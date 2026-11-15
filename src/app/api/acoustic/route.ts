import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { lonLatToTile, esriTileUrl } from "@/lib/tileMath";
import type { ChainsawDetection } from "@/lib/acoustic";
import { alertChainsaw, alertsConfigured, maybeAlertChainsawCluster } from "@/lib/server/alerts";
import { clientIp, isProduction, rateLimit, safeEqual } from "@/lib/server/security";
import { addDetection, listDetections } from "@/lib/server/store";

export const dynamic = "force-dynamic";

// Detections are kept by lib/server/store.ts: in Supabase Postgres when
// DATABASE_URL is set, otherwise in data/acoustic_detections.json.
const TILE_ZOOM = 15; // ~1.2 km tile at Ghana's latitude
export async function GET() {
  try {
    return NextResponse.json({ detections: await listDetections() });
  } catch (err) {
    console.error("acoustic: could not read detections:", err);
    return NextResponse.json({ detections: [], error: "Detections are unavailable right now" }, { status: 503 });
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// Anyone who can reach this URL can post here (e.g. through a tunnel), so if
// ACOUSTIC_DEVICE_KEY is set, phones must send it in the x-device-key header.
// A phone sends one clip every 10 s, so 30 reports a minute per address is
// generous for real use and stops floods of fake detections.
const REPORTS_PER_MIN = 30;

export async function POST(req: NextRequest) {
  // Without a device key anyone could post fake chainsaw detections and set
  // off SMS/Telegram/email alerts, so production refuses to run without one.
  const requiredKey = process.env.ACOUSTIC_DEVICE_KEY;
  if (!requiredKey && isProduction()) {
    console.error("acoustic: ACOUSTIC_DEVICE_KEY is not set; refusing detections");
    return NextResponse.json({ error: "detections are not accepted right now" }, { status: 503 });
  }
  const sentKey = req.headers.get("x-device-key") ?? "";
  if (requiredKey && !safeEqual(sentKey, requiredKey)) {
    return NextResponse.json({ error: "invalid device key" }, { status: 401 });
  }
  if (!rateLimit(`acoustic:${clientIp(req)}`, REPORTS_PER_MIN, 60_000)) {
    return NextResponse.json({ error: "too many reports, slow down" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { lat, lng, accuracyM, score, model, deviceName, detectedAt } = body;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "lat/lng required" }, { status: 400 });
  }
  if (!isFiniteNumber(score) || score < 0 || score > 1) {
    return NextResponse.json({ error: "score must be 0-1" }, { status: 400 });
  }

  const detectedDate = typeof detectedAt === "string" ? new Date(detectedAt) : new Date();
  const detection: ChainsawDetection = {
    id: randomUUID(),
    deviceName: typeof deviceName === "string" && deviceName.trim() ? deviceName.trim().slice(0, 40) : "Unnamed phone",
    lat,
    lng,
    accuracyM: isFiniteNumber(accuracyM) ? accuracyM : null,
    score,
    model: typeof model === "string" ? model.slice(0, 100) : "unknown",
    detectedAt: Number.isNaN(detectedDate.getTime()) ? new Date().toISOString() : detectedDate.toISOString(),
    receivedAt: new Date().toISOString(),
    tileImageUrl: esriTileUrl(lonLatToTile(lng, lat, TILE_ZOOM)),
  };

  let detections;
  try {
    detections = await addDetection(detection);
  } catch (err) {
    console.error("acoustic: could not save detection:", err);
    return NextResponse.json({ error: "could not save the detection, try again" }, { status: 503 });
  }

  // Email in the background: a slow or failing mail server must not make the
  // phone think the detection wasn't saved.
  if (alertsConfigured().ok) {
    alertChainsaw(detection).catch((err) => console.error("chainsaw alert email failed:", err));
  }
  maybeAlertChainsawCluster(detection, detections).catch((err) => console.error("chainsaw SMS/Telegram alert failed:", err));
  return NextResponse.json({ detection }, { status: 201 });
}
