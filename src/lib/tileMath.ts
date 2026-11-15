// Web Mercator tile math — converts a lat/lng into the Esri World Imagery
// tile that covers it (same tile scheme already used for the map basemap),
// so the AI analysis looks at a real, visible satellite image, not a
// synthetic crop.

export interface TileCoord {
  x: number;
  y: number;
  z: number;
}

export function lonLatToTile(lon: number, lat: number, zoom: number): TileCoord {
  const latRad = (lat * Math.PI) / 180;
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)), z: zoom };
}

export function esriTileUrl(tile: TileCoord): string {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tile.z}/${tile.y}/${tile.x}`;
}

// Approximate ground area covered by one tile at this latitude, in hectares.
// Web Mercator tiles are square in projected meters but not in true ground
// area away from the equator — this corrects for that with cos(latitude).
export function tileAreaHectares(lat: number, zoom: number): number {
  const degPerTile = 360 / Math.pow(2, zoom);
  const kmPerDegLng = 111.32 * Math.cos((lat * Math.PI) / 180);
  const kmPerDegLat = 111.32;
  const widthKm = degPerTile * kmPerDegLng;
  const heightKm = degPerTile * kmPerDegLat;
  return widthKm * heightKm * 100; // km^2 -> ha
}
