// Two-way Telegram bot for tackling deforestation: answers commands with the
// same live data and prediction model as the dashboard. /predict (where
// clearing is likely next), /forest (how much is being lost), /chainsaw
// (illegal logging heard by listening phones), /fires (fires that are often
// land clearing). Alerts themselves go out from alerts.ts.
//
// Two ways messages reach it:
//   - startTelegramPolling(): asks Telegram for new messages in a loop. Started
//     from src/instrumentation.ts for `npm run dev` / `npm start`; needs no
//     public URL.
//   - POST /api/telegram/webhook: Telegram pushes each message, for deployed
//     hosts (Vercel). Polling and a webhook can't both be active for one bot.
//
// /chainsaw shows where listening phones are, so it only answers in the chats
// listed in TELEGRAM_CHAT_ID. Fire data is public NASA data and answers anyone.

import fs from "node:fs/promises";
import path from "node:path";
import { FOREST_BELT_REGIONS, predictHotspots, type DeforestationPrediction, type TreeCoverLookup } from "@/lib/deforestationModel";
import type { ActiveFire } from "@/lib/fires";
import { pointInGeometry } from "@/lib/geo";
import { getActiveFires } from "@/lib/server/firmsClient";
import { getGhanaLossData } from "@/lib/server/gfwClient";
import { loadRegionFeatures } from "@/lib/server/ghanaRegions";
import { getLastFireCheck } from "@/lib/server/fireSchedule";
import { nearestPlaceLabel } from "@/lib/server/placesServer";
import { rateLimit } from "@/lib/server/security";
import { listDetections } from "@/lib/server/store";

const MAX_LISTED = 8;
const FIRE_WINDOW_H = 24;
const CHAINSAW_WINDOW_H = 24;

