// Microsoft Planetary Computer client for the satellite clearing check.
// Uses the public hosted STAC API (search) and data API (statistics and image
// crops, computed on Microsoft's servers). No account or key needed.

import {
  NDVI_DROP_CLEARING,
  NDVI_DROP_POSSIBLE,
  NDVI_FOREST_MIN,
  VH_DROP_DB,
  type ClearingCheckResult,
  type ClearingVerdict,
  type OpticalScene,
  type RadarSummary,
} from "@/lib/clearingCheck";

const PC = "https://planetarycomputer.microsoft.com/api";
const HALF_BOX_DEG = 0.0045; // ~1 km box
const WINDOW_DAYS = 90;
const MIN_CLEAR_PCT = 80;
const MAX_OPTICAL_CANDIDATES = 6;
const MAX_RADAR_SCENES = 3;
const CACHE_MS = 6 * 60 * 60 * 1000;
// Sentinel-2 scene classification: vegetation, bare soil, water, unclassified, snow.
// Everything else (cloud, shadow, cirrus, saturated, no data) is "not clear".
const CLEAR_SCL_CLASSES = new Set([4, 5, 6, 7, 11]);

type Window = { start: Date; end: Date };
type StacItem = { id: string; properties: { datetime: string; "eo:cloud_cover"?: number } };
type Stats = Record<string, { mean: number; histogram?: [number[], number[]]; valid_percent: number }>;

const cache = new Map<string, { at: number; result: ClearingCheckResult }>();

function box(lat: number, lng: number) {
  const [w, s, e, n] = [lng - HALF_BOX_DEG, lat - HALF_BOX_DEG, lng + HALF_BOX_DEG, lat + HALF_BOX_DEG];
  return {
    bbox: [w, s, e, n],
    feature: {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
    },
  };
}

async function pcFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(25000), cache: "no-store" });
  if (!res.ok) throw new Error(`Planetary Computer HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function search(collection: string, lat: number, lng: number, w: Window, extra: object = {}): Promise<StacItem[]> {
  const body = {
    collections: [collection],
    intersects: { type: "Point", coordinates: [lng, lat] },
    datetime: `${w.start.toISOString()}/${w.end.toISOString()}`,
    limit: 50,
    ...extra,
  };
  const data = await pcFetch<{ features: StacItem[] }>(`${PC}/stac/v1/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return data.features;
}

