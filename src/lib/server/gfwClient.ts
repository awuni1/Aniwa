import type { ForestSince2000 } from "@/lib/deforestation";
import fs from "node:fs/promises";
import path from "node:path";

// Real, live Global Forest Watch Data API — gadm__tcl__adm1_change dataset
// (Hansen/UMD Global Forest Change via GFW, per-admin1-region, per-year tree
// cover loss). Verified directly against the live API on 2026-10-02:
//   - Real data covers loss years 2001-2024 (checked via MIN/MAX query —
//     NOT 2025, despite the dataset's own version-number pattern suggesting
//     otherwise; don't infer vintage from version strings, query it).
//   - The "umd_tree_cover_density_2000__threshold" field is a DIMENSION
//     (0/10/15/20/25/30/50/75), not a single row — summing without filtering
//     to one threshold overcounts by ~7x. 30% canopy density is GFW's own
//     canonical default for headline "tree cover loss" stats, confirmed by
//     cross-checking against the previously-pasted GNW dashboard figures
//     (Western 431.5kha here vs 450kha pasted, Ashanti 410.9kha vs 440kha,
//     etc. — consistently close, confirming this is the right threshold).
const GFW_BASE = "https://data-api.globalforestwatch.org";
const DATASET = "gadm__tcl__adm1_change";
const CANOPY_THRESHOLD = 30;
const FIRST_YEAR = 2001;
const LATEST_YEAR = 2024;

// Near-real-time forest-disturbance alerts (GLAD-S2 + RADD, combined as
// GFW's "integrated alerts") — a DIFFERENT dataset from the annual Hansen
// loss above. Verified live on 2026-10-02: this one updates daily (its
// latest version string was dated literally today), with real alert dates
// up to 2026-09-22 — 10 days old, genuinely near-real-time, not an annual
// snapshot. Outside the humid forest zone (Ghana's savanna north) this
// system throws a lot of noise from seasonal/agricultural vegetation
// change, so every query below filters to sbtn_natural_forests__class =
// 'Natural Forest' — confirmed empirically: unfiltered, Upper West (a
// savanna region with ~0 annual tree-cover loss) topped the alert count;
// filtered, the ranking correctly matches the real forest-zone regions.
const ALERTS_DATASET = "gadm__integrated_alerts__adm1_daily_alerts";
const ALERT_WINDOW_DAYS = 30;

// Real historical wildfire-detection counts (VIIRS satellite, per region,
// per week, 2012-present). Verified live: Ghana's savanna-belt regions
// (Savannah, Bono East, Northern, Upper West) show 10-40x more alerts than
// the southern forest belt over the last 2 years — matches the real,
// well-documented pattern of dry-season bushfires in the north vs humid
// forest in the south. A real frequency signal, not a trained wildfire-risk
// model.
const FIRE_DATASET = "gadm__viirs__adm1_weekly_alerts";
const FIRE_YEARS_BACK = 2;

// Ghana's 16 GADM admin-1 regions. The tree-cover-loss dataset's "adm1"
// field is a bare integer, not a name — verified by cross-referencing
// against gadm_administrative_boundaries v4.1's gid_1 codes (e.g.
// "GHA2_2" = Ashanti), which turn out to be a 1-indexed ALPHABETICAL
// ranking of the 16 region names. Confirmed by sanity-checking the
// resulting per-region loss magnitudes against the previously-known top-5
// regions (Western, Ashanti, Eastern, Central, Western North all landed
// in the expected range at the expected relative ranking).
const ADM1_REGIONS_ALPHABETICAL = [
  "Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern",
  "Greater Accra", "North East", "Northern", "Oti", "Savannah",
  "Upper East", "Upper West", "Volta", "Western", "Western North",
];

// GFW's 2000 tree-cover baseline (gadm__tcl__adm1_summary) still uses
// Ghana's 10 pre-2018 regions, numbered alphabetically. Verified 2026-11-14:
// the 10 extents sum to ~6.95 Mha, matching GFW's published national 2000
// figure (1.9 Mha lost = 27% of 2000 cover). Each lists the current regions
// it was split into in 2018.
const SUMMARY_DATASET = "gadm__tcl__adm1_summary";
const FORMER_REGIONS: { name: string; currentRegions: string[] }[] = [
  { name: "Ashanti", currentRegions: ["Ashanti"] },
  { name: "Brong-Ahafo", currentRegions: ["Ahafo", "Bono", "Bono East"] },
  { name: "Central", currentRegions: ["Central"] },
  { name: "Eastern", currentRegions: ["Eastern"] },
  { name: "Greater Accra", currentRegions: ["Greater Accra"] },
  { name: "Northern", currentRegions: ["Northern", "Savannah", "North East"] },
  { name: "Upper East", currentRegions: ["Upper East"] },
  { name: "Upper West", currentRegions: ["Upper West"] },
  { name: "Volta", currentRegions: ["Volta", "Oti"] },
  { name: "Western", currentRegions: ["Western", "Western North"] },
];

