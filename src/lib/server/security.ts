// Small server-side guards shared by the API routes: an admin check for
// setup-only endpoints, a constant-time key compare, and an in-memory rate
// limiter.
//
// The rate limiter keeps counts in this server process. That is enough for a
// single server (or `next start`); on a serverless host each instance keeps
// its own counts, so use a shared store (e.g. Redis/Upstash) there.

import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Setup-only endpoints: allowed with a matching x-admin-key header. When
 * ADMIN_KEY isn't set, they work only while developing (`next dev`).
 */
export function isAdmin(req: NextRequest): boolean {
  const key = process.env.ADMIN_KEY;
  if (!key) return !isProduction();
  const sent = req.headers.get("x-admin-key");
  return sent !== null && safeEqual(sent, key);
}

export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

const buckets = new Map<string, { count: number; resetAt: number }>();

/** True if this call is allowed; false once `limit` calls happened within `windowMs`. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}
