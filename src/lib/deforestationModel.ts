import { distanceKm } from "@/lib/geo";
import { INTACT_FOREST_PATCHES } from "@/lib/species";
import type { RegionLoss } from "@/lib/deforestation";

// A basic predictive model for deforestation risk at any point in Ghana.
//
// Structure: logistic regression — the same functional form real
// deforestation-risk models use (e.g. Soares-Filho-style frontier models):
// a weighted sum of features, squashed to a 0-100% probability by a sigmoid.
//
// Honesty about what this is NOT: the weights below are literature-informed
// (frontier/accessibility pressure is consistently the dominant predictor in
// published deforestation-driver studies, which is why it's weighted ~3x the
// forest-presence term), not fitted via gradient descent on a labeled
// dataset. Ghana now has real per-region loss figures for all 16 regions
// (live GFW data — see lib/server/gfwClient.ts), but that's still only 16
// data points at the region level — nowhere near enough to train a model
// that would generalize at sub-region resolution. A real version would fit
// these weights on pixel-level loss/no-loss labels (e.g. the Hansen dataset
// at native resolution via Google Earth Engine). This is a basic,
// explainable, honestly-labeled model — not a black box, and not clairvoyant.

export type RiskLevel = "low" | "moderate" | "high" | "severe";

export interface DeforestationPrediction {
  lat: number;
  lng: number;
  probability: number; // 0-1
  riskLevel: RiskLevel;
  nearestFrontierRegion: string;
  distanceToFrontierKm: number;
  nearestForestPatch: string;
  distanceToForestKm: number;
  contributionFrontierPct: number; // share of the (positive) signal from each feature
  contributionForestPct: number;
  contributionActivityPct: number;
  // Live evidence that clearing is happening near this point right now.
  chainsawDetectionsNearby: number;
  forestFiresNearby: number;
  regionActiveAlertHa: number;
  // Meteomatics forest fire index (0..1, peak of the next 3 days) at the
  // nearest forest-belt forecast point, or null when none is close enough.
  fireWeatherIndex: number | null;
  fireWeatherRegion: string | null;
  // Share of tree cover in the ~2 km cell around the point (ESA WorldCover
  // 2021), 0-100, or null when the tree-cover map isn't loaded.
  treeCoverPct: number | null;
}

// Looks up the share of tree cover (0..1) at a point; null if unknown.
export type TreeCoverLookup = (p: { lat: number; lng: number }) => number | null;

// Live signals the model can use on top of history. All optional: without
// them the model falls back to history + forest presence only.
export interface LiveActivity {
  chainsaws: { lat: number; lng: number; detectedAt: string }[];
  fires: { lat: number; lng: number; region: string }[];
  // 3-day fire-weather forecast, one point per forest-belt region (Meteomatics).
  fireWeather?: { region: string; lat: number; lng: number; peakIndex: number | null }[];
}

// Ghana's high-forest zone regions. A fire here is far more likely to be
// land clearing than in the savanna north, where grass burns every dry
// season (verified 2026-11-10: ~90% of NASA FIRMS fires over 5 days were in
// northern savanna regions). Regional granularity is coarse — Bono and
// Eastern straddle the forest-savanna transition.
export const FOREST_BELT_REGIONS = new Set(["Western", "Western North", "Ahafo", "Ashanti", "Central", "Eastern", "Bono"]);

// Frontier-pressure proxy: a gravity-style sum over EVERY region's real
// tree-cover-loss magnitude, each decayed by distance — a point near one
// large high-loss region (or several moderate ones) reads as higher
// pressure than a point equally near a region with almost no measured loss.
// Previously this only checked distance to the nearest of 5 regions that
// happened to have a published figure, ignoring magnitude entirely; now
// every region has a real number, so the model can actually weight by it.
const W_FRONTIER = 3;
const DECAY_FRONTIER_KM = 60;

// Forest presence. Preferred: the real share of tree cover around the point
// from ESA WorldCover 2021 (10 m), so a town next to a high-loss area no
// longer scores as if it were forest. The frontier term is also scaled by it:
// there has to be forest here for clearing to happen, so history only pulls
// at full strength where at least FULL_PRESSURE_TREE_COVER of the cell is
// trees. Fallback when the map isn't loaded: proximity to the nearest known
// intact-forest patch, as before.
const W_FOREST = 1.5;
const FULL_PRESSURE_TREE_COVER = 0.4;
const W_FOREST_FALLBACK = 1;
const DECAY_FOREST_KM = 150;

