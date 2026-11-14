import type { RegionLoss, LossDriver, ForestSince2000 } from "@/lib/deforestation";

export interface GhanaLossData {
  available: boolean;
  error?: string;
  regions: RegionLoss[];
  nationalTotalLossKha2001to2024: number;
  nationalTotalLossKha2024: number;
  nationalRecentAlertAreaHa: number;
  nationalYearlyLossKha: { year: number; lossKha: number }[];
  drivers: LossDriver[];
  dataThroughYear: number;
  alertsWindowStart: string;
  alertsAsOfLatest: string;
  fetchedAt: string;
  source: string;
  forestSince2000?: ForestSince2000; // absent if GFW's 2000 baseline couldn't be fetched
}

// Live per-region/national Ghana tree-cover-loss data (see
// lib/server/gfwClient.ts) — fetched once on dashboard load and passed down
// as props, the same pattern already used for species results.
export async function fetchGhanaLossData(): Promise<GhanaLossData> {
  const res = await fetch("/api/region-loss");
  return res.json();
}
