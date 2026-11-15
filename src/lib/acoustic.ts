// Chainsaw detections reported by listening devices (an iPhone running the
// /listen page). The audio is classified ON the phone, so only this small
// record is sent — no audio ever leaves the device.

export interface ChainsawDetection {
  id: string;
  deviceName: string;
  lat: number;
  lng: number;
  accuracyM: number | null; // the phone's own GPS accuracy estimate, not the distance to the saw
  score: number; // 0-1 model confidence for the clip that triggered this detection
  model: string;
  detectedAt: string; // when the phone heard it (ISO)
  receivedAt: string; // when the server stored it (ISO)
  tileImageUrl: string; // satellite tile covering the phone's position
}

// What a phone sends; the server fills in id, receivedAt and tileImageUrl.
export type ChainsawReport = Pick<ChainsawDetection, "deviceName" | "lat" | "lng" | "accuracyM" | "score" | "model" | "detectedAt">;

// A chainsaw is the phone's neighbour, not its position: one phone can only
// say "a saw was heard within earshot of here". Roughly 1 km is a commonly
// cited audible range for a chainsaw under forest canopy; it varies a lot
// with terrain, wind and the phone's microphone, so the map shows it as an
// approximate search radius, not a measured one.
export const APPROX_HEARING_RADIUS_M = 1000;

export async function fetchDetections(): Promise<ChainsawDetection[]> {
  const res = await fetch("/api/acoustic", { cache: "no-store" });
  if (!res.ok) throw new Error(`detections fetch failed: ${res.status}`);
  const data = await res.json();
  return data.detections ?? [];
}
