import { distanceKm, bearingDeg, compassLabel } from "@/lib/geo";
import { INTACT_FOREST_PATCHES, type IntactForestPatch } from "@/lib/species";
import type { RegionLoss } from "@/lib/deforestation";

// No free API gives real soil-moisture or river-basin data for arbitrary
// Ghana coordinates, so this doesn't pretend to have hydrology inputs (the
// master spec asked for "soil moisture potential and proximity to river
// basins" — faking those numbers would be worse than not having them). What
// it does have, honestly: each region's real loss magnitude (restoration
// need) and real distance to the nearest known intact-forest patch
// (ecological connectivity value). The recommender scores on those two
// factors only, and says so.

export interface ReforestationSite {
  lat: number;
  lng: number;
  distanceFromRegionKm: number;
  distanceToIntactForestKm: number;
  nearestIntactForest: string;
  bearingFromRegion: string;
  recommendationType: "primary_forest_restoration" | "climate_smart_agroforestry";
  score: number; // 0-100, higher = better candidate
  reasoning: string;
}

function pointAlong(a: { lat: number; lng: number }, b: { lat: number; lng: number }, fraction: number) {
  return { lat: a.lat + (b.lat - a.lat) * fraction, lng: a.lng + (b.lng - a.lng) * fraction };
}

export function nearestIntactForest(point: { lat: number; lng: number }): IntactForestPatch & { distanceKm: number } {
  let best: (IntactForestPatch & { distanceKm: number }) | null = null;
  for (const p of INTACT_FOREST_PATCHES) {
    const d = distanceKm(point, p);
    if (!best || d < best.distanceKm) best = { ...p, distanceKm: d };
  }
  return best!;
}

const FRACTIONS = [0.25, 0.5, 0.75];

export function recommendSites(region: RegionLoss, regionCentroid: { lat: number; lng: number }, maxLossKha: number): ReforestationSite[] {
  const target = nearestIntactForest(regionCentroid);

  return FRACTIONS.map((frac) => {
    const point = pointAlong(regionCentroid, target, frac);
    const distFromRegion = distanceKm(regionCentroid, point);
    const distToForest = distanceKm(point, target);
    const bearing = compassLabel(bearingDeg(regionCentroid, point));

    // Connectivity: closer to intact forest is better for corridor value (0-60 pts)
    const connectivityScore = Math.max(0, 60 - (distToForest / target.distanceKm) * 60);
    // Restoration need: this region's real loss magnitude relative to the worst region (0-40 pts)
    const needScore = (region.totalLossKha2001to2024 / maxLossKha) * 40;
    const score = Math.round(connectivityScore + needScore);

    const recommendationType: ReforestationSite["recommendationType"] =
      frac >= 0.6 ? "primary_forest_restoration" : "climate_smart_agroforestry";

    const reasoning =
      recommendationType === "primary_forest_restoration"
        ? `Close to ${target.name} (${distToForest.toFixed(0)} km) — expanding forest cover here extends an existing intact patch rather than starting an isolated stand.`
        : `${distFromRegion.toFixed(0)} km into the ${region.region} loss zone, still ${distToForest.toFixed(0)} km from intact forest — better suited to shade-grown cocoa/agroforestry than primary restoration, bridging farmland toward the forest corridor.`;

    return {
      lat: point.lat,
      lng: point.lng,
      distanceFromRegionKm: distFromRegion,
      distanceToIntactForestKm: distToForest,
      nearestIntactForest: target.name,
      bearingFromRegion: bearing,
      recommendationType,
      score,
      reasoning,
    };
  }).sort((a, b) => b.score - a.score);
}
