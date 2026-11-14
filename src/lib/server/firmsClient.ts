import { regionAtPoint } from "@/lib/geo";
import { loadRegionFeatures } from "@/lib/server/ghanaRegions";
import type { ActiveFire, FiresResponse } from "@/lib/fires";

// NASA FIRMS area API. Verified live on 2026-11-10: a valid MAP_KEY returns
// CSV; the day range must be 1-5 (6+ is rejected with "Invalid day range").
const FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const DAYS = 5;

// Ghana's bounding box (west,south,east,north). It also covers slivers of
// Côte d'Ivoire, Burkina Faso and Togo, so every fire is checked against the
// real region polygons and anything outside Ghana is dropped.
const GHANA_BBOX = "-3.3,4.7,1.2,11.2";

// All three VIIRS satellites (375 m pixels) plus MODIS (1 km), near-real-time.
// Several satellites pass each day, so combining them catches more fires.
const SOURCES = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "MODIS_NRT"];

// FIRMS data refreshes within ~3 hours of each overpass; there's no point
// hitting it more often than this.
const CACHE_MS = 30 * 60 * 1000;
let cache: { at: number; data: FiresResponse } | null = null;

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

// VIIRS reports confidence as l/n/h; MODIS as a 0-100 number.
function normalizeConfidence(raw: string): ActiveFire["confidence"] {
  if (raw === "h") return "high";
  if (raw === "l") return "low";
  if (raw === "n") return "nominal";
  const n = Number(raw);
  if (Number.isFinite(n)) return n >= 80 ? "high" : n >= 30 ? "nominal" : "low";
  return "nominal";
}

async function fetchSource(key: string, source: string): Promise<Record<string, string>[]> {
  const res = await fetch(`${FIRMS_BASE}/${key}/${source}/${GHANA_BBOX}/${DAYS}`, { signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  if (!res.ok || !text.startsWith("latitude")) throw new Error(`${source}: ${text.slice(0, 120)}`);
  return parseCsv(text);
}

export async function getActiveFires(): Promise<FiresResponse> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const key = process.env.NASA_FIRMS_MAP_KEY;
  if (!key) {
    return { available: false, error: "NASA_FIRMS_MAP_KEY not configured", fires: [], days: DAYS, sources: SOURCES, fetchedAt: new Date().toISOString() };
  }

  const [features, ...results] = await Promise.all([loadRegionFeatures(), ...SOURCES.map((s) => fetchSource(key, s).catch((e: Error) => e))]);
  const failures = results.filter((r): r is Error => r instanceof Error);
  if (failures.length === SOURCES.length) {
    return { available: false, error: failures[0].message, fires: [], days: DAYS, sources: SOURCES, fetchedAt: new Date().toISOString() };
  }

  const fires: ActiveFire[] = [];
  results.forEach((rows, i) => {
    if (rows instanceof Error) return;
    for (const r of rows) {
      const lat = Number(r.latitude);
      const lng = Number(r.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const region = regionAtPoint({ lat, lng }, features);
      if (!region) continue; // outside Ghana
      const time = (r.acq_time ?? "").padStart(4, "0");
      fires.push({
        lat,
        lng,
        region,
        acquiredAt: `${r.acq_date}T${time.slice(0, 2)}:${time.slice(2)}:00Z`,
        confidence: normalizeConfidence(r.confidence),
        frpMw: Number(r.frp) || 0,
        satellite: SOURCES[i].replace(/_NRT$/, ""),
      });
    }
  });
  fires.sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt));

  const data: FiresResponse = { available: true, fires, days: DAYS, sources: SOURCES, fetchedAt: new Date().toISOString() };
  cache = { at: Date.now(), data };

  return data;
}
