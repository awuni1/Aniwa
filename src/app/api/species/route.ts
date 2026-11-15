import { NextRequest, NextResponse } from "next/server";
import { TRACKED_SPECIES, type SpeciesOccurrence, type SpeciesResult, type SpeciesPhoto } from "@/lib/species";

export const dynamic = "force-dynamic";

interface GbifRecord {
  decimalLatitude?: number;
  decimalLongitude?: number;
  year?: number;
  locality?: string;
  country?: string;
  basisOfRecord?: string;
  media?: { type?: string; identifier?: string }[];
}

// Tries a real GBIF photo from a Ghana record first; if this species has
// none documented in Ghana (true for the two rarest tracked species — real
// absence, not a bug), falls back to the nearest real documented photo
// anywhere, clearly flagged as not-from-Ghana rather than passed off as one.
async function fetchPhoto(scientificName: string): Promise<SpeciesPhoto | null> {
  async function query(countryFilter: boolean): Promise<GbifRecord | null> {
    const url = `https://api.gbif.org/v1/occurrence/search?scientificName=${encodeURIComponent(scientificName)}${
      countryFilter ? "&country=GH" : ""
    }&mediaType=StillImage&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.results ?? [])[0] ?? null;
  }

  const ghRecord = await query(true);
  const record = ghRecord ?? (await query(false));
  const identifier = record?.media?.find((m) => m.type === "StillImage")?.identifier;
  if (!record || !identifier) return null;

  return {
    url: identifier,
    fromGhana: record === ghRecord,
    basisOfRecord: record.basisOfRecord ?? "UNKNOWN",
    year: typeof record.year === "number" ? record.year : null,
    country: record.country ?? null,
  };
}

// GBIF's public occurrence search API. Free, no key, confirmed working for
// all three tracked species in Ghana. Proxied server-side for consistency
// with the other data routes here (and to keep the point sample small/capped
// before it reaches the client).
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name") ?? "";
  const species = TRACKED_SPECIES.find((s) => s.scientificName === name);
  if (!species) {
    return NextResponse.json({ error: "unknown species" }, { status: 400 });
  }

  try {
    const url = `https://api.gbif.org/v1/occurrence/search?scientificName=${encodeURIComponent(
      name,
    )}&country=GH&hasCoordinate=true&limit=50`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`GBIF HTTP ${res.status}`);
    const data = await res.json();

    const occurrences: SpeciesOccurrence[] = (data.results ?? [])
      .filter((r: Record<string, unknown>) => typeof r.decimalLatitude === "number" && typeof r.decimalLongitude === "number")
      .map((r: Record<string, unknown>) => ({
        lat: r.decimalLatitude as number,
        lng: r.decimalLongitude as number,
        year: typeof r.year === "number" ? r.year : null,
        locality: typeof r.locality === "string" ? r.locality : null,
      }));

    const photo = await fetchPhoto(species.scientificName).catch(() => null);

    const body: SpeciesResult = {
      species,
      totalCount: data.count ?? occurrences.length,
      occurrences,
      photo,
    };
    return NextResponse.json(body);
  } catch {
    const body: SpeciesResult = { species, totalCount: 0, occurrences: [], photo: null };
    return NextResponse.json(body);
  }
}
