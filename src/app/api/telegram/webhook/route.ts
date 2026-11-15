import { NextRequest, NextResponse } from "next/server";
import { handleTelegramUpdate, webhookSecret, type TgUpdate } from "@/lib/server/telegramBot";
import { safeEqual } from "@/lib/server/security";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Telegram pushes each message here once the webhook is registered with
// setWebhook (see README). Telegram sends the secret_token chosen at setup in
// this header, so random callers can't make the bot talk.
export async function POST(req: NextRequest) {
  const secret = webhookSecret();
  const got = req.headers.get("x-telegram-bot-api-secret-token");
  if (!secret || !got || !safeEqual(got, secret)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  if (update) await handleTelegramUpdate(update).catch((err) => console.error("telegram update failed:", err));
  return NextResponse.json({ ok: true }); // always 200, or Telegram keeps retrying
}
