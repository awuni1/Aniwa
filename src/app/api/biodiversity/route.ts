import { NextRequest, NextResponse } from "next/server";
import type { BiodiversityResponse, ThreatenedSpecies } from "@/lib/biodiversity";

export const dynamic = "force-dynamic";

// GBIF occurrence search, faceted by species. Verified live on 2026-11-10:
// a 15 km circle around Kakum returns 153k records and 1,477 species, with
// IUCN categories available as a filter.
const GBIF = "https://api.gbif.org/v1";
const FACET_LIMIT = 5000;
const MAX_RADIUS_KM = 50;
const CACHE_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; body: BiodiversityResponse }>();

async function gbif<T>(path: string): Promise<T> {
  const res = await fetch(`${GBIF}${path}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`GBIF ${res.status}`);
  return res.json();
}

type FacetResponse = { count: number; facets: { field: string; counts: { name: string; count: number }[] }[] };

async function speciesKeys(area: string, extra = ""): Promise<{ count: number; keys: string[] }> {
  const data = await gbif<FacetResponse>(`/occurrence/search?${area}${extra}&limit=0&facet=speciesKey&facetLimit=${FACET_LIMIT}`);
  return { count: data.count, keys: data.facets.find((f) => f.field === "SPECIES_KEY")?.counts.map((c) => c.name) ?? [] };
}

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  const radiusKm = Math.min(MAX_RADIUS_KM, Math.max(1, Number(req.nextUrl.searchParams.get("radiusKm")) || 10));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat/lng required" }, { status: 400 });
  }

  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)},${radiusKm}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body);

  const area = `geoDistance=${lat},${lng},${radiusKm}km`;
  try {
    const [all, cr, en, vu] = await Promise.all([
      speciesKeys(area),
      speciesKeys(area, "&iucnRedListCategory=CR"),
      speciesKeys(area, "&iucnRedListCategory=EN"),
      speciesKeys(area, "&iucnRedListCategory=VU"),
    ]);

    // Names for a few threatened species, most threatened first.
    const exampleKeys: { key: string; category: ThreatenedSpecies["category"] }[] = [
      ...cr.keys.map((key) => ({ key, category: "CR" as const })),
      ...en.keys.map((key) => ({ key, category: "EN" as const })),
      ...vu.keys.map((key) => ({ key, category: "VU" as const })),
    ].slice(0, 6);
    const threatenedExamples = (
      await Promise.all(
        exampleKeys.map(async ({ key, category }) => {
          try {
            const [s, vernacular] = await Promise.all([
              gbif<{ canonicalName?: string; scientificName?: string }>(`/species/${key}`),
              gbif<{ results: { vernacularName: string; language?: string }[] }>(`/species/${key}/vernacularNames?limit=50`).catch(() => ({ results: [] })),
            ]);
            const latin = s.canonicalName || s.scientificName || `Species ${key}`;
            // Skip bird-banding codes like "HOVU" that GBIF also lists as English names.
            const english = vernacular.results.find((v) => v.language === "eng" && !/^[A-Z]{2,6}$/.test(v.vernacularName))?.vernacularName;
            return { name: english ? `${english} (${latin})` : latin, category };
          } catch {
            return null;
          }
        }),
      )
    ).filter((x): x is ThreatenedSpecies => x !== null);

    const body: BiodiversityResponse = {
      available: true,
      lat,
      lng,
      radiusKm,
      records: all.count,
      species: all.keys.length,
      speciesCapped: all.keys.length >= FACET_LIMIT,
      threatened: { CR: cr.keys.length, EN: en.keys.length, VU: vu.keys.length },
      threatenedExamples,
    };
    cache.set(cacheKey, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (err) {
    const body: BiodiversityResponse = {
      available: false,
      error: err instanceof Error ? err.message : String(err),
      lat,
      lng,
      radiusKm,
      records: 0,
      species: 0,
      speciesCapped: false,
      threatened: { CR: 0, EN: 0, VU: 0 },
      threatenedExamples: [],
    };
    return NextResponse.json(body);
  }
}
