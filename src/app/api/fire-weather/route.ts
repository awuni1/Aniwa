import { NextResponse } from "next/server";
import { getFireWeather, meteomaticsConfigured } from "@/lib/server/meteomaticsClient";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!meteomaticsConfigured()) {
    return NextResponse.json({ available: false, error: "Fire-weather forecast not configured" });
  }
  try {
    const { regions, fetchedAt } = await getFireWeather();
    return NextResponse.json({ available: true, regions, fetchedAt, source: "Meteomatics Weather API" });
  } catch (err) {
    // Log the detail on the server; send the browser a plain message only.
    console.error("fire-weather:", err);
    return NextResponse.json({ available: false, error: "Fire-weather forecast is unavailable right now" });
  }
}
