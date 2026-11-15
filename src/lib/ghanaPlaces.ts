import { distanceKm } from "@/lib/geo";

export interface GhanaPlace {
  name: string;
  region: string;
  lat: number;
  lng: number;
}

// Regional capitals + a few notable towns, spanning all 16 regions. Used for
// (a) the map search box and (b) turning any lat/lng into a human-readable
// "near <town>, <region>" label instead of raw coordinates.
export const GHANA_PLACES: GhanaPlace[] = [
  { name: "Accra", region: "Greater Accra Region", lat: 5.6037, lng: -0.187 },
  { name: "Kumasi", region: "Ashanti Region", lat: 6.6885, lng: -1.6244 },
  { name: "Tamale", region: "Northern Region", lat: 9.4035, lng: -0.8393 },
  { name: "Takoradi", region: "Western Region", lat: 4.8845, lng: -1.7554 },
  { name: "Cape Coast", region: "Central Region", lat: 5.1053, lng: -1.2466 },
  { name: "Koforidua", region: "Eastern Region", lat: 6.094, lng: -0.2591 },
  { name: "Ho", region: "Volta Region", lat: 6.6007, lng: 0.4713 },
  { name: "Sunyani", region: "Bono Region", lat: 7.3399, lng: -2.3268 },
  { name: "Techiman", region: "Bono East Region", lat: 7.5833, lng: -1.9333 },
  { name: "Goaso", region: "Ahafo Region", lat: 6.8014, lng: -2.5169 },
  { name: "Sefwi Wiawso", region: "Western North Region", lat: 6.2, lng: -2.4833 },
  { name: "Bolgatanga", region: "Upper East Region", lat: 10.7856, lng: -0.8514 },
  { name: "Wa", region: "Upper West Region", lat: 10.0601, lng: -2.5057 },
  { name: "Damongo", region: "Savannah Region", lat: 9.0833, lng: -1.8167 },
  { name: "Nalerigu", region: "North East Region", lat: 10.5262, lng: -0.3708 },
  { name: "Dambai", region: "Oti Region", lat: 8.0667, lng: 0.1667 },
  { name: "Gushegu", region: "Northern Region", lat: 9.9167, lng: -0.2667 },
  { name: "Karaga", region: "Northern Region", lat: 9.9036, lng: -0.5314 },
  { name: "Yendi", region: "Northern Region", lat: 9.4437, lng: -0.0093 },
  { name: "Savelugu", region: "Northern Region", lat: 9.6244, lng: -0.8253 },
  { name: "Mole National Park", region: "Savannah Region", lat: 9.7, lng: -1.85 },
  { name: "Obuasi", region: "Ashanti Region", lat: 6.2, lng: -1.6667 },
  { name: "Tarkwa", region: "Western Region", lat: 5.3, lng: -1.9956 },
  { name: "Axim", region: "Western Region", lat: 4.8667, lng: -2.2333 },
];

export function nearestPlace(point: { lat: number; lng: number }): (GhanaPlace & { distanceKm: number }) | null {
  if (GHANA_PLACES.length === 0) return null;
  let best: (GhanaPlace & { distanceKm: number }) | null = null;
  for (const p of GHANA_PLACES) {
    const d = distanceKm(point, p);
    if (!best || d < best.distanceKm) best = { ...p, distanceKm: Math.round(d * 10) / 10 };
  }
  return best;
}

export function locationLabel(point: { lat: number; lng: number }): string {
  const nearest = nearestPlace(point);
  if (!nearest) return `${point.lat.toFixed(2)}, ${point.lng.toFixed(2)}`;
  if (nearest.distanceKm < 2) return `${nearest.name}, ${nearest.region}`;
  return `~${Math.round(nearest.distanceKm)} km from ${nearest.name}, ${nearest.region}`;
}
