// Server-side nearest real settlement (OpenStreetMap; public/ghana_places.json),
// for alert messages. Same data and wording as lib/places.ts on the client.
import fs from "node:fs/promises";
import path from "node:path";
import { distanceKm } from "@/lib/geo";

type PlaceRow = [string, number, number, number, number];
let file: Promise<{ regions: string[]; places: PlaceRow[] }> | null = null;

export async function nearestPlaceLabel(point: { lat: number; lng: number }): Promise<string | null> {
  try {
    file ??= fs.readFile(path.join(process.cwd(), "public", "ghana_places.json"), "utf8").then(JSON.parse);
    const { regions, places } = await file;
    let best: PlaceRow | null = null;
    let bestKm = Infinity;
    for (const row of places) {
      if (Math.abs(row[1] - point.lat) > 0.5 || Math.abs(row[2] - point.lng) > 0.5) continue;
      const d = distanceKm(point, { lat: row[1], lng: row[2] });
      if (d < bestKm) {
        bestKm = d;
        best = row;
      }
    }
    if (!best) return null;
    const where = best[4] >= 0 ? `${best[0]}, ${regions[best[4]]}` : best[0];
    return bestKm < 2 ? where : `${bestKm.toFixed(1)} km from ${where}`;
  } catch {
    file = null;
    return null;
  }
}
