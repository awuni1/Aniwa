import { NextRequest, NextResponse } from "next/server";
import { getGhanaLossData } from "@/lib/server/gfwClient";
import { isAdmin } from "@/lib/server/security";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // ?refresh=1 skips the 24 h cache and re-runs ~8 Global Forest Watch
  // queries, so only an admin may force it; everyone else gets the cache.
  const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1" && isAdmin(req);
  try {
    const data = await getGhanaLossData(forceRefresh);
    return NextResponse.json({ available: true, ...data });
  } catch (err) {
    console.error("region-loss:", err);
    return NextResponse.json({ available: false, error: "Live forest data is unavailable right now" });
  }
}
