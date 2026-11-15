import nodemailer from "nodemailer";
import type { ChainsawDetection } from "@/lib/acoustic";
import type { ActiveFire } from "@/lib/fires";
import { nearestPlaceLabel } from "@/lib/server/placesServer";
import { getState, setState } from "@/lib/server/store";

// Email alerts through Brevo's SMTP relay (free plan has a daily sending
// allowance). Settings come from .env.local:
//   BREVO_SMTP_KEY    the SMTP key (starts "xsmtpsib-"), used as the password
//   BREVO_SMTP_LOGIN  the SMTP login shown on Brevo's SMTP & API page
//   ALERT_EMAIL_FROM  a sender address verified in Brevo
//   ALERT_EMAIL_TO    one or more recipients, comma-separated
const SMTP_HOST = "smtp-relay.brevo.com";
const SMTP_PORT = 587;

const MAX_FIRES_PER_EMAIL = 15;

export function alertsConfigured(): { ok: boolean; missing: string[] } {
  const missing = ["BREVO_SMTP_KEY", "BREVO_SMTP_LOGIN", "ALERT_EMAIL_FROM", "ALERT_EMAIL_TO"].filter((k) => !process.env[k]);
  return { ok: missing.length === 0, missing };
}

export async function sendAlertEmail(subject: string, lines: string[]): Promise<void> {
  const { ok, missing } = alertsConfigured();
  if (!ok) throw new Error(`Email alerts not configured; missing ${missing.join(", ")} in .env.local`);

  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    auth: { user: process.env.BREVO_SMTP_LOGIN, pass: process.env.BREVO_SMTP_KEY },
  });
  const text = [...lines, "", "Aniwa — Ghana forest watch. Live data; check on the ground before acting."].join("\n");
  await transport.sendMail({
    from: `Aniwa alerts <${process.env.ALERT_EMAIL_FROM}>`,
    to: process.env.ALERT_EMAIL_TO,
    subject: `[Aniwa] ${subject}`,
    text,
  });
}

// SMS through Africa's Talking. With AT_USERNAME=sandbox, messages go to
// their online simulator (simulator.africastalking.com), not real phones;
// switch to the live username and key to text real numbers.
//   AT_USERNAME     "sandbox" for testing, or the live app's username
//   AT_API_KEY      API key from the Africa's Talking dashboard
//   ALERT_SMS_TO    one or more numbers in +233… format, comma-separated
export function smsConfigured(): { ok: boolean; missing: string[] } {
  const missing = ["AT_USERNAME", "AT_API_KEY", "ALERT_SMS_TO"].filter((k) => !process.env[k]);
  return { ok: missing.length === 0, missing };
}

export async function sendAlertSms(message: string): Promise<void> {
  const { ok, missing } = smsConfigured();
  if (!ok) throw new Error(`SMS alerts not configured; missing ${missing.join(", ")} in .env.local`);
  const username = process.env.AT_USERNAME!;
  const base = username === "sandbox" ? "https://api.sandbox.africastalking.com" : "https://api.africastalking.com";
  const res = await fetch(`${base}/version1/messaging`, {
    method: "POST",
    headers: { apiKey: process.env.AT_API_KEY!, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, to: process.env.ALERT_SMS_TO!, message }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Africa's Talking ${res.status}: ${body.slice(0, 200)}`);
  // A 2xx can still carry per-number failures (e.g. invalid number format).
  const recipients: { status?: string; number?: string }[] = JSON.parse(body)?.SMSMessageData?.Recipients ?? [];
  const failed = recipients.filter((r) => r.status && r.status !== "Success");
  if (recipients.length === 0 || failed.length === recipients.length) {
    throw new Error(`Africa's Talking accepted the request but sent nothing: ${body.slice(0, 200)}`);
  }
}

// SMS rule: a single detection could be a passing motorbike, so only text
// once a second detection lands within SMS_CLUSTER_KM / SMS_WINDOW_MIN of
// another — and then not again for the same area for SMS_COOLDOWN_MIN.
// ALERT_DEMO_MODE=1 in .env.local alerts on a single detection with a 1-minute
// cooldown — for live demos, where waiting for a second detection is too slow.
// Leave it off in the field.
const SMS_CLUSTER_KM = 2;
const SMS_WINDOW_MIN = 10;
const SMS_COOLDOWN_MIN = 30;
const DEMO_COOLDOWN_MIN = 1;
const demoMode = () => process.env.ALERT_DEMO_MODE === "1";

function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Telegram bot alerts — free, and arrive as push notifications.
//   TELEGRAM_BOT_TOKEN  from @BotFather
//   TELEGRAM_CHAT_ID    the chat(s) to post to, comma-separated (a person or a
//                       group; GET /api/alerts/telegram-chats lists them)
export function telegramConfigured(): { ok: boolean; missing: string[] } {
  const missing = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"].filter((k) => !process.env[k]);
  return { ok: missing.length === 0, missing };
}

export async function sendTelegram(text: string): Promise<void> {
  const { ok, missing } = telegramConfigured();
  if (!ok) throw new Error(`Telegram alerts not configured; missing ${missing.join(", ")} in .env.local`);
  const chatIds = process.env.TELEGRAM_CHAT_ID!.split(",").map((s) => s.trim()).filter(Boolean);
  for (const chatId of chatIds) {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) throw new Error(`Telegram (chat ${chatId}): ${body?.description ?? `HTTP ${res.status}`}`);
  }
}

// Sends to every instant channel that's configured (SMS, Telegram); one
// failing doesn't stop the other.
async function sendInstant(text: string): Promise<void> {
  const sends: Promise<void>[] = [];
  if (smsConfigured().ok) sends.push(sendAlertSms(text));
  if (telegramConfigured().ok) sends.push(sendTelegram(text));
  const results = await Promise.allSettled(sends);
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length > 0 && failures.length === results.length) throw failures[0].reason;
  for (const f of failures) console.error("instant alert channel failed:", f.reason);
}

