// Meteomatics Weather API client: a 3-day fire-weather forecast for each
// forest-belt region, in one request. Credentials stay on the server
// (METEOMATICS_USERNAME / METEOMATICS_PASSWORD in .env) and are sent only to
// api.meteomatics.com.

import { fireWeatherLevel, type FireWeatherDay, type RegionFireWeather } from "@/lib/fireWeather";

const API = "https://api.meteomatics.com";
const CACHE_MS = 60 * 60 * 1000; // forecasts update a few times a day; one call an hour is plenty

// One representative point per forest-belt region (same points the loss data uses).
const FOREST_BELT_POINTS: { region: string; lat: number; lng: number }[] = [
  { region: "Western", lat: 5.1, lng: -2.0 },
  { region: "Western North", lat: 6.2, lng: -2.48 },
  { region: "Ahafo", lat: 6.8014, lng: -2.5169 },
  { region: "Ashanti", lat: 6.7, lng: -1.6 },
  { region: "Central", lat: 5.3, lng: -1.1 },
  { region: "Eastern", lat: 6.3, lng: -0.5 },
  { region: "Bono", lat: 7.3399, lng: -2.3268 },
];

// forest_fire_warning: Meteomatics' 0..1 forest fire index (soil-moisture based).
// The rest are the plain weather behind it, shown so people can see why.
const PARAMS = [
  "forest_fire_warning:idx",
  "t_max_2m_24h:C",
  "precip_24h:mm",
  "wind_gusts_10m_24h:ms",
  "relative_humidity_min_2m_24h:p",
] as const;

type ApiResponse = {
  status: string;
  data: { parameter: string; coordinates: { lat: number; lon: number; dates: { date: string; value: number }[] }[] }[];
};

let cache: { at: number; regions: RegionFireWeather[] } | null = null;

export function meteomaticsConfigured(): boolean {
  return Boolean(process.env.METEOMATICS_USERNAME && process.env.METEOMATICS_PASSWORD);
}

export async function getFireWeather(): Promise<{ regions: RegionFireWeather[]; fetchedAt: string }> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return { regions: cache.regions, fetchedAt: new Date(cache.at).toISOString() };
  }
  const user = process.env.METEOMATICS_USERNAME;
  const pass = process.env.METEOMATICS_PASSWORD;
  if (!user || !pass) throw new Error("METEOMATICS_USERNAME and METEOMATICS_PASSWORD are not set");

  // 24-hour figures are stamped at the END of their window, so values at
  // tomorrow 00Z, +1 day and +2 days cover today, tomorrow and the day after.
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() + 1);
  const time = `${start.toISOString().replace(".000", "")}P2D:P1D`;
  const coords = FOREST_BELT_POINTS.map((p) => `${p.lat},${p.lng}`).join("+");
  const url = `${API}/${time}/${PARAMS.join(",")}/${coords}/json`;

  const res = await fetch(url, {
    headers: { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Meteomatics returned HTTP ${res.status}`);
  const body = (await res.json()) as ApiResponse;
  if (body.status !== "OK") throw new Error("Meteomatics returned an error status");

  const series = (param: string, i: number) =>
    body.data.find((d) => d.parameter === param)?.coordinates[i]?.dates ?? [];

  const regions: RegionFireWeather[] = FOREST_BELT_POINTS.map((p, i) => {
    const idx = series("forest_fire_warning:idx", i);
    const days: FireWeatherDay[] = idx.map((d, k) => {
      const covered = new Date(new Date(d.date).getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
      const val = (param: string) => {
        const v = series(param, i)[k]?.value;
        return typeof v === "number" && Number.isFinite(v) && v > -999 ? v : null;
      };
      return {
        date: covered,
        fireIndex: val("forest_fire_warning:idx"),
        tMaxC: val("t_max_2m_24h:C"),
        precipMm: val("precip_24h:mm"),
        gustMs: val("wind_gusts_10m_24h:ms"),
        rhMinPct: val("relative_humidity_min_2m_24h:p"),
      };
    });
    const indices = days.map((d) => d.fireIndex).filter((v): v is number => v !== null);
    const peakIndex = indices.length ? Math.max(...indices) : null;
    return { ...p, days, peakIndex, level: fireWeatherLevel(peakIndex) };
  }).sort((a, b) => (b.peakIndex ?? -1) - (a.peakIndex ?? -1));

  cache = { at: Date.now(), regions };
  return { regions, fetchedAt: new Date(cache.at).toISOString() };
}
