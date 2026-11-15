// Builds public/ghana_places.json: every named city, town and village in
// Ghana from OpenStreetMap, each tagged with its region. Used to label
// hotspots, fires, chainsaw detections and satellite checks with the nearest
// real settlement. Rebuild when you want fresher OSM data:
//
//   node scripts/build-places.mjs

import { readFile, writeFile } from "node:fs/promises";

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const QUERY = `[out:json][timeout:150];area["ISO3166-1"="GH"][admin_level=2]->.gh;node["place"~"^(city|town|village)$"]["name"](area.gh);out body;`;
const TYPES = ["city", "town", "village"];

async function download() {
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "aniwa-forest-dashboard/1.0" },
        body: `data=${encodeURIComponent(QUERY)}`,
      });
      if (res.ok) return (await res.json()).elements;
      console.warn(`${url}: HTTP ${res.status}`);
    } catch (err) {
      console.warn(`${url}: ${err.message}`);
    }
  }
  throw new Error("All Overpass endpoints failed; try again in a few minutes");
}

function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inGeometry(lng, lat, g) {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.some((p) => inRing(lng, lat, p[0]) && !p.slice(1).some((h) => inRing(lng, lat, h)));
}

const regions = JSON.parse(await readFile(new URL("../public/ghana_regions.geojson", import.meta.url), "utf8")).features;
const regionNames = regions.map((f) => f.properties.shapeName.replace(/\s+Region$/i, ""));

const elements = await download();
const places = [];
for (const e of elements) {
  const name = e.tags?.["name:en"] || e.tags?.name;
  if (!name) continue;
  const region = regions.findIndex((f) => inGeometry(e.lon, e.lat, f.geometry));
  places.push([name, Number(e.lat.toFixed(4)), Number(e.lon.toFixed(4)), TYPES.indexOf(e.tags.place), region]);
}

await writeFile(
  new URL("../public/ghana_places.json", import.meta.url),
  JSON.stringify({
    source: "OpenStreetMap contributors (ODbL), place=city|town|village",
    builtAt: new Date().toISOString().slice(0, 10),
    types: TYPES,
    regions: regionNames,
    // [name, lat, lng, typeIndex, regionIndex (-1 = outside the region outlines)]
    places,
  }),
);
console.log(`wrote ${places.length} places`);
