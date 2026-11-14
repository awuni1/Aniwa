// Endangered species tracked for the habitat displacement module. Real
// species genuinely found in Ghana's forest zone, occurrence data pulled
// live from GBIF (Global Biodiversity Information Facility) — a free, public
// API, no key required.

export interface SpeciesDef {
  commonName: string;
  scientificName: string;
  iucnStatus: string; // as commonly cited; GBIF occurrence records carry their own when available
}

export const TRACKED_SPECIES: SpeciesDef[] = [
  { commonName: "Roloway monkey", scientificName: "Cercopithecus roloway", iucnStatus: "Critically Endangered" },
  { commonName: "White-naped mangabey", scientificName: "Cercocebus lunulatus", iucnStatus: "Critically Endangered" },
  { commonName: "African forest elephant", scientificName: "Loxodonta cyclotis", iucnStatus: "Critically Endangered" },
];

export interface SpeciesOccurrence {
  lat: number;
  lng: number;
  year: number | null;
  locality: string | null;
}

export interface SpeciesPhoto {
  url: string;
  fromGhana: boolean; // false = no Ghana-specific photo exists in GBIF; this is the nearest real documented example elsewhere
  basisOfRecord: string; // e.g. "HUMAN_OBSERVATION" (a live sighting) vs "PRESERVED_SPECIMEN" (a museum specimen) — real GBIF field, shown so a specimen photo is never mistaken for a live one
  year: number | null;
  country: string | null;
}

export interface SpeciesResult {
  species: SpeciesDef;
  totalCount: number;
  occurrences: SpeciesOccurrence[]; // capped sample, not the full count
  photo: SpeciesPhoto | null;
}

export async function fetchSpeciesOccurrences(scientificName: string): Promise<SpeciesResult> {
  const res = await fetch(`/api/species?name=${encodeURIComponent(scientificName)}`);
  if (!res.ok) throw new Error(`species fetch failed: ${res.status}`);
  return res.json();
}

// Real, named intact-forest reference points (major rainforest protected
// areas in southern Ghana) used as displacement targets — "if this zone is
// cleared, the nearest refuge is X". Approximate representative coordinates,
// not survey-grade boundaries.
export interface IntactForestPatch {
  name: string;
  lat: number;
  lng: number;
}

export const INTACT_FOREST_PATCHES: IntactForestPatch[] = [
  { name: "Kakum National Park", lat: 5.35, lng: -1.38 },
  { name: "Ankasa Conservation Area", lat: 5.17, lng: -2.63 },
  { name: "Bia National Park", lat: 6.48, lng: -3.13 },
  { name: "Digya National Park", lat: 7.65, lng: -0.2 },
];
