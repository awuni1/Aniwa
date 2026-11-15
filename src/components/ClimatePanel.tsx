"use client";

import { useEffect, useMemo, useState } from "react";
import { Thermometer, TrendingUp, Leaf, Info, AlertTriangle, Loader2, Cloud, ChevronDown } from "lucide-react";
import { estimateCarbonEmissions } from "@/lib/carbon";
import BarChart from "@/components/BarChart";
import type { GhanaLossData } from "@/lib/regionLossClient";
import { projectLoss, PROJECT_TO_YEAR, TREND_WINDOW_YEARS } from "@/lib/projection";
import { fetchClimate, linearSlope, HOT_DAY_THRESHOLD_C, type ClimateResponse } from "@/lib/climate";
import { fetchBiodiversity, IUCN_LABEL, type BiodiversityResponse } from "@/lib/biodiversity";

// Biodiversity is counted within this distance of the region's
// representative point — a round number big enough to reach the region's
// forest, not a modeled habitat boundary.
const BIODIVERSITY_RADIUS_KM = 25;
const DEFAULT_REGION = "Ashanti";

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("en-GH", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

// Folded by default so the tab opens as a short list of headings.
function Section({ icon: Icon, title, defaultOpen = false, children }: { icon: typeof Leaf; title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-2 border-b border-white/[0.06] pb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 py-1.5 text-left text-[11px] font-medium text-white/55 transition-colors hover:text-white"
      >
        <Icon size={12} /> <span className="flex-1">{title}</span>
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="mt-2 mb-2">{children}</div>}
    </div>
  );
}

interface Props {
  lossData: GhanaLossData | null;
  selectedRegion: string | null;
  onSelectRegion: (region: string) => void;
}