export async function maybeAlertChainsawCluster(latest: ChainsawDetection, all: ChainsawDetection[]): Promise<void> {
  if (!smsConfigured().ok && !telegramConfigured().ok) return;
  const t = new Date(latest.detectedAt).getTime();
  const nearby = all.filter(
    (d) => d.id !== latest.id && Math.abs(new Date(d.detectedAt).getTime() - t) <= SMS_WINDOW_MIN * 60000 && kmBetween(d, latest) <= SMS_CLUSTER_KM,
  );
  const demo = demoMode();
  if (nearby.length === 0 && !demo) return;

  let log = (await getState<{ lat: number; lng: number; sentAt: string }[]>("sms_log")) ?? [];
  const cooldownMin = demo ? DEMO_COOLDOWN_MIN : SMS_COOLDOWN_MIN;
  const recent = log.find((s) => Date.now() - new Date(s.sentAt).getTime() < cooldownMin * 60000 && kmBetween(s, latest) <= SMS_CLUSTER_KM);
  if (recent) return;

  const heard = nearby.length === 0 ? "heard" : `heard ${nearby.length + 1} times in ${SMS_WINDOW_MIN} min`;
  const place = await nearestPlaceLabel(latest);
  await sendInstant(
    `ANIWA ALERT: chainsaw ${heard} ${place ? `(${place}) ` : ""}near ${latest.lat.toFixed(4)},${latest.lng.toFixed(4)} (${latest.deviceName}, ${Math.round(latest.score * 100)}% confidence). ${mapLink(latest.lat, latest.lng)}`,
  );
  log = [...log.filter((s) => Date.now() - new Date(s.sentAt).getTime() < 24 * 3600000), { lat: latest.lat, lng: latest.lng, sentAt: new Date().toISOString() }];
  await setState("sms_log", log);
}

const mapLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat.toFixed(5)},${lng.toFixed(5)}`;

export async function alertChainsaw(d: ChainsawDetection): Promise<void> {
  const place = await nearestPlaceLabel(d);
  await sendAlertEmail(`Chainsaw heard${place ? ` near ${place}` : ""} by ${d.deviceName}`, [
    `A listening phone heard a chainsaw (${Math.round(d.score * 100)}% confidence).`,
    ...(place ? [`Nearest settlement: ${place}`] : []),
    `Phone: ${d.deviceName}`,
    `Time: ${new Date(d.detectedAt).toUTCString()}`,
    `Phone position: ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}${d.accuracyM !== null ? ` (GPS ±${Math.round(d.accuracyM)} m)` : ""}`,
    `Map: ${mapLink(d.lat, d.lng)}`,
    "The saw is within roughly 1 km of the phone, not at the pin itself.",
  ]);
}

const fireKey = (f: ActiveFire) => `${f.lat},${f.lng},${f.acquiredAt},${f.satellite}`;

// Emails forest-region fires that haven't been emailed before. Remembers
// what was sent in data/alerted_fires.json so each fire is reported once.
export async function alertNewForestFires(forestFires: ActiveFire[]): Promise<void> {
  const email = alertsConfigured().ok;
  const telegram = telegramConfigured().ok;
  if ((!email && !telegram) || forestFires.length === 0) return;

  const alerted = await getState<string[]>("alerted_fires");
  if (alerted === null) {
    // First run: treat every current fire as already known, so turning
    // alerts on doesn't send a burst of days-old fires.
    await setState("alerted_fires", forestFires.map(fireKey));
    return;
  }

  const known = new Set(alerted);
  const fresh = forestFires.filter((f) => !known.has(fireKey(f)) && f.confidence !== "low");
  if (fresh.length === 0) return;

  const byRegion: Record<string, number> = {};
  for (const f of fresh) byRegion[f.region] = (byRegion[f.region] ?? 0) + 1;
  const subject = `${fresh.length} new NASA fire${fresh.length === 1 ? "" : "s"} in forest regions`;
  const places = await Promise.all(fresh.slice(0, MAX_FIRES_PER_EMAIL).map((f) => nearestPlaceLabel(f)));
  const lines = [
    `NASA FIRMS detected ${fresh.length} new fire${fresh.length === 1 ? "" : "s"} in Ghana's forest belt, where fire usually means land being cleared.`,
    `By region: ${Object.entries(byRegion).map(([r, n]) => `${r} ${n}`).join(", ")}`,
    "",
    ...fresh.slice(0, MAX_FIRES_PER_EMAIL).map(
      (f, i) => `- ${places[i] ?? f.region}, ${new Date(f.acquiredAt).toUTCString()}, ${f.confidence} confidence: ${mapLink(f.lat, f.lng)}`,
    ),
    ...(fresh.length > MAX_FIRES_PER_EMAIL ? [`…and ${fresh.length - MAX_FIRES_PER_EMAIL} more on the dashboard.`] : []),
  ];
  const results = await Promise.allSettled([
    ...(email ? [sendAlertEmail(subject, lines)] : []),
    ...(telegram ? [sendTelegram([`ANIWA: ${subject}`, ...lines].join("\n"))] : []),
  ]);
  for (const r of results) if (r.status === "rejected") console.error("fire alert channel failed:", r.reason);
  // If every channel failed, keep these fires unmarked so the next refresh retries.
  if (results.every((r) => r.status === "rejected")) return;

  // Keep the remembered list bounded to fires FIRMS can still return.
  const current = new Set(forestFires.map(fireKey));
  const next = [...alerted.filter((k) => current.has(k)), ...fresh.map(fireKey)];
  await setState("alerted_fires", next);
}
