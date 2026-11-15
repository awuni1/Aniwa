import { NextResponse } from "next/server";
import { getTreeCrops } from "@/lib/server/faoClient";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getTreeCrops());
  } catch (err) {
    return NextResponse.json({ available: false, error: err instanceof Error ? err.message : String(err), crops: [], dataThroughYear: null, source: "FAOSTAT" });
  }
}
