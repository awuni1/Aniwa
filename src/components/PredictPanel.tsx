"use client";

import { useEffect, useMemo, useState } from "react";
import { Brain, Info, MapPin, Crosshair, Flame, PawPrint, ShieldAlert, Sparkles, Loader2, Axe, Satellite } from "lucide-react";
import type { DeforestationPrediction } from "@/lib/deforestationModel";
import { MODEL_METHODOLOGY } from "@/lib/deforestationModel";
import ClearingCheck from "@/components/ClearingCheck";
import { fetchProtectedAreaStatus, type ProtectedAreaResult } from "@/lib/siteCheckClient";
import { distanceKm } from "@/lib/geo";
import type { SpeciesResult } from "@/lib/species";
import type { RegionLoss } from "@/lib/deforestation";
import { placeLabel, useNearestPlace } from "@/lib/places";

// Within this radius, a tracked species' nearest GBIF record counts as
// "nearby" — a round, explainable threshold, not a modeled habitat range
// (no real range-polygon data exists for these species at this precision).
const NEARBY_SPECIES_KM = 50;


interface PredictPanelProps {
  prediction: DeforestationPrediction | null;
  speciesResults: SpeciesResult[];
  regions: RegionLoss[];
  hotspots: DeforestationPrediction[] | null;
  hotspotsRunning: boolean;
  canPredict: boolean; // live data loaded
  liveSummary: { chainsaws: number; forestFires: number };
  onPredictHotspots: () => void;
  onSelectHotspot: (p: DeforestationPrediction) => void;
}

