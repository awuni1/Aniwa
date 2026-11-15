"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { GHANA_PLACES as GHANA_PLACES_SOURCE } from "@/lib/ghanaPlaces";
import type { GeocodeResult } from "@/app/api/geocode/route";

// Regional capitals + notable towns spanning all of Ghana — shown instantly
// (no network call) while the box is empty or barely typed-in.
const GHANA_PLACES: Array<{ name: string; lng: number; lat: number; note?: string }> = GHANA_PLACES_SOURCE.map(
  (p) => ({ name: p.name, lng: p.lng, lat: p.lat, note: p.region }),
);

interface MapSearchProps {
  onSelect: (place: {
    name: string;
    lng: number;
    lat: number;
    // "place" = town from the list (fly-to only, don't infer);
    // "coord" = user pasted a lat/lng (run inference immediately).
    type: "place" | "coord";
  }) => void;
}

interface ResultItem {
  name: string;
  lat: number;
  lng: number;
  note?: string;
  source: "built-in" | "live";
}

export default function MapSearch({ onSelect }: MapSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [liveResults, setLiveResults] = useState<GeocodeResult[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse "lat, lng" or "lat lng", accepts signed decimals. Returns null if not a coordinate pair.
  const parsedCoord = useMemo(() => {
    const q = query.trim();
    const m = q.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
  }, [query]);

  // Any real place in Ghana via OpenStreetMap's free Nominatim geocoder —
  // not just the ~24 hardcoded towns. Debounced so typing doesn't fire a
  // request per keystroke (Nominatim's usage policy caps at ~1 req/sec).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3 || parsedCoord) {
      setLiveResults([]);
      return;
    }
    setLiveLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const data: { results: GeocodeResult[] } = await res.json();
        setLiveResults(data.results ?? []);
      } finally {
        setLiveLoading(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [query, parsedCoord]);

  const results = useMemo((): ResultItem[] => {
    const q = query.trim().toLowerCase();
    const builtIn: ResultItem[] = (
      q
        ? GHANA_PLACES.filter((p) => p.name.toLowerCase().includes(q) || p.note?.toLowerCase().includes(q))
        : GHANA_PLACES.slice(0, 6)
    ).map((p) => ({ name: p.name, lat: p.lat, lng: p.lng, note: p.note, source: "built-in" as const }));

    const seen = new Set(builtIn.map((p) => p.name.toLowerCase()));
    const live: ResultItem[] = liveResults
      .filter((r) => !seen.has(r.name.toLowerCase()))
      .map((r) => ({ name: r.name, lat: r.lat, lng: r.lng, note: r.type, source: "live" as const }));

    return [...builtIn, ...live].slice(0, 8);
  }, [query, liveResults]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, []);

  function choose(p: ResultItem) {
    onSelect({ name: p.name, lng: p.lng, lat: p.lat, type: "place" });
    setQuery(p.name);
    setOpen(false);
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (parsedCoord) {
        onSelect({
          name: `${parsedCoord.lat.toFixed(4)}, ${parsedCoord.lng.toFixed(4)}`,
          ...parsedCoord,
          type: "coord",
        });
        setOpen(false);
      } else if (results[activeIndex]) {
        choose(results[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative w-72 md:w-96 font-mono pointer-events-auto">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/55 pointer-events-none" />
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        placeholder="Search a place in Ghana, or lat, lng"
        aria-label="Search a place in Ghana or enter coordinates (lat, lng)"
        className="w-full rounded-lg bg-gray-900/95 backdrop-blur border border-white/25 pl-9 pr-3 py-2.5 text-sm text-white placeholder-white/50 focus:outline-none focus:border-emerald-400/60 transition-colors shadow-lg"
      />

      {open && parsedCoord && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-lg bg-gray-900/95 backdrop-blur border border-white/15 overflow-hidden z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <span className="text-[11px] font-medium text-white/50">
              Coordinate · Parsed
            </span>
            <span className="text-[11px] text-white/50">⏎</span>
          </div>
          <button
            onClick={() => {
              onSelect({
                name: `${parsedCoord.lat.toFixed(4)}, ${parsedCoord.lng.toFixed(4)}`,
                ...parsedCoord,
                type: "coord",
              });
              setOpen(false);
            }}
            className="w-full text-left px-3 py-2.5 hover:bg-white/5 transition-colors"
          >
            <div className="text-sm text-white tabular-nums">
              {parsedCoord.lat.toFixed(4)}, {parsedCoord.lng.toFixed(4)}
            </div>
            <div className="text-[11px] font-medium text-white/55 mt-0.5">
              Goto · Run Inference
            </div>
          </button>
        </div>
      )}

      {open && !parsedCoord && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-lg bg-gray-900/95 backdrop-blur border border-white/15 overflow-hidden z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <span className="text-[11px] font-medium text-white/50">Places</span>
            <span className="text-[11px] tabular-nums text-white/50">
              {liveLoading ? "searching…" : `${String(results.length).padStart(2, "0")} found`}
            </span>
          </div>
          <ul className="divide-y divide-white/5">
            {results.map((p, i) => (
              // Different places can share a name (e.g. two towns called Bremang), so the coordinates are part of the key.
              <li key={`${p.source}-${p.name}-${p.lat}-${p.lng}-${i}`}>
                <button
                  onClick={() => choose(p)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`w-full text-left px-3 py-2 transition-colors ${
                    i === activeIndex ? "bg-white/10" : "hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-white font-medium tracking-wide">
                      {p.name}
                    </span>
                    <span className="text-[11px] tabular-nums text-white/55">
                      {p.lat.toFixed(2)}, {p.lng.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 mt-0.5">
                    {p.note && <div className="text-[11px] text-white/50 truncate">{p.note}</div>}
                    {p.source === "live" && (
                      <span className="text-[11px] font-medium text-white/50 shrink-0">via OpenStreetMap</span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
