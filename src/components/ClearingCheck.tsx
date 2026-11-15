"use client";

import { useState } from "react";
import { Satellite, Loader2, Info } from "lucide-react";
import {
  NDVI_DROP_CLEARING,
  NDVI_DROP_POSSIBLE,
  NDVI_FOREST_MIN,
  VH_DROP_DB,
  fetchClearingCheck,
  type ClearingCheckResponse,
  type ClearingVerdict,
  type OpticalScene,
} from "@/lib/clearingCheck";
import { placeLabel, useNearestPlace } from "@/lib/places";

const VERDICT: Record<ClearingVerdict, { label: string; text: string; box: string }> = {
  clearing_likely: { label: "Clearing likely", text: "text-red-300", box: "bg-red-500/10 border-red-500/30" },
  radar_suggests_clearing: { label: "Radar suggests clearing", text: "text-red-300", box: "bg-red-500/10 border-red-500/30" },
  possible_change: { label: "Possible thinning", text: "text-amber-300", box: "bg-amber-500/10 border-amber-500/30" },
  no_change: { label: "No clear change", text: "text-emerald-300", box: "bg-emerald-500/5 border-emerald-500/20" },
  radar_no_change: { label: "No change on radar", text: "text-emerald-300", box: "bg-emerald-500/5 border-emerald-500/20" },
  not_forest: { label: "Little dense vegetation a year ago", text: "text-white/70", box: "bg-white/[0.03] border-white/10" },
  no_data: { label: "Too cloudy, no radar either", text: "text-white/70", box: "bg-white/[0.03] border-white/10" },
};

// "2025-11-03" -> "3 Nov 2025"
const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function Scene({ title, scene }: { title: string; scene: OpticalScene | null }) {
  return (
    <figure className="min-w-0">
      {scene ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote PNG crop from Planetary Computer
        <img src={scene.imageUrl} alt={`${title}: satellite image from ${fmtDate(scene.date)}`} className="aspect-square w-full border border-white/10 object-cover rounded-xl" />
      ) : (
        <div className="grid aspect-square w-full place-items-center border border-dashed border-white/15 px-2 text-center text-[11px] text-white/55 rounded-xl">
          No cloud-free image
        </div>
      )}
      <figcaption className="mt-1 text-[11px] text-white/50">
        {title}
        {scene && (
          <>
            {" "}· {fmtDate(scene.date)} · greenness <span className="tabular-nums text-white/70">{scene.ndvi.toFixed(2)}</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}

export default function ClearingCheck({ lat, lng }: { lat: number; lng: number }) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [result, setResult] = useState<ClearingCheckResponse | null>(null);
  const [showMethod, setShowMethod] = useState(false);
  const nearest = useNearestPlace();
  const place = placeLabel(nearest?.({ lat, lng }) ?? null);

  async function run() {
    setState("loading");
    try {
      setResult(await fetchClearingCheck(lat, lng));
    } catch {
      setResult({ available: false, error: "Satellite check is unavailable right now" });
    }
    setState("done");
  }

  return (
    <div id="clearing-check" className="mt-4 border border-white/10 p-3 rounded-xl">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-white/55">
        <Satellite size={11} /> Check with satellites
      </p>

      {state === "idle" && (
        <button
          type="button"
          onClick={run}
          className="flex w-full items-center justify-center gap-2 border border-white/15 py-2 text-xs text-white/80 transition-colors hover:border-white/30 hover:text-white rounded-xl"
        >
          <Satellite size={13} /> Compare this spot now vs a year ago
        </button>
      )}

      {state === "loading" && (
        <p className="flex items-center gap-2 text-[11px] text-white/50">
          <Loader2 size={13} className="animate-spin" /> Searching Sentinel-2 and Sentinel-1 images…
        </p>
      )}

      {state === "done" && result && !result.available && <p className="text-[11px] text-white/50">{result.error}</p>}

      {state === "done" && result?.available && (
        <>
          <div className={`border px-3 py-2 ${VERDICT[result.verdict].box} rounded-xl`}>
            <p className={`text-xs font-medium ${VERDICT[result.verdict].text}`}>{VERDICT[result.verdict].label}</p>
            {(result.verdict === "clearing_likely" || result.verdict === "radar_suggests_clearing" || result.verdict === "possible_change") && (
              <p className="mt-0.5 text-[11px] text-white/70">Next: share this place with forest officers to check on the ground.</p>
            )}
            {place && <p className="mt-0.5 text-[11px] text-white/70">{place}</p>}
            {result.ndviDrop !== null && (
              <p className="mt-0.5 text-[11px] text-white/60">
                {Math.abs(result.ndviDrop) < 0.005 ? (
                  <>Greenness unchanged in the {result.boxKm} km box.</>
                ) : (
                  <>
                    Greenness {result.ndviDrop > 0 ? "fell" : "rose"} by{" "}
                    <span className="tabular-nums">{Math.abs(result.ndviDrop).toFixed(2)}</span> in the {result.boxKm} km box.
                  </>
                )}
              </p>
            )}
            {result.radar && (
              <p className="mt-0.5 text-[11px] text-white/60">
                Radar, which sees through cloud: {result.radar.beforeDb - result.radar.afterDb >= VH_DROP_DB ? "the tree canopy signal dropped, which suggests trees were removed" : "the tree canopy signal is steady"}{" "}
                <span className="text-white/45">
                  ({result.radar.beforeDb.toFixed(1)} → {result.radar.afterDb.toFixed(1)} dB)
                </span>
                .
              </p>
            )}
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <Scene title="A year ago" scene={result.before} />
            <Scene title="Now" scene={result.after} />
          </div>

          <button
            type="button"
            onClick={() => setShowMethod((s) => !s)}
            className="mt-2 flex items-center gap-1.5 text-[11px] text-white/55 transition-colors hover:text-white/70"
          >
            <Info size={11} /> {showMethod ? "Hide" : "How this works"}
          </button>
          {showMethod && (
            <ul className="mt-1.5 list-inside list-disc space-y-1 text-[11px] leading-relaxed text-white/50">
              <li>
                Compares a {result.boxKm} km box around this point over the last {result.windowDays} days with the same {result.windowDays} days a year
                earlier, so seasonal browning isn&apos;t mistaken for clearing.
              </li>
              <li>
                Optical: the clearest Sentinel-2 image in each period (at least 80% of the box cloud-free). NDVI measures green vegetation.
                A drop of {NDVI_DROP_CLEARING} or more reads as clearing likely, {NDVI_DROP_POSSIBLE}–{NDVI_DROP_CLEARING} as possible thinning. Below {NDVI_FOREST_MIN} a
                year ago there was little dense vegetation to clear.
              </li>
              <li>
                Radar: Sentinel-1 VH backscatter averaged over up to 3 scenes per period. It sees through cloud, so it is used alone when no clear
                optical image exists. A fall of {VH_DROP_DB} dB or more suggests canopy loss.
              </li>
              <li>These thresholds are Aniwa&apos;s own judgment. Treat a result as a lead to check on the ground, not proof.</li>
              <li>Data: Copernicus Sentinel-1 and Sentinel-2 via Microsoft Planetary Computer.</li>
            </ul>
          )}
        </>
      )}
    </div>
  );
}
