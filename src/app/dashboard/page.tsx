"use client";

// Public preview of the Aniwa dashboard: the headline figure, two live
// signals, the loss map and the yearly trend. The full dashboard (risk
// prediction, satellite checks, chainsaw listening, alerts, climate and
// reforestation tools) is not part of this repository.

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Satellite, Flame, Lock } from "lucide-react";
import { CARD, CountUp, KpiCard, TrendCard, Delta } from "@/components/OverviewWidgets";
import { fetchGhanaLossData, type GhanaLossData } from "@/lib/regionLossClient";
import { fetchFires, type FiresResponse } from "@/lib/fires";
import { FOREST_BELT_REGIONS } from "@/lib/forestBelt";

const PublicMap = dynamic(() => import("@/components/PublicMap"), { ssr: false });

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("en-GH", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

// "2026-11-02" -> "2 Nov 2026"
function fmtDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default function DashboardPreview() {
  const [lossData, setLossData] = useState<GhanaLossData | null>(null);
  const [fires, setFires] = useState<FiresResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchGhanaLossData().then((d) => !cancelled && setLossData(d)).catch(() => {});
    fetchFires().then((d) => !cancelled && setFires(d)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const live = lossData?.available ? lossData : null;
  const since2000 = live?.forestSince2000 ?? null;
  const yearly = useMemo(() => (live?.nationalYearlyLossKha ?? []).map((d) => ({ year: d.year, value: d.lossKha })), [live]);
  const lastYear = yearly[yearly.length - 1];
  const prevYear = yearly[yearly.length - 2];
  const yoyPct = lastYear && prevYear && prevYear.value > 0 ? ((lastYear.value - prevYear.value) / prevYear.value) * 100 : null;
  const activeAlertRegions = (live?.regions ?? []).filter((r) => r.recentAlertAreaHa >= 0.1).length;
  const lossByRegion = useMemo(() => Object.fromEntries((live?.regions ?? []).map((r) => [r.region, r.totalLossKha2001to2024])), [live]);
  const fireList = useMemo(() => (fires?.available ? fires.fires : []), [fires]);
  const mapFires = useMemo(() => fireList.map((f) => ({ lat: f.lat, lng: f.lng, forest: FOREST_BELT_REGIONS.has(f.region) })), [fireList]);
  const forestFires = mapFires.filter((f) => f.forest).length;

  return (
    <div className="min-h-screen bg-[#04070d] text-white md:p-4">
      <div className="min-h-screen bg-[#070b14] p-4 md:min-h-[calc(100vh-2rem)] md:rounded-[28px] md:border md:border-white/[0.06] md:p-7">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="Aniwa home">
              {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
              <img src="/logo.png" alt="" width={44} height={44} className="h-11 w-11" />
            </Link>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight md:text-[34px]">Ghana Forest Watch</h1>
              <p className="mt-1 text-sm text-white/55">Real data. Every region. · Public preview</p>
            </div>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-xl border border-white/10 bg-[#0f172a]/80 px-3 py-2 text-xs text-white/70">
            {live ? `Loss data to ${live.dataThroughYear} · alerts to ${fmtDate(live.alertsAsOfLatest)}` : lossData ? "Live data unavailable" : "Loading data…"}
          </span>
        </header>

        <div className="grid gap-5 xl:grid-cols-[290px_minmax(0,1fr)_360px]">
          <div className="space-y-3">
            <div className="px-1 pb-2">
              <p className="text-sm text-white/60">Forest lost since 2000</p>
              {since2000 ? (
                <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">
                  <CountUp value={since2000.nationalLostPct} digits={1} />
                  <span className="text-3xl text-white/60">%</span>
                </p>
              ) : (
                <span className="mt-2 block h-12 w-32 animate-pulse rounded-lg bg-white/[0.07]" />
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {yoyPct !== null && <Delta text={`${fmt(Math.abs(yoyPct))}%`} up={yoyPct > 0} worse={yoyPct > 0} />}
                {lastYear && prevYear && <span className="text-[11px] text-white/55">{lastYear.year} loss vs {prevYear.year}</span>}
              </div>
            </div>
            <KpiCard
              icon={Satellite}
              tone="red"
              label="Forest being cleared (30 days)"
              value={live ? fmt(live.nationalRecentAlertAreaHa) : null}
              unit="ha"
              caption={live ? `alerts in ${activeAlertRegions} regions` : undefined}
            />
            <KpiCard
              icon={Flame}
              tone="orange"
              label="NASA fires in forest regions"
              value={fires?.available ? fmt(forestFires) : fires ? "—" : null}
              caption={fires?.available ? `last ${fires.days} days` : "NASA FIRMS"}
            />
          </div>

          <section className={`${CARD} relative h-[460px] overflow-hidden rounded-[24px] md:h-[620px]`}>
            <PublicMap lossByRegion={lossByRegion} fires={mapFires} />
            <div className="pointer-events-none absolute bottom-3 left-3 w-52 space-y-1.5 rounded-xl border border-white/10 bg-[#0a1020]/85 px-3 py-2.5 text-[11px] text-white/75 backdrop-blur">
              <p className="font-medium text-white/60">Map legend</p>
              <div className="h-1.5 rounded-full bg-gradient-to-r from-[rgb(254,202,202)] to-[rgb(127,29,29)]" />
              <div className="flex justify-between text-white/55">
                <span>Less loss</span>
                <span>More loss</span>
              </div>
              <p className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-orange-500" /> NASA fire, forest region</p>
              <p className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-yellow-400" /> NASA fire, savanna</p>
            </div>
          </section>

          <div className="space-y-5">
            <TrendCard title="Tree-cover loss per year" rangeLabel={yearly.length ? `${yearly[0].year}–${lastYear.year}` : "2001–"} series={yearly} unit="k ha" />
            <section className={`${CARD} p-4`}>
              <p className="flex items-center gap-2 text-[13px] font-medium text-white/90">
                <Lock size={14} className="text-emerald-400" /> More in the full dashboard
              </p>
              <p className="mt-2 text-xs leading-relaxed text-white/60">
                Risk prediction with nearest-town names, satellite clearing checks, phone chainsaw listening, alerts, climate and reforestation
                tools are part of the full Aniwa dashboard and aren’t included in this public repository.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
