// "Check with satellites": compares a ~1 km box around a point now with the
// same season a year earlier, using free Sentinel-2 (optical) and Sentinel-1
// (radar) data from Microsoft Planetary Computer. Server side:
// lib/server/planetaryClient.ts. This file is shared types + the client fetcher.

// Thresholds are Aniwa's own judgment, not from a published standard.
// Below this a year ago, there was little dense vegetation to clear. Kept low
// because hazy or dry-season images of real forest can read 0.45-0.5.
export const NDVI_FOREST_MIN = 0.4;
export const NDVI_DROP_CLEARING = 0.2;
export const NDVI_DROP_POSSIBLE = 0.1;
export const VH_DROP_DB = 2; // radar backscatter fall that suggests canopy loss

export type ClearingVerdict =
  | "clearing_likely"
  | "possible_change"
  | "no_change"
  | "not_forest"
  | "radar_suggests_clearing"
  | "radar_no_change"
  | "no_data";

export interface OpticalScene {
  date: string; // YYYY-MM-DD
  ndvi: number;
  clearPct: number;
  imageUrl: string; // true-colour crop of the box, served by Planetary Computer
}

export interface RadarSummary {
  beforeDb: number;
  afterDb: number;
  scenesBefore: number;
  scenesAfter: number;
}

export interface ClearingCheckResult {
  lat: number;
  lng: number;
  boxKm: number;
  windowDays: number;
  before: OpticalScene | null;
  after: OpticalScene | null;
  ndviDrop: number | null;
  radar: RadarSummary | null;
  verdict: ClearingVerdict;
  checkedAt: string;
}

export type ClearingCheckResponse = ({ available: true } & ClearingCheckResult) | { available: false; error: string };

export async function fetchClearingCheck(lat: number, lng: number): Promise<ClearingCheckResponse> {
  const res = await fetch(`/api/clearing-check?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}`);
  return res.json();
}
