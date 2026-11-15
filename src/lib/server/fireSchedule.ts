// Scheduled fire check. Fetching fresh NASA FIRMS data is what triggers
// forest-fire alerts (lib/server/firmsClient.ts -> alerts.ts), so without a
// schedule, alerts only went out when someone happened to open the dashboard.
//
// Two ways this runs:
//   - startFireSchedule(): a timer inside the server process, started from
//     src/instrumentation.ts. Works for `npm run dev` and `npm start`.
//   - GET /api/cron/fires: for hosts where a process can't keep a timer
//     (Vercel, other serverless), called by Vercel Cron or any scheduler.

import { getActiveFires, waitForFireAlerts } from "@/lib/server/firmsClient";

export const FIRE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // matches the FIRMS cache, so each run fetches fresh data
const FIRST_RUN_DELAY_MS = 60 * 1000; // let the server finish starting first

type FireCheckResult = { ok: boolean; fires: number; checkedAt: string; error?: string };

const globalForCheck = globalThis as unknown as { aniwaLastFireCheck?: FireCheckResult };
export const getLastFireCheck = () => globalForCheck.aniwaLastFireCheck ?? null;

export async function runFireCheck(): Promise<FireCheckResult> {
  const result = await checkFires();
  globalForCheck.aniwaLastFireCheck = result;
  return result;
}

async function checkFires(): Promise<FireCheckResult> {
  const checkedAt = new Date().toISOString();
  try {
    const data = await getActiveFires();
    await waitForFireAlerts(); // make sure any alert has actually been sent
    if (!data.available) return { ok: false, fires: 0, checkedAt, error: data.error };
    return { ok: true, fires: data.fires.length, checkedAt };
  } catch (err) {
    console.error("fire check failed:", err);
    return { ok: false, fires: 0, checkedAt, error: "fire check failed" };
  }
}

const globalForSchedule = globalThis as unknown as { aniwaFireTimer?: ReturnType<typeof setInterval> };

export function startFireSchedule(): void {
  if (globalForSchedule.aniwaFireTimer) return; // already running (hot reload, double start)
  const tick = () => {
    void runFireCheck().then((r) =>
      console.log(r.ok ? `fire check: ${r.fires} fires from NASA FIRMS` : `fire check skipped: ${r.error}`),
    );
  };
  setTimeout(tick, FIRST_RUN_DELAY_MS);
  globalForSchedule.aniwaFireTimer = setInterval(tick, FIRE_CHECK_INTERVAL_MS);
  console.log(`fire alerts: checking NASA FIRMS every ${FIRE_CHECK_INTERVAL_MS / 60000} minutes`);
}
