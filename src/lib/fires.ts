// Active fires from NASA FIRMS (Fire Information for Resource Management
// System). In Ghana's forest belt, fire is a common way to finish clearing
// land after felling, so a fresh fire inside forest is a strong sign that
// clearing is happening now. Not every fire is deforestation, though: the
// savanna north burns every dry season.

export interface ActiveFire {
  lat: number;
  lng: number;
  region: string;
  acquiredAt: string; // ISO, satellite overpass time (UTC)
  confidence: "low" | "nominal" | "high";
  frpMw: number; // fire radiative power — how intense the fire is
  satellite: string;
}

export interface FiresResponse {
  available: boolean;
  error?: string;
  fires: ActiveFire[];
  days: number;
  sources: string[];
  fetchedAt: string;
}

export async function fetchFires(): Promise<FiresResponse> {
  const res = await fetch("/api/fires", { cache: "no-store" });
  return res.json();
}
