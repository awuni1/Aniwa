import { CARBON_DENSITY_T_PER_HA } from "@/lib/deforestation";

// Molecular weight ratio CO2/C (44/12) — the standard IPCC conversion from
// carbon mass to CO2 mass. The master spec's formula ("hectares x carbon
// density") actually yields tonnes of CARBON, not CO2 — this applies the
// missing conversion so the CO2e number is scientifically correct, and
// reports both so the carbon-only figure is still visible.
const C_TO_CO2 = 44 / 12;

export interface Range {
  low: number;
  mid: number;
  high: number;
}

export interface CarbonEstimate {
  hectares: number;
  carbonTonnes: Range;
  co2eTonnes: Range;
}

function scaleRange(hectares: number, factor: typeof CARBON_DENSITY_T_PER_HA): Range {
  return { low: hectares * factor.low, mid: hectares * factor.mid, high: hectares * factor.high };
}

export function estimateCarbonEmissions(hectares: number): CarbonEstimate {
  const carbonTonnes = scaleRange(hectares, CARBON_DENSITY_T_PER_HA);
  const co2eTonnes: Range = {
    low: carbonTonnes.low * C_TO_CO2,
    mid: carbonTonnes.mid * C_TO_CO2,
    high: carbonTonnes.high * C_TO_CO2,
  };
  return { hectares, carbonTonnes, co2eTonnes };
}

export type EudrRiskLevel = "high" | "moderate" | "low" | "unknown";

export interface EudrAssessment {
  risk: EudrRiskLevel;
  reasoning: string;
}

// EUDR (EU Deforestation Regulation) cares about forest cleared after
// Dec 31, 2020. We don't have polygon-level clearing data for a specific
// farm/plot (that needs Google Earth Engine or a paid GFW API tier this
// project doesn't have), so this uses the predictive model's risk score for
// this region, backed by the region's real 2024 loss figure (live GFW data,
// not an estimate), as the best available region-level signal — and is
// explicit about what a site-specific check would still need.
export function assessEudrRisk(input: {
  predictedProbabilityPct: number;
  regionLossKha2024?: number;
}): EudrAssessment {
  if (input.predictedProbabilityPct >= 50) {
    return {
      risk: "high",
      reasoning: `The deforestation-risk model predicts ${input.predictedProbabilityPct.toFixed(0)}% risk for this area — if clearing happens here, it would fall after the EUDR's Dec 31, 2020 cutoff and be non-compliant for regulated commodities (cocoa, timber, rubber, etc.) sourced from here.`,
    };
  }
  if (input.regionLossKha2024 && input.regionLossKha2024 > 15) {
    return {
      risk: "moderate",
      reasoning: `Predicted risk is moderate (${input.predictedProbabilityPct.toFixed(0)}%), but this region had a real, measured ${input.regionLossKha2024.toFixed(1)} kha of tree cover loss in 2024 (live GFW data, not an estimate) — sourcing nearby carries elevated EUDR risk pending a site-specific check.`,
    };
  }
  return {
    risk: "unknown",
    reasoning:
      "Predicted risk and the region's real 2024 loss are both low for this specific site. A real EUDR risk assessment still needs plot-level forest-cover data (e.g. via Google Earth Engine or a paid GFW API tier), which isn't connected here.",
  };
}
