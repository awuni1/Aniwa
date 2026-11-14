"use client";

// A light version of Aniwa's map for the public preview: Ghana's 16 regions
// shaded by real tree-cover loss (Global Forest Watch) and the last 5 days of
// NASA fires. The full dashboard map adds predictions, satellite checks,
// chainsaw detections and restoration sites.

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export interface PublicFire {
  lat: number;
  lng: number;
  forest: boolean;
}

const GHANA_BOUNDS: [[number, number], [number, number]] = [[-3.3, 4.7], [1.2, 11.2]];

// Light red (little loss) to deep red (most loss).
function lossColor(t: number): string {
  const light = [254, 202, 202];
  const deep = [127, 29, 29];
  const rgb = light.map((c, i) => Math.round(c + (deep[i] - c) * Math.min(Math.max(t, 0), 1)));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

export default function PublicMap({ lossByRegion, fires }: { lossByRegion: Record<string, number>; fires: PublicFire[] }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!container.current) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {
          esri: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            attribution: "Tiles &copy; Esri",
          },
        },
        layers: [{ id: "esri", type: "raster", source: "esri" }],
      },
      bounds: GHANA_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      maxZoom: 13,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => setReady(true));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      setReady(false);
    };
  }, []);

  // Regions shaded by loss since 2001.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || Object.keys(lossByRegion).length === 0) return;
    let cancelled = false;
    const max = Math.max(...Object.values(lossByRegion), 1);
    fetch("/ghana_regions.geojson")
      .then((r) => r.json())
      .then((geo: GeoJSON.FeatureCollection) => {
        if (cancelled || !map.current) return;
        for (const f of geo.features) {
          const name = String(f.properties?.shapeName ?? "").replace(/\s+Region$/i, "");
          f.properties = { ...f.properties, region: name, color: lossColor((lossByRegion[name] ?? 0) / max) };
        }
        for (const id of ["regions-line", "regions-fill"]) if (m.getLayer(id)) m.removeLayer(id);
        if (m.getSource("regions")) m.removeSource("regions");
        m.addSource("regions", { type: "geojson", data: geo });
        m.addLayer({ id: "regions-fill", type: "fill", source: "regions", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.55 } });
        m.addLayer({ id: "regions-line", type: "line", source: "regions", paint: { "line-color": "#ffffff", "line-width": 0.75, "line-opacity": 0.5 } });
        // Keep fires on top if they were drawn first.
        if (m.getLayer("fires")) m.moveLayer("fires");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lossByRegion, ready]);

  // NASA fires: forest-region fires orange, savanna fires small and yellow.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    if (m.getLayer("fires")) m.removeLayer("fires");
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
      id: "fires",
      type: "circle",
      source: "fires",
      paint: {
        "circle-radius": ["case", ["get", "forest"], 4, 2.5],
        "circle-color": ["case", ["get", "forest"], "#f97316", "#facc15"],
        "circle-opacity": ["case", ["get", "forest"], 1, 0.55],
        "circle-stroke-color": "#7c2d12",
        "circle-stroke-width": ["case", ["get", "forest"], 1, 0],
      },
    });
  }, [fires, ready]);

  return <div ref={container} className="h-full w-full" role="region" aria-label="Map of Ghana's regions shaded by tree-cover loss, with NASA fires" />;
}
