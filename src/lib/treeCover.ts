import type { TreeCoverLookup } from "@/lib/deforestationModel";

// Client loader for public/ghana_tree_cover.json (built by
// scripts/build-tree-cover.mjs from ESA WorldCover 2021): % tree cover per
// 0.02° (~2 km) cell, row-major from the north-west corner, 255 = no data.
interface TreeCoverGrid {
  west: number;
  north: number;
  res: number;
  rows: number;
  cols: number;
  data: string; // base64 bytes
}

export async function loadTreeCover(): Promise<TreeCoverLookup> {
  const grid = (await fetch("/ghana_tree_cover.json").then((r) => r.json())) as TreeCoverGrid;
  const bytes = Uint8Array.from(atob(grid.data), (c) => c.charCodeAt(0));
  return ({ lat, lng }) => {
    const r = Math.floor((grid.north - lat) / grid.res);
    const c = Math.floor((lng - grid.west) / grid.res);
    if (r < 0 || r >= grid.rows || c < 0 || c >= grid.cols) return null;
    const v = bytes[r * grid.cols + c];
    return v === 255 ? null : v / 100;
  };
}
