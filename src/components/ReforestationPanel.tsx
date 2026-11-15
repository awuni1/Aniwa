"use client";

import { useMemo, useState } from "react";
import { Sprout, Info } from "lucide-react";
import type { RegionLoss } from "@/lib/deforestation";
import { recommendSites } from "@/lib/reforestation";

interface ReforestationPanelProps {
  selectedRegion: string | null;
  regions: RegionLoss[];
  maxLossKha: number;
}

const TYPE_LABEL: Record<string, string> = {
  primary_forest_restoration: "Primary forest restoration",
  climate_smart_agroforestry: "Climate-smart agroforestry (cocoa shade)",
};

const TYPE_COLOR: Record<string, string> = {
  primary_forest_restoration: "text-green-300 bg-green-500/10 border-green-500/30",
  climate_smart_agroforestry: "text-lime-300 bg-lime-500/10 border-lime-500/30",
};

export default function ReforestationPanel({ selectedRegion, regions, maxLossKha }: ReforestationPanelProps) {
  const [showMethodology, setShowMethodology] = useState(false);
  const region = regions.find((r) => r.region === selectedRegion);
  const centroid = useMemo(() => (region ? { lat: region.lat, lng: region.lng } : null), [region]);

  const sites = useMemo(
    () => (region && centroid ? recommendSites(region, centroid, maxLossKha) : null),
    [region, centroid, maxLossKha],
  );

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <Sprout size={14} className="text-lime-400" />
        <p className="text-[11px] font-medium text-white/50">Reforestation</p>
      </div>

      {!sites && <p className="text-xs text-white/55">Select a region in the Deforestation tab.</p>}

      {sites && region && (
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-white/55 mb-1">Top 3 sites — {region.region}</p>
          {sites.map((s, i) => (
            <div key={i} className="border border-white/10 px-3 py-2.5 rounded-xl">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-white font-medium">#{i + 1} · {s.score}/100</span>
                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-sm border ${TYPE_COLOR[s.recommendationType]}`}>
                  {TYPE_LABEL[s.recommendationType]}
                </span>
              </div>
              <p className="text-[11px] text-white/50 leading-relaxed">{s.reasoning}</p>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => setShowMethodology((v) => !v)}
        className="mt-4 flex items-center gap-1.5 text-[11px] text-white/50 hover:text-white transition-colors"
      >
        <Info size={12} />
        {showMethodology ? "Hide" : "Show"} methodology
      </button>
      {showMethodology && (
        <ul className="mt-2 space-y-1.5 text-[11px] text-white/50 leading-relaxed list-disc list-inside">
          <li>No free API gives real soil-moisture or river-basin data for Ghana, so this doesn&apos;t fabricate it.</li>
          <li>Score = connectivity to intact forest (0-60) + the region&apos;s real loss severity (0-40, live GFW data).</li>
          <li>Sites sit at 25/50/75% of the line from region center toward the nearest intact forest — a geometric proxy, not a GIS suitability model.</li>
        </ul>
      )}
    </div>
  );
}
