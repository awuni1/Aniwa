"use client";

import { useMemo, useState } from "react";
import { Sprout, Sparkles, Loader2, AlertTriangle, Info } from "lucide-react";
import { Answer } from "@/components/AiAnalyst";
import { APPROACHES, computePlan, PLAN_YEARS, type PlantingApproach } from "@/lib/planting";
import type { RegionLoss } from "@/lib/deforestation";

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-GH");
}

interface Props {
  regions: RegionLoss[];
  selectedRegion: string | null;
}

// Works out trees and CO2 for a planting plan, then asks Gemini which
// species suit the region and how the plan helps with CO2 and heat.
export default function PlantingPlan({ regions, selectedRegion }: Props) {
  const sorted = useMemo(() => [...regions].sort((a, b) => a.region.localeCompare(b.region)), [regions]);
  const [regionChoice, setRegionChoice] = useState<string | null>(null);
  const region = regionChoice ?? selectedRegion ?? "Ashanti";
  const [hectares, setHectares] = useState(100);
  const [approach, setApproach] = useState<PlantingApproach>("native");
  const [treesPerHa, setTreesPerHa] = useState(APPROACHES.native.treesPerHa);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);

  const result = computePlan(hectares, approach, treesPerHa);

  async function askGemini() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "plant", plan: { region, hectares, approach, treesPerHa } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAnswer(data.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const input = "w-full rounded-lg border border-white/15 bg-gray-900 px-2.5 py-1.5 text-sm text-white";

  return (
    <div className="border-t border-white/[0.06] px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        <Sprout size={14} className="text-emerald-400" />
        <p className="text-[11px] font-medium text-white/50">Planting plan (with Gemini)</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] text-white/50">
        <label className="col-span-2">
          Region
          <select value={region} onChange={(e) => { setRegionChoice(e.target.value); setAnswer(null); }} className={input}>
            {sorted.map((r) => <option key={r.region} value={r.region}>{r.region}</option>)}
          </select>
        </label>
        <label className="col-span-2">
          Approach
          <select
            value={approach}
            onChange={(e) => {
              const a = e.target.value as PlantingApproach;
              setApproach(a);
              setTreesPerHa(APPROACHES[a].treesPerHa);
              setAnswer(null);
            }}
            className={input}
          >
            {(Object.keys(APPROACHES) as PlantingApproach[]).map((a) => <option key={a} value={a}>{APPROACHES[a].label}</option>)}
          </select>
        </label>
        <label>
          Hectares
          <input type="number" min={1} value={hectares} onChange={(e) => { setHectares(Math.max(1, Number(e.target.value) || 1)); setAnswer(null); }} className={input} />
        </label>
        <label>
          Trees per hectare
          <input type="number" min={1} value={treesPerHa} onChange={(e) => { setTreesPerHa(Math.max(1, Number(e.target.value) || 1)); setAnswer(null); }} className={input} />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-white/10 px-2.5 py-2">
          <p className="text-[11px] text-white/55">Trees to plant</p>
          <p className="text-sm font-semibold tabular-nums text-white">{fmt(result.trees)}</p>
        </div>
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-2">
          <p className="text-[11px] text-emerald-300/80">CO2 removed / yr</p>
          <p className="text-sm font-semibold tabular-nums text-white">{fmt(result.co2PerYearT.low)}–{fmt(result.co2PerYearT.high)} t</p>
        </div>
        <div className="rounded-lg border border-white/10 px-2.5 py-2">
          <p className="text-[11px] text-white/55">Over {PLAN_YEARS} years</p>
          <p className="text-sm font-semibold tabular-nums text-white">{fmt(result.co2OverPlanT.low)}–{fmt(result.co2OverPlanT.high)} t</p>
        </div>
      </div>

      <button
        type="button"
        onClick={askGemini}
        disabled={loading || regions.length === 0}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {loading ? "Asking Gemini…" : "Which trees should we plant here?"}
      </button>

      {error && <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-200/85"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}</p>}
      {answer && (
        <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3">
          <Answer text={answer} />
          <p className="mt-2 text-[11px] text-white/50">AI advice. Confirm species with the Forestry Commission or a local forester.</p>
        </div>
      )}

      <button onClick={() => setShowAssumptions((v) => !v)} className="mt-3 flex items-center gap-1.5 text-[11px] text-white/50 transition-colors hover:text-white">
        <Info size={12} /> {showAssumptions ? "Hide" : "Show"} assumptions
      </button>
      {showAssumptions && (
        <ul className="mt-2 list-inside list-disc space-y-1.5 text-[11px] leading-relaxed text-white/50">
          {(Object.keys(APPROACHES) as PlantingApproach[]).map((a) => (
            <li key={a}>
              {APPROACHES[a].label}: {APPROACHES[a].treesPerHa} trees/ha by default; assumed carbon uptake {APPROACHES[a].carbonTPerHaYr.low}–{APPROACHES[a].carbonTPerHaYr.high} t carbon per hectare per year, × 44/12 for CO2. Indicative values for young trees; real uptake depends on species, soil, rainfall and survival.
            </li>
          ))}
          <li>Heat: shade and evaporation from leaves cool the ground under canopy. The size of the effect isn&apos;t measured here, so no temperature figure is claimed.</li>
        </ul>
      )}
    </div>
  );
}
