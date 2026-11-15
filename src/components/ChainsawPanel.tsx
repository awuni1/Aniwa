"use client";

import { useState } from "react";
import { Axe, Info, Smartphone } from "lucide-react";
import { APPROX_HEARING_RADIUS_M, type ChainsawDetection } from "@/lib/acoustic";
import { placeLabel, useNearestPlace } from "@/lib/places";

function timeAgo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

interface Props {
  detections: ChainsawDetection[];
  loaded: boolean;
  onSelect: (d: ChainsawDetection) => void;
}

export default function ChainsawPanel({ detections, loaded, onSelect }: Props) {
  const [showMethodology, setShowMethodology] = useState(false);
  const nearest = useNearestPlace();

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <Axe size={14} className="text-red-400" />
        <p className="text-[11px] font-medium text-white/50">Chainsaw detections</p>
      </div>

      <a
        href="/listen"
        target="_blank"
        className="flex items-center gap-2 border border-white/15 px-3 py-2.5 mb-4 text-[11px] text-white/70 hover:text-white hover:border-white/30 transition-colors rounded-xl"
      >
        <Smartphone size={14} className="shrink-0" />
        <span>Open <span className="font-mono text-white">/listen</span> on a phone to turn it into a listening device.</span>
      </a>

      {!loaded && <p className="text-xs text-white/55">Loading detections…</p>}
      {loaded && detections.length === 0 && (
        <p className="text-xs text-white/55">No chainsaws heard yet. Detections from listening phones appear here and on the map.</p>
      )}

      <div className="space-y-2">
        {detections.map((d) => {
          return (
            <div key={d.id} className="border border-red-500/25 bg-red-500/5 px-3 py-2.5 rounded-xl">
              <button type="button" onClick={() => onSelect(d)} className="w-full text-left flex gap-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white font-medium">{Math.round(d.score * 100)}% chainsaw</span>
                    <span className="text-[11px] text-white/55 tabular-nums">{timeAgo(d.detectedAt)}</span>
                  </div>
                  {nearest?.(d) && <p className="text-xs text-white/80 truncate">{placeLabel(nearest(d))}</p>}
                  <p className="text-[11px] text-white/50 truncate">{d.deviceName}</p>
                  <p className="text-[11px] text-white/50 tabular-nums">
                    {d.lat.toFixed(5)}, {d.lng.toFixed(5)}
                    {d.accuracyM !== null && ` · GPS ±${Math.round(d.accuracyM)} m`}
                  </p>
                </div>
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => setShowMethodology((v) => !v)}
        className="mt-4 flex items-center gap-1.5 text-[11px] text-white/50 hover:text-white transition-colors"
      >
        <Info size={12} />
        {showMethodology ? "Hide" : "Show"} how detection works
      </button>
      {showMethodology && (
        <ul className="mt-2 space-y-1.5 text-[11px] text-white/50 leading-relaxed list-disc list-inside">
          <li>The phone records 10-second clips and classifies each one on the phone itself with a Hugging Face audio model. Audio never leaves the phone; only detections are sent.</li>
          <li>The pin is the phone&apos;s GPS position, not the saw&apos;s. One phone can&apos;t tell direction or distance, so the shaded circle (~{APPROX_HEARING_RADIUS_M / 1000} km) is an approximate search area, not a measurement.</li>
          <li>The model is general-purpose, not trained on Ghanaian forest recordings. It can mistake motorbikes or generators for chainsaws, and miss distant saws. Treat a detection as a reason to look, not proof.</li>
        </ul>
      )}
    </div>
  );
}
