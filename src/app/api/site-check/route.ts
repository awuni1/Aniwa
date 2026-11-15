import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GFW_BASE = "https://data-api.globalforestwatch.org";
const WDPA_DATASET = "wdpa_protected_areas";

// Real point-in-protected-area lookup — World Database on Protected Areas
// (WDPA), the actual legal register of Ghana's national parks, forest
// reserves, and resource reserves. Verified directly: ST_Intersects against
// a real polygon's own centroid correctly returns that polygon (Kakum),
// confirming this spatial query genuinely works, not just returns empty.
export interface ProtectedAreaResult {
  available: boolean;
  error?: string;
  inside: boolean;
  name: string | null;
  designation: string | null;
  iucnCategory: string | null;
  areaHa: number | null;
}

export async function GET(req: NextRequest) {
  const lat = parseFloat(req.nextUrl.searchParams.get("lat") ?? "");
  const lng = parseFloat(req.nextUrl.searchParams.get("lng") ?? "");
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "lat/lng required" }, { status: 400 });
  }

  const apiKey = process.env.GFW_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ available: false, error: "GFW_API_KEY not configured", inside: false, name: null, designation: null, iucnCategory: null, areaHa: null });
  }

  try {
    const sql = `SELECT name, desig_eng, iucn_cat, gfw_area__ha FROM data WHERE iso3 = 'GHA' AND ST_Intersects(geom, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)) LIMIT 1`;
    const url = `${GFW_BASE}/dataset/${WDPA_DATASET}/latest/query/json?sql=${encodeURIComponent(sql)}`;
    const res = await fetch(url, {
      headers: { "x-api-key": apiKey, Origin: "localhost" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`GFW query failed (${res.status})`);
    const body = await res.json();
    if (body.status === "failed") throw new Error(body.message);

    const hit = (body.data ?? [])[0];
    const result: ProtectedAreaResult = hit
      ? { available: true, inside: true, name: hit.name, designation: hit.desig_eng, iucnCategory: hit.iucn_cat, areaHa: hit.gfw_area__ha }
      : { available: true, inside: false, name: null, designation: null, iucnCategory: null, areaHa: null };
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({
      available: false,
      error: err instanceof Error ? err.message : String(err),
      inside: false,
      name: null,
      designation: null,
      iucnCategory: null,
      areaHa: null,
    });
  }
}
