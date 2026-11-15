import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export interface GeocodeResult {
  name: string;
  lat: number;
  lng: number;
  type: string; // e.g. "town", "village", "nature_reserve" — real OSM place type
}

// OpenStreetMap's free Nominatim geocoder, restricted to Ghana — real place
// search (any town, village, or named landmark in OSM), not limited to the
// ~24 hand-picked towns in lib/ghanaPlaces.ts. Free, no API key, but their
// usage policy requires a real identifying User-Agent and caps at ~1 req/sec,
// which a single user typing in a search box comfortably stays under.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 3) {
    return NextResponse.json({ results: [] });
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&countrycodes=gh&format=json&limit=6`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Aniwa/1.0 (deforestation monitoring tool)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const data = await res.json();

    const results: GeocodeResult[] = (Array.isArray(data) ? data : [])
      .map((r: Record<string, unknown>) => ({
        name: String(r.name ?? r.display_name ?? "").split(",")[0],
        lat: parseFloat(String(r.lat)),
        lng: parseFloat(String(r.lon)),
        type: String(r.type ?? r.addresstype ?? "place"),
      }))
      .filter((r: GeocodeResult) => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lng));

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