// Current-activity evidence. History says where clearing has been; these say
// where it's happening now, so they're weighted to be able to push a point
// into "severe" on their own. Hand-set like the weights above, not fitted.
//   - chainsaw: a phone heard a saw within CHAINSAW_RADIUS_KM in the last
//     CHAINSAW_WINDOW_DAYS (saturates at 2 detections)
//   - fire: NASA FIRMS fires in forest-belt regions within FIRE_RADIUS_KM
//     (last 5 days; saturates at 5 fires)
//   - alerts: the containing region's satellite disturbance alerts (last 30
//     days), relative to the most-alerted region
const W_CHAINSAW = 2.5;
const CHAINSAW_RADIUS_KM = 5;
const CHAINSAW_WINDOW_DAYS = 7;
const W_FIRE = 1.5;
const FIRE_RADIUS_KM = 10;
const W_ALERTS = 1;
// Fire weather: dry soil makes fire-assisted clearing easier and lets fires
// spread. It is a condition, not evidence that anyone is clearing, so it gets
// the smallest weight. Only the part of Meteomatics' index above 0.5 counts
// (they say risk rises above 0.5), scaled so an index of 1 gives the full
// weight. Applies only within FIRE_WEATHER_RADIUS_KM of a forecast point,
// which are all in forest-belt regions.
const W_FIRE_WEATHER = 0.5;
const FIRE_WEATHER_THRESHOLD = 0.5;
const FIRE_WEATHER_RADIUS_KM = 75;

const BIAS = -2.5;

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function predictDeforestationRisk(
  point: { lat: number; lng: number },
  regions: RegionLoss[],
  activity: LiveActivity = { chainsaws: [], fires: [] },
  treeCoverAt?: TreeCoverLookup,
): DeforestationPrediction {
  const maxLoss = Math.max(...regions.map((r) => r.totalLossKha2001to2024), 1);
  const maxAlertHa = Math.max(...regions.map((r) => r.recentAlertAreaHa), 1);

  let nearestRegion = regions[0];
  let distanceToFrontierKm = Infinity;
  let frontierSignal = 0;
  for (const r of regions) {
    const d = distanceKm(point, r);
    const weight = r.totalLossKha2001to2024 / maxLoss;
    frontierSignal += weight * Math.exp(-d / DECAY_FRONTIER_KM);
    if (d < distanceToFrontierKm) {
      distanceToFrontierKm = d;
      nearestRegion = r;
    }
  }

  let nearestForest = INTACT_FOREST_PATCHES[0];
  let distanceToForestKm = Infinity;
  for (const f of INTACT_FOREST_PATCHES) {
    const d = distanceKm(point, f);
    if (d < distanceToForestKm) {
      distanceToForestKm = d;
      nearestForest = f;
    }
  }

  const treeCover = treeCoverAt?.(point) ?? null;
  const frontierTerm =
    W_FRONTIER * frontierSignal * (treeCover === null ? 1 : Math.min(1, treeCover / FULL_PRESSURE_TREE_COVER));
  const forestTerm =
    treeCover === null ? W_FOREST_FALLBACK * Math.exp(-distanceToForestKm / DECAY_FOREST_KM) : W_FOREST * treeCover;

  const chainsawCutoff = Date.now() - CHAINSAW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const chainsawDetectionsNearby = activity.chainsaws.filter(
    (c) => new Date(c.detectedAt).getTime() >= chainsawCutoff && distanceKm(point, c) <= CHAINSAW_RADIUS_KM,
  ).length;
  const forestFiresNearby = activity.fires.filter((f) => FOREST_BELT_REGIONS.has(f.region) && distanceKm(point, f) <= FIRE_RADIUS_KM).length;
  // The nearest region's alerts stand in for the containing region's — region
  // centers are close enough to their polygons for this coarse a signal.
  const regionActiveAlertHa = nearestRegion?.recentAlertAreaHa ?? 0;
  let fireWeatherIndex: number | null = null;
  let fireWeatherRegion: string | null = null;
  let nearestWeatherKm = Infinity;
  for (const w of activity.fireWeather ?? []) {
    if (w.peakIndex === null) continue;
    const d = distanceKm(point, w);
    if (d <= FIRE_WEATHER_RADIUS_KM && d < nearestWeatherKm) {
      nearestWeatherKm = d;
      fireWeatherIndex = w.peakIndex;
      fireWeatherRegion = w.region;
    }
  }
  const fireWeatherSignal =
    fireWeatherIndex === null ? 0 : Math.max(0, (fireWeatherIndex - FIRE_WEATHER_THRESHOLD) / (1 - FIRE_WEATHER_THRESHOLD));

  const activityTerm =
    W_CHAINSAW * Math.min(1, chainsawDetectionsNearby / 2) +
    W_FIRE * Math.min(1, forestFiresNearby / 5) +
    W_ALERTS * (regionActiveAlertHa / maxAlertHa) +
    W_FIRE_WEATHER * fireWeatherSignal;

  const probability = sigmoid(BIAS + frontierTerm + forestTerm + activityTerm);
  const totalSignal = frontierTerm + forestTerm + activityTerm || 1;

  let riskLevel: RiskLevel = "low";
  if (probability >= 0.7) riskLevel = "severe";
  else if (probability >= 0.5) riskLevel = "high";
  else if (probability >= 0.3) riskLevel = "moderate";

  return {
    lat: point.lat,
    lng: point.lng,
    probability,
    riskLevel,
    nearestFrontierRegion: nearestRegion.region,
    distanceToFrontierKm,
    nearestForestPatch: nearestForest.name,
    distanceToForestKm,
    contributionFrontierPct: (frontierTerm / totalSignal) * 100,
    contributionForestPct: (forestTerm / totalSignal) * 100,
    contributionActivityPct: (activityTerm / totalSignal) * 100,
    chainsawDetectionsNearby,
    forestFiresNearby,
    regionActiveAlertHa,
    fireWeatherIndex,
    fireWeatherRegion,
    treeCoverPct: treeCover === null ? null : treeCover * 100,
  };
}

