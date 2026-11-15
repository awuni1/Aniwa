import { NextRequest, NextResponse } from "next/server";
import { checkClearing } from "@/lib/server/planetaryClient";
import { clientIp, rateLimit } from "@/lib/server/security";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ghana's bounding box (with a small margin): this route only checks points
// in Ghana, so it can't be used as a general proxy to Planetary Computer.
const BOUNDS = { south: 4.5, north: 11.4, west: -3.5, east: 1.4 };

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < BOUNDS.south || lat > BOUNDS.north || lng < BOUNDS.west || lng > BOUNDS.east) {
    return NextResponse.json({ available: false, error: "Pick a point inside Ghana" }, { status: 400 });
  }
  // Each check makes ~20 Planetary Computer requests; cached repeats are cheap,
  // but new points are limited per address.
  if (!rateLimit(`clearing:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ available: false, error: "Too many checks in a minute. Wait a moment and try again." }, { status: 429 });
  }
  try {
    return NextResponse.json({ available: true, ...(await checkClearing(lat, lng)) });
  } catch (err) {
    console.error("clearing-check:", err);
    return NextResponse.json({ available: false, error: "Satellite check is unavailable right now" });
  }
}
