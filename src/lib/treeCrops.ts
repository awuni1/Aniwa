// Ghana's tree crops — cocoa, cashew, oil palm, rubber, shea and others —
// from FAOSTAT (UN Food and Agriculture Organization), annual national
// statistics. Real data, but yearly and national, not live or per region.

export interface TreeCrop {
  name: string;
  years: number[];
  productionT: (number | null)[]; // tonnes, aligned with years
  areaHa: (number | null)[]; // hectares harvested, aligned with years
}

export interface TreeCropsResponse {
  available: boolean;
  error?: string;
  crops: TreeCrop[];
  dataThroughYear: number | null;
  source: string;
}

export async function fetchTreeCrops(): Promise<TreeCropsResponse> {
  const res = await fetch("/api/tree-crops");
  return res.json();
}