const RISK_STYLE: Record<string, { bg: string; border: string; text: string; label: string }> = {
  low: { bg: "bg-gray-500/10", border: "border-gray-500/30", text: "text-gray-300", label: "Low" },
  moderate: { bg: "bg-yellow-500/10", border: "border-yellow-500/30", text: "text-yellow-300", label: "Moderate" },
  high: { bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-300", label: "High" },
  severe: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-300", label: "Severe" },
};

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("en-GH", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export default function PredictPanel({
  prediction,
  speciesResults,
  hotspots,
  hotspotsRunning,
  canPredict,
  liveSummary,
  onPredictHotspots,
  onSelectHotspot,
}: PredictPanelProps) {
  const [showMethodology, setShowMethodology] = useState(false);
  const nearest = useNearestPlace();
  const [protectedArea, setProtectedArea] = useState<ProtectedAreaResult | null>(null);

  // New point clicked — look up protected-area status automatically. The
  // user shouldn't have to click a button to see whether it's protected.
  useEffect(() => {
    setProtectedArea(null);
    if (prediction) fetchProtectedAreaStatus(prediction.lat, prediction.lng).then(setProtectedArea);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prediction?.lat, prediction?.lng]);

  // Nearest confirmed GBIF occurrence of each tracked species to the clicked
  // point — real occurrence coordinates (sampled, capped at 50/species, fetched
  // once for the whole app), not a modeled habitat range.
  const speciesExposure = useMemo(() => {
    if (!prediction) return [];
    return speciesResults.map((r) => {
      let nearestKm: number | null = null;
      for (const o of r.occurrences) {
        const d = distanceKm(prediction, o);
        if (nearestKm === null || d < nearestKm) nearestKm = d;
      }
      return { species: r.species, nearestKm, sampleSize: r.occurrences.length };
    });
  }, [prediction, speciesResults]);

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <Brain size={14} className="text-emerald-400" />
        <p className="text-[11px] font-medium text-white/50">Predict deforestation</p>
      </div>

      <button
        type="button"
        onClick={onPredictHotspots}
        disabled={!canPredict || hotspotsRunning}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 py-3 text-sm font-medium text-white shadow-lg shadow-emerald-900/30 transition hover:brightness-110 disabled:opacity-50"
      >
        {hotspotsRunning ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {hotspotsRunning ? "Predicting…" : canPredict ? "Predict where clearing is happening" : "Loading live data…"}
      </button>
      <p className="mt-2 text-[11px] leading-relaxed text-white/55">
        Uses loss history, remaining forest, {liveSummary.chainsaws} chainsaw detection{liveSummary.chainsaws === 1 ? "" : "s"} and {liveSummary.forestFires} NASA fire
        {liveSummary.forestFires === 1 ? "" : "s"} in forest regions (last 5 days). Or click any spot on the map.
      </p>

      {hotspots && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[11px] font-medium text-white/55">Top {hotspots.length} hotspots</p>
          {hotspots.map((h, i) => {
            const active = prediction?.lat === h.lat && prediction?.lng === h.lng;
            const evidence = [
              h.chainsawDetectionsNearby > 0 && `${h.chainsawDetectionsNearby} chainsaw`,
              h.forestFiresNearby > 0 && `${h.forestFiresNearby} fire${h.forestFiresNearby === 1 ? "" : "s"}`,
            ].filter(Boolean);
            return (
              <button
                key={`${h.lat},${h.lng}`}
                type="button"
                onClick={() => onSelectHotspot(h)}
                className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                  active ? "border-white/30 bg-white/10" : "border-white/10 hover:bg-white/5"
                }`}
              >
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${RISK_STYLE[h.riskLevel].bg} ${RISK_STYLE[h.riskLevel].text}`}>
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-white/85">{placeLabel(nearest?.(h) ?? null) ?? `Near ${h.nearestFrontierRegion}`}</span>
                  <span className="block text-[11px] text-white/55">{evidence.length > 0 ? `Live: ${evidence.join(", ")}` : "History and forest only"}</span>
                </span>
                <span className={`shrink-0 text-xs font-medium tabular-nums ${RISK_STYLE[h.riskLevel].text}`}>{fmt(h.probability * 100, 0)}%</span>
              </button>
            );
          })}
        </div>
      )}

      {hotspots && prediction && (
        <button
          type="button"
          onClick={() => document.getElementById("clearing-check")?.scrollIntoView({ behavior: "smooth", block: "center" })}
          className="mt-3 flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 text-left text-xs text-emerald-200 transition-colors hover:border-emerald-400/60"
        >
          <span>Next: check the selected spot with satellites</span>
          <span aria-hidden="true">↓</span>
        </button>
      )}

      {!prediction && !hotspots && (
        <div className="mt-3 flex items-start gap-2 bg-emerald-500/5 border border-emerald-500/20 px-3 py-3 text-xs text-white/60 leading-relaxed rounded-xl">
          <Crosshair size={14} className="shrink-0 mt-0.5 text-emerald-400" />
          <span>Press Predict, or click any point on the map to check it.</span>
        </div>
      )}
      {prediction && <div className="mt-4" />}

      {prediction && (
        <>
          <div className={`border px-4 py-3 ${RISK_STYLE[prediction.riskLevel].bg} ${RISK_STYLE[prediction.riskLevel].border} rounded-xl`}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-white/55">Predicted risk</span>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-sm ${RISK_STYLE[prediction.riskLevel].text}`}>
                {RISK_STYLE[prediction.riskLevel].label}
              </span>
            </div>
            <p className="text-3xl font-semibold text-white tabular-nums mt-1">
              {fmt(prediction.probability * 100, 1)}<span className="text-base font-normal text-white/50">%</span>
            </p>
            <p className="text-[11px] text-white/50 mt-1 tabular-nums flex items-center gap-1">
              <MapPin size={10} /> {prediction.lat.toFixed(4)}, {prediction.lng.toFixed(4)}
            </p>
            {nearest && placeLabel(nearest(prediction)) && (
              <p className="text-xs text-white/70 mt-0.5">{placeLabel(nearest(prediction))}</p>
            )}
          </div>

          {/* Protected area — only shown when it matters (point is inside one) */}
          {protectedArea?.inside && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 px-3 py-2.5 mt-2 rounded-xl">
              <ShieldAlert size={14} className="shrink-0 mt-0.5 text-red-300" />
              <div>
                <p className="text-xs font-medium text-red-300">Protected — do not clear</p>
                <p className="text-[11px] text-white/60 mt-0.5">
                  {protectedArea.name} ({protectedArea.designation}{protectedArea.iucnCategory ? `, IUCN ${protectedArea.iucnCategory}` : ""})
                </p>
              </div>
            </div>
          )}


          <div className="space-y-2 mt-3">
            <div>
              <div className="flex items-center justify-between text-[11px] mb-0.5">
                <span className="text-white/70">Frontier pressure ({fmt(prediction.contributionFrontierPct)}%)</span>
                <span className="text-white/55 tabular-nums">{fmt(prediction.distanceToFrontierKm)} km</span>
              </div>
              <div className="h-1.5 bg-white/5">
                <div className="h-full bg-orange-500/60" style={{ width: `${Math.max(prediction.contributionFrontierPct, 2)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-[11px] mb-0.5">
                <span className="text-white/70">Forest presence ({fmt(prediction.contributionForestPct)}%)</span>
                <span className="text-white/55 tabular-nums">
                  {prediction.treeCoverPct !== null ? `${fmt(prediction.treeCoverPct)}% tree cover` : `${fmt(prediction.distanceToForestKm)} km`}
                </span>
              </div>
              <div className="h-1.5 bg-white/5">
                <div className="h-full bg-green-500/60" style={{ width: `${Math.max(prediction.contributionForestPct, 2)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-[11px] mb-0.5">
                <span className="text-white/70">Live activity ({fmt(prediction.contributionActivityPct)}%)</span>
              </div>
              <div className="h-1.5 bg-white/5">
                <div className="h-full bg-red-500/70" style={{ width: `${Math.max(prediction.contributionActivityPct, 2)}%` }} />
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[11px] text-white/50">
                <span className="flex items-center gap-1"><Axe size={10} className={prediction.chainsawDetectionsNearby ? "text-red-400" : ""} /> {prediction.chainsawDetectionsNearby} chainsaw</span>
                <span className="flex items-center gap-1"><Flame size={10} className={prediction.forestFiresNearby ? "text-orange-400" : ""} /> {prediction.forestFiresNearby} fires</span>
                <span className="flex items-center gap-1"><Satellite size={10} /> {fmt(prediction.regionActiveAlertHa, 0)} ha alerts</span>
              </div>
              {prediction.fireWeatherIndex !== null && (
                <p className="mt-1 text-[11px] text-white/50">
                  Fire weather (next 3 days, {prediction.fireWeatherRegion}): index{" "}
                  <span className={prediction.fireWeatherIndex > 0.5 ? "text-orange-300" : ""}>{prediction.fireWeatherIndex.toFixed(1)}</span>
                  {prediction.fireWeatherIndex > 0.5 ? " — adds a little to the risk" : " — no effect below 0.5"}
                </p>
              )}
            </div>
          </div>

          <ClearingCheck key={`${prediction.lat},${prediction.lng}`} lat={prediction.lat} lng={prediction.lng} />

          {/* Species exposure at this point */}
          {speciesExposure.length > 0 && (
            <div className="mt-4 border border-white/10 p-3 rounded-xl">
              <p className="text-[11px] font-medium text-white/55 flex items-center gap-1.5 mb-2">
                <PawPrint size={11} /> Species nearby
              </p>
              <div className="space-y-1.5">
                {speciesExposure.map(({ species, nearestKm, sampleSize }) => {
                  const nearby = nearestKm !== null && nearestKm <= NEARBY_SPECIES_KM;
                  return (
                    <div
                      key={species.scientificName}
                      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 border ${
                        nearby ? "bg-red-500/5 border-red-500/20" : "border-white/10"
                      } rounded-xl`}
                    >
                      <span className="text-xs text-white/80 truncate">{species.commonName}</span>
                      <span className={`text-[11px] tabular-nums shrink-0 ${nearby ? "text-red-300" : "text-white/55"}`}>
                        {nearestKm !== null ? `${fmt(nearestKm)} km` : sampleSize === 0 ? "no sample" : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </>
      )}

      <button
        onClick={() => setShowMethodology((v) => !v)}
        className="mt-4 flex items-center gap-1.5 text-[11px] text-white/50 hover:text-white transition-colors"
      >
        <Info size={12} />
        {showMethodology ? "Hide" : "Show"} methodology — what this model is and isn&apos;t
      </button>
      {showMethodology && (
        <ul className="mt-2 space-y-1.5 text-[11px] text-white/50 leading-relaxed list-disc list-inside">
          {MODEL_METHODOLOGY.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
          <li>Protected-area check: a real point-in-polygon lookup against the World Database on Protected Areas (WDPA) — the actual legal register of Ghana&apos;s national parks and forest reserves. Only shown when the point is inside one.</li>
        </ul>
      )}
    </div>
  );
}
