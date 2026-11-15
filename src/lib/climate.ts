// Temperature history from NASA POWER (MERRA-2 reanalysis, ~0.5° x 0.625°
// grid, roughly 50 km). Good for regional climate trends; too coarse to see
// the local cooling a single forest provides, so it can't by itself show how
// much warming forest loss causes.

export const HOT_DAY_THRESHOLD_C = 35;

export interface ClimateYear {
  year: number;
  hotDays: number; // days with max temperature >= HOT_DAY_THRESHOLD_C
  meanMaxTempC: number;
}

export interface ClimateResponse {
  available: boolean;
  error?: string;
  region: string;
  lat: number;
  lng: number;
  years: ClimateYear[];
  source: string;
}

export async function fetchClimate(region: string): Promise<ClimateResponse> {
  const res = await fetch(`/api/climate?region=${encodeURIComponent(region)}`);
  return res.json();
}

// Ordinary least-squares slope of y over x (e.g. °C per year).
export function linearSlope(points: { x: number; y: number }[]): number {
  const n = points.length;
  if (n < 2) return 0;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const num = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const den = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  return den === 0 ? 0 : num / den;
}
