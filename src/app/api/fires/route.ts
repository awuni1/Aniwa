import { NextResponse } from "next/server";
import { getActiveFires } from "@/lib/server/firmsClient";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getActiveFires());
  } catch (err) {
    return NextResponse.json({ available: false, error: err instanceof Error ? err.message : String(err), fires: [], days: 0, sources: [], fetchedAt: new Date().toISOString() });
  }
}
