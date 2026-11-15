import type { ProtectedAreaResult } from "@/app/api/site-check/route";

export type { ProtectedAreaResult };

export async function fetchProtectedAreaStatus(lat: number, lng: number): Promise<ProtectedAreaResult> {
  const res = await fetch(`/api/site-check?lat=${lat}&lng=${lng}`);
  return res.json();
}
