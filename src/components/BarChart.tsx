"use client";

import { useEffect, useState } from "react";

export interface Bar {
  label: string; // shown on hover, and on the axis for the first/last bar
  value: number;
  projected?: boolean; // drawn faded and dashed — a projection, not data
}

interface BarChartProps {
  data: Bar[];
  color: string;
  height?: number;
  formatValue?: (n: number) => string;
  ariaLabel: string;
}

// Inline SVG bar chart, no charting dependency. Bars grow in on mount so a
// tab switch reads as fresh data rather than a static picture.
export default function BarChart({ data, color, height = 96, formatValue = (n) => n.toFixed(0), ariaLabel }: BarChartProps) {
  const [grown, setGrown] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const max = Math.max(...data.map((d) => d.value), 1);
  const gap = 2;
  const width = 300;
  const barW = (width - gap * (data.length - 1)) / Math.max(data.length, 1);
  const shown = hover !== null ? data[hover] : null;

  return (
    <div>
      <div className="flex h-4 items-center justify-end text-[11px] tabular-nums text-white/60">
        {shown && (
          <span>
            {shown.label}: <span className="text-white">{formatValue(shown.value)}</span>
            {shown.projected && <span className="text-white/55"> (projected)</span>}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 2);
          const x = i * (barW + gap);
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)}>
              <rect x={x} y={0} width={barW + gap} height={height} fill="transparent" />
              <rect
                x={x}
                y={height - h}
                width={barW}
                height={Math.max(h, 0.5)}
                rx={Math.min(2, barW / 3)}
                fill={color}
                fillOpacity={d.projected ? 0.25 : hover === i ? 1 : 0.8}
                stroke={d.projected ? color : "none"}
                strokeDasharray={d.projected ? "2 2" : undefined}
                strokeWidth={d.projected ? 0.8 : 0}
                style={{
                  transformOrigin: `${x + barW / 2}px ${height}px`,
                  transform: grown ? "scaleY(1)" : "scaleY(0)",
                  transition: `transform 600ms cubic-bezier(.2,.8,.2,1) ${i * 12}ms`,
                }}
              >
                <title>{`${d.label}: ${formatValue(d.value)}${d.projected ? " (projected)" : ""}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-white/50">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}
