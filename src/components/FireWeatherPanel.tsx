"use client";

import { useEffect, useState } from "react";
import { ThermometerSun, Info } from "lucide-react";
import {
  FIRE_INDEX_ELEVATED,
  FIRE_INDEX_HIGH,
  fetchFireWeather,
  fireWeatherLevel,
  type FireWeatherLevel,
  type FireWeatherResponse,
} from "@/lib/fireWeather";

const LEVEL_STYLE: Record<FireWeatherLevel, { label: string; chip: string; cell: string }> = {
  high: { label: "High", chip: "bg-red-500/15 text-red-300 border-red-500/30", cell: "bg-red-500/25 text-red-200" },
  elevated: { label: "Elevated", chip: "bg-amber-500/15 text-amber-300 border-amber-500/30", cell: "bg-amber-500/20 text-amber-200" },
  low: { label: "Low", chip: "bg-white/5 text-white/50 border-white/10", cell: "bg-white/[0.04] text-white/50" },
};

function dayName(iso: string, i: number): string {
  if (i === 0) return "Today";
  if (i === 1) return "Tmrw";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GH", { weekday: "short", timeZone: "UTC" });
}

interface Props {
  onFocus: (point: { lat: number; lng: number }, region?: string) => void;
}

export default function FireWeatherPanel({ onFocus }: Props) {
  const [data, setData] = useState<FireWeatherResponse | null>(null);
  const [showMethodology, setShowMethodology] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchFireWeather()
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData({ available: false, error: "Fire-weather forecast is unavailable right now" }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="px-4 py-4">
      <div className="mb-1 flex items-center gap-2">
        <ThermometerSun size={14} className="text-orange-400" />
        <p className="text-[11px] font-medium text-white/50">Fire weather, next 3 days</p>
      </div>
      <p className="mb-3 text-[11px] text-white/55">Forest fire index for each forest-belt region. Click a region to see it on the map.</p>

      {!data && <p className="text-[11px] text-white/55">Loading forecast…</p>}
      {data && !data.available && <p className="text-[11px] text-white/55">{data.error}</p>}

      {data?.available && (
        <ul className="space-y-1.5">
          {data.regions.map((r) => {
            const style = LEVEL_STYLE[r.level];
            return (
              <li key={r.region}>
                <button
                  type="button"
                  onClick={() => onFocus({ lat: r.lat, lng: r.lng }, r.region)}
                  className="flex w-full items-center gap-3 border border-white/10 px-3 py-2 text-left transition-colors hover:border-white/25 rounded-xl"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-white/85">{r.region}</span>
                    <span className={`mt-0.5 inline-block rounded border px-1.5 text-[11px] ${style.chip}`}>{style.label}</span>
                  </span>
                  <span className="flex gap-1">
                    {r.days.map((d, i) => {
                      const cell = LEVEL_STYLE[fireWeatherLevel(d.fireIndex)].cell;
                      return (
                        <span
                          key={d.date}
                          className={`flex w-11 flex-col items-center rounded py-1 tabular-nums ${cell}`}
                          title={`${d.date}: index ${d.fireIndex ?? "n/a"}, max ${d.tMaxC ?? "?"}°C, rain ${d.precipMm ?? "?"} mm, gusts ${d.gustMs ?? "?"} m/s, min humidity ${d.rhMinPct ?? "?"}%`}
                        >
                          <span className="text-[11px] opacity-70">{dayName(d.date, i)}</span>
                          <span className="text-[11px] font-medium">{d.fireIndex === null ? "–" : d.fireIndex.toFixed(1)}</span>
                        </span>
                      );
                    })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setShowMethodology((s) => !s)}
        className="mt-3 flex items-center gap-1.5 text-[11px] text-white/55 transition-colors hover:text-white/70"
      >
        <Info size={11} /> {showMethodology ? "Hide" : "How this works"}
      </button>
      {showMethodology && (
        <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-white/50">
          <li>
            Meteomatics&apos; forest fire index runs from 0 to 1 and is based on soil moisture. Meteomatics says risk rises
            above {FIRE_INDEX_ELEVATED}; Aniwa marks {FIRE_INDEX_HIGH} and above as high. That cut-off is our choice.
          </li>
          <li>Each region is one representative point, not the whole region. Hover a day for temperature, rain, wind and humidity.</li>
          <li>This is weather that makes fires easier to start and spread. It is not evidence that anyone is clearing forest.</li>
          <li>Source: Meteomatics Weather API, refreshed at most once an hour.</li>
        </ul>
      )}
    </div>
  );
}
