import fs from "node:fs/promises";
import path from "node:path";

// The same geoBoundaries region polygons the map draws (public/
// ghana_regions.geojson), read once on the server for point-in-region tests.
export interface RegionFeature {
  properties: { shapeName: string };
  geometry: { type: string; coordinates: unknown };
}

let featuresPromise: Promise<RegionFeature[]> | null = null;

export function loadRegionFeatures(): Promise<RegionFeature[]> {
  if (!featuresPromise) {
    featuresPromise = fs
      .readFile(path.join(process.cwd(), "public", "ghana_regions.geojson"), "utf8")
      .then((raw) => JSON.parse(raw).features as RegionFeature[])
      .catch((err) => {
        featuresPromise = null;
        throw err;
      });
  }
  return featuresPromise;
}