interface TgMessage {
  chat: { id: number; type: string };
  text?: string;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

const token = () => process.env.TELEGRAM_BOT_TOKEN;
const api = (method: string) => `https://api.telegram.org/bot${token()}/${method}`;

const alertChats = () =>
  new Set((process.env.TELEGRAM_CHAT_ID ?? "").split(",").map((s) => s.trim()).filter(Boolean));

const mapLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat.toFixed(5)},${lng.toFixed(5)}`;

const COMMANDS = [
  { command: "predict", description: "Where forest is most likely to be cleared next" },
  { command: "forest", description: "How much forest Ghana is losing, by region" },
  { command: "chainsaw", description: "Illegal logging: chainsaws heard in the last 24 hours" },
  { command: "fires", description: "Fires in the forest belt (often land clearing), last 24 hours" },
  { command: "status", description: "Is Aniwa's data up to date?" },
  { command: "myid", description: "This chat's ID, for adding it to alerts" },
  { command: "help", description: "What this bot does" },
];

async function reply(chatId: number, text: string): Promise<void> {
  const res = await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) console.error("telegram reply failed:", res.status, (await res.text()).slice(0, 200));
}

function ago(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function helpText(): string {
  return [
    "Aniwa helps tackle deforestation in Ghana. It predicts where forest is most likely to be cleared next, listens for chainsaws (illegal logging) through phones in the forest, and watches NASA satellites for fires in the forest belt, which usually mean land being cleared.",
    "",
    "This chat gets an alert when a chainsaw is heard or a new forest fire is seen. You can also ask:",
    ...COMMANDS.map((c) => `/${c.command} - ${c.description}`),
    "",
    `Add a region to narrow it down, e.g. /predict Ashanti or /forest Western. Forest regions: ${[...FOREST_BELT_REGIONS].join(", ")}.`,
  ].join("\n");
}

// Matches "ashanti", "Western North", "west" to a region name; null if none.
function matchRegion(arg: string, names: Iterable<string>): string | null {
  const list = [...names];
  const a = arg.toLowerCase();
  return list.find((r) => r.toLowerCase() === a) ?? list.find((r) => r.toLowerCase().startsWith(a)) ?? null;
}

const pct = (x: number) => `${Math.round(x)}%`;

// Same ESA WorldCover tree-cover grid the dashboard loads (lib/treeCover.ts),
// read from disk on the server.
let treeCoverPromise: Promise<TreeCoverLookup | undefined> | null = null;
function loadTreeCoverServer(): Promise<TreeCoverLookup | undefined> {
  treeCoverPromise ??= fs
    .readFile(path.join(process.cwd(), "public", "ghana_tree_cover.json"), "utf8")
    .then((raw) => {
      const grid = JSON.parse(raw) as { west: number; north: number; res: number; rows: number; cols: number; data: string };
      const bytes = Buffer.from(grid.data, "base64");
      const lookup: TreeCoverLookup = ({ lat, lng }) => {
        const r = Math.floor((grid.north - lat) / grid.res);
        const c = Math.floor((lng - grid.west) / grid.res);
        if (r < 0 || r >= grid.rows || c < 0 || c >= grid.cols) return null;
        const v = bytes[r * grid.cols + c];
        return v === 255 ? null : v / 100;
      };
      return lookup;
    })
    .catch(() => undefined);
  return treeCoverPromise;
}

// Scores every ~17 km cell in Ghana with the dashboard's model, using live
// forest-loss history, chainsaw detections and fires. Cached for 30 min.
const PREDICT_CACHE_MS = 30 * 60 * 1000;
let predictCache: { at: number; ranked: (DeforestationPrediction & { region: string | null })[] } | null = null;

async function rankedHotspots() {
  if (predictCache && Date.now() - predictCache.at < PREDICT_CACHE_MS) return predictCache.ranked;
  const [loss, fires, detections, features, treeCoverAt] = await Promise.all([
    getGhanaLossData(),
    getActiveFires().catch(() => null),
    listDetections().catch(() => []),
    loadRegionFeatures().catch(() => []),
    loadTreeCoverServer(),
  ]);
  const regionOf = (p: { lat: number; lng: number }) =>
    features.find((f) => pointInGeometry(p, f.geometry))?.properties.shapeName.replace(/ Region$/, "") ?? null;
  const insideGhana = (p: { lat: number; lng: number }) => features.length === 0 || regionOf(p) !== null;
  const activity = { chainsaws: detections, fires: fires?.available ? fires.fires : [] };
  const ranked = predictHotspots(loss.regions, activity, insideGhana, 400, treeCoverAt).map((h) => ({ ...h, region: regionOf(h) }));
  predictCache = { at: Date.now(), ranked };
  return ranked;
}

function whyText(h: DeforestationPrediction): string {
  const reasons: string[] = [];
  if (h.chainsawDetectionsNearby > 0) reasons.push(`${h.chainsawDetectionsNearby} chainsaw${h.chainsawDetectionsNearby === 1 ? "" : "s"} heard nearby`);
  if (h.forestFiresNearby > 0) reasons.push(`${h.forestFiresNearby} forest fire${h.forestFiresNearby === 1 ? "" : "s"} nearby`);
  if (h.regionActiveAlertHa > 0) reasons.push(`${Math.round(h.regionActiveAlertHa).toLocaleString("en-US")} ha of clearing alerts in the region this month`);
  if (h.treeCoverPct !== null) reasons.push(`${Math.round(h.treeCoverPct)}% tree cover left here`);
  reasons.push(`${Math.round(h.distanceToFrontierKm)} km from the ${h.nearestFrontierRegion} loss frontier`);
  return reasons.join("; ");
}

async function predictText(arg: string): Promise<string> {
  const ranked = await rankedHotspots();
  let region: string | null = null;
  if (arg) {
    region = matchRegion(arg, new Set(ranked.map((h) => h.region).filter((r): r is string => r !== null)));
    if (!region) return `"${arg}" isn't a region I know. Try one of: ${[...FOREST_BELT_REGIONS].join(", ")}.`;
  }
  const top = (region ? ranked.filter((h) => h.region === region) : ranked).slice(0, 5);
  if (top.length === 0) return `No high-risk places found in ${region} Region.`;
  const places = await Promise.all(top.map((h) => nearestPlaceLabel(h)));
  return [
    `Where forest is most likely to be cleared next${region ? ` in ${region} Region` : " in Ghana"}:`,
    "",
    ...top.flatMap((h, i) => [
      `${i + 1}. ${places[i] ?? h.region ?? "Unknown place"}: ${pct(h.probability * 100)} risk (${h.riskLevel})`,
      `   Why: ${whyText(h)}`,
      `   ${mapLink(h.lat, h.lng)}`,
    ]),
    "",
    "Aniwa's model combines forest loss since 2001 (Global Forest Watch), this month's clearing alerts, chainsaws heard and NASA fires. It shows where to send patrols first, not a certainty.",
  ].join("\n");
}

