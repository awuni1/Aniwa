// Geometry helpers used across the app (distances, bearings, centroids).
// Plain spherical-earth math, no mapping library dependency.

const EARTH_RADIUS_KM = 6371;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

// Great-circle distance between two lng/lat points, in km (haversine).
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// Initial compass bearing from a to b, in degrees [0, 360), 0 = north.
export function bearingDeg(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Centroid of a set of points.
export function centroid(points: Array<{ lat: number; lng: number }>): {
  lat: number;
  lng: number;
} {
  const n = points.length || 1;
  const sum = points.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / n, lng: sum.lng / n };
}

// Ray-casting point-in-polygon test for GeoJSON Polygon / MultiPolygon
// geometry (outer ring minus holes). Coordinates are [lng, lat].
function inRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(lng: number, lat: number, rings: number[][][]): boolean {
  if (!inRing(lng, lat, rings[0])) return false;
  return !rings.slice(1).some((hole) => inRing(lng, lat, hole));
}

export function pointInGeometry(point: { lat: number; lng: number }, geometry: { type: string; coordinates: unknown }): boolean {
  if (geometry.type === "Polygon") return inPolygon(point.lng, point.lat, geometry.coordinates as number[][][]);
  if (geometry.type === "MultiPolygon") return (geometry.coordinates as number[][][][]).some((p) => inPolygon(point.lng, point.lat, p));
  return false;
}

// Which Ghana region (from the bundled geoBoundaries file) contains a point,
// or null if it's outside Ghana.
export function regionAtPoint(
  point: { lat: number; lng: number },
  features: { properties: { shapeName: string }; geometry: { type: string; coordinates: unknown } }[],
): string | null {
  const hit = features.find((f) => pointInGeometry(point, f.geometry));
  return hit ? hit.properties.shapeName.replace(/\s+Region$/i, "") : null;
}

export function compassLabel(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}