// Representative point per region (regional capital / center of mass),
// for map placement only — not derived from GFW, not used in any loss
// calculation.
const REGION_GEO: Record<string, { lat: number; lng: number }> = {
  Western: { lat: 5.1, lng: -2.0 },
  Ashanti: { lat: 6.7, lng: -1.6 },
  Eastern: { lat: 6.3, lng: -0.5 },
  Central: { lat: 5.3, lng: -1.1 },
  "Western North": { lat: 6.2, lng: -2.48 },
  "Greater Accra": { lat: 5.6037, lng: -0.187 },
  Volta: { lat: 6.6007, lng: 0.4713 },
  Oti: { lat: 8.0667, lng: 0.1667 },
  Northern: { lat: 9.4035, lng: -0.8393 },
  "North East": { lat: 10.5262, lng: -0.3708 },
  "Upper East": { lat: 10.7856, lng: -0.8514 },
  "Upper West": { lat: 10.0601, lng: -2.5057 },
  Savannah: { lat: 9.0833, lng: -1.8167 },
  Bono: { lat: 7.3399, lng: -2.3268 },
  "Bono East": { lat: 7.5833, lng: -1.9333 },
  Ahafo: { lat: 6.8014, lng: -2.5169 },
};

export interface LiveRegionLoss {
  region: string;
  lat: number;
  lng: number;
  totalLossKha2001to2024: number;
  lossKha2024: number;
  recentAlertCount: number; // real disturbance alerts, natural-forest-filtered, last 30 days
  recentAlertAreaHa: number;
  fireAlertCount2yr: number; // real VIIRS fire detections, last 2 calendar years
  yearlyLossKha: number[]; // index 0 = FIRST_YEAR, one entry per year through LATEST_YEAR
}

export interface LiveLossDriver {
  name: string;
  areaKha: number;
}

export interface LiveGhanaLossData {
  regions: LiveRegionLoss[];
  nationalTotalLossKha2001to2024: number;
  nationalTotalLossKha2024: number;
  nationalRecentAlertAreaHa: number;
  nationalYearlyLossKha: { year: number; lossKha: number }[];
  drivers: LiveLossDriver[];
  dataThroughYear: number;
  alertsWindowStart: string; // ISO date, start of the rolling alert window
  alertsAsOfLatest: string; // ISO date, the newest alert date actually seen in the data
  fetchedAt: string;
  source: string;
  forestSince2000?: ForestSince2000;
}

const CACHE_PATH = path.join(process.cwd(), "data", "gfw_region_loss_cache.json");
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — region-level historical loss doesn't change intraday