async function forestText(arg: string): Promise<string> {
  const loss = await getGhanaLossData();
  const fmtHa = (kha: number) => `${Math.round(kha * 1000).toLocaleString("en-US")} ha`;
  if (arg) {
    const name = matchRegion(arg, loss.regions.map((r) => r.region));
    if (!name) return `"${arg}" isn't a region I know. Try one of: ${loss.regions.map((r) => r.region).join(", ")}.`;
    const r = loss.regions.find((x) => x.region === name)!;
    return [
      `${r.region} Region (Global Forest Watch):`,
      `- Tree cover lost 2001-${loss.dataThroughYear}: ${fmtHa(r.totalLossKha2001to2024)}`,
      `- Lost in ${loss.dataThroughYear}: ${fmtHa(r.lossKha2024)}`,
      `- Clearing alerts in the last 30 days: ${r.recentAlertCount.toLocaleString("en-US")} (${Math.round(r.recentAlertAreaHa).toLocaleString("en-US")} ha)`,
      "",
      `Send /predict ${r.region} for where clearing is likely next.`,
    ].join("\n");
  }
  const f = loss.forestSince2000;
  const recent = [...loss.regions].sort((a, b) => b.recentAlertAreaHa - a.recentAlertAreaHa).slice(0, 5);
  return [
    "Ghana's forest (Global Forest Watch, satellite data):",
    ...(f ? [`- Since 2000, Ghana has lost ${pct(f.nationalLostPct)} of its tree cover (${fmtHa(f.nationalLossKha)} of ${fmtHa(f.nationalExtent2000Kha)}).`] : []),
    `- Lost in ${loss.dataThroughYear}: ${fmtHa(loss.nationalTotalLossKha2024)}`,
    `- Clearing alerts in the last 30 days: ${Math.round(loss.nationalRecentAlertAreaHa).toLocaleString("en-US")} ha`,
    "",
    "Most active clearing this month:",
    ...recent.map((r, i) => `${i + 1}. ${r.region}: ${Math.round(r.recentAlertAreaHa).toLocaleString("en-US")} ha`),
    "",
    "Add a region for its details, e.g. /forest Ashanti.",
  ].join("\n");
}

async function firesText(arg: string): Promise<string> {
  const data = await getActiveFires();
  if (!data.available) return `NASA fire data is unavailable right now (${data.error ?? "unknown error"}). Try again later.`;

  let region: string | null = null;
  if (arg) {
    region = [...FOREST_BELT_REGIONS].find((r) => r.toLowerCase() === arg.toLowerCase())
      ?? [...FOREST_BELT_REGIONS].find((r) => r.toLowerCase().startsWith(arg.toLowerCase())) ?? null;
    if (!region) return `"${arg}" isn't a forest-belt region. Use one of: ${[...FOREST_BELT_REGIONS].join(", ")}.`;
  }

  const since = Date.now() - FIRE_WINDOW_H * 3600000;
  const fires: ActiveFire[] = data.fires
    .filter((f) => (region ? f.region === region : FOREST_BELT_REGIONS.has(f.region)))
    .filter((f) => f.confidence !== "low" && new Date(f.acquiredAt).getTime() >= since)
    .sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt));
  const where = region ? `${region} Region` : "Ghana's forest belt";

  if (fires.length === 0) {
    return `No fires seen in ${where} in the last ${FIRE_WINDOW_H} hours (NASA FIRMS, updated ${ago(data.fetchedAt)}).`;
  }

  const byRegion: Record<string, number> = {};
  for (const f of fires) byRegion[f.region] = (byRegion[f.region] ?? 0) + 1;
  const shown = fires.slice(0, MAX_LISTED);
  const places = await Promise.all(shown.map((f) => nearestPlaceLabel(f)));
  return [
    `${fires.length} fire${fires.length === 1 ? "" : "s"} in ${where} in the last ${FIRE_WINDOW_H} hours (NASA FIRMS). In the forest belt, fire usually means land being cleared.`,
    ...(region ? [] : [`By region: ${Object.entries(byRegion).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(", ")}`]),
    "",
    "Most recent:",
    ...shown.map((f, i) => `- ${places[i] ?? f.region}, ${ago(f.acquiredAt)}, ${f.confidence} confidence: ${mapLink(f.lat, f.lng)}`),
    ...(fires.length > MAX_LISTED ? [`...and ${fires.length - MAX_LISTED} more on the dashboard.`] : []),
  ].join("\n");
}

async function chainsawText(chatId: number): Promise<string> {
  if (!alertChats().has(String(chatId))) {
    return "Chainsaw reports show where listening phones are, so they're only shared in Aniwa's alert chats. Ask the Aniwa admin to add this chat (send /myid and give them the number).";
  }
  const since = Date.now() - CHAINSAW_WINDOW_H * 3600000;
  const recent = (await listDetections()).filter((d) => new Date(d.detectedAt).getTime() >= since);
  if (recent.length === 0) return `No chainsaws heard by Aniwa's listening phones in the last ${CHAINSAW_WINDOW_H} hours.`;
  const shown = recent.slice(0, MAX_LISTED);
  const places = await Promise.all(shown.map((d) => nearestPlaceLabel(d)));
  return [
    `${recent.length} chainsaw${recent.length === 1 ? "" : "s"} heard in the last ${CHAINSAW_WINDOW_H} hours, possible illegal logging. Each saw is within about 1 km of the phone that heard it.`,
    "",
    ...shown.map((d, i) => `- ${places[i] ?? "Unknown place"}, ${ago(d.detectedAt)}, ${d.deviceName}, ${Math.round(d.score * 100)}% confidence: ${mapLink(d.lat, d.lng)}`),
    ...(recent.length > MAX_LISTED ? [`...and ${recent.length - MAX_LISTED} more on the dashboard.`] : []),
  ].join("\n");
}

