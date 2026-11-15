// Builds public/ghana_tree_cover.json: the share of tree cover in each
// ~2 km cell across Ghana, from ESA WorldCover 2021 (10 m) via Microsoft
// Planetary Computer. Run once (or when WorldCover publishes a new year):
//
//   node scripts/build-tree-cover.mjs
//
// How: for each WorldCover tile over Ghana, the Planetary Computer data API
// returns the raw class codes as a PNG, sampled every ~0.002° (~220 m,
// nearest neighbour). Samples are counted into 0.02° cells; a cell's value
// is the percentage of its ~100 samples that are tree cover (class 10) or
// mangroves (class 95). Cells with no samples are stored as 255.

import { writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const PC = "https://planetarycomputer.microsoft.com/api";
const GRID = { west: -3.3, south: 4.7, east: 1.2, north: 11.2, res: 0.02 };
const SAMPLE_DEG = 0.002;
const TREE_CLASSES = new Set([10, 95]);
const YEAR = 2021;

const cols = Math.round((GRID.east - GRID.west) / GRID.res);
const rows = Math.round((GRID.north - GRID.south) / GRID.res);
const total = new Uint32Array(rows * cols);
const trees = new Uint32Array(rows * cols);

const search = await fetch(`${PC}/stac/v1/search`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    collections: ["esa-worldcover"],
    bbox: [GRID.west, GRID.south, GRID.east, GRID.north],
    datetime: `${YEAR}-01-01/${YEAR}-12-31`,
    limit: 50,
  }),
}).then((r) => r.json());

for (const item of search.features) {
  const [ix0, iy0, ix1, iy1] = item.bbox;
  const minx = Math.max(ix0, GRID.west), miny = Math.max(iy0, GRID.south);
  const maxx = Math.min(ix1, GRID.east), maxy = Math.min(iy1, GRID.north);
  if (minx >= maxx || miny >= maxy) continue;
  const width = Math.round((maxx - minx) / SAMPLE_DEG);
  const height = Math.round((maxy - miny) / SAMPLE_DEG);
  const url = `${PC}/data/v1/item/bbox/${minx},${miny},${maxx},${maxy}.png?collection=esa-worldcover&item=${item.id}&assets=map&resampling=nearest&return_mask=false&width=${width}&height=${height}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${item.id}: HTTP ${res.status}`);
  const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
  const dx = (maxx - minx) / png.width, dy = (maxy - miny) / png.height;
  for (let y = 0; y < png.height; y++) {
    const lat = maxy - (y + 0.5) * dy;
    const r = Math.floor((lat - GRID.south) / GRID.res);
    if (r < 0 || r >= rows) continue;
    for (let x = 0; x < png.width; x++) {
      const v = png.data[(y * png.width + x) * 4];
      if (v === 0) continue; // no data
      const lng = minx + (x + 0.5) * dx;
      const c = Math.floor((lng - GRID.west) / GRID.res);
      if (c < 0 || c >= cols) continue;
      const k = (rows - 1 - r) * cols + c; // row 0 = north
      total[k]++;
      if (TREE_CLASSES.has(v)) trees[k]++;
    }
  }
  console.log(`${item.id}: ${png.width}x${png.height}`);
}

const pct = new Uint8Array(rows * cols);
for (let k = 0; k < pct.length; k++) pct[k] = total[k] ? Math.round((trees[k] / total[k]) * 100) : 255;

await writeFile(
  new URL("../public/ghana_tree_cover.json", import.meta.url),
  JSON.stringify({
    source: `ESA WorldCover ${YEAR} v200 (10 m) via Microsoft Planetary Computer; tree cover + mangroves`,
    west: GRID.west,
    north: GRID.north,
    res: GRID.res,
    rows,
    cols,
    // Row-major from the north-west corner; each byte = % tree cover, 255 = no data.
    data: Buffer.from(pct).toString("base64"),
  }),
);
console.log(`wrote ${rows}x${cols} grid`);
