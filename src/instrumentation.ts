// Runs once when the Next.js server starts. Starts the 30-minute fire check
// (so forest-fire alerts go out even when nobody has the dashboard open) and
// the Telegram bot's command replies.
// Skipped on Vercel (serverless functions can't keep a timer; vercel.json's
// cron calls /api/cron/fires instead) and when FIRE_ALERT_SCHEDULE=off.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.VERCEL) return; // vercel.json's cron and the Telegram webhook take over
  if (process.env.FIRE_ALERT_SCHEDULE !== "off") {
    const { startFireSchedule } = await import("@/lib/server/fireSchedule");
    startFireSchedule();
  }
  // Answer Telegram commands (/fires, /status, ...) by polling; no public URL needed.
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_POLLING !== "off") {
    const { startTelegramPolling } = await import("@/lib/server/telegramBot");
    startTelegramPolling();
  }
}
