"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export interface RegionLossMarker {
  region: string;
  lat: number;
  lng: number;
  lossKha: number | null; // null = no individually-published figure for this region
}

export interface SpeciesPoint {
  lat: number;
  lng: number;
  species: string;
  color: string;
}

export interface IntactForestMarker {
  name: string;
  lat: number;
  lng: number;
}

export interface ReforestationSiteMarker {
  lat: number;
  lng: number;
  rank: number;
  score: number;
  type: "primary_forest_restoration" | "climate_smart_agroforestry";
  reasoning: string;
}

export interface PredictionMarker {
  lat: number;
  lng: number;
  riskLevel: "low" | "moderate" | "high" | "severe";
  probabilityPct: number;
}

export interface ChainsawMarker {
  id: string;
  lat: number;
  lng: number;
  score: number;
  detectedAt: string;
  deviceName: string;
  radiusM: number;
}

export interface FireMarker {
  lat: number;
  lng: number;
  forest: boolean; // in a forest-belt region — likely clearing, drawn pulsing
}

export interface HotspotMarker {
  lat: number;
  lng: number;
  rank: number;
  riskLevel: PredictionMarker["riskLevel"];
}

export type Basemap = "esri" | "nasa";

// A floating label pinned to a real place on the map (e.g. the region with
// the most clearing right now). Tone picks the accent colour.
export interface MapCallout {
  id: string;
  lat: number;
  lng: number;
  value: string;
  label: string;
  tone: "loss" | "fire" | "forest" | "alert";
}

const CALLOUT_TONE: Record<MapCallout["tone"], string> = {
  loss: "#ef4444",
  fire: "#f97316",
  forest: "#34d399",
  alert: "#f43f5e",
};

interface EcoMapProps {
  basemap?: Basemap;
  fires?: FireMarker[];
  hotspots?: HotspotMarker[];
  flyTo?: { lat: number; lng: number } | null;
  flyToBounds?: [{ lat: number; lng: number }, { lat: number; lng: number }] | null;
  regions?: RegionLossMarker[];
  selectedRegion?: string | null;
  onSelectRegion?: (region: string) => void;
  speciesPoints?: SpeciesPoint[];
  intactForestPatches?: IntactForestMarker[];
  reforestationSites?: ReforestationSiteMarker[];
  connectionLine?: [{ lat: number; lng: number }, { lat: number; lng: number }] | null;
  prediction?: PredictionMarker | null;
  chainsawDetections?: ChainsawMarker[];
  onMapClick?: (lat: number, lng: number) => void;
  callouts?: MapCallout[];
  showRegionLabels?: boolean;
}

// Whole-country overview on first paint.
// Fit the whole country into whatever size the map card is.
const GHANA_BOUNDS: [[number, number], [number, number]] = [[-3.3, 4.7], [1.2, 11.2]];

const PREDICTION_COLOR: Record<PredictionMarker["riskLevel"], string> = {
  low: "#6b7280",
  moderate: "#eab308",
  high: "#f97316",
  severe: "#ef4444",
};

// Real Ghana ADM1 (region) boundary polygons — geoBoundaries (OpenStreetMap-
// derived, CC-BY-SA), bundled at public/ghana_regions.geojson — so the
// deforestation-loss shading covers each region's actual shape, not a dot at
// its center.
const REGION_BOUNDARIES_URL = "/ghana_regions.geojson";

function stripRegionSuffix(shapeName: string): string {
  return shapeName.replace(/\s+Region$/i, "");
}

