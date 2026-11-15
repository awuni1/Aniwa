import fs from "node:fs/promises";
import path from "node:path";
import { HOT_DAY_THRESHOLD_C, type ClimateYear } from "@/lib/climate";

// NASA POWER daily point API — no key needed. Verified live on 2026-11-10:
// 1991-2024 daily max temperature for one point returns in ~3 s (~210 KB).
const POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point";
const FIRST_YEAR = 1991;
// Last complete calendar year; the current year is partial and would
// undercount hot days.
const LAST_YEAR = new Date().getUTCFullYear() - 1;
const MISSING = -999; // POWER's fill value

const CACHE_PATH = path.join(process.cwd(), "data", "power_climate_cache.json");
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // history doesn't change; refresh monthly

type Cache = Record<string, { fetchedAt: string; lastYear: number; years: ClimateYear[] }>;

async function readCache(): Promise<Cache> {
  try {
    return JSON.parse(await fs.readFile(CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function writeCache(cache: Cache): Promise<void> {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache), "utf8");
}

export async function getClimateHistory(key: string, lat: number, lng: number): Promise<ClimateYear[]> {
  const cache = await readCache();
  const hit = cache[key];
  if (hit && hit.lastYear === LAST_YEAR && Date.now() - new Date(hit.fetchedAt).getTime() < CACHE_MAX_AGE_MS) return hit.years;

  const url = `${POWER_URL}?parameters=T2M_MAX&community=AG&longitude=${lng}&latitude=${lat}&start=${FIRST_YEAR}0101&end=${LAST_YEAR}1231&format=JSON`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`NASA POWER request failed (${res.status})`);
  const body = await res.json();
  const daily: Record<string, number> | undefined = body?.properties?.parameter?.T2M_MAX;
  if (!daily) throw new Error("NASA POWER returned no temperature data");

  const byYear = new Map<number, { hot: number; sum: number; n: number }>();
  for (const [date, value] of Object.entries(daily)) {
    if (value === MISSING) continue;
    const year = Number(date.slice(0, 4));
    const y = byYear.get(year) ?? { hot: 0, sum: 0, n: 0 };
    if (value >= HOT_DAY_THRESHOLD_C) y.hot++;
    y.sum += value;
    y.n++;
    byYear.set(year, y);
  }
  const years: ClimateYear[] = [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, y]) => ({ year, hotDays: y.hot, meanMaxTempC: y.sum / y.n }));

  cache[key] = { fetchedAt: new Date().toISOString(), lastYear: LAST_YEAR, years };
  await writeCache(cache);
  return years;
}
