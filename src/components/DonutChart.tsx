"use client";

import { useRef, useState } from "react";

export interface DonutDatum {
  label: string;
  value: number;
  note?: string; // shown under the legend row, e.g. "includes logging, wildfire"
}

interface DonutChartProps {
  data: DonutDatum[];
  colors: string[]; // fixed-order hex, one per datum
  size?: number;
  thickness?: number;
  unit?: string;
  formatValue?: (n: number) => string;
  centerCaption?: string;
}

const DEFAULT_FORMAT = (n: number) => n.toLocaleString("en-GH", { maximumFractionDigits: 1 });

// Inline SVG donut — no charting dependency. Click a legend row (or the ring
// segment itself) to toggle it off; the remaining slices re-scale to fill the
// ring. Hover/focus either the ring or the legend to see the exact value —
// the legend always shows every real number too, so nothing is tooltip-only.
export default function DonutChart({
  data,
  colors,
  size = 168,
  thickness = 26,
  unit = "",
  formatValue = DEFAULT_FORMAT,
  centerCaption,
}: DonutChartProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const visibleTotal = data.reduce((s, d) => (hidden.has(d.label) ? s : s + d.value), 0);

  const c = size / 2;
  const radius = c - thickness / 2 - 2;
  const circumference = 2 * Math.PI * radius;
  const gapLen = 3;

  // Prefix sums computed as a separate pass (rather than a mutated running
  // total inside .map) so this stays a pure render-time computation.
  const percents = data.map((d) => (hidden.has(d.label) || visibleTotal === 0 ? 0 : d.value / visibleTotal));
  const cumulativePercents = percents.reduce<number[]>((arr, p, i) => {
    arr.push((i === 0 ? 0 : arr[i - 1]) + p);
    return arr;
  }, []);
  const segments = data.map((d, i) => {
    const color = colors[i % colors.length];
    const isHidden = hidden.has(d.label);
    const percent = percents[i];
    const dash = Math.max(percent * circumference - gapLen, 0);
    const offset = -(i === 0 ? 0 : cumulativePercents[i - 1]) * circumference;
    return { ...d, color, isHidden, percent, dash, offset };
  });

  function toggle(label: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        if (data.length - next.size <= 1) return prev; // always keep >=1 slice visible
        next.add(label);
      }
      return next;
    });
  }

  function showTooltip(clientX: number, clientY: number, label: string) {
    setHovered(label);
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setTooltipPos({ x: clientX - rect.left, y: clientY - rect.top });
  }
  function hideTooltip() {
    setHovered(null);
    setTooltipPos(null);
  }

  const hoveredDatum = segments.find((s) => s.label === hovered);

  return (
    <div ref={containerRef} className="relative flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <g transform={`rotate(-90 ${c} ${c})`}>
          <circle cx={c} cy={c} r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={thickness} />
          {segments.map((s) =>
            s.isHidden || s.value <= 0 ? null : (
              <circle
                key={s.label}
                cx={c}
                cy={c}
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${s.dash} ${Math.max(circumference - s.dash, 0)}`}
                strokeDashoffset={s.offset}
                strokeLinecap="butt"
                opacity={hovered && hovered !== s.label ? 0.45 : 1}
                tabIndex={0}
                role="img"
                aria-label={`${s.label}: ${formatValue(s.value)} ${unit}, ${(s.percent * 100).toFixed(1)}%`}
                style={{ cursor: "pointer", transition: "opacity 120ms" }}
                onMouseMove={(e) => showTooltip(e.clientX, e.clientY, s.label)}
                onMouseLeave={hideTooltip}
                onFocus={(e) => {
                  const rect = (e.target as SVGCircleElement).getBoundingClientRect();
                  showTooltip(rect.left + rect.width / 2, rect.top, s.label);
                }}
                onBlur={hideTooltip}
                onClick={() => toggle(s.label)}
              />
            ),
          )}
        </g>
        <foreignObject x={c - radius * 0.62} y={c - radius * 0.62} width={radius * 1.24} height={radius * 1.24}>
          <div className="w-full h-full flex flex-col items-center justify-center text-center">
            <span className="text-white text-base font-semibold leading-none">{formatValue(visibleTotal)}</span>
            <span className="text-white/55 text-[11px] font-medium mt-1">{centerCaption ?? unit}</span>
          </div>
        </foreignObject>
      </svg>

      <div className="flex-1 min-w-0 space-y-1">
        {segments.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => toggle(s.label)}
            onMouseEnter={(e) => showTooltip(e.clientX, e.clientY, s.label)}
            onMouseLeave={hideTooltip}
            onFocus={(e) => showTooltip(e.currentTarget.getBoundingClientRect().left, e.currentTarget.getBoundingClientRect().top, s.label)}
            onBlur={hideTooltip}
            className={`w-full flex items-start justify-between gap-2 text-left px-1 py-0.5 transition-opacity ${
              s.isHidden ? "opacity-35" : hovered && hovered !== s.label ? "opacity-60" : "opacity-100"
            }`}
          >
            <span className="flex items-start gap-1.5 min-w-0">
              <span className="w-2.5 h-2.5 shrink-0 mt-0.5" style={{ backgroundColor: s.color }} />
              <span className="min-w-0">
                <span className="block text-[11px] text-white/70 truncate" title={s.label}>{s.label}</span>
                {s.note && <span className="block text-[11px] text-white/50 leading-tight">{s.note}</span>}
              </span>
            </span>
            <span className="text-[11px] text-white/55 tabular-nums shrink-0">
              {formatValue(s.value)} {unit}
            </span>
          </button>
        ))}
      </div>

      {hoveredDatum && tooltipPos && (
        <div
          className="pointer-events-none absolute z-10 px-2.5 py-1.5 bg-gray-900 border border-white/15 shadow-lg"
          style={{ left: Math.min(Math.max(tooltipPos.x + 12, 0), size + 140), top: Math.max(tooltipPos.y - 36, 0) }}
        >
          <p className="text-white text-[12px] font-semibold tabular-nums leading-none whitespace-nowrap">
            {formatValue(hoveredDatum.value)} {unit}
          </p>
          <p className="text-white/50 text-[11px] mt-1 whitespace-nowrap">
            {hoveredDatum.label} · {(hoveredDatum.percent * 100).toFixed(1)}%
          </p>
        </div>
      )}
    </div>
  );
}