// Light -> deep red, linear in RGB. lossKha === null (no individually
// published figure) renders neutral grey instead of inventing a color.
function regionFillColor(lossKha: number | null, maxLoss: number): string {
  if (lossKha === null) return "#6b7280";
  const t = Math.min(lossKha / maxLoss, 1);
  const light = [254, 202, 202];
  const deep = [127, 29, 29];
  const rgb = light.map((c, i) => Math.round(c + (deep[i] - c) * t));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

// Recursively walks a Polygon/MultiPolygon coordinate tree to find its bbox —
// used so "zoom to this region" fits its real shape instead of a guessed
// fixed zoom level (a small region like Greater Accra and a large one like
// Western need very different zooms to fill the frame the same way).
function geometryBounds(geom: GeoJSON.Geometry): [[number, number], [number, number]] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const visit = (node: unknown): void => {
    if (Array.isArray(node) && typeof node[0] === "number") {
      const [lng, lat] = node as [number, number];
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else if (Array.isArray(node)) {
      for (const child of node) visit(child);
    }
  };
  visit((geom as { coordinates: unknown }).coordinates);
  return [[minLng, minLat], [maxLng, maxLat]];
}

// NASA GIBS daily true-colour imagery from VIIRS on NOAA-20. Verified
// 2026-11-10: yesterday's tiles exist for NOAA-20 (the SNPP layer returned
// 404). Native resolution is ~375 m, so GIBS serves up to zoom 9; maplibre
// stretches it beyond that. Ghana is often cloudy, so some days show cloud.
function gibsTileUrl(): string {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${yesterday}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
}

// A ground-distance circle as a polygon ring (maplibre's circle layer is
// sized in screen pixels, which can't show "~1 km around the phone").
function circleRing(lat: number, lng: number, radiusM: number, steps = 48): [number, number][] {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return ring;
}

export default function EcoMap({
  basemap = "esri",
  fires = [],
  hotspots = [],
  flyTo,
  flyToBounds,
  regions = [],
  selectedRegion = null,
  onSelectRegion,
  speciesPoints = [],
  intactForestPatches = [],
  reforestationSites = [],
  connectionLine = null,
  prediction = null,
  chainsawDetections = [],
  onMapClick,
  callouts = [],
  showRegionLabels = true,
}: EcoMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const regionLabelMarkers = useRef<Map<string, maplibregl.Marker>>(new window.Map());
  const regionBoundaries = useRef<GeoJSON.FeatureCollection | null>(null);
  const regionFeatureIdByName = useRef<Map<string, number>>(new Map());
  const regionGeometryByName = useRef<Map<string, GeoJSON.Geometry>>(new Map());
  const selectedFeatureId = useRef<number | null>(null);
  const [boundariesReady, setBoundariesReady] = useState(false);
  const intactForestMarkers = useRef<maplibregl.Marker[]>([]);
  const predictionMarker = useRef<maplibregl.Marker | null>(null);
  const onSelectRegionRef = useRef(onSelectRegion);
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => {
    onSelectRegionRef.current = onSelectRegion;
    onMapClickRef.current = onMapClick;
  }, [onSelectRegion, onMapClick]);
  // Tracks whether the CURRENT map.current instance has finished loading its
  // style. Needed because React Strict Mode (dev only) mounts this component
  // twice, creating and tearing down a first map instance before the final
  // one exists; effects that depend only on data props won't re-run for the
  // second instance if that data already arrived before the remount, so
  // they'd attach markers to a map that's already been removed. Re-running
  // off this state (set fresh per instance) instead of a one-time "load"
  // listener fixes that.
  const [styleLoaded, setStyleLoaded] = useState(false);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const probe = document.createElement("canvas");
    if (!probe.getContext("webgl2") && !probe.getContext("webgl")) {
      mapContainer.current.innerHTML = `
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#0a0e14;padding:2rem;">
          <div style="max-width:28rem;text-align:center;color:#9ca3af;font-family:ui-sans-serif,system-ui;">
            <p style="font-family:ui-monospace,monospace;font-size:10px;letter-spacing:0.25em;color:#22c55e;margin-bottom:1rem;">WEBGL DISABLED</p>
            <h2 style="font-size:1.25rem;color:#f3f4f6;margin-bottom:0.75rem;">Map unavailable</h2>
            <p style="font-size:0.875rem;line-height:1.5;">Your browser has WebGL disabled, so the map can't render. Enable it to view the map.</p>
          </div>
        </div>
      `;
      return;
    }

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          "esri-satellite": {
            type: "raster",
            tiles: [
              "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
            attribution: "Tiles &copy; Esri",
            maxzoom: 18,
          },
          "nasa-viirs": {
            type: "raster",
            tiles: [gibsTileUrl()],
            tileSize: 256,
            attribution: "Imagery: NASA GIBS / VIIRS NOAA-20",
            maxzoom: 9,
          },
        },
        layers: [
          { id: "satellite", type: "raster", source: "esri-satellite" },
          { id: "nasa-imagery", type: "raster", source: "nasa-viirs", layout: { visibility: "none" } },
        ],
      },
      bounds: GHANA_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      maxZoom: 15,
    });

    map.current.addControl(new maplibregl.NavigationControl(), "top-right");
    map.current.on("load", () => setStyleLoaded(true));
    map.current.on("click", (e) => {
      onMapClickRef.current?.(e.lngLat.lat, e.lngLat.lng);
    });

    return () => {
      map.current?.remove();
      map.current = null;
      regionLabelMarkers.current.clear();
      setStyleLoaded(false);
    };
  }, []);

  // Fetch the real region boundary polygons once (static file, doesn't
  // depend on props) — a 270KB bundled geoBoundaries GeoJSON, not a live call.
  useEffect(() => {
    let cancelled = false;
    fetch(REGION_BOUNDARIES_URL)
      .then((res) => res.json())
      .then((geo: GeoJSON.FeatureCollection) => {
        if (cancelled) return;
        regionBoundaries.current = geo;
        setBoundariesReady(true);
      })
      .catch(() => {
        // No boundary polygons available — region shading just won't render;
        // everything else on the map still works.
      });
    return () => { cancelled = true; };
  }, []);

  // Deforestation region shading, filled across each region's REAL boundary
  // polygon (not a dot at its center) — color intensity carries tree cover
  // loss; grey = no individually published figure for that region, not an
  // invented number.
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded || !boundariesReady || !regionBoundaries.current || regions.length === 0) return;

    if (m.getLayer("region-outline")) m.removeLayer("region-outline");
    if (m.getLayer("region-fill")) m.removeLayer("region-fill");
    if (m.getSource("region-boundaries")) m.removeSource("region-boundaries");
    regionLabelMarkers.current.forEach((marker) => marker.remove());
    regionLabelMarkers.current.clear();
    regionFeatureIdByName.current.clear();
    regionGeometryByName.current.clear();

    const lossByName = new Map(regions.map((r) => [r.region, r.lossKha]));
    const knownLosses = regions.map((r) => r.lossKha).filter((v): v is number => v !== null);
    const maxLoss = Math.max(...knownLosses, 1);

    const features = regionBoundaries.current.features
      .map((f, i) => {
        const shapeName = (f.properties as { shapeName?: string } | null)?.shapeName ?? "";
        const name = stripRegionSuffix(shapeName);
        if (!lossByName.has(name)) return null; // boundary set and our region list should match 1:1, but don't render an orphan silently-wrong
        const lossKha = lossByName.get(name) ?? null;
        return {
          ...f,
          id: i,
          properties: { ...f.properties, region: name, lossKha, fillColor: regionFillColor(lossKha, maxLoss) },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    for (const f of features) {
      regionFeatureIdByName.current.set(f.properties.region, f.id as number);
      regionGeometryByName.current.set(f.properties.region, f.geometry);
    }

    m.addSource("region-boundaries", {
      type: "geojson",
      data: { type: "FeatureCollection", features },
    });
    m.addLayer({
      id: "region-fill",
      type: "fill",
      source: "region-boundaries",
      paint: {
        "fill-color": ["get", "fillColor"],
        "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.75, 0.5],
      },
    });
    m.addLayer({
      id: "region-outline",
      type: "line",
      source: "region-boundaries",
      paint: {
        "line-color": "#ffffff",
        "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.5, 0.75],
        "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, 0.4],
      },
    });

    // Small centroid label (loss figure only, no filled dot — the polygon
    // fill already carries the color) so a region's number is still readable
    // without having to click it. pointer-events:none lets the click reach
    // the fill layer underneath for selection.
    for (const r of regions) {
      // Labels under 5 thousand ha ("0 k ha", "1 k ha") add clutter, not information.
      if (r.lossKha !== null && r.lossKha < 5) continue;
      const el = document.createElement("div");
      el.style.pointerEvents = "none";
      el.style.fontFamily = "ui-monospace, monospace";
      el.style.fontSize = "12px";
      el.style.fontWeight = "700";
      el.style.color = "white";
      el.style.textShadow = "0 1px 3px rgba(0,0,0,0.9)";
      el.style.whiteSpace = "nowrap";
      el.textContent = r.lossKha !== null ? `${Math.round(r.lossKha)} k ha` : "no data";
      const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([r.lng, r.lat]).addTo(m);
      regionLabelMarkers.current.set(r.region, marker);
    }

    const onEnter = () => { m.getCanvas().style.cursor = "pointer"; };
    const onLeave = () => { m.getCanvas().style.cursor = ""; };
    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      const name = e.features?.[0]?.properties?.region as string | undefined;
      if (name) onSelectRegionRef.current?.(name);
    };
    m.on("mouseenter", "region-fill", onEnter);
    m.on("mouseleave", "region-fill", onLeave);
    m.on("click", "region-fill", onClick);

    return () => {
      m.off("mouseenter", "region-fill", onEnter);
      m.off("mouseleave", "region-fill", onLeave);
      m.off("click", "region-fill", onClick);
    };
  }, [regions, styleLoaded, boundariesReady]);

  // The per-region loss numbers can be hidden (the shading still shows loss).
  useEffect(() => {
    regionLabelMarkers.current.forEach((marker) => {
      marker.getElement().style.display = showRegionLabels ? "" : "none";
    });
  }, [showRegionLabels, regions, styleLoaded, boundariesReady]);

  // Highlight selected region via feature-state (cheap re-paint, no source rebuild).
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded || !m.getSource("region-boundaries")) return;

    if (selectedFeatureId.current !== null) {
      m.setFeatureState({ source: "region-boundaries", id: selectedFeatureId.current }, { selected: false });
    }
    const nextId = selectedRegion ? regionFeatureIdByName.current.get(selectedRegion) : undefined;
    if (nextId !== undefined) {
      m.setFeatureState({ source: "region-boundaries", id: nextId }, { selected: true });
      selectedFeatureId.current = nextId;
    } else {
      selectedFeatureId.current = null;
    }
  }, [selectedRegion, styleLoaded, boundariesReady]);

  // Species occurrence points (GBIF), colored per species.
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded) return;

    if (m.getLayer("species-layer")) m.removeLayer("species-layer");
    if (m.getSource("species")) m.removeSource("species");

    m.addSource("species", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: speciesPoints.map((p) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
          properties: { species: p.species, color: p.color },
        })),
      },
    });
    m.addLayer({
      id: "species-layer",
      type: "circle",
      source: "species",
      paint: {
        "circle-radius": 5,
        "circle-color": ["get", "color"],
        "circle-opacity": 0.75,
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1,
      },
    });
  }, [speciesPoints, styleLoaded]);

  // Reforestation candidate sites, numbered to match the panel's #1/#2/#3
  // ranking, sized/colored by score, clickable for the full reasoning —
  // otherwise they're unlabeled dots on a line with no way to tell what
  // they are or why they're there.
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded) return;

    if (m.getLayer("reforest-label-layer")) m.removeLayer("reforest-label-layer");
    if (m.getLayer("reforest-layer")) m.removeLayer("reforest-layer");
    if (m.getSource("reforest")) m.removeSource("reforest");

    m.addSource("reforest", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: reforestationSites.map((s) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [s.lng, s.lat] },
          properties: { rank: s.rank, score: s.score, type: s.type, reasoning: s.reasoning },
        })),
      },
    });
    m.addLayer({
      id: "reforest-layer",
      type: "circle",
      source: "reforest",
      paint: {
        "circle-radius": 11,
        "circle-color": ["match", ["get", "type"], "primary_forest_restoration", "#16a34a", "#84cc16"],
        "circle-opacity": 0.85,
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 2,
      },
    });
    m.addLayer({
      id: "reforest-label-layer",
      type: "symbol",
      source: "reforest",
      layout: {
        "text-field": ["to-string", ["get", "rank"]],
        "text-size": 11,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "text-color": "#ffffff" },
    });

    const onEnter = () => { m.getCanvas().style.cursor = "pointer"; };
    const onLeave = () => { m.getCanvas().style.cursor = ""; };
    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as { rank: number; score: number; type: ReforestationSiteMarker["type"]; reasoning: string };
      const typeLabel = p.type === "primary_forest_restoration" ? "Primary forest restoration" : "Climate-smart agroforestry";

      const root = document.createElement("div");
      root.style.fontFamily = "ui-sans-serif, system-ui";
      root.style.fontSize = "12px";
      root.style.lineHeight = "1.4";
      root.style.color = "#111827"; // maplibre's popup card is white — set dark text explicitly rather than inherit the app's white theme color
      const title = document.createElement("strong");
      title.style.color = "#111827";
      title.textContent = `Site #${p.rank} · Score ${p.score}/100`;
      const typeEl = document.createElement("div");
      typeEl.style.color = "#374151";
      typeEl.textContent = typeLabel;
      const reasonEl = document.createElement("p");
      reasonEl.style.margin = "6px 0 0";
      reasonEl.style.color = "#374151";
      reasonEl.textContent = p.reasoning;
      root.appendChild(title);
      root.appendChild(typeEl);
      root.appendChild(reasonEl);

      new maplibregl.Popup({ closeButton: true, maxWidth: "240px" }).setLngLat(e.lngLat).setDOMContent(root).addTo(m);
    };
    m.on("mouseenter", "reforest-layer", onEnter);
    m.on("mouseleave", "reforest-layer", onLeave);
    m.on("click", "reforest-layer", onClick);

    return () => {
      m.off("mouseenter", "reforest-layer", onEnter);
      m.off("mouseleave", "reforest-layer", onLeave);
      m.off("click", "reforest-layer", onClick);
    };
  }, [reforestationSites, styleLoaded]);

  // Connection line (displacement vector / reforestation corridor).
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded) return;

    if (m.getLayer("connection-layer")) m.removeLayer("connection-layer");
    if (m.getSource("connection")) m.removeSource("connection");
    if (!connectionLine) return;

    m.addSource("connection", {
      type: "geojson",
      data: {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [connectionLine[0].lng, connectionLine[0].lat],
            [connectionLine[1].lng, connectionLine[1].lat],
          ],
        },
        properties: {},
      },
    });
    m.addLayer({
      id: "connection-layer",
      type: "line",
      source: "connection",
      paint: { "line-color": "#22d3ee", "line-width": 2, "line-dasharray": [2, 2] },
    });
  }, [connectionLine, styleLoaded]);

  // Intact-forest reference patches, small labeled markers.
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded) return;

    intactForestMarkers.current.forEach((marker) => marker.remove());
    intactForestMarkers.current = [];

    for (const patch of intactForestPatches) {
      const el = document.createElement("div");
      el.title = `${patch.name} — approximate reference point for this protected area, not its surveyed boundary (which covers a much larger area than this dot).`;
      el.style.display = "flex";
      el.style.flexDirection = "column";
      el.style.alignItems = "center";
      const dot = document.createElement("div");
      dot.style.width = "12px";
      dot.style.height = "12px";
      dot.style.borderRadius = "9999px";
      dot.style.background = "#16a34a";
      dot.style.border = "2px solid white";
      const label = document.createElement("div");
      label.textContent = patch.name;
      label.style.fontSize = "9px";
      label.style.fontFamily = "ui-monospace, monospace";
      label.style.color = "white";
      label.style.background = "rgba(0,0,0,0.6)";
      label.style.padding = "1px 4px";
      label.style.marginTop = "2px";
      label.style.whiteSpace = "nowrap";
      el.appendChild(dot);
      el.appendChild(label);

      const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([patch.lng, patch.lat]).addTo(m);
      intactForestMarkers.current.push(marker);
    }
  }, [intactForestPatches, styleLoaded]);

  // Prediction marker — where the user clicked, colored by predicted risk.
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded) return;

    predictionMarker.current?.remove();
    predictionMarker.current = null;
    if (!prediction) return;

    const el = document.createElement("div");
    el.style.width = "26px";
    el.style.height = "26px";
    el.style.borderRadius = "9999px";
    el.style.border = "3px solid white";
    el.style.background = PREDICTION_COLOR[prediction.riskLevel];
    el.style.boxShadow = "0 0 0 8px rgba(255,255,255,0.15), 0 2px 10px rgba(0,0,0,0.5)";
    el.style.display = "flex";
    el.style.alignItems = "center";
    el.style.justifyContent = "center";
    el.style.color = "white";
    el.style.fontSize = "8px";
    el.style.fontFamily = "ui-monospace, monospace";
    el.style.fontWeight = "700";
    el.textContent = `${Math.round(prediction.probabilityPct)}%`;

    predictionMarker.current = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([prediction.lng, prediction.lat])
      .addTo(m);
  }, [prediction, styleLoaded]);

  // Basemap switch: Esri (sharp, but a composite that can be months or years
  // old) vs NASA VIIRS (coarse, but yesterday's actual view).
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded || !m.getLayer("nasa-imagery")) return;
    m.setLayoutProperty("nasa-imagery", "visibility", basemap === "nasa" ? "visible" : "none");
  }, [basemap, styleLoaded]);

  // NASA FIRMS fires. Forest-belt fires get an animated pulse ring so live
  // likely-clearing events stand out from routine savanna burning.
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded) return;

    for (const id of ["fires-pulse", "fires-layer"]) if (m.getLayer(id)) m.removeLayer(id);
    if (m.getSource("fires")) m.removeSource("fires");
    if (fires.length === 0) return;

    m.addSource("fires", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: fires.map((f) => ({ type: "Feature", geometry: { type: "Point", coordinates: [f.lng, f.lat] }, properties: { forest: f.forest } })),
      },
    });
    m.addLayer({
      id: "fires-pulse",
      type: "circle",
      source: "fires",
      filter: ["==", ["get", "forest"], true],
      paint: { "circle-radius": 4, "circle-color": "#f97316", "circle-opacity": 0.5, "circle-stroke-width": 0 },
    });
    // Fires are triangles so they never read as a risk level (circles).
    for (const [name, color, size] of [["fire-forest", "#f97316", 14], ["fire-savanna", "#facc15", 10]] as const) {
      if (m.hasImage(name)) continue;
      const ratio = 2;
      const c = document.createElement("canvas");
      c.width = c.height = size * ratio;
      const g = c.getContext("2d")!;
      g.scale(ratio, ratio);
      g.beginPath();
      g.moveTo(size / 2, 1);
      g.lineTo(size - 1, size - 1);
      g.lineTo(1, size - 1);
      g.closePath();
      g.fillStyle = color;
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = "#431407";
      g.stroke();
      const img = g.getImageData(0, 0, c.width, c.height);
      m.addImage(name, { width: c.width, height: c.height, data: new Uint8Array(img.data.buffer) }, { pixelRatio: ratio });
    }
    m.addLayer({
      id: "fires-layer",
      type: "symbol",
      source: "fires",
      layout: {
        "icon-image": ["case", ["get", "forest"], "fire-forest", "fire-savanna"],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: { "icon-opacity": ["case", ["get", "forest"], 1, 0.6] },
    });

    let frame = 0;
    const start = performance.now();
    const animate = (now: number) => {
      const t = ((now - start) % 1600) / 1600; // one pulse every 1.6 s
      if (m.getLayer("fires-pulse")) {
        m.setPaintProperty("fires-pulse", "circle-radius", 4 + t * 14);
        m.setPaintProperty("fires-pulse", "circle-opacity", 0.55 * (1 - t));
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [fires, styleLoaded]);

  // Predicted hotspots, numbered by rank.
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded) return;

    for (const id of ["hotspot-label", "hotspot-layer"]) if (m.getLayer(id)) m.removeLayer(id);
    if (m.getSource("hotspots")) m.removeSource("hotspots");
    if (hotspots.length === 0) return;

    m.addSource("hotspots", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: hotspots.map((h) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [h.lng, h.lat] },
          properties: { rank: h.rank, color: PREDICTION_COLOR[h.riskLevel] },
        })),
      },
    });
    m.addLayer({
      id: "hotspot-layer",
      type: "circle",
      source: "hotspots",
      paint: { "circle-radius": 12, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 2, "circle-opacity": 0.9 },
    });
    m.addLayer({
      id: "hotspot-label",
      type: "symbol",
      source: "hotspots",
      layout: { "text-field": ["to-string", ["get", "rank"]], "text-size": 11, "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": "#ffffff" },
    });
  }, [hotspots, styleLoaded]);

  // Chainsaw detections — a pin where the PHONE was, plus a shaded circle for
  // roughly how far it can hear. One phone can't tell where the saw is
  // within that circle, so the circle is the honest search area.
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded) return;

    for (const id of ["chainsaw-point-layer", "chainsaw-radius-line", "chainsaw-radius-fill"]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    for (const id of ["chainsaw-points", "chainsaw-radius"]) {
      if (m.getSource(id)) m.removeSource(id);
    }
    if (chainsawDetections.length === 0) return;

    m.addSource("chainsaw-radius", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: chainsawDetections.map((d) => ({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [circleRing(d.lat, d.lng, d.radiusM)] },
          properties: {},
        })),
      },
    });
    m.addSource("chainsaw-points", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: chainsawDetections.map((d) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [d.lng, d.lat] },
          properties: { score: d.score, detectedAt: d.detectedAt, deviceName: d.deviceName, radiusM: d.radiusM },
        })),
      },
    });
    m.addLayer({ id: "chainsaw-radius-fill", type: "fill", source: "chainsaw-radius", paint: { "fill-color": "#ef4444", "fill-opacity": 0.12 } });
    m.addLayer({ id: "chainsaw-radius-line", type: "line", source: "chainsaw-radius", paint: { "line-color": "#ef4444", "line-width": 1.5, "line-dasharray": [2, 2] } });
    m.addLayer({
      id: "chainsaw-point-layer",
      type: "circle",
      source: "chainsaw-points",
      paint: { "circle-radius": 8, "circle-color": "#ef4444", "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
    });

    const onEnter = () => { m.getCanvas().style.cursor = "pointer"; };
    const onLeave = () => { m.getCanvas().style.cursor = ""; };
    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as { score: number; detectedAt: string; deviceName: string; radiusM: number };

      const root = document.createElement("div");
      root.style.fontFamily = "ui-sans-serif, system-ui";
      root.style.fontSize = "12px";
      root.style.lineHeight = "1.4";
      root.style.color = "#111827";
      const title = document.createElement("strong");
      title.textContent = `Chainsaw heard · ${Math.round(p.score * 100)}% confidence`;
      const when = document.createElement("div");
      when.style.color = "#374151";
      when.textContent = `${new Date(p.detectedAt).toLocaleString()} · ${p.deviceName}`;
      const note = document.createElement("p");
      note.style.margin = "6px 0 0";
      note.style.color = "#374151";
      note.textContent = `Pin is the phone's position. The saw is somewhere within roughly ${(p.radiusM / 1000).toFixed(1)} km.`;
      root.append(title, when, note);

      new maplibregl.Popup({ closeButton: true, maxWidth: "240px" }).setLngLat(e.lngLat).setDOMContent(root).addTo(m);
    };
    m.on("mouseenter", "chainsaw-point-layer", onEnter);
    m.on("mouseleave", "chainsaw-point-layer", onLeave);
    m.on("click", "chainsaw-point-layer", onClick);

    return () => {
      m.off("mouseenter", "chainsaw-point-layer", onEnter);
      m.off("mouseleave", "chainsaw-point-layer", onLeave);
      m.off("click", "chainsaw-point-layer", onClick);
    };
  }, [chainsawDetections, styleLoaded]);

  // Floating callout chips, each anchored to its real coordinates.
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded) return;
    const markers = callouts.map((c) => {
      const color = CALLOUT_TONE[c.tone];
      const el = document.createElement("div");
      el.style.pointerEvents = "none";
      el.style.display = "flex";
      el.style.flexDirection = "column";
      el.style.alignItems = "center";
      const chip = document.createElement("div");
      chip.style.cssText =
        "display:flex;align-items:center;gap:8px;padding:6px 10px 6px 6px;border-radius:14px;background:rgba(10,16,32,0.82);border:1px solid rgba(255,255,255,0.12);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 8px 24px rgba(0,0,0,0.35);font-family:var(--font-poppins),ui-sans-serif,system-ui;white-space:nowrap;";
      const tile = document.createElement("div");
      tile.style.cssText = `width:26px;height:26px;border-radius:9px;background:${color}26;display:grid;place-items:center;`;
      const dot = document.createElement("div");
      dot.style.cssText = `width:9px;height:9px;border-radius:50%;background:${color};box-shadow:0 0 0 3px ${color}40;`;
      tile.appendChild(dot);
      const text = document.createElement("div");
      const value = document.createElement("div");
      value.textContent = c.value;
      value.style.cssText = "color:#fff;font-size:13px;font-weight:600;line-height:1.1;";
      const label = document.createElement("div");
      label.textContent = c.label;
      label.style.cssText = "color:rgba(255,255,255,0.6);font-size:10px;line-height:1.2;margin-top:1px;";
      text.append(value, label);
      chip.append(tile, text);
      const stem = document.createElement("div");
      stem.style.cssText = "width:1px;height:14px;background:rgba(255,255,255,0.35);";
      const pin = document.createElement("div");
      pin.style.cssText = `width:10px;height:10px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 4px ${color}40;`;
      el.append(chip, stem, pin);
      return new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, 5] }).setLngLat([c.lng, c.lat]).addTo(m);
    });
    return () => markers.forEach((mk) => mk.remove());
  }, [callouts, styleLoaded]);

  // Zoom to the selected region's REAL polygon bounds when available — a
  // fixed zoom level looks fine for a small region (Greater Accra) and
  // leaves a large one (Western) as an off-screen blur of its own fill.
  // Falls back to a plain flyTo (e.g. boundaries not loaded yet) so this
  // never blocks camera movement.
  useEffect(() => {
    const m = map.current;
    if (!m || !flyTo) return;
    const geom = selectedRegion ? regionGeometryByName.current.get(selectedRegion) : undefined;
    if (geom) {
      const [sw, ne] = geometryBounds(geom);
      m.fitBounds([sw, ne], { padding: 48, duration: 1000, maxZoom: 11 });
    } else {
      m.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: 12, duration: 1000 });
    }
  }, [flyTo, selectedRegion]);

  // Fit both endpoints (e.g. a region and its nearest intact-forest target)
  // in view, instead of a fixed zoom that can leave a 100+ km-away marker
  // off-screen. Takes priority over flyTo when provided.
  useEffect(() => {
    if (!map.current || !flyToBounds) return;
    const [a, b] = flyToBounds;
    map.current.fitBounds(
      [
        [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat)],
        [Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)],
      ],
      { padding: 80, duration: 1000, maxZoom: 11 },
    );
  }, [flyToBounds]);

  return <div ref={mapContainer} className="w-full h-full" />;
}