// Ghana's bounding box; hotspot candidates outside the real borders are
// filtered by the caller with the region polygons.
const GHANA_BOUNDS = { south: 4.7, north: 11.2, west: -3.3, east: 1.2 };
const HOTSPOT_GRID_DEG = 0.15; // ~17 km cells

// Scores a grid of points across Ghana and returns the highest-risk ones —
// where the model thinks clearing is most likely happening or about to.
export function predictHotspots(
  regions: RegionLoss[],
  activity: LiveActivity,
  insideGhana: (p: { lat: number; lng: number }) => boolean,
  count = 10,
  treeCoverAt?: TreeCoverLookup,
): DeforestationPrediction[] {
  const results: DeforestationPrediction[] = [];
  for (let lat = GHANA_BOUNDS.south; lat <= GHANA_BOUNDS.north; lat += HOTSPOT_GRID_DEG) {
    for (let lng = GHANA_BOUNDS.west; lng <= GHANA_BOUNDS.east; lng += HOTSPOT_GRID_DEG) {
      const point = { lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) };
      if (!insideGhana(point)) continue;
      results.push(predictDeforestationRisk(point, regions, activity, treeCoverAt));
    }
  }
  return results.sort((a, b) => b.probability - a.probability).slice(0, count);
}

export const MODEL_METHODOLOGY: string[] = [
  "Structure: logistic regression — a weighted sum of features squashed to a 0-100% probability via a sigmoid function. Same functional form real deforestation-risk models use.",
  "Feature 1 (weight 3x): a gravity-style sum of every region's real 2001-2024 tree-cover-loss total (live GFW data), each decayed by distance from the clicked point — regions that lost more forest pull harder, nearby ones pull harder than far ones.",
  `Feature 2 (weight ${W_FOREST}): the share of tree cover in the ~2 km cell around the point, from ESA WorldCover 2021 (10 m land cover, via Microsoft Planetary Computer). Feature 1 is also scaled by it — full strength only where at least ${FULL_PRESSURE_TREE_COVER * 100}% of the cell is trees — because clearing needs forest to clear. This stops towns and farmland next to high-loss areas from ranking as hotspots. WorldCover is a 2021 snapshot, so forest cleared since then still counts as forest here.`,
  "Weights are literature-informed, not fitted via gradient descent — even with real loss figures for all 16 regions, that's still only 16 region-level data points, far too few to train a model that would generalize at sub-region resolution. A production version would fit on pixel-level labeled data (e.g. Hansen loss/no-loss via Google Earth Engine).",
  `Feature 3 — live activity: chainsaw detections from listening phones within ${CHAINSAW_RADIUS_KM} km (last ${CHAINSAW_WINDOW_DAYS} days, weight ${W_CHAINSAW}), NASA FIRMS fires in forest-belt regions within ${FIRE_RADIUS_KM} km (last 5 days, weight ${W_FIRE}), and the nearest region's satellite disturbance alerts over the last 30 days (weight ${W_ALERTS}). These mark where clearing is happening now rather than where it happened before.`,
`Fire weather (weight ${W_FIRE_WEATHER}): the Meteomatics forest fire index (0 to 1, from soil moisture) at the nearest forest-belt forecast point within ${FIRE_WEATHER_RADIUS_KM} km, peak of the next 3 days. Only the part above ${FIRE_WEATHER_THRESHOLD} counts, since Meteomatics says risk rises above it. It is the smallest weight because dry weather makes clearing by fire easier but is not evidence that clearing is happening. Points in the savanna north get no fire-weather term.`,
  "Savanna fires are ignored: grass burns every dry season in the north, so only fires in forest-belt regions (Western, Western North, Ahafo, Ashanti, Central, Eastern, Bono) count as evidence of clearing.",
  `"Predict hotspots" scores a ~17 km grid across Ghana and lists the highest-risk cells.`,
  "Known omissions from the model itself: no roads, slope, or land tenure. Protected-area status is checked separately (below), not fed into this score.",
];