async function statusText(): Promise<string> {
  const [data, loss] = await Promise.all([getActiveFires(), getGhanaLossData().catch(() => null)]);
  const check = getLastFireCheck();
  return [
    loss
      ? `Forest-loss data (Global Forest Watch): working, clearing alerts up to ${loss.alertsAsOfLatest.slice(0, 10)}.`
      : "Forest-loss data (Global Forest Watch): unavailable right now.",
    data.available
      ? `NASA fire data: working, updated ${ago(data.fetchedAt)} (${data.fires.length} fires in Ghana over the last ${data.days} days).`
      : `NASA fire data: unavailable (${data.error ?? "unknown error"}).`,
    check
      ? `Automatic fire check: last ran ${ago(check.checkedAt)}${check.ok ? "" : ` and failed (${check.error})`}. Runs every 30 min.`
      : "Automatic fire check: hasn't run yet since the server started.",
    `Alerts go to ${alertChats().size} Telegram chat${alertChats().size === 1 ? "" : "s"}.`,
  ].join("\n");
}

// The reply text for one command, or null when the bot should stay quiet.
export async function answerCommand(cmd: string, arg: string, chatId: number, isPrivate: boolean): Promise<string | null> {
  let out: string;
  try {
    switch (cmd) {
      case "start":
      case "help":
        out = helpText();
        break;
      case "predict":
      case "risk":
        out = await predictText(arg);
        break;
      case "forest":
      case "loss":
        out = await forestText(arg);
        break;
      case "fires":
        out = await firesText(arg);
        break;
      case "chainsaw":
      case "chainsaws":
        out = await chainsawText(chatId);
        break;
      case "status":
        out = await statusText();
        break;
      case "myid":
        out = `This chat's ID is ${chatId}. To send Aniwa alerts here, add it to TELEGRAM_CHAT_ID.`;
        break;
      default:
        if (!isPrivate) return null;
        out = "I don't know that command. Send /help to see what I can do.";
    }
  } catch (err) {
    console.error("telegram command failed:", err);
    out = "Something went wrong getting that. Try again in a minute.";
  }
  return out;
}

export async function handleTelegramUpdate(update: TgUpdate): Promise<void> {
  const msg = update.message;
  const text = msg?.text?.trim();
  if (!msg || !text) return;
  const isPrivate = msg.chat.type === "private";
  // In groups, only react to commands so normal conversation is ignored.
  if (!text.startsWith("/")) {
    if (isPrivate) await reply(msg.chat.id, "I answer commands. Send /help to see them.");
    return;
  }
  if (!rateLimit(`tg:${msg.chat.id}`, 10, 60000)) return;

  const [rawCmd, ...rest] = text.split(/\s+/);
  const [cmd, mention] = rawCmd.slice(1).toLowerCase().split("@");
  // "/fires@some_other_bot" in a group is meant for another bot.
  if (mention && process.env.TELEGRAM_BOT_USERNAME && mention !== process.env.TELEGRAM_BOT_USERNAME.toLowerCase()) return;
  const arg = rest.join(" ").slice(0, 40);

  const out = await answerCommand(cmd, arg, msg.chat.id, isPrivate);
  if (out) await reply(msg.chat.id, out);
}

// Long polling: each request waits up to 25 s for new messages.
const globalForBot = globalThis as unknown as { aniwaTelegramPolling?: boolean };

export function startTelegramPolling(): void {
  if (!token() || globalForBot.aniwaTelegramPolling) return;
  globalForBot.aniwaTelegramPolling = true;

  void fetch(api("setMyCommands"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands: COMMANDS }),
    signal: AbortSignal.timeout(20000),
  }).catch(() => {});

  let offset = 0;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const loop = async () => {
    for (;;) {
      try {
        const res = await fetch(`${api("getUpdates")}?timeout=25&offset=${offset}&allowed_updates=${encodeURIComponent('["message"]')}`, {
          signal: AbortSignal.timeout(35000),
        });
        if (res.status === 409) {
          // A webhook is set, or another server is polling with this bot.
          console.warn("telegram bot: another server or a webhook is receiving this bot's messages; retrying in 60 s");
          await wait(60000);
          continue;
        }
        const body = (await res.json()) as { ok: boolean; result?: TgUpdate[] };
        if (!body.ok) {
          await wait(5000);
          continue;
        }
        for (const update of body.result ?? []) {
          offset = update.update_id + 1;
          await handleTelegramUpdate(update).catch((err) => console.error("telegram update failed:", err));
        }
      } catch {
        await wait(5000); // network blip or timeout
      }
    }
  };
  void loop();
  console.log("telegram bot: answering commands (/fires, /status, ...)");
}