async function stats(collection: string, item: string, query: string, feature: object): Promise<Stats> {
  const data = await pcFetch<{ properties: { statistics: Stats } }>(
    `${PC}/data/v1/item/statistics?collection=${collection}&item=${encodeURIComponent(item)}&${query}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(feature) },
  );
  return data.properties.statistics;
}

// Share of the box that is cloud-free, from the Sentinel-2 scene classification layer.
async function clearPct(item: string, feature: object): Promise<number> {
  const s = (await stats("sentinel-2-l2a", item, "assets=SCL&categorical=true", feature)).SCL_b1;
  if (!s?.histogram) return 0;
  const [counts, classes] = s.histogram;
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const clear = counts.reduce((a, c, i) => a + (CLEAR_SCL_CLASSES.has(Math.round(classes[i])) ? c : 0), 0);
  return (clear / total) * 100;
}

// The clearest Sentinel-2 scene in the window, with its mean NDVI over the box.
async function bestOptical(lat: number, lng: number, w: Window): Promise<OpticalScene | null> {
  const { bbox, feature } = box(lat, lng);
  const items = (await search("sentinel-2-l2a", lat, lng, w, { query: { "eo:cloud_cover": { lt: 80 } } }))
    .sort((a, b) => (a.properties["eo:cloud_cover"] ?? 100) - (b.properties["eo:cloud_cover"] ?? 100))
    .slice(0, MAX_OPTICAL_CANDIDATES);
  const scored = await Promise.all(
    items.map(async (it) => ({ it, clear: await clearPct(it.id, feature).catch(() => 0) })),
  );
  const best = scored.filter((s) => s.clear >= MIN_CLEAR_PCT).sort((a, b) => b.clear - a.clear)[0];
  if (!best) return null;
  const ndviStats = await stats("sentinel-2-l2a", best.it.id, `expression=${encodeURIComponent("(B08-B04)/(B08+B04)")}&asset_as_band=true`, feature);
  const ndvi = Object.values(ndviStats)[0]?.mean;
  if (typeof ndvi !== "number" || !Number.isFinite(ndvi)) return null;
  const imageUrl = `${PC}/data/v1/item/bbox/${bbox.join(",")}.png?collection=sentinel-2-l2a&item=${encodeURIComponent(best.it.id)}&assets=visual&width=256&height=256`;
  return { date: best.it.properties.datetime.slice(0, 10), ndvi, clearPct: best.clear, imageUrl };
}

// Mean VH radar backscatter (dB) over the box, averaged across a few scenes.
// Radar sees through cloud; a forest canopy scatters strongly in VH.
async function radarMeanDb(lat: number, lng: number, w: Window): Promise<{ db: number; n: number } | null> {
  const { feature } = box(lat, lng);
  const items = (await search("sentinel-1-rtc", lat, lng, w))
    .sort((a, b) => b.properties.datetime.localeCompare(a.properties.datetime))
    .slice(0, MAX_RADAR_SCENES);
  const values = (
    await Promise.all(items.map((it) => stats("sentinel-1-rtc", it.id, "assets=vh", feature).then((s) => s.vh_b1?.mean).catch(() => undefined)))
  ).filter((v): v is number => typeof v === "number" && v > 0);
  if (!values.length) return null;
  const linear = values.reduce((a, b) => a + b, 0) / values.length;
  return { db: 10 * Math.log10(linear), n: values.length };
}

function verdictFor(before: OpticalScene | null, after: OpticalScene | null, radar: RadarSummary | null): ClearingVerdict {
  if (before && after) {
    if (before.ndvi < NDVI_FOREST_MIN) return "not_forest";
    const drop = before.ndvi - after.ndvi;
    if (drop >= NDVI_DROP_CLEARING) return "clearing_likely";
    if (drop >= NDVI_DROP_POSSIBLE) return "possible_change";
    return "no_change";
  }
  if (radar) return radar.beforeDb - radar.afterDb >= VH_DROP_DB ? "radar_suggests_clearing" : "radar_no_change";
  return "no_data";
}

export async function checkClearing(lat: number, lng: number): Promise<ClearingCheckResult> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;

  const now = new Date();
  const day = 24 * 3600 * 1000;
  const after: Window = { start: new Date(now.getTime() - WINDOW_DAYS * day), end: now };
  // Same season a year earlier, so dry-season browning isn't mistaken for clearing.
  const before: Window = { start: new Date(after.start.getTime() - 365 * day), end: new Date(now.getTime() - 365 * day) };

  const [optBefore, optAfter, radBefore, radAfter] = await Promise.all([
    bestOptical(lat, lng, before).catch(() => null),
    bestOptical(lat, lng, after).catch(() => null),
    radarMeanDb(lat, lng, before).catch(() => null),
    radarMeanDb(lat, lng, after).catch(() => null),
  ]);

  const radar: RadarSummary | null =
    radBefore && radAfter ? { beforeDb: radBefore.db, afterDb: radAfter.db, scenesBefore: radBefore.n, scenesAfter: radAfter.n } : null;

  const result: ClearingCheckResult = {
    lat,
    lng,
    boxKm: 1,
    windowDays: WINDOW_DAYS,
    before: optBefore,
    after: optAfter,
    ndviDrop: optBefore && optAfter ? optBefore.ndvi - optAfter.ndvi : null,
    radar,
    verdict: verdictFor(optBefore, optAfter, radar),
    checkedAt: now.toISOString(),
  };
  cache.set(key, { at: Date.now(), result });
  return result;
}
