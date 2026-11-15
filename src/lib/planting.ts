// Planting-plan arithmetic. These are indicative assumptions, not
// measurements: how much carbon young trees take up varies a lot with
// species, soil, rainfall and care. The ranges below sit within commonly
// published values for young tropical forest regrowth and agroforestry, and
// are shown to users as assumptions they should confirm with a forester.

export type PlantingApproach = "native" | "agroforestry";

export const APPROACHES: Record<PlantingApproach, { label: string; treesPerHa: number; carbonTPerHaYr: { low: number; high: number }; note: string }> = {
  native: {
    label: "Native forest restoration",
    treesPerHa: 625, // 4 m x 4 m spacing
    carbonTPerHaYr: { low: 2.5, high: 5 },
    note: "Mixed native species planted at 4 m spacing to rebuild closed forest.",
  },
  agroforestry: {
    label: "Agroforestry (shade trees with cocoa or cashew)",
    treesPerHa: 100,
    carbonTPerHaYr: { low: 1, high: 2.5 },
    note: "Shade and timber trees among farm crops; stores less carbon than forest but keeps the land productive.",
  },
};

const C_TO_CO2 = 44 / 12;
export const PLAN_YEARS = 10;

export interface PlantingResult {
  trees: number;
  co2PerYearT: { low: number; high: number };
  co2OverPlanT: { low: number; high: number };
}

export function computePlan(hectares: number, approach: PlantingApproach, treesPerHa: number): PlantingResult {
  const rate = APPROACHES[approach].carbonTPerHaYr;
  const perYear = { low: hectares * rate.low * C_TO_CO2, high: hectares * rate.high * C_TO_CO2 };
  return {
    trees: Math.round(hectares * treesPerHa),
    co2PerYearT: perYear,
    co2OverPlanT: { low: perYear.low * PLAN_YEARS, high: perYear.high * PLAN_YEARS },
  };
}
