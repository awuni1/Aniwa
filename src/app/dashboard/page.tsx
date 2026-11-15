"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { TreeDeciduous, Sprout, Brain, Bell, Thermometer, Wheat, LayoutGrid, CalendarDays, Axe, Flame, Satellite } from "lucide-react";
import { CARD, CountUp, KpiCard, TrendCard, ActionCard, Delta } from "@/components/OverviewWidgets";
import { fetchFireWeather, type RegionFireWeather } from "@/lib/fireWeather";
import { placeLabel, useNearestPlace } from "@/lib/places";
import MapSearch from "@/components/MapSearch";
import DeforestationPanel from "@/components/DeforestationPanel";
import ReforestationPanel from "@/components/ReforestationPanel";
import PredictPanel from "@/components/PredictPanel";
import PriorityPanel from "@/components/PriorityPanel";
import ChainsawPanel from "@/components/ChainsawPanel";
import FireWeatherPanel from "@/components/FireWeatherPanel";
import ClimatePanel from "@/components/ClimatePanel";
import AiAnalyst from "@/components/AiAnalyst";
import PlantingPlan from "@/components/PlantingPlan";
import TreeCropsPanel from "@/components/TreeCropsPanel";
import Collapsible from "@/components/Collapsible";
import { APPROX_HEARING_RADIUS_M, fetchDetections, type ChainsawDetection } from "@/lib/acoustic";
import { fetchFires, type FiresResponse } from "@/lib/fires";
import { fetchGhanaLossData, type GhanaLossData } from "@/lib/regionLossClient";
import { TRACKED_SPECIES, fetchSpeciesOccurrences, type SpeciesResult } from "@/lib/species";
import { nearestIntactForest, recommendSites } from "@/lib/reforestation";
import {
  predictDeforestationRisk,
  predictHotspots,
  FOREST_BELT_REGIONS,
  type DeforestationPrediction,
  type LiveActivity,
  type TreeCoverLookup,
} from "@/lib/deforestationModel";
import { loadTreeCover } from "@/lib/treeCover";
import { pointInGeometry } from "@/lib/geo";
import type {
  RegionLossMarker,
  IntactForestMarker,
  ReforestationSiteMarker,
  PredictionMarker,
  ChainsawMarker,
  FireMarker,
  HotspotMarker,
  Basemap,
  MapCallout,
} from "@/components/EcoMap";

const EcoMap = dynamic(() => import("@/components/EcoMap"), { ssr: false });

type PaneMode = "overview" | "deforestation" | "predict" | "priority" | "climate" | "reforestation";

const PANE_MODES: { mode: PaneMode; icon: typeof TreeDeciduous; label: string }[] = [
  { mode: "overview", icon: LayoutGrid, label: "Overview" },
  { mode: "deforestation", icon: TreeDeciduous, label: "Deforestation" },
  { mode: "predict", icon: Brain, label: "Predict" },
  { mode: "priority", icon: Bell, label: "Live threats" },
  { mode: "climate", icon: Thermometer, label: "Climate" },
  { mode: "reforestation", icon: Sprout, label: "Reforestation" },
];

// The overview always shows the whole country.
const GHANA_VIEW: [{ lat: number; lng: number }, { lat: number; lng: number }] = [
  { lat: 4.7, lng: -3.3 },
  { lat: 11.2, lng: 1.2 },
];


// Phones post detections and there's no push channel back, so poll; FIRMS
// itself only refreshes every few hours, and the server caches it for 30 min.
const DETECTION_POLL_MS = 15000;
const FIRES_POLL_MS = 10 * 60 * 1000;


