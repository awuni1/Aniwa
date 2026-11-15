"use client";

import { useState } from "react";
import { Bell, Info, Flame, Satellite, ChevronRight } from "lucide-react";
import type { ActiveFire } from "@/lib/fires";
import type { RegionLoss } from "@/lib/deforestation";
import { FOREST_BELT_REGIONS } from "@/lib/deforestationModel";
import { placeLabel, useNearestPlace } from "@/lib/places";

const MAX_FIRES_LISTED = 8;
const MAX_ALERT_REGIONS_LISTED = 6;

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("en-GH", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function SectionTitle({ icon: Icon, children, count }: { icon: typeof Bell; children: React.ReactNode; count?: number }) {
  return (
    <div className="mb-2 mt-5 flex items-center justify-between">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-white/55">
        <Icon size={12} /> {children}
      </p>
      {count !== undefined && <span className="text-[11px] tabular-nums text-white/50">{fmt(count)}</span>}
    </div>
  );
}

interface Props {
  fires: ActiveFire[] | null;
  firesError: string | null;
  regions: RegionLoss[];
  onFocus: (point: { lat: number; lng: number }, region?: string) => void;
  children?: React.ReactNode; // chainsaw detections section, rendered first
}

export default function PriorityPanel({ fires, firesError, regions, onFocus, children }: Props) {
  const [showMethodology, setShowMethodology] = useState(false);
  const nearest = useNearestPlace();

  const forestFires = (fires ?? []).filter((f) => FOREST_BELT_REGIONS.has(f.region));
  const savannaFireCount = (fires?.length ?? 0) - forestFires.length;
  const alertRegions = [...regions].filter((r) => r.recentAlertAreaHa >= 0.1).sort((a, b) => b.recentAlertAreaHa - a.recentAlertAreaHa);

  return (
    <div className="px-4 py-4">
      <div className="mb-1 flex items-center gap-2">
        <Bell size={14} className="text-amber-400" />
        <p className="text-[11px] font-medium text-white/50">Live threats</p>
      </div>
      <p className="text-[11px] text-white/55">Click any item to see it on the map.</p>

      {children}

      {/* NASA FIRMS fires in the forest belt */}
      <SectionTitle icon={Flame} count={forestFires.length}>NASA fires in forest regions (5 days)</SectionTitle>
      {firesError && <p className="text-[11px] text-amber-200/80">{firesError}</p>}
      {!fires && !firesError && <p className="text-[11px] text-white/55">Loading NASA FIRMS…</p>}
      {fires && forestFires.length === 0 && <p className="text-[11px] text-white/55">No fires detected in forest regions in the last 5 days.</p>}
      <div className="space-y-1">
        {forestFires.slice(0, MAX_FIRES_LISTED).map((f) => (
          <button
            key={`${f.lat},${f.lng},${f.acquiredAt},${f.satellite}`}
            type="button"
            onClick={() => onFocus(f, f.region)}
            className="flex w-full items-center gap-2.5 rounded-lg border border-orange-500/20 bg-orange-500/5 px-2.5 py-2 text-left transition-colors hover:bg-orange-500/10"
          >
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-orange-500" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-white/85">{placeLabel(nearest?.(f) ?? null) ?? f.region}</span>
              <span className="block text-[11px] text-white/55">
                {timeAgo(f.acquiredAt)} · {f.confidence} confidence · {fmt(f.frpMw, 1)} MW
              </span>
            </span>
            <ChevronRight size={14} className="shrink-0 text-white/50" />
          </button>
        ))}
      </div>
      {fires && savannaFireCount > 0 && (
        <p className="mt-1.5 text-[11px] text-white/50">
          Plus {fmt(savannaFireCount)} fires in savanna regions, mostly seasonal grass burning, shown on the map but not listed.
        </p>
      )}

      {/* GFW disturbance alerts by region */}
      <SectionTitle icon={Satellite} count={alertRegions.length}>Satellite clearing alerts (30 days)</SectionTitle>
      <div className="space-y-1">
        {alertRegions.slice(0, MAX_ALERT_REGIONS_LISTED).map((r) => (
          <button
            key={r.region}
            type="button"
            onClick={() => onFocus(r, r.region)}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 px-2.5 py-2 text-left transition-colors hover:bg-white/5"
          >
            <span className="text-xs text-white/85">{r.region}</span>
            <span className="flex items-center gap-2">
              <span className="text-[11px] tabular-nums text-red-300/80">{fmt(r.recentAlertAreaHa, 1)} ha</span>
              <ChevronRight size={14} className="text-white/50" />
            </span>
          </button>
        ))}
      </div>

      <button
        onClick={() => setShowMethodology((v) => !v)}
        className="mt-4 flex items-center gap-1.5 text-[11px] text-white/50 transition-colors hover:text-white"
      >
        <Info size={12} />
        {showMethodology ? "Hide" : "Show"} where these come from
      </button>
      {showMethodology && (
        <ul className="mt-2 list-inside list-disc space-y-1.5 text-[11px] leading-relaxed text-white/50">
          <li>Chainsaw detections: listening phones running the /listen page. The pin is the phone, not the saw.</li>
          <li>Fires: NASA FIRMS active fires from VIIRS (three satellites) and MODIS, last 5 days, kept only if inside Ghana. Listed only in forest-belt regions (Western, Western North, Ahafo, Ashanti, Central, Eastern, Bono), where fire usually means land clearing; savanna fires are mostly seasonal burning. MW is fire radiative power, a measure of intensity.</li>
          <li>Clearing alerts: Global Forest Watch integrated alerts (GLAD-S2 + RADD), natural forest only, last 30 days.</li>
       </ul>
      )}
    </div>
  );
}
