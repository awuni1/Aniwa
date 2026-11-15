import { estimateCarbonEmissions } from "@/lib/carbon";
import { linearSlope } from "@/lib/climate";

// "What if it isn't stopped": the recent trend in Ghana's real yearly tree
// cover loss (GFW/Hansen), continued in a straight line. A trend line, not a
// model of what drives clearing — a new cocoa price spike or a crackdown on
// illegal logging would change the real path either way.

export const TREND_WINDOW_YEARS = 10;
export const PROJECT_TO_YEAR = 2035;

export interface ProjectionYear {
  year: number;
  lossKha: number;
}

export interface LossProjection {
  trendPerYearKha: number; // how much yearly loss grows (or shrinks) each year
  recentAvgKha: number; // average yearly loss over the trend window
  projected: ProjectionYear[]; // years after the data ends, through PROJECT_TO_YEAR
  cumulativeKha: number; // total projected loss over those years
  co2eMt: { low: number; mid: number; high: number };
}

export function projectLoss(yearly: { year: number; lossKha: number }[]): LossProjection | null {
  if (yearly.length < TREND_WINDOW_YEARS) return null;
  const window = yearly.slice(-TREND_WINDOW_YEARS);
  const slope = linearSlope(window.map((y) => ({ x: y.year, y: y.lossKha })));
  const recentAvgKha = window.reduce((s, y) => s + y.lossKha, 0) / window.length;
  const midYear = window.reduce((s, y) => s + y.year, 0) / window.length;

  const lastYear = yearly[yearly.length - 1].year;
  const projected: ProjectionYear[] = [];
  for (let year = lastYear + 1; year <= PROJECT_TO_YEAR; year++) {
    projected.push({ year, lossKha: Math.max(0, recentAvgKha + slope * (year - midYear)) });
  }
  const cumulativeKha = projected.reduce((s, y) => s + y.lossKha, 0);
  const carbon = estimateCarbonEmissions(cumulativeKha * 1000);
  return {
    trendPerYearKha: slope,
    recentAvgKha,
    projected,
    cumulativeKha,
    co2eMt: { low: carbon.co2eTonnes.low / 1e6, mid: carbon.co2eTonnes.mid / 1e6, high: carbon.co2eTonnes.high / 1e6 },
  };
}
