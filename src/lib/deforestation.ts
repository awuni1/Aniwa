// Ghana deforestation reference data.
//
// Region-level and national tree-cover-loss figures are LIVE — fetched from
// the real Global Forest Watch Data API (see lib/server/gfwClient.ts) for
// all 16 regions, not a static snapshot. Fetch it via GET /api/region-loss;
// components receive it as props from app/dashboard/page.tsx, which fetches
// it once on load.
//

export const DEFORESTATION_DATA_SOURCE =
  "Global Forest Watch Data API (data-api.globalforestwatch.org), live: tree cover loss (Hansen/UMD) and integrated clearing alerts.";

// Live per-region loss data shape (see lib/server/gfwClient.ts LiveRegionLoss
// for the authoritative type — this mirrors it for consumers that don't
// import server-only code).
export interface RegionLoss {
  region: string;
  lat: number;
  lng: number;
  totalLossKha2001to2024: number;
  lossKha2024: number;
  recentAlertCount: number;
  recentAlertAreaHa: number;
  fireAlertCount2yr: number;
  yearlyLossKha: number[]; // 2001 onwards, one entry per year through dataThroughYear
}

// Forest in 2000 vs now, per region. Global Forest Watch publishes the 2000
// tree-cover baseline only for Ghana's 10 pre-2018 regions, so the
// comparison is made at that level; each former region lists the current
// regions it was split into, whose 2001-2024 losses are summed.
export interface FormerRegionForest {
  name: string;
  currentRegions: string[];
  extent2000Kha: number; // tree cover in 2000 (>=30% canopy density)
  lossKha: number; // 2001 to dataThroughYear, summed over currentRegions
  remainingKha: number; // extent2000 - loss (gain not added; see gainKha)
  lostPct: number;
  gainKha: number; // tree cover gain 2000-2020, reported separately
}

export interface ForestSince2000 {
  formerRegions: FormerRegionForest[];
  nationalExtent2000Kha: number;
  nationalLossKha: number;
  nationalLostPct: number;
  throughYear: number;
}

export interface LossDriver {
  name: string;
  areaKha: number;
}

// IPCC/tropical-forest literature range for West African dense forest carbon
// stock, in tonnes of carbon per hectare (not CO2 — see carbon.ts for the
// C-to-CO2 conversion). The master spec's own suggested range.
export const CARBON_DENSITY_T_PER_HA = { low: 180, mid: 190, high: 200 };
