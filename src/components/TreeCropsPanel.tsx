"use client";

import { useEffect, useState } from "react";
import { Wheat, Sparkles, Loader2, AlertTriangle } from "lucide-react";
import BarChart from "@/components/BarChart";
import { Answer } from "@/components/AiAnalyst";
import { fetchTreeCrops, type TreeCropsResponse } from "@/lib/treeCrops";

const COMPARE_YEARS_BACK = 5;

function fmt(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("en-GH", { maximumFractionDigits: 2 })}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString("en-GH")}k`;
  return Math.round(n).toLocaleString("en-GH");
}

// Ghana's tree crops from FAOSTAT, with a Gemini summary on request.
export default function TreeCropsPanel() {
  const [data, setData] = useState<TreeCropsResponse | null>(null);
  const [selected, setSelected] = useState("Cocoa");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchTreeCrops().then(setData).catch(() => setData({ available: false, error: "Couldn't load FAOSTAT data", crops: [], dataThroughYear: null, source: "" }));
  }, []);

  async function askGemini() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "crops" }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setAnswer(body.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const crop = data?.crops.find((c) => c.name === selected);

  return (
    <div className="border-t border-white/[0.06] px-4 py-4">
      <div className="mb-1 flex items-center gap-2">
        <Wheat size={14} className="text-amber-400" />
        <p className="text-[11px] font-medium text-white/50">Forest resources &amp; tree crops</p>
      </div>
      <p className="mb-3 text-[11px] text-white/55">Ghana, national, FAOSTAT{data?.dataThroughYear ? ` (to ${data.dataThroughYear})` : ""}. Click a crop for its trend.</p>

      {!data && <p className="flex items-center gap-1.5 text-[11px] text-white/55"><Loader2 size={11} className="animate-spin" /> Loading FAOSTAT…</p>}
      {data && !data.available && <p className="flex items-start gap-1.5 text-[11px] text-amber-200/80"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {data.error}</p>}

      {data?.available && (
        <>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[11px] font-medium text-white/50">
                <th className="pb-1.5 font-normal">Crop</th>
                <th className="pb-1.5 text-right font-normal">Production</th>
                <th className="pb-1.5 text-right font-normal">Area</th>
                <th className="pb-1.5 text-right font-normal">vs {COMPARE_YEARS_BACK} yrs</th>
              </tr>
            </thead>
            <tbody>
              {data.crops.map((c) => {
                const n = c.productionT.length;
                const now = c.productionT[n - 1];
                const then = c.productionT[n - 1 - COMPARE_YEARS_BACK];
                const change = now != null && then ? ((now - then) / then) * 100 : null;
                return (
                  <tr
                    key={c.name}
                    onClick={() => setSelected(c.name)}
                    className={`cursor-pointer border-t border-white/[0.05] ${selected === c.name ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"}`}
                  >
                    <td className="py-1.5 text-white/80">{c.name}</td>
                    <td className="py-1.5 text-right tabular-nums text-white/70">{fmt(now)} t</td>
                    <td className="py-1.5 text-right tabular-nums text-white/55">{fmt(c.areaHa[c.areaHa.length - 1])} ha</td>
                    <td className={`py-1.5 text-right tabular-nums ${change == null ? "text-white/50" : change >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                      {change == null ? "—" : `${change >= 0 ? "+" : ""}${Math.round(change)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {crop && (
            <div className="mt-3">
              <p className="mb-1 text-[11px] text-white/50">{crop.name} production per year (tonnes)</p>
              <BarChart
                key={crop.name}
                data={crop.years.map((y, i) => ({ label: String(y), value: crop.productionT[i] ?? 0 }))}
                color="#d97706"
                height={70}
                formatValue={(v) => `${fmt(v)} t`}
                ariaLabel={`${crop.name} production in Ghana per year`}
              />
            </div>
          )}

          <button
            type="button"
            onClick={askGemini}
            disabled={loading}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 py-2 text-sm text-amber-100 transition hover:bg-amber-500/15 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {loading ? "Asking Gemini…" : "What do these crop trends mean?"}
          </button>
          {error && <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-200/85"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}</p>}
          {answer && (
            <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3">
              <Answer text={answer} />
              <p className="mt-2 text-[11px] text-white/50">AI-written from FAOSTAT data. Check key figures before quoting them.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
