import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/server/security";

export const dynamic = "force-dynamic";

// Lists the chats that have recently messaged the bot (or groups it was
// added to), so their IDs can be copied into TELEGRAM_CHAT_ID. Telegram only
// keeps these updates for about 24 hours.
// Setup tool: it reveals the names and usernames of people who messaged the
// bot, so only an admin may call it (see lib/server/security.ts).
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN is not set in .env.local" }, { status: 400 });

  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { signal: AbortSignal.timeout(20000) });
  const body = await res.json().catch(() => null);
  if (!body?.ok) return NextResponse.json({ error: body?.description ?? `HTTP ${res.status}` }, { status: 502 });

  type Chat = { id: number; type: string; title?: string; first_name?: string; username?: string };
  const chats = new Map<number, Chat>();
  for (const u of body.result as Record<string, { chat?: Chat }>[]) {
    const chat = (u.message ?? u.my_chat_member ?? u.channel_post ?? u.edited_message)?.chat;
    if (chat) chats.set(chat.id, chat);
  }
  return NextResponse.json({
    chats: [...chats.values()].map((c) => ({ id: c.id, type: c.type, name: c.title ?? c.first_name ?? c.username ?? "" })),
  });
}
