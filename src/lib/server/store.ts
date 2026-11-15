// Storage for chainsaw detections and the alert logs.
//
// With DATABASE_URL set (Supabase Postgres), everything is kept in the
// database, so it survives restarts and works on serverless hosts. Without
// it, the same data falls back to JSON files in data/, as before.
//
// Tables are created on first use. Row-level security is switched on with no
// policies, so Supabase's public REST API can't read or write them; the
// server connects as the database owner, which bypasses RLS.

import fs from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import type { ChainsawDetection } from "@/lib/acoustic";
import { SUPABASE_ROOT_CA_2021 } from "@/lib/server/supabaseCa";

const MAX_DETECTIONS = 500;
const DATA_DIR = path.join(process.cwd(), "data");
const DETECTIONS_FILE = path.join(DATA_DIR, "acoustic_detections.json");

// ---------- connection ----------

const globalForDb = globalThis as unknown as { aniwaPool?: Promise<Pool>; aniwaSchema?: Promise<void> };

// TLS: Supabase signs its database certificate with its own CA, so the
// connection is verified against that CA (download it from Supabase:
// Project Settings › Database › SSL Configuration). Give it as a file path in
// DATABASE_CA_CERT_PATH or as PEM text in DATABASE_CA_CERT. Without it,
// production refuses to connect; development connects encrypted but
// unverified, with a warning.
function isSupabase(url: string | undefined): boolean {
  try {
    const host = new URL(url ?? "").hostname;
    return host.endsWith(".supabase.com") || host.endsWith(".supabase.co");
  } catch {
    return false;
  }
}

async function sslConfig(): Promise<{ ca: string; rejectUnauthorized: true } | { rejectUnauthorized: false }> {
  let ca = process.env.DATABASE_CA_CERT;
  const caPath = process.env.DATABASE_CA_CERT_PATH;
  if (!ca && caPath) ca = await fs.readFile(path.resolve(process.cwd(), caPath), "utf8");
  if (!ca && isSupabase(process.env.DATABASE_URL)) ca = SUPABASE_ROOT_CA_2021;
  if (ca) return { ca, rejectUnauthorized: true };
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_CA_CERT_PATH (or DATABASE_CA_CERT) is required in production to verify the database certificate");
  }
  console.warn("store: no database CA certificate set; connecting without certificate verification (development only)");
  return { rejectUnauthorized: false };
}

async function pool(): Promise<Pool | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  // One pool per server process (kept across hot reloads in development).
  // Stored as a promise so concurrent first requests share the same pool.
  globalForDb.aniwaPool ??= sslConfig()
    .then(
      (ssl) =>
        new Pool({
          connectionString: url,
          ssl,
          max: 5,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 10_000,
        }),
    )
    .catch((err) => {
      globalForDb.aniwaPool = undefined; // retry on the next call
      throw err;
    });
  return globalForDb.aniwaPool;
}

const SCHEMA = `
  create table if not exists acoustic_detections (
    id uuid primary key,
    device_name text not null,
    lat double precision not null,
    lng double precision not null,
    accuracy_m double precision,
    score double precision not null,
    model text not null,
    detected_at timestamptz not null,
    received_at timestamptz not null,
    tile_image_url text not null
  );
  create index if not exists acoustic_detections_detected_at_idx on acoustic_detections (detected_at desc);
  alter table acoustic_detections enable row level security;

  create table if not exists app_state (
    key text primary key,
    value jsonb not null,
    updated_at timestamptz not null default now()
  );
  alter table app_state enable row level security;
`;

async function db(): Promise<Pool | null> {
  const p = await pool();
  if (!p) return null;
  globalForDb.aniwaSchema ??= p
    .query(SCHEMA)
    .then(() => undefined)
    .catch((err) => {
      globalForDb.aniwaSchema = undefined; // retry on the next call
      throw err;
    });
  await globalForDb.aniwaSchema;
  return p;
}

export function usingDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

// ---------- chainsaw detections ----------

type DetectionRow = {
  id: string;
  device_name: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  score: number;
  model: string;
  detected_at: Date;
  received_at: Date;
  tile_image_url: string;
};

const fromRow = (r: DetectionRow): ChainsawDetection => ({
  id: r.id,
  deviceName: r.device_name,
  lat: r.lat,
  lng: r.lng,
  accuracyM: r.accuracy_m,
  score: r.score,
  model: r.model,
  detectedAt: new Date(r.detected_at).toISOString(),
  receivedAt: new Date(r.received_at).toISOString(),
  tileImageUrl: r.tile_image_url,
});

/** Newest first, at most 500. */
export async function listDetections(): Promise<ChainsawDetection[]> {
  const p = await db();
  if (p) {
    const { rows } = await p.query<DetectionRow>(
      `select * from acoustic_detections order by detected_at desc limit $1`,
      [MAX_DETECTIONS],
    );
    return rows.map(fromRow);
  }
  try {
    return JSON.parse(await fs.readFile(DETECTIONS_FILE, "utf8"));
  } catch {
    return [];
  }
}

/** Saves one detection and returns the updated list (newest first). */
export async function addDetection(d: ChainsawDetection): Promise<ChainsawDetection[]> {
  const p = await db();
  if (p) {
    await p.query(
      `insert into acoustic_detections
         (id, device_name, lat, lng, accuracy_m, score, model, detected_at, received_at, tile_image_url)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [d.id, d.deviceName, d.lat, d.lng, d.accuracyM, d.score, d.model, d.detectedAt, d.receivedAt, d.tileImageUrl],
    );
    return listDetections();
  }
  const all = [d, ...(await listDetections())].slice(0, MAX_DETECTIONS);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DETECTIONS_FILE, JSON.stringify(all, null, 2), "utf8");
  return all;
}

// ---------- small JSON state (alert logs) ----------

/** Reads a stored value, or null if it has never been saved. */
export async function getState<T>(key: string): Promise<T | null> {
  const p = await db();
  if (p) {
    const { rows } = await p.query<{ value: T }>(`select value from app_state where key = $1`, [key]);
    return rows[0]?.value ?? null;
  }
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, `${key}.json`), "utf8")) as T;
  } catch {
    return null;
  }
}

export async function setState<T>(key: string, value: T): Promise<void> {
  const p = await db();
  if (p) {
    await p.query(
      `insert into app_state (key, value, updated_at) values ($1, $2::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, `${key}.json`), JSON.stringify(value), "utf8");
}