async function gfwQuery<T>(dataset: string, sql: string): Promise<T[]> {
  const apiKey = process.env.GFW_API_KEY;
  if (!apiKey) throw new Error("GFW_API_KEY not configured");

  const url = `${GFW_BASE}/dataset/${dataset}/latest/query/json?sql=${encodeURIComponent(sql)}`;
  const res = await fetch(url, {
    headers: { "x-api-key": apiKey, Origin: "localhost" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GFW query failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const body = await res.json();
  if (body.status === "failed") throw new Error(`GFW query failed: ${body.message}`);
  return body.data as T[];
}

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function readCache(): Promise<LiveGhanaLossData | null> {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf8");
    const data: LiveGhanaLossData = JSON.parse(raw);
    const age = Date.now() - new Date(data.fetchedAt).getTime();
    if (age > CACHE_MAX_AGE_MS) return null;
    if (!data.nationalYearlyLossKha) return null; // cached before the yearly series existed
    return data;
  } catch {
    return null;
  }
}

async function writeCache(data: LiveGhanaLossData): Promise<void> {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(data, null, 2), "utf8");
}

async function fetchLive(): Promise<LiveGhanaLossData> {
  const windowStart = isoDateDaysAgo(ALERT_WINDOW_DAYS);
  const fireYearStart = new Date().getUTCFullYear() - FIRE_YEARS_BACK;

  const [cumulative, latestYear, driverRows, alertRows, alertDateRange, fireRows, yearlyRows] = await Promise.all([
    gfwQuery<{ adm1: number; total_loss_ha: number }>(
      DATASET,
      `SELECT adm1, SUM(umd_tree_cover_loss__ha) as total_loss_ha FROM data WHERE iso = 'GHA' AND umd_tree_cover_density_2000__threshold = ${CANOPY_THRESHOLD} GROUP BY adm1 ORDER BY adm1`,
    ),
    gfwQuery<{ adm1: number; loss_ha: number }>(
      DATASET,
      `SELECT adm1, SUM(umd_tree_cover_loss__ha) as loss_ha FROM data WHERE iso = 'GHA' AND umd_tree_cover_density_2000__threshold = ${CANOPY_THRESHOLD} AND umd_tree_cover_loss__year = ${LATEST_YEAR} GROUP BY adm1 ORDER BY adm1`,
    ),
    gfwQuery<{ wri_google_tree_cover_loss_drivers__category: string; loss_ha: number }>(
      DATASET,
      `SELECT wri_google_tree_cover_loss_drivers__category, SUM(umd_tree_cover_loss__ha) as loss_ha FROM data WHERE iso = 'GHA' AND umd_tree_cover_density_2000__threshold = ${CANOPY_THRESHOLD} GROUP BY wri_google_tree_cover_loss_drivers__category ORDER BY loss_ha DESC`,
    ),
    gfwQuery<{ adm1: number; alerts: number; area_ha: number }>(
      ALERTS_DATASET,
      `SELECT adm1, SUM(alert__count) as alerts, SUM(alert_area__ha) as area_ha FROM data WHERE iso = 'GHA' AND gfw_integrated_alerts__date >= '${windowStart}' AND sbtn_natural_forests__class = 'Natural Forest' GROUP BY adm1`,
    ),
    gfwQuery<{ max_d: string }>(ALERTS_DATASET, `SELECT MAX(gfw_integrated_alerts__date) as max_d FROM data WHERE iso = 'GHA'`),
    gfwQuery<{ adm1: number; alerts: number }>(
      FIRE_DATASET,
      `SELECT adm1, SUM(alert__count) as alerts FROM data WHERE iso = 'GHA' AND alert__year >= ${fireYearStart} GROUP BY adm1`,
    ),
    // Same dataset and threshold as the cumulative total, split by year — so
    // the yearly series sums exactly to the 2001-2024 totals shown elsewhere.
    gfwQuery<{ adm1: number; year: number; loss_ha: number }>(
      DATASET,
      `SELECT adm1, umd_tree_cover_loss__year as year, SUM(umd_tree_cover_loss__ha) as loss_ha FROM data WHERE iso = 'GHA' AND umd_tree_cover_density_2000__threshold = ${CANOPY_THRESHOLD} GROUP BY adm1, umd_tree_cover_loss__year ORDER BY adm1, umd_tree_cover_loss__year`,
    ),
  ]);

  // 2000 baseline: fetched separately so a failure here never blocks the rest.
  const extentRows = await gfwQuery<{ adm1: number; extent_ha: number; gain_ha: number }>(
    SUMMARY_DATASET,
    `SELECT adm1, SUM(umd_tree_cover_extent_2000__ha) as extent_ha, SUM(umd_tree_cover_gain__ha) as gain_ha FROM data WHERE iso = 'GHA' AND umd_tree_cover_density_2000__threshold = ${CANOPY_THRESHOLD} GROUP BY adm1 ORDER BY adm1`,
  ).catch((err) => {
    console.error("GFW 2000 baseline unavailable:", err);
    return null;
  });

  const yearCount = LATEST_YEAR - FIRST_YEAR + 1;
  const yearlyByAdm1 = new Map<number, number[]>();
  for (const row of yearlyRows) {
    if (row.year < FIRST_YEAR || row.year > LATEST_YEAR) continue;
    const series = yearlyByAdm1.get(row.adm1) ?? new Array(yearCount).fill(0);
    series[row.year - FIRST_YEAR] += row.loss_ha / 1000;
    yearlyByAdm1.set(row.adm1, series);
  }

  const latestByAdm1 = new Map(latestYear.map((r) => [r.adm1, r.loss_ha]));
  const alertsByAdm1 = new Map(alertRows.map((r) => [r.adm1, r]));
  const fireByAdm1 = new Map(fireRows.map((r) => [r.adm1, r.alerts]));
  const regions: LiveRegionLoss[] = cumulative.map((r) => {
    const name = ADM1_REGIONS_ALPHABETICAL[r.adm1 - 1];
    const geo = REGION_GEO[name];
    const alert = alertsByAdm1.get(r.adm1);
    return {
      region: name,
      lat: geo.lat,
      lng: geo.lng,
      totalLossKha2001to2024: r.total_loss_ha / 1000,
      lossKha2024: (latestByAdm1.get(r.adm1) ?? 0) / 1000,
      recentAlertCount: alert?.alerts ?? 0,
      recentAlertAreaHa: alert?.area_ha ?? 0,
      fireAlertCount2yr: fireByAdm1.get(r.adm1) ?? 0,
      yearlyLossKha: yearlyByAdm1.get(r.adm1) ?? new Array(yearCount).fill(0),
    };
  });

  const nationalYearlyLossKha = Array.from({ length: yearCount }, (_, i) => ({
    year: FIRST_YEAR + i,
    lossKha: regions.reduce((s, r) => s + r.yearlyLossKha[i], 0),
  }));

  const drivers: LiveLossDriver[] = driverRows.map((r) => ({
    name: r.wri_google_tree_cover_loss_drivers__category || "Unknown",
    areaKha: r.loss_ha / 1000,
  }));

  let forestSince2000: ForestSince2000 | undefined;
  if (extentRows && extentRows.length === FORMER_REGIONS.length) {
    const lossOf = (name: string) => regions.find((r) => r.region === name)?.totalLossKha2001to2024 ?? 0;
    const formerRegions = extentRows.map((row) => {
      const former = FORMER_REGIONS[row.adm1 - 1];
      const extent2000Kha = row.extent_ha / 1000;
      const lossKha = former.currentRegions.reduce((s, n) => s + lossOf(n), 0);
      return {
        name: former.name,
        currentRegions: former.currentRegions,
        extent2000Kha,
        lossKha,
        remainingKha: Math.max(0, extent2000Kha - lossKha),
        lostPct: extent2000Kha > 0 ? Math.min(100, (lossKha / extent2000Kha) * 100) : 0,
        gainKha: row.gain_ha / 1000,
      };
    });
    const nationalExtent2000Kha = formerRegions.reduce((s, r) => s + r.extent2000Kha, 0);
    const nationalLossKha = formerRegions.reduce((s, r) => s + r.lossKha, 0);
    forestSince2000 = {
      formerRegions: formerRegions.sort((a, b) => b.extent2000Kha - a.extent2000Kha),
      nationalExtent2000Kha,
      nationalLossKha,
      nationalLostPct: (nationalLossKha / nationalExtent2000Kha) * 100,
      throughYear: LATEST_YEAR,
    };
  }

  return {
    forestSince2000,
    regions,
    nationalTotalLossKha2001to2024: regions.reduce((s, r) => s + r.totalLossKha2001to2024, 0),
    nationalTotalLossKha2024: regions.reduce((s, r) => s + r.lossKha2024, 0),
    nationalRecentAlertAreaHa: regions.reduce((s, r) => s + r.recentAlertAreaHa, 0),
    nationalYearlyLossKha,
    drivers,
    dataThroughYear: LATEST_YEAR,
    alertsWindowStart: windowStart,
    alertsAsOfLatest: alertDateRange[0]?.max_d ?? windowStart,
    fetchedAt: new Date().toISOString(),
    source:
      "Global Forest Watch Data API (data-api.globalforestwatch.org) — annual loss from gadm__tcl__adm1_change (Hansen/UMD, 30% canopy density); recent-activity alerts from gadm__integrated_alerts__adm1_daily_alerts (GLAD-S2 + RADD, near-real-time, natural-forest-filtered); fire history from gadm__viirs__adm1_weekly_alerts. All live-queried per region.",
  };
}

export async function getGhanaLossData(forceRefresh = false): Promise<LiveGhanaLossData> {
  if (!forceRefresh) {
    const cached = await readCache();
    if (cached) return cached;
  }
  const fresh = await fetchLive();
  await writeCache(fresh);
  return fresh;
}
