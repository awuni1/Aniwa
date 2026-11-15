import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/server/security";
import { alertsConfigured, sendAlertEmail, smsConfigured, sendAlertSms, telegramConfigured, sendTelegram } from "@/lib/server/alerts";

export const dynamic = "force-dynamic";

// Sends one test message so the settings can be checked without waiting for
// a real chainsaw or fire. ?channel=sms or ?channel=telegram; default is email.
// Setup tool: sends real messages, so only an admin may call it (see lib/server/security.ts).
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const channel = req.nextUrl.searchParams.get("channel");
  const { ok, missing } = channel === "sms" ? smsConfigured() : channel === "telegram" ? telegramConfigured() : alertsConfigured();
  if (!ok) return NextResponse.json({ ok: false, error: `Missing in .env.local: ${missing.join(", ")}` }, { status: 400 });
  try {
    if (channel === "sms") await sendAlertSms("ANIWA TEST: SMS alerts are working.");
    else if (channel === "telegram") await sendTelegram("ANIWA TEST: Telegram alerts are working.");
    else await sendAlertEmail("Test alert", ["This is a test of Aniwa's email alerts. If you can read this, alerts are working."]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