export default function ClimatePanel({ lossData, selectedRegion, onSelectRegion }: Props) {
  // Results are stored with the region they belong to, so switching regions
  // shows "loading" instead of the previous region's numbers.
  const [climateFor, setClimateFor] = useState<{ region: string; data: ClimateResponse } | null>(null);
  const [bioFor, setBioFor] = useState<{ region: string; data: BiodiversityResponse } | null>(null);
  const [showMethodology, setShowMethodology] = useState(false);

  const regions = useMemo(() => [...(lossData?.regions ?? [])].sort((a, b) => a.region.localeCompare(b.region)), [lossData]);
  const regionName = selectedRegion ?? DEFAULT_REGION;
  const region = regions.find((r) => r.region === regionName);
  const climate = climateFor?.region === regionName ? climateFor.data : null;
  const bio = bioFor?.region === regionName ? bioFor.data : null;

  useEffect(() => {
    if (!region) return;
    let cancelled = false;
    const name = region.region;
    fetchClimate(name).then((data) => !cancelled && setClimateFor({ region: name, data }));
    fetchBiodiversity(region.lat, region.lng, BIODIVERSITY_RADIUS_KM).then((data) => !cancelled && setBioFor({ region: name, data }));
    return () => { cancelled = true; };
  }, [region]);

  const projection = useMemo(() => (lossData?.nationalYearlyLossKha ? projectLoss(lossData.nationalYearlyLossKha) : null), [lossData]);

  const lossBars = useMemo(() => {
    if (!lossData?.nationalYearlyLossKha) return [];
    return [
      ...lossData.nationalYearlyLossKha.map((y) => ({ label: String(y.year), value: y.lossKha })),
      ...(projection?.projected ?? []).map((y) => ({ label: String(y.year), value: y.lossKha, projected: true })),
    ];
  }, [lossData, projection]);

  // CO2 released each year, estimated from that year's real loss.
  const co2 = useMemo(() => {
    const yearly = lossData?.nationalYearlyLossKha ?? [];
    if (yearly.length === 0) return null;
    const mt = (kha: number) => estimateCarbonEmissions(kha * 1000).co2eTonnes.mid / 1e6;
    const totalKha = yearly.reduce((s, y) => s + y.lossKha, 0);
    const latest = yearly[yearly.length - 1];
    return {
      bars: yearly.map((y) => ({ label: String(y.year), value: mt(y.lossKha) })),
      totalMt: estimateCarbonEmissions(totalKha * 1000).co2eTonnes,
      latestYear: latest.year,
      latestMt: mt(latest.lossKha),
    };
  }, [lossData]);

  const heat = useMemo(() => {
    if (!climate?.available || climate.years.length < 20) return null;
    const ys = climate.years;
    const first10 = ys.slice(0, 10);
    const last10 = ys.slice(-10);
    const avg = (arr: typeof ys, k: "hotDays" | "meanMaxTempC") => arr.reduce((s, y) => s + y[k], 0) / arr.length;
    return {
      first: `${first10[0].year}–${first10[first10.length - 1].year}`,
      last: `${last10[0].year}–${last10[last10.length - 1].year}`,
      hotDaysEarly: avg(first10, "hotDays"),
      hotDaysRecent: avg(last10, "hotDays"),
      warmingPerDecadeC: linearSlope(ys.map((y) => ({ x: y.year, y: y.meanMaxTempC }))) * 10,
      bars: ys.map((y) => ({ label: String(y.year), value: y.hotDays })),
    };
  }, [climate]);

  if (!lossData) return <p className="px-4 py-4 text-xs text-white/55">Loading live data…</p>;

  const threatenedTotal = bio ? bio.threatened.CR + bio.threatened.EN + bio.threatened.VU : 0;

  return (
    <div className="px-4 py-4">
      {/* CO2 from forest loss (national) */}
      {co2 && (
        <Section icon={Cloud} title="CO2 released by forest loss (estimate)" defaultOpen>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
              <p className="text-[11px] text-red-300/80">2001–{co2.latestYear} total</p>
              <p className="text-lg font-semibold tabular-nums text-white">
                {fmt(co2.totalMt.mid / 1e9, 2)} <span className="text-xs font-normal text-white/50">billion t CO2e</span>
              </p>
              <p className="text-[11px] text-white/55">range {fmt(co2.totalMt.low / 1e9, 2)}–{fmt(co2.totalMt.high / 1e9, 2)} billion t</p>
            </div>
            <div className="rounded-lg border border-white/10 px-3 py-2">
              <p className="text-[11px] text-white/55">In {co2.latestYear} alone</p>
              <p className="text-lg font-semibold tabular-nums text-white">
                {fmt(co2.latestMt, 0)} <span className="text-xs font-normal text-white/50">Mt CO2e</span>
              </p>
            </div>
          </div>
          <BarChart data={co2.bars} color="#a855f7" height={70} formatValue={(n) => `${fmt(n, 1)} Mt CO2e`} ariaLabel="Estimated CO2 released per year from forest loss" />
        </Section>
      )}

      {/* Forest loss + projection (national) */}
      <Section icon={TrendingUp} title="Ghana forest loss — and if it isn't stopped">
        {lossBars.length > 0 && (
          <BarChart data={lossBars} color="#f97316" height={90} formatValue={(n) => `${fmt(n, 1)} k ha`} ariaLabel="Yearly tree cover loss with projection" />
        )}
        {projection && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-white/10 px-3 py-2">
              <p className="text-[11px] text-white/55">Loss trend</p>
              <p className="text-sm font-medium tabular-nums text-white">
                {projection.trendPerYearKha >= 0 ? "+" : ""}
                {fmt(projection.trendPerYearKha, 1)} kha/yr each year
              </p>
            </div>
            <div className="rounded-lg border border-white/10 px-3 py-2">
              <p className="text-[11px] text-white/55">Average, last {TREND_WINDOW_YEARS} years</p>
              <p className="text-sm font-medium tabular-nums text-white">{fmt(projection.recentAvgKha, 0)} kha/yr</p>
            </div>
            <div className="col-span-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5">
              <p className="text-[11px] font-medium text-red-300/80">If the trend continues to {PROJECT_TO_YEAR}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-white">
                {fmt(projection.cumulativeKha / 1000, 2)} <span className="text-xs font-normal text-white/50">M ha more tree cover lost</span>
              </p>
              <p className="text-[11px] text-white/60">
                ≈ {fmt(projection.co2eMt.mid, 0)} Mt CO2e released (range {fmt(projection.co2eMt.low, 0)}–{fmt(projection.co2eMt.high, 0)}). Stopping it now avoids that.
              </p>
            </div>
          </div>
        )}
      </Section>

      {/* Region selector for heat + biodiversity */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <label htmlFor="climate-region" className="text-[11px] text-white/50">Region</label>
        <select
          id="climate-region"
          value={regionName}
          onChange={(e) => onSelectRegion(e.target.value)}
          className="rounded-lg border border-white/15 bg-gray-900 px-2.5 py-1.5 text-sm text-white"
        >
          {regions.map((r) => <option key={r.region} value={r.region}>{r.region}</option>)}
        </select>
      </div>

      {/* Heat — NASA POWER */}
      <Section icon={Thermometer} title={`Heat in ${regionName} (NASA POWER)`}>
        {!climate && <p className="flex items-center gap-1.5 text-[11px] text-white/55"><Loader2 size={11} className="animate-spin" /> Loading 35 years of NASA temperature data…</p>}
        {climate && !climate.available && (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-200/80"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {climate.error}</p>
        )}
        {heat && (
          <>
            <p className="mb-1 text-[11px] text-white/50">Days per year at or above {HOT_DAY_THRESHOLD_C} °C</p>
            <BarChart data={heat.bars} color="#ef4444" height={70} formatValue={(n) => `${n} days`} ariaLabel={`Hot days per year in ${regionName}`} />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-white/10 px-3 py-2">
                <p className="text-[11px] text-white/55">Hot days/yr, {heat.first}</p>
                <p className="text-sm font-medium tabular-nums text-white">{fmt(heat.hotDaysEarly, 0)}</p>
              </div>
              <div className="rounded-lg border border-white/10 px-3 py-2">
                <p className="text-[11px] text-white/55">Hot days/yr, {heat.last}</p>
                <p className={`text-sm font-medium tabular-nums ${heat.hotDaysRecent > heat.hotDaysEarly ? "text-red-300" : "text-white"}`}>{fmt(heat.hotDaysRecent, 0)}</p>
              </div>
              <div className="col-span-2 rounded-lg border border-white/10 px-3 py-2">
                <p className="text-[11px] text-white/55">Average daily high, trend</p>
                <p className={`text-sm font-medium tabular-nums ${heat.warmingPerDecadeC > 0 ? "text-red-300" : "text-sky-300"}`}>
                  {heat.warmingPerDecadeC >= 0 ? "+" : ""}
                  {fmt(heat.warmingPerDecadeC, 2)} °C per decade
                </p>
              </div>
            </div>
          </>
        )}
      </Section>

      {/* Biodiversity — GBIF */}
      <Section icon={Leaf} title={`Biodiversity at risk near ${regionName}`}>
        {!bio && <p className="flex items-center gap-1.5 text-[11px] text-white/55"><Loader2 size={11} className="animate-spin" /> Counting recorded species…</p>}
        {bio && !bio.available && (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-200/80"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {bio.error}</p>
        )}
        {bio?.available && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-white/10 px-3 py-2">
                <p className="text-[11px] text-white/55">Species recorded within {bio.radiusKm} km</p>
                <p className="text-lg font-semibold tabular-nums text-white">{fmt(bio.species)}{bio.speciesCapped && "+"}</p>
              </div>
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
                <p className="text-[11px] text-red-300/80">Threatened species</p>
                <p className="text-lg font-semibold tabular-nums text-white">{fmt(threatenedTotal)}</p>
              </div>
            </div>
            <div className="mt-2 flex gap-1.5 text-[11px]">
              <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-red-300">{bio.threatened.CR} critically endangered</span>
              <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-orange-300">{bio.threatened.EN} endangered</span>
              <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-yellow-300">{bio.threatened.VU} vulnerable</span>
            </div>
            {bio.threatenedExamples.length > 0 && (
              <ul className="mt-2 space-y-1">
                {bio.threatenedExamples.map((s) => (
                  <li key={s.name} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate text-white/75">{s.name}</span>
                    <span className="shrink-0 text-white/50">{IUCN_LABEL[s.category]}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Section>


      <button
        onClick={() => setShowMethodology((v) => !v)}
        className="mt-2 flex items-center gap-1.5 text-[11px] text-white/50 transition-colors hover:text-white"
      >
        <Info size={12} />
        {showMethodology ? "Hide" : "Show"} how these numbers are made
      </button>
      {showMethodology && (
        <ul className="mt-2 list-inside list-disc space-y-1.5 text-[11px] leading-relaxed text-white/50">
          <li>CO2: each year&apos;s real loss (hectares) × 180–200 tonnes of carbon per hectare (literature range for West African dense forest) × 44/12 to convert carbon to CO2. An estimate, since tree cover lost outside dense forest holds less carbon.</li>
          <li>Yearly loss: Global Forest Watch (Hansen/UMD, Landsat-based), live per year, 2001–{lossData.dataThroughYear}.</li>
          <li>Projection: a straight-line trend through the last {TREND_WINDOW_YEARS} years of real loss, continued to {PROJECT_TO_YEAR}. It shows where the current path leads, not a forecast of policy or prices. CO2e uses the same 180–200 tC/ha density as the rest of the app.</li>
          <li>Heat: NASA POWER daily maximum temperature (MERRA-2 reanalysis) at the region&apos;s representative point, 1991 to the last full year. Its ~50 km grid is too coarse to isolate a forest&apos;s own cooling effect, so these trends show regional climate change, not warming caused by forest loss specifically.</li>
          <li>Biodiversity: distinct species with GBIF records within {BIODIVERSITY_RADIUS_KM} km of the region&apos;s representative point, and how many carry an IUCN Red List category of critically endangered, endangered or vulnerable. GBIF holds documented sightings and specimens, so well-studied places show more species than equally rich but unsurveyed ones.</li>
        </ul>
      )}
    </div>
  );
}
