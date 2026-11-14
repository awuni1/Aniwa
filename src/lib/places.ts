"use client";

// Nearest real settlement to a point, from public/ghana_places.json (every
// named city, town and village in Ghana in OpenStreetMap; built by
// scripts/build-places.mjs). Loaded once, shared by every component.

import { useEffect, useState } from "react";
import { distanceKm } from "@/lib/geo";

export interface NearestPlace {
  name: string;
  type: "city" | "town" | "village";
  region: string | null;
  distanceKm: number;
}

type PlaceRow = [string, number, number, number, number];
interface PlacesFile {
  types: NearestPlace["type"][];
  regions: string[];
  places: PlaceRow[];
}

export type NearestPlaceLookup = (p: { lat: number; lng: number }) => NearestPlace | null;

let loading: Promise<NearestPlaceLookup> | null = null;

function loadPlaces(): Promise<NearestPlaceLookup> {
  loading ??= fetch("/ghana_places.json")
    .then((r) => r.json())
    .then((file: PlacesFile) => (point: { lat: number; lng: number }) => {
      let best: PlaceRow | null = null;
      let bestKm = Infinity;
      for (const row of file.places) {
        // Cheap box check before the exact distance (0.5° ≈ 55 km).
        if (Math.abs(row[1] - point.lat) > 0.5 || Math.abs(row[2] - point.lng) > 0.5) continue;
        const d = distanceKm(point, { lat: row[1], lng: row[2] });
        if (d < bestKm) {
          bestKm = d;
          best = row;
        }
      }
      if (!best) return null;
      return { name: best[0], type: file.types[best[3]], region: best[4] >= 0 ? file.regions[best[4]] : null, distanceKm: bestKm };
    })
    .catch((err) => {
      loading = null; // allow a retry next time
      throw err;
    });
  return loading;
}

/** Returns a nearest-place lookup once the places file has loaded (null until then). */
export function useNearestPlace(): NearestPlaceLookup | null {
  const [lookup, setLookup] = useState<{ fn: NearestPlaceLookup } | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadPlaces()
      .then((fn) => !cancelled && setLookup({ fn }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return lookup?.fn ?? null;
}

/** "Esuaso, Western" when within 2 km, else "5.6 km from Esuaso, Western". */
export function placeLabel(place: NearestPlace | null): string | null {
  if (!place) return null;
  const where = place.region ? `${place.name}, ${place.region}` : place.name;
  return place.distanceKm < 2 ? where : `${place.distanceKm.toFixed(1)} km from ${where}`;
}
