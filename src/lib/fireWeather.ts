// Fire-weather forecast for Ghana's forest-belt regions, from the Meteomatics
// Weather API (see lib/server/meteomaticsClient.ts). Shared types and the
// client-side fetcher; no server-only code here.

// Meteomatics' forest fire index runs 0 to 1, and "the risk increases for
// values exceeding 0.5". The 0.75 "high" cut-off is Aniwa's own choice, not
// a Meteomatics category.
export const FIRE_INDEX_ELEVATED = 0.5;
export const FIRE_INDEX_HIGH = 0.75;

export type FireWeatherLevel = "low" | "elevated" | "high";

export interface FireWeatherDay {
  date: string; // YYYY-MM-DD, the day the 24-hour figures cover
  fireIndex: number | null; // 0..1
  tMaxC: number | null;
  precipMm: number | null;
  gustMs: number | null;
  rhMinPct: number | null;
}

export interface RegionFireWeather {
  region: string;
  lat: number;
  lng: number;
  days: FireWeatherDay[];
  peakIndex: number | null;
  level: FireWeatherLevel;
}

export type FireWeatherResponse =
  | { available: true; regions: RegionFireWeather[]; fetchedAt: string; source: string }
  | { available: false; error: string };

export function fireWeatherLevel(index: number | null): FireWeatherLevel {
  if (index === null) return "low";
  if (index >= FIRE_INDEX_HIGH) return "high";
  if (index > FIRE_INDEX_ELEVATED) return "elevated";
  return "low";
}

export async function fetchFireWeather(): Promise<FireWeatherResponse> {
  const res = await fetch("/api/fire-weather");
  return res.json();
}