// "2026-11-02" -> "2 Nov 2026"
function fmtDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("en-GH", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function timeAgo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function LegendRow({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {swatch}
      <span>{label}</span>
    </div>
  );
}

// Fires are triangles on the map and in the legend; risk levels are circles,
// so the two never share a look even where they share a colour.
const triangle = (color: string, size = 9) => (
  <span
    className="shrink-0"
    style={{ width: 0, height: 0, borderLeft: `${size / 2 + 1}px solid transparent`, borderRight: `${size / 2 + 1}px solid transparent`, borderBottom: `${size}px solid ${color}` }}
  />
);

const dot = (color: string, size = 8) => <span className="shrink-0 rounded-full" style={{ width: size, height: size, background: color }} />;

type RegionFeature = { properties: { shapeName: string }; geometry: { type: string; coordinates: unknown } };

export default function DashboardPage() {
  const [paneMode, setPaneMode] = useState<PaneMode>("overview");
  const [fireWeather, setFireWeather] = useState<RegionFireWeather[]>([]);
  const [legendOpen, setLegendOpen] = useState(false);
  const mapSectionRef = useRef<HTMLElement>(null);
  const nearest = useNearestPlace();
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number } | null>(null);
  const [flyToBounds, setFlyToBounds] = useState<[{ lat: number; lng: number }, { lat: number; lng: number }] | null>(null);
  const [speciesResults, setSpeciesResults] = useState<SpeciesResult[]>([]);
  const [prediction, setPrediction] = useState<DeforestationPrediction | null>(null);
  const [hotspots, setHotspots] = useState<DeforestationPrediction[] | null>(null);
  const [hotspotsRunning, setHotspotsRunning] = useState(false);
  const [lossData, setLossData] = useState<GhanaLossData | null>(null);
  const [detections, setDetections] = useState<ChainsawDetection[]>([]);
  const [detectionsLoaded, setDetectionsLoaded] = useState(false);
  const [fires, setFires] = useState<FiresResponse | null>(null);
  const [regionFeatures, setRegionFeatures] = useState<RegionFeature[]>([]);
  const [basemap, setBasemap] = useState<Basemap>("esri");
  // Wrapped in an object: useState would treat a bare function as an updater.
  const [treeCover, setTreeCover] = useState<{ at: TreeCoverLookup } | null>(null);

  // Tracked-species sightings, used by the Predict tab's "species nearby" check.
  useEffect(() => {
    let cancelled = false;
    Promise.all(TRACKED_SPECIES.map((s) => fetchSpeciesOccurrences(s.scientificName)))
      .then((all) => !cancelled && setSpeciesResults(all))
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Real, live, all-16-region tree-cover-loss data from the GFW Data API
  // (see lib/server/gfwClient.ts) — fetched once here and passed down,
  // same pattern as speciesResults above.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await fetchGhanaLossData();
      if (!cancelled) setLossData(data);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchDetections();
        if (!cancelled) setDetections(data);
      } catch {
        // Keep showing the last list; the next poll will retry.
      } finally {
        if (!cancelled) setDetectionsLoaded(true);
      }
    };
    load();
    const timer = setInterval(load, DETECTION_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => fetchFires().then((data) => !cancelled && setFires(data)).catch(() => {});
    load();
    const timer = setInterval(load, FIRES_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // ESA WorldCover tree-cover grid, so the model knows where forest actually is.
  useEffect(() => {
    let cancelled = false;
    loadTreeCover()
      .then((at) => !cancelled && setTreeCover({ at }))
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Region outlines, used to keep predicted hotspots inside Ghana.
  useEffect(() => {
    fetch("/ghana_regions.geojson")
      .then((res) => res.json())
      .then((geo: { features: RegionFeature[] }) => setRegionFeatures(geo.features))
      .catch(() => {});
  }, []);

  const regions = useMemo(() => lossData?.regions ?? [], [lossData]);
  const maxLossKha = useMemo(() => Math.max(...regions.map((r) => r.totalLossKha2001to2024), 1), [regions]);
  const fireList = useMemo(() => (fires?.available ? fires.fires : []), [fires]);
  const forestFires = useMemo(() => fireList.filter((f) => FOREST_BELT_REGIONS.has(f.region)), [fireList]);

  // 3-day fire-weather forecast (Meteomatics), shown in the overview and used by the risk model.
  useEffect(() => {
    let cancelled = false;
    fetchFireWeather()
      .then((d) => !cancelled && d.available && setFireWeather(d.regions))
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const activity: LiveActivity = useMemo(
    () => ({ chainsaws: detections, fires: fireList, fireWeather: fireWeather.map((w) => ({ region: w.region, lat: w.lat, lng: w.lng, peakIndex: w.peakIndex })) }),
    [detections, fireList, fireWeather],
  );

  const regionMarkers: RegionLossMarker[] = useMemo(
    () => regions.map((r) => ({ region: r.region, lat: r.lat, lng: r.lng, lossKha: r.totalLossKha2001to2024 })),
    [regions],
  );

  const region = regions.find((r) => r.region === selectedRegion);
  const regionCentroid = useMemo(() => (region ? { lat: region.lat, lng: region.lng } : null), [region]);

  // Deforestation tab: zoom straight to the region. Climate/Reforestation
  // tabs: fit both the region AND its nearest intact-forest target in view —
  // those markers can be 100+ km apart, so a fixed region-only zoom leaves
  // the other end of the connection line off-screen.
  useEffect(() => {
    if (!regionCentroid) return;
    if (paneMode === "deforestation" || paneMode === "overview") {
      setFlyTo({ lat: regionCentroid.lat, lng: regionCentroid.lng });
      setFlyToBounds(null);
    } else if (paneMode === "climate" || paneMode === "reforestation") {
      const target = nearestIntactForest(regionCentroid);
      setFlyToBounds([regionCentroid, { lat: target.lat, lng: target.lng }]);
    }
  }, [selectedRegion, paneMode, regionCentroid]);

  const showsLiveThreats = paneMode === "overview" || paneMode === "deforestation" || paneMode === "predict" || paneMode === "priority";

  const fireMarkers: FireMarker[] = useMemo(
    () => (showsLiveThreats ? fireList.map((f) => ({ lat: f.lat, lng: f.lng, forest: FOREST_BELT_REGIONS.has(f.region) })) : []),
    [showsLiveThreats, fireList],
  );

  const chainsawMarkers: ChainsawMarker[] = useMemo(() => {
    if (!showsLiveThreats) return [];
    return detections.map((d) => ({
      id: d.id,
      lat: d.lat,
      lng: d.lng,
      score: d.score,
      detectedAt: d.detectedAt,
      deviceName: d.deviceName,
      radiusM: APPROX_HEARING_RADIUS_M,
    }));
  }, [showsLiveThreats, detections]);

  const hotspotMarkers: HotspotMarker[] = useMemo(
    () => (paneMode === "predict" && hotspots ? hotspots.map((h, i) => ({ lat: h.lat, lng: h.lng, rank: i + 1, riskLevel: h.riskLevel })) : []),
    [paneMode, hotspots],
  );

  const reforestationSites: ReforestationSiteMarker[] = useMemo(() => {
    if (paneMode !== "reforestation" || !region || !regionCentroid) return [];
    return recommendSites(region, regionCentroid, maxLossKha).map((s, i) => ({
      lat: s.lat,
      lng: s.lng,
      rank: i + 1,
      score: s.score,
      type: s.recommendationType,
      reasoning: s.reasoning,
    }));
  }, [paneMode, region, regionCentroid, maxLossKha]);

  const intactForestPatches: IntactForestMarker[] = useMemo(() => {
    if ((paneMode !== "climate" && paneMode !== "reforestation") || !regionCentroid) return [];
    const target = nearestIntactForest(regionCentroid);
    return [{ name: target.name, lat: target.lat, lng: target.lng }];
  }, [paneMode, regionCentroid]);

  const connectionLine = useMemo(() => {
    if ((paneMode !== "climate" && paneMode !== "reforestation") || !regionCentroid) return null;
    const target = nearestIntactForest(regionCentroid);
    return [regionCentroid, { lat: target.lat, lng: target.lng }] as [{ lat: number; lng: number }, { lat: number; lng: number }];
  }, [paneMode, regionCentroid]);

  const predictionMarker: PredictionMarker | null = useMemo(() => {
    if (paneMode !== "predict" || !prediction) return null;
    return {
      lat: prediction.lat,
      lng: prediction.lng,
      riskLevel: prediction.riskLevel,
      probabilityPct: prediction.probability * 100,
    };
  }, [paneMode, prediction]);

  function handleMapClick(lat: number, lng: number) {
    if (paneMode !== "predict" || regions.length === 0) return;
    setPrediction(predictDeforestationRisk({ lat, lng }, regions, activity, treeCover?.at));
  }

  function runHotspotPrediction() {
    if (regions.length === 0) return;
    setHotspotsRunning(true);
    // Let the button's spinner paint before the (synchronous) grid scoring.
    setTimeout(() => {
      const insideGhana = (p: { lat: number; lng: number }) =>
        regionFeatures.length === 0 || regionFeatures.some((f) => pointInGeometry(p, f.geometry));
      const results = predictHotspots(regions, activity, insideGhana, 10, treeCover?.at);
      setHotspots(results);
      setHotspotsRunning(false);
      if (results[0]) {
        setPrediction(results[0]);
        setFlyTo({ lat: results[0].lat, lng: results[0].lng });
      }
    }, 30);
  }

  function focusOn(point: { lat: number; lng: number }) {
    setFlyToBounds(null);
    setFlyTo({ lat: point.lat, lng: point.lng });
  }

  // Overview widgets — all derived from the same live data the panels use.
  const live = lossData?.available ? lossData : null;
  const activeAlertRegions = useMemo(
    () => regions.filter((r) => r.recentAlertAreaHa >= 0.1).sort((a, b) => b.recentAlertAreaHa - a.recentAlertAreaHa),
    [regions],
  );
  const latestDetection = detections[0] ?? null;

  // ----- Overview figures, all derived from the live data above -----
  const yearly = useMemo(() => (live?.nationalYearlyLossKha ?? []).map((d) => ({ year: d.year, value: d.lossKha })), [live]);
  const lastYear = yearly[yearly.length - 1];
  const prevYear = yearly[yearly.length - 2];
  const yoyPct = lastYear && prevYear && prevYear.value > 0 ? ((lastYear.value - prevYear.value) / prevYear.value) * 100 : null;
  const since2000 = live?.forestSince2000 ?? null;
  const peakFire = fireWeather.reduce<RegionFireWeather | null>((m, w) => (w.peakIndex !== null && (!m || (m.peakIndex ?? 0) < w.peakIndex) ? w : m), null);
  // The main recorded cause of loss, as one line under the trend chart.
  const topDriver = useMemo(() => {
    const drivers = live?.drivers ?? [];
    const total = drivers.reduce((sum, d) => sum + d.areaKha, 0);
    return drivers[0] && total > 0 ? { name: drivers[0].name, pct: (drivers[0].areaKha / total) * 100 } : null;
  }, [live]);

  // Floating labels on the overview map, each pinned to a real place.
  const callouts: MapCallout[] = useMemo(() => {
    if (paneMode !== "overview") return [];
    const out: MapCallout[] = [];
    for (const r of activeAlertRegions.slice(0, 2)) {
      out.push({ id: `alert-${r.region}`, lat: r.lat, lng: r.lng, value: `${fmt(r.recentAlertAreaHa)} ha`, label: `clearing now · ${r.region}`, tone: "alert" });
    }
    if (peakFire && peakFire.peakIndex !== null && peakFire.peakIndex > 0.5) {
      const near = placeLabel(nearest?.(peakFire) ?? null);
      out.push({ id: "fire-weather", lat: peakFire.lat, lng: peakFire.lng, value: `Fire index ${peakFire.peakIndex.toFixed(1)}`, label: near ?? peakFire.region, tone: "fire" });
    }
    if (hotspots?.[0]) {
      const h = hotspots[0];
      out.push({ id: "hotspot", lat: h.lat, lng: h.lng, value: `${fmt(h.probability * 100)}% risk`, label: placeLabel(nearest?.(h) ?? null) ?? "top hotspot", tone: "loss" });
    }
    // Drop callouts that would overlap an earlier one (closer than ~140 km; chips are wide).
    return out.filter((c, i) => out.slice(0, i).every((o) => Math.hypot(o.lat - c.lat, o.lng - c.lng) > 1.3));
  }, [paneMode, activeAlertRegions, peakFire, hotspots, nearest]);

  const activeLabel = PANE_MODES.find((p) => p.mode === paneMode)?.label ?? "";
  const mapSummary = [
    `Map of Ghana, ${activeLabel}. Regions are shaded by tree-cover loss since 2001.`,
    selectedRegion ? `Selected region: ${selectedRegion}.` : "",
    fireMarkers.length ? `${fireMarkers.filter((f) => f.forest).length} NASA fires in forest regions shown.` : "",
    chainsawMarkers.length ? `${chainsawMarkers.length} chainsaw detections shown.` : "",
    hotspots?.length && paneMode === "predict"
      ? `${hotspots.length} risk hotspots shown. Highest: ${placeLabel(nearest?.(hotspots[0]) ?? null) ?? "unknown place"}, ${fmt(hotspots[0].probability * 100)} percent.`
      : "",
    "The same details are listed in the panel beside the map.",
  ]
    .filter(Boolean)
    .join(" ");
  const openSection = (mode: PaneMode) => {
    setPaneMode(mode);
    if (mode === "overview") {
      setSelectedRegion(null);
      setFlyToBounds([...GHANA_VIEW]);
    }
    // Below xl the panel sits under the cards and map, so without this a
    // tap on a section changes nothing visible on screen.
    if (window.matchMedia("(max-width: 1279px)").matches) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      requestAnimationFrame(() => mapSectionRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }));
    }
  };

  return (
    <div className="dashboard min-h-screen bg-[#04070d] text-white md:p-3 lg:p-4">
      <div className="flex min-h-screen overflow-clip bg-[#070b14] md:min-h-[calc(100vh-1.5rem)] md:rounded-[28px] md:border md:border-white/[0.06] md:shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)] lg:min-h-[calc(100vh-2rem)]">
        {/* Sidebar: an icon rail that opens over the content on hover or keyboard focus */}
        <aside className="rail-spacer sticky top-0 z-40 hidden h-screen w-[76px] shrink-0 self-start md:block md:top-3 md:h-[calc(100vh-1.5rem)] lg:top-4 lg:h-[calc(100vh-2rem)]">
          <div className="rail-panel group/rail absolute inset-y-0 left-0 flex w-[76px] flex-col overflow-hidden border-r border-white/[0.05] py-5 transition-[width,background-color,box-shadow] duration-200 ease-out hover:w-[236px] focus-within:w-[236px] motion-reduce:transition-none">
            <Link href="/" aria-label="Aniwa home" className="mx-4 flex h-11 items-center gap-3 rounded-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
              <img src="/logo.png" alt="" width={44} height={44} className="h-11 w-11 shrink-0" />
              <span className="rail-label whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100 group-focus-within/rail:opacity-100">
                <span className="block text-sm font-semibold leading-tight">Aniwa</span>
                <span className="block text-[11px] text-white/55">Ghana forest watch · Home</span>
              </span>
            </Link>
            <nav aria-label="Sections" className="mt-8 flex flex-1 flex-col gap-1.5 px-4">
              {PANE_MODES.map(({ mode, icon: Icon, label }) => {
                const active = paneMode === mode;
                const badge = mode === "priority" ? detections.length + forestFires.length : 0;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => openSection(mode)}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm transition-colors active:scale-[0.98] ${
                      active ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/25" : "text-white/60 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <Icon size={19} className="shrink-0" />
                    <span className="rail-label whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100 group-focus-within/rail:opacity-100">{label}</span>
                    {badge > 0 && (
                      <>
                        <span className="rail-dot absolute left-[30px] top-2 h-2 w-2 rounded-full bg-red-500 transition-opacity group-hover/rail:opacity-0 group-focus-within/rail:opacity-0" aria-hidden="true" />
                        <span className="rail-label ml-auto rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] tabular-nums text-red-300 opacity-0 transition-opacity group-hover/rail:opacity-100 group-focus-within/rail:opacity-100">
                          {badge}
                          <span className="sr-only"> live threats</span>
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="mx-4 flex h-11 items-center gap-3 px-[17px]">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${live ? "bg-emerald-400" : lossData ? "bg-amber-400" : "bg-white/40"}`} aria-hidden="true" />
              <span className="rail-label whitespace-nowrap text-[11px] leading-tight text-white/60 opacity-0 transition-opacity group-hover/rail:opacity-100 group-focus-within/rail:opacity-100">
                {live ? (
                  <>
                    Live data
                    <span className="block text-white/55">Loss to {live.dataThroughYear} · alerts to {fmtDate(live.alertsAsOfLatest)}</span>
                  </>
                ) : lossData ? (
                  "Live data unavailable"
                ) : (
                  "Connecting…"
                )}
              </span>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Phone tab bar */}
          <div className={`sticky top-0 z-20 gap-1 overflow-x-auto border-b border-white/[0.06] bg-[#0a1020]/95 px-3 py-2 backdrop-blur md:hidden ${PANE_MODES.length > 1 ? "flex" : "hidden"}`}>
            {PANE_MODES.map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => openSection(mode)}
                aria-current={paneMode === mode ? "page" : undefined}
                className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[13px] ${paneMode === mode ? "bg-emerald-500/15 text-white" : "text-white/60"}`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>

          <main className="space-y-5 p-4 md:p-6 lg:p-7">
            {/* Header */}
            <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight md:text-[34px]">
                  Ghana Forest Watch
                </h1>
                <p className="mt-1 text-sm text-white/50">
                  Real data. Every region.{paneMode !== "overview" && <span className="text-white/70"> · {activeLabel}</span>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#0f172a]/80 px-3 py-2 text-xs text-white/70 md:hidden">
                  <CalendarDays size={14} className="text-white/50" />
                  {live ? `Loss data to ${live.dataThroughYear} · alerts to ${fmtDate(live.alertsAsOfLatest)}` : "Loading data…"}
                </span>
                <MapSearch onSelect={(p) => setFlyTo({ lat: p.lat, lng: p.lng })} />
              </div>
            </header>

            <div className="grid gap-5 xl:grid-cols-[290px_minmax(0,1fr)_360px]">
              {/* Left: headline figure + live signals */}
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
                    {yoyPct !== null && <Delta text={`${fmt(Math.abs(yoyPct), 0)}%`} up={yoyPct > 0} worse={yoyPct > 0} />}
                    {lastYear && prevYear && <span className="text-[11px] text-white/55">{lastYear.year} loss vs {prevYear.year}</span>}
                  </div>
                  {since2000 && (
                    <p className="mt-2 text-[11px] text-white/55">
                      {fmt(since2000.nationalLossKha / 1000, 2)} of {fmt(since2000.nationalExtent2000Kha / 1000, 2)} M ha of tree cover, 2001–{since2000.throughYear}
                    </p>
                  )}
                </div>
                <KpiCard
                  icon={Satellite}
                  tone="red"
                  label="Forest being cleared (30 days)"
                  value={live ? fmt(live.nationalRecentAlertAreaHa) : null}
                  unit="ha"
                  caption={live ? `alerts in ${activeAlertRegions.length} regions` : undefined}
                  onClick={() => setPaneMode("deforestation")}
                />
                <KpiCard
                  icon={Flame}
                  tone="orange"
                  label="NASA fires in forest regions"
                  value={fires?.available ? fmt(forestFires.length) : fires ? "—" : null}
                  caption={fires?.available ? `last ${fires.days} days` : "NASA FIRMS"}
                  onClick={() => setPaneMode("priority")}
                />
                <KpiCard
                  icon={Axe}
                  tone="rose"
                  label="Chainsaws heard"
                  value={detectionsLoaded ? fmt(detections.length) : null}
                  caption={latestDetection ? `latest ${timeAgo(latestDetection.detectedAt)}` : "no phones yet"}
                  onClick={() => setPaneMode("priority")}
                />
                {detectionsLoaded && detections.length === 0 && (
                  <a
                    href="/listen"
                    target="_blank"
                    rel="noopener"
                    className="-mt-1 flex min-h-9 items-center justify-end gap-1 rounded-lg px-2 text-xs font-medium text-emerald-300 hover:text-emerald-200"
                  >
                    Set up a phone as a listener →
                  </a>
                )}
              </div>

              {/* Centre: map */}
              <section
                ref={mapSectionRef}
                aria-label={`Map: ${activeLabel}`}
                className={`${CARD} relative h-[460px] scroll-mt-20 overflow-hidden rounded-[24px] md:h-[640px] ${paneMode === "predict" ? "[&_.maplibregl-canvas]:!cursor-crosshair" : ""}`}
              >
              <EcoMap
                basemap={basemap}
                fires={fireMarkers}
                hotspots={hotspotMarkers}
                flyTo={flyTo}
                flyToBounds={flyToBounds}
                regions={regionMarkers}
                selectedRegion={selectedRegion}
                onSelectRegion={paneMode === "predict" ? undefined : setSelectedRegion}
                reforestationSites={reforestationSites}
                intactForestPatches={intactForestPatches}
                connectionLine={connectionLine}
                prediction={predictionMarker}
                chainsawDetections={chainsawMarkers}
                onMapClick={handleMapClick}
                callouts={callouts}
                showRegionLabels={paneMode !== "overview"}
              />

                {(paneMode !== "overview" || selectedRegion) && (
                <div className="absolute left-3 top-3 hidden items-center gap-1 rounded-xl glass py-1 pl-3 pr-1 text-xs sm:flex">
                  <span className="text-white/55">Viewing · </span>
                  {activeLabel}
                  {selectedRegion && (
                    <>
                      <span className="text-white/55"> · {selectedRegion}</span>
                      <button
                        type="button"
                        onClick={() => setSelectedRegion(null)}
                        aria-label={`Clear the selected region, ${selectedRegion}`}
                        className="ml-1 grid h-7 w-7 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
                      >
                        ×
                      </button>
                    </>
                  )}
                  {!selectedRegion && <span className="w-2" />}
                </div>
                )}

                {/* What the map shows, for screen readers */}
                <p className="sr-only" aria-live="polite">{mapSummary}</p>

              {/* Basemap switch */}
              <div className="absolute right-14 top-3 flex overflow-hidden rounded-xl glass text-[11px]">
                {([
                  ["esri", "Detailed"],
                  ["nasa", "NASA yesterday"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setBasemap(value)}
                    aria-pressed={basemap === value}
                    className={`min-h-11 px-3 transition-colors sm:min-h-9 ${basemap === value ? "bg-emerald-500/20 text-white" : "text-white/55 hover:text-white"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div
                role="status"
                className={`pointer-events-none absolute left-3 top-14 max-w-[calc(100%-4.5rem)] rounded-full glass px-3 py-1.5 text-xs font-medium sm:left-1/2 sm:-translate-x-1/2 ${
                  paneMode === "predict" ? "text-emerald-300" : "text-white/80"
                }`}
              >
                {paneMode === "predict" ? "Click: check the risk at that spot" : "Click a region: select it"}
              </div>

              {/* Legend: always open on larger screens; a button on phones so it doesn't cover the map */}
              <button
                type="button"
                onClick={() => setLegendOpen((o) => !o)}
                aria-expanded={legendOpen}
                className="absolute bottom-3 left-3 z-10 rounded-xl glass px-3 py-2 text-xs text-white/80 sm:hidden"
              >
                {legendOpen ? "Hide legend" : "Legend"}
              </button>
              <div
                className={`pointer-events-none absolute bottom-14 left-3 w-52 space-y-1.5 rounded-xl glass px-3 py-2.5 text-[11px] text-white/75 sm:bottom-3 sm:block ${
                  legendOpen ? "block" : "hidden"
                }`}
              >
                <p className="text-[11px] font-medium text-white/55">Map legend</p>
                <div>
                  <div className="h-1.5 rounded-full bg-gradient-to-r from-[rgb(254,202,202)] to-[rgb(127,29,29)]" />
                  <div className="mt-1 flex justify-between text-[11px] text-white/55">
                    <span>Less loss</span>
                    <span>More loss</span>
                  </div>
                </div>
                {showsLiveThreats && fireMarkers.length > 0 && (
                  <>
                    <LegendRow swatch={triangle("#f97316")} label="NASA fire, forest region" />
                    <LegendRow swatch={triangle("#facc15", 7)} label="NASA fire, savanna" />
                  </>
                )}
                {showsLiveThreats && chainsawMarkers.length > 0 && (
                  <LegendRow
                    swatch={<span className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-red-400 bg-red-500/40" />}
                    label={`Chainsaw heard (~${APPROX_HEARING_RADIUS_M / 1000} km area)`}
                  />
                )}
                {paneMode === "predict" && (
                  <>
                    <LegendRow swatch={dot("#ef4444")} label="Severe risk" />
                    <LegendRow swatch={dot("#f97316")} label="High risk" />
                    <LegendRow swatch={dot("#eab308")} label="Moderate risk" />
                    <LegendRow swatch={dot("#6b7280")} label="Low risk" />
                  </>
                )}
                {paneMode === "reforestation" && (
                  <>
                    <LegendRow swatch={dot("#16a34a", 10)} label="Primary forest restoration" />
                    <LegendRow swatch={dot("#84cc16", 10)} label="Climate-smart agroforestry" />
                  </>
                )}
              </div>
              </section>

              {/* Right: trend + causes on the overview, otherwise the section's panel */}
              {paneMode === "overview" ? (
                <div key="overview" className="space-y-5 animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
                  <TrendCard title="Tree-cover loss per year" rangeLabel={yearly.length ? `${yearly[0].year}–${lastYear.year}` : "2001–"} series={yearly} unit="k ha" />
                  {topDriver && (
                    <p className="px-1 text-sm leading-relaxed text-white/70">
                      <span className="font-semibold text-white">{fmt(topDriver.pct, 1)}%</span> of the loss since 2001 is classed as{" "}
                      {topDriver.name.toLowerCase()}.
                    </p>
                  )}
                  <ActionCard
                    icon={TreeDeciduous}
                    title="Find where clearing is happening"
                    body="Rank Ghana's riskiest spots, then check any of them with Sentinel satellite images."
                    cta="Open Predict"
                    onClick={() => openSection("predict")}
                  />
                </div>
              ) : (
                <section key={paneMode} className={`${CARD} overflow-hidden animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none xl:h-[640px]`}>
                  <div className="h-full overflow-y-auto">
                {paneMode === "deforestation" ? (
                      <DeforestationPanel
                        selectedRegion={selectedRegion}
                        onSelectRegion={setSelectedRegion}
                        lossData={lossData}
                        onOpenSection={(m) => openSection(m)}
                      />
                    ) : paneMode === "predict" ? (
                      <PredictPanel
                        prediction={prediction}
                        speciesResults={speciesResults}
                        regions={regions}
                        hotspots={hotspots}
                        hotspotsRunning={hotspotsRunning}
                        canPredict={regions.length > 0}
                        liveSummary={{ chainsaws: detections.length, forestFires: forestFires.length }}
                        onPredictHotspots={runHotspotPrediction}
                        onSelectHotspot={(h) => {
                          setPrediction(h);
                          focusOn(h);
                        }}
                      />
                    ) : paneMode === "priority" ? (
                      <PriorityPanel
                        fires={fires?.available ? fireList : fires ? [] : null}
                        firesError={fires && !fires.available ? `NASA FIRMS unavailable: ${fires.error}` : null}
                        regions={regions}
                        onFocus={(p, regionName) => {
                          if (regionName) setSelectedRegion(regionName);
                          focusOn(p);
                        }}
                      >
                        <div className="-mx-4">
                          <ChainsawPanel detections={detections} loaded={detectionsLoaded} onSelect={(d) => focusOn(d)} />
                          <div className="border-t border-white/[0.06]">
                            <FireWeatherPanel
                              onFocus={(p, regionName) => {
                                if (regionName) setSelectedRegion(regionName);
                                focusOn(p);
                              }}
                            />
                          </div>
                        </div>
                      </PriorityPanel>
                    ) : paneMode === "climate" ? (
                      <ClimatePanel lossData={lossData} selectedRegion={selectedRegion} onSelectRegion={setSelectedRegion} />
                    ) : (
                      <>
                        <ReforestationPanel selectedRegion={selectedRegion} regions={regions} maxLossKha={maxLossKha} />
                        <Collapsible title="Plan a planting (with Gemini)" icon={<Sprout size={14} className="text-emerald-400" />}>
                          <PlantingPlan regions={regions} selectedRegion={selectedRegion} />
                        </Collapsible>
                        <Collapsible title="Ghana's tree crops: cocoa, cashew and more" icon={<Wheat size={14} className="text-amber-400" />}>
                          <TreeCropsPanel />
                        </Collapsible>
                      </>
                    )}
                  </div>
                </section>
              )}
            </div>


            <AiAnalyst />
          </main>
        </div>
      </div>
    </div>
  );
}
