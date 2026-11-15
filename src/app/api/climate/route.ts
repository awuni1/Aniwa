import { NextRequest, NextResponse } from "next/server";
import { getClimateHistory } from "@/lib/server/powerClient";
import { getGhanaLossData } from "@/lib/server/gfwClient";
import type { ClimateResponse } from "@/lib/climate";

export const dynamic = "force-dynamic";

const SOURCE = "NASA POWER (power.larc.nasa.gov), daily T2M_MAX from MERRA-2 reanalysis, ~50 km grid, at the region's representative point.";

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("region") ?? "";
  const empty = (error: string): ClimateResponse => ({ available: false, error, region: name, lat: 0, lng: 0, years: [], source: SOURCE });

  try {
    const { regions } = await getGhanaLossData();
    const region = regions.find((r) => r.region === name);
    if (!region) return NextResponse.json(empty("unknown region"), { status: 400 });

    const years = await getClimateHistory(region.region, region.lat, region.lng);
    const body: ClimateResponse = { available: true, region: region.region, lat: region.lat, lng: region.lng, years, source: SOURCE };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(empty(err instanceof Error ? err.message : String(err)));
  }
}
