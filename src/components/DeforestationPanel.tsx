"use client";

import { useMemo, useState } from "react";
import { TreeDeciduous, Info, AlertTriangle } from "lucide-react";
import { DEFORESTATION_DATA_SOURCE, type RegionLoss } from "@/lib/deforestation";
import type { GhanaLossData } from "@/lib/regionLossClient";
import { estimateCarbonEmissions } from "@/lib/carbon";

interface DeforestationPanelProps {
  selectedRegion: string | null;
  onSelectRegion: (region: string | null) => void;
  lossData: GhanaLossData | null;
  onOpenSection?: (section: "predict" | "reforestation") => void;
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("en-GH", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

type RegionFilter = "all" | "top5";

// Below this much tree cover in 2000, a "% lost" figure means little.
const MIN_FOREST_KHA_FOR_PCT = 10;

export default function DeforestationPanel({ selectedRegion, onSelectRegion, lossData, onOpenSection }: DeforestationPanelProps) {
  const [showMethodology, setShowMethodology] = useState(false);
  const [regionFilter, setRegionFilter] = useState<RegionFilter>("top5");

  const regions = useMemo(() => lossData?.regions ?? [], [lossData]);
  const sortedRegions = useMemo(() => [...regions].sort((a, b) => b.totalLossKha2001to2024 - a.totalLossKha2001to2024), [regions]);
  const visibleRegions = regionFilter === "top5" ? sortedRegions.slice(0, 5) : sortedRegions;

  const region: RegionLoss | undefined = sortedRegions.find((r) => r.region === selectedRegion);
  const regionCarbon = region ? estimateCarbonEmissions(region.totalLossKha2001to2024 * 1000) : null;

  const nationalCo2e = lossData ? estimateCarbonEmissions(lossData.nationalTotalLossKha2001to2024 * 1000) : null;

  if (!lossData) {
    return (
      <div className="px-4 py-4">
        <p className="text-xs text-white/55">Loading live data…</p>
      </div>
    );
  }

  if (!lossData.available) {
    return (
      <div className="px-4 py-4">
        <div className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/20 px-3 py-3 text-xs text-amber-200/80 leading-relaxed rounded-xl">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Couldn&apos;t reach live data: {lossData.error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <TreeDeciduous size={14} className="text-green-400" />
        <p className="text-[11px] font-medium text-white/50">Ghana deforestation</p>
      </div>

      {/* National summary */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="border border-white/10 px-3 py-2.5 rounded-xl">
          <p className="text-[11px] font-medium text-white/55 mb-1">Lost in {lossData.dataThroughYear}</p>
          <p className="text-lg font-semibold text-white tabular-nums">
            {fmt(lossData.nationalTotalLossKha2024)} <span className="text-xs font-normal text-white/50">k ha</span>
          </p>
        </div>
        <div className="border border-white/10 px-3 py-2.5 rounded-xl">
          <p className="text-[11px] font-medium text-white/55 mb-1">Lost since 2001</p>
          <p className="text-lg font-semibold text-white tabular-nums">
            {fmt(lossData.nationalTotalLossKha2001to2024 / 1000, 2)} <span className="text-xs font-normal text-white/50">M ha</span>
          </p>
        </div>
        <div className="col-span-2 border border-white/10 px-3 py-2.5 rounded-xl">
          <p className="text-[11px] font-medium text-white/55 mb-1">CO2e released (estimate)</p>
          <p className="text-lg font-semibold text-white tabular-nums">
            {nationalCo2e ? fmt(nationalCo2e.co2eTonnes.mid / 1e9, 2) : "—"} <span className="text-xs font-normal text-white/50">billion t</span>
          </p>
          {nationalCo2e && (
            <p className="text-[11px] text-white/50">≈{fmt(nationalCo2e.co2eTonnes.mid / 4.6 / 1e6, 0)}M cars/year</p>
          )}
        </div>
      </div>

      {/* Forest in 2000 vs now */}
      {lossData.forestSince2000 && (
        <div className="mt-4 border border-white/10 p-3 rounded-xl">
          <p className="text-[11px] font-medium text-white/55 mb-1">Forest in 2000 vs {lossData.forestSince2000.throughYear}</p>
          <p className="text-[11px] text-white/60 leading-relaxed mb-3">
            Ghana had <span className="text-white tabular-nums">{fmt(lossData.forestSince2000.nationalExtent2000Kha / 1000, 2)} M ha</span> of tree cover in 2000 and lost{" "}
            <span className="text-red-300 tabular-nums">{fmt(lossData.forestSince2000.nationalLostPct, 1)}%</span> of it by {lossData.forestSince2000.throughYear}.
          </p>
          <div className="space-y-2">
            {lossData.forestSince2000.formerRegions.map((f) => {
              const meaningful = f.extent2000Kha >= MIN_FOREST_KHA_FOR_PCT;
              const containsSelected = selectedRegion !== null && f.currentRegions.includes(selectedRegion);
              return (
                <button
                  key={f.name}
                  type="button"
                  onClick={() => onSelectRegion(f.currentRegions[0])}
                  className={`block w-full text-left px-2 py-1.5 border transition-colors ${containsSelected ? "border-white/30 bg-white/5" : "border-transparent hover:bg-white/5"} rounded-xl`}
                >
                  <div className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="text-white/85 truncate">
                      {f.name}
                      {f.currentRegions.length > 1 && <span className="text-white/50"> · now {f.currentRegions.join(", ")}</span>}
                    </span>
                    <span className="shrink-0 tabular-nums text-white/50">
                      {meaningful ? <><span className="text-red-300">{fmt(f.lostPct, 0)}%</span> lost</> : "little dense forest"}
                    </span>
                  </div>
                  {meaningful && (
                    <>
                      <div className="mt-1 flex h-1.5 overflow-hidden bg-white/5" aria-hidden="true">
                        <div className="h-full bg-green-500/60" style={{ width: `${100 - f.lostPct}%` }} />
                        <div className="h-full bg-red-500/60" style={{ width: `${f.lostPct}%` }} />
                      </div>
                      <p className="mt-0.5 text-[11px] text-white/55 tabular-nums">
                        {fmt(f.extent2000Kha)} k ha in 2000 → {fmt(f.remainingKha)} k ha left · {fmt(f.lossKha)} k ha lost
                      </p>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-white/50 leading-relaxed">
            Tree cover = at least 30% canopy (Hansen/UMD via Global Forest Watch). GFW publishes the 2000 baseline only for Ghana&apos;s 10
            regions before the 2018 split, so the comparison uses those. Regrowth since 2000 is not subtracted from losses.
          </p>
        </div>
      )}

      {/* Region list */}
      <div className="flex items-center justify-between mt-4 mb-2">
        <p className="text-[11px] font-medium text-white/55">16 regions</p>
        <div className="flex gap-1.5">
          {([
            ["all", "All"],
            ["top5", "Top 5"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setRegionFilter(value)}
              className={`text-[11px] font-medium px-2 py-1 border transition-colors ${
                regionFilter === value ? "bg-white/15 border-white/40 text-white" : "border-white/15 text-white/55 hover:text-white/70"
              } rounded-xl`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        {visibleRegions.map((r) => (
          <button
            key={r.region}
            onClick={() => onSelectRegion(selectedRegion === r.region ? null : r.region)}
            className={`w-full text-left px-3 py-2 border transition-colors ${
              selectedRegion === r.region ? "bg-white/10 border-white/30" : "border-white/10 hover:bg-white/5"
            } rounded-xl`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-white font-medium">{r.region}</span>
              <span className="text-[11px] text-white/55 tabular-nums">{fmt(r.totalLossKha2001to2024)} k ha</span>
            </div>
            {r.recentAlertAreaHa >= 0.1 && (
              <p className="text-[11px] text-red-300/70 tabular-nums mt-0.5">{fmt(r.recentAlertAreaHa, 1)} ha active now</p>
            )}
          </button>
        ))}
      </div>

      {region && regionCarbon && (
        <div className="mt-3 border border-white/10 p-3 rounded-xl">
          <p className="text-[11px] font-medium text-white/55 mb-2">{region.region}</p>

          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <p className="text-[11px] text-white/55">CO2e released</p>
              <p className="text-sm text-white tabular-nums">{fmt(regionCarbon.co2eTonnes.mid / 1e6, 2)} million t</p>
            </div>
            <div>
              <p className="text-[11px] text-white/55">{lossData.dataThroughYear} loss</p>
              <p className="text-sm text-white tabular-nums">{fmt(region.lossKha2024, 1)} k ha</p>
            </div>
          </div>
          {region.recentAlertAreaHa >= 0.1 && (
            <p className="text-[11px] text-red-300/70 mb-2">{fmt(region.recentAlertAreaHa, 1)} ha active now (last 30 days)</p>
          )}
          {onOpenSection && (
            <div className="mt-2 border-t border-white/10 pt-2">
              <p className="mb-1.5 text-[11px] text-white/55">Next step for {region.region}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onOpenSection("predict")}
                  className="min-h-9 rounded-lg border border-white/15 px-3 text-xs text-white/85 transition-colors hover:border-white/30 hover:text-white"
                >
                  Find risk spots →
                </button>
                <button
                  type="button"
                  onClick={() => onOpenSection("reforestation")}
                  className="min-h-9 rounded-lg border border-emerald-500/30 px-3 text-xs text-emerald-300 transition-colors hover:border-emerald-400/60"
                >
                  Where to replant →
                </button>
              </div>
            </div>
          )}

        </div>
      )}

      <button
        onClick={() => setShowMethodology((v) => !v)}
        className="mt-4 flex items-center gap-1.5 text-[11px] text-white/50 hover:text-white transition-colors"
      >
        <Info size={12} />
        {showMethodology ? "Hide" : "Show"} methodology &amp; sources
      </button>
      {showMethodology && (
        <ul className="mt-2 space-y-1.5 text-[11px] text-white/50 leading-relaxed list-disc list-inside">
          <li>{DEFORESTATION_DATA_SOURCE}</li>
          <li>Units: k ha = thousand hectares, M ha = million hectares, CO2e = CO2-equivalent.</li>
          <li>Region and national tree-cover-loss figures are LIVE — queried directly from the Global Forest Watch Data API (dataset gadm__tcl__adm1_change, Hansen/UMD Global Forest Change at 30% canopy density), cached 24h. Data covers 2001-{lossData.dataThroughYear} (verified directly, not inferred from a version number). Drivers-of-loss donut is from the same live source.</li>
          <li>&quot;Forest being cleared (30 days)&quot; at the top of the dashboard is a separate, near-real-time dataset (GLAD-S2 + RADD satellite alerts, updated every few days, as of {lossData.alertsAsOfLatest}) — filtered to real natural forest to exclude seasonal/farming noise in the savanna north.</li>
          <li>Carbon: hectares x 180-200 tC/ha (literature range for West African dense forest), converted to CO2e via the standard 44/12 ratio. Car-equivalence uses the US EPA&apos;s ~4.6 t CO2/vehicle/year, for scale only.</li>
        </ul>
      )}
    </div>
  );
}
