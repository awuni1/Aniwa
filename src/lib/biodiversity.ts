// Species recorded around a point, from GBIF (Global Biodiversity
// Information Facility). These are documented sightings and specimens, not a
// census: well-studied places (like Kakum) have far more records than
// equally rich but unsurveyed forest. "At risk" means recorded within the
// radius of an area losing forest, not a count of animals harmed.

export interface ThreatenedSpecies {
  name: string;
  category: "CR" | "EN" | "VU";
}

export interface BiodiversityResponse {
  available: boolean;
  error?: string;
  lat: number;
  lng: number;
  radiusKm: number;
  records: number;
  species: number;
  speciesCapped: boolean; // true = more species than GBIF's facet limit; the real number is higher
  threatened: { CR: number; EN: number; VU: number }; // distinct species per IUCN category
  threatenedExamples: ThreatenedSpecies[];
}

export const IUCN_LABEL: Record<ThreatenedSpecies["category"], string> = {
  CR: "Critically endangered",
  EN: "Endangered",
  VU: "Vulnerable",
};

export async function fetchBiodiversity(lat: number, lng: number, radiusKm: number): Promise<BiodiversityResponse> {
  const res = await fetch(`/api/biodiversity?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`);
  return res.json();
}
