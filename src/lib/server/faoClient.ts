import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import type { TreeCrop, TreeCropsResponse } from "@/lib/treeCrops";

// FAOSTAT's query API now requires an auth token (verified 2026-11-13: HTTP
// 401 "Missing Authorization Header"), but its free bulk download doesn't.
// The Africa crops file is ~4.3 MB; we download it, keep only Ghana's tree
// crops, and cache that small result on disk. FAOSTAT updates yearly.
const BULK_URL = "https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_Africa.zip";
const CSV_NAME = "Production_Crops_Livestock_E_Africa_NOFLAG.csv";
const CACHE_PATH = path.join(process.cwd(), "data", "fao_ghana_tree_crops.json");
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const FIRST_YEAR = 2000;
const SOURCE = "FAOSTAT (UN FAO), Crops and livestock products, bulk download for Africa — Ghana, production and area harvested.";

// FAOSTAT item names for Ghana's main tree and forest-related crops, with
// the label shown in the app.
const ITEMS: Record<string, string> = {
  "Cocoa beans": "Cocoa",
  "Cashew nuts, in shell": "Cashew nuts",
  "Oil palm fruit": "Oil palm",
  "Natural rubber in primary forms": "Rubber",
  "Karite nuts (sheanuts)": "Shea nuts",
  "Coconuts, in shell": "Coconut",
  "Kola nuts": "Kola nuts",
  "Oranges": "Oranges",
  "Coffee, green": "Coffee",
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

async function fetchFromFao(): Promise<TreeCropsResponse> {
  const res = await fetch(BULK_URL, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`FAOSTAT download failed (${res.status})`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const entry = zip.getEntry(CSV_NAME);
  if (!entry) throw new Error(`FAOSTAT file missing ${CSV_NAME}`);
  const lines = entry.getData().toString("utf8").split(/\r?\n/);

  const header = parseCsvLine(lines[0]);
  const col = (name: string) => header.indexOf(name);
  const [areaCol, itemCol, elementCol] = [col("Area"), col("Item"), col("Element")];
  const yearCols = header.map((h, i) => ({ year: Number(h.slice(1)), i })).filter(({ year }, k) => /^Y\d{4}$/.test(header[k]) && year >= FIRST_YEAR);

  const byItem = new Map<string, { production: (number | null)[]; area: (number | null)[] }>();
  for (const line of lines.slice(1)) {
    if (!line.includes("Ghana")) continue;
    const row = parseCsvLine(line);
    const label = ITEMS[row[itemCol]];
    if (row[areaCol] !== "Ghana" || !label) continue;
    const element = row[elementCol];
    if (element !== "Production" && element !== "Area harvested") continue;
    const values = yearCols.map(({ i }) => (row[i] === "" ? null : Number(row[i])));
    const entryFor = byItem.get(label) ?? { production: [], area: [] };
    if (element === "Production") entryFor.production = values;
    else entryFor.area = values;
    byItem.set(label, entryFor);
  }

  const years = yearCols.map(({ year }) => year);
  // Trim trailing years with no data for any crop (the file has empty future columns).
  let last = years.length - 1;
  while (last > 0 && [...byItem.values()].every((v) => v.production[last] == null)) last--;
  const crops: TreeCrop[] = Object.values(ITEMS)
    .filter((label) => byItem.has(label))
    .map((label) => {
      const v = byItem.get(label)!;
      return { name: label, years: years.slice(0, last + 1), productionT: v.production.slice(0, last + 1), areaHa: v.area.slice(0, last + 1) };
    });
  if (crops.length === 0) throw new Error("No Ghana tree-crop rows found in FAOSTAT file");
  return { available: true, crops, dataThroughYear: years[last], source: SOURCE };
}

export async function getTreeCrops(): Promise<TreeCropsResponse> {
  try {
    const raw = JSON.parse(await fs.readFile(CACHE_PATH, "utf8"));
    if (Date.now() - new Date(raw.fetchedAt).getTime() < CACHE_MAX_AGE_MS) return raw.data;
  } catch {
    // no cache yet
  }
  const data = await fetchFromFao();
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify({ fetchedAt: new Date().toISOString(), data }), "utf8");
  return data;
}
