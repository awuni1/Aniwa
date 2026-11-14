"use client";

// Building blocks for the dashboard overview: KPI cards with icon tiles and
// change badges, a trend chart, a ranked bar list, mini bar-chart cards and
// an action card. All values are passed in from live data by the page.

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, ArrowRight, ChevronRight } from "lucide-react";

export const CARD = "rounded-[20px] border border-white/[0.06] bg-[#0f172a]/80 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_12px_32px_-16px_rgba(0,0,0,0.6)]";

type Tone = "red" | "orange" | "rose" | "emerald" | "amber" | "sky" | "violet";
const TONE: Record<Tone, { tile: string; icon: string; bar: string }> = {
  red: { tile: "bg-red-500/15", icon: "text-red-400", bar: "bg-red-400" },
  orange: { tile: "bg-orange-500/15", icon: "text-orange-400", bar: "bg-orange-400" },
  rose: { tile: "bg-rose-500/15", icon: "text-rose-400", bar: "bg-rose-400" },
  emerald: { tile: "bg-emerald-500/15", icon: "text-emerald-400", bar: "bg-emerald-400" },
  amber: { tile: "bg-amber-500/15", icon: "text-amber-300", bar: "bg-amber-300" },
  sky: { tile: "bg-sky-500/15", icon: "text-sky-400", bar: "bg-sky-400" },
  violet: { tile: "bg-violet-500/15", icon: "text-violet-400", bar: "bg-violet-400" },
};

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("en-GH", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function IconTile({ icon: Icon, tone, size = 40 }: { icon: LucideIcon; tone: Tone; size?: number }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl ${TONE[tone].tile}`} style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.48)} className={TONE[tone].icon} />
    </span>
  );
}

// A change badge. `worse` says whether this direction is bad news (more
// forest loss is bad; fewer fires is good), which picks red or green.
export function Delta({ text, up, worse }: { text: string; up: boolean; worse: boolean }) {
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
        worse ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"
      }`}
    >
      <Arrow size={12} />
      {text}
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`block animate-pulse rounded-md bg-white/[0.07] ${className}`} />;
}

export function KpiCard({
  icon,
  tone,
  label,
  value,
  unit,
  delta,
  caption,
  onClick,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  value: string | null;
  unit?: string;
  delta?: React.ReactNode;
  caption?: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={`${CARD} flex w-full items-center gap-3 px-4 py-3.5 text-left transition duration-150 hover:border-white/15 hover:bg-[#111a2e]/90 active:scale-[0.99] motion-reduce:transform-none`}>
      <IconTile icon={icon} tone={tone} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] text-white/50">{label}</span>
        {value === null ? (
          <Skeleton className="mt-1.5 h-5 w-20" />
        ) : (
          <span className="mt-0.5 block text-xl font-semibold tracking-tight tabular-nums">
            {value}
            {unit && <span className="ml-1 text-xs font-normal text-white/55">{unit}</span>}
          </span>
        )}
        {caption && <span className="mt-0.5 block truncate text-[11px] text-white/55">{caption}</span>}
      </span>
      {delta && <span className="shrink-0">{delta}</span>}
      {onClick && <ChevronRight size={18} className="shrink-0 text-white/40" aria-hidden="true" />}
    </button>
  );
}

// Counts up to a number when it first appears (skipped with reduced motion).
export function CountUp({ value, digits = 0, durationMs = 900 }: { value: number; digits?: number; durationMs?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      const id = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(id);
    }
    const start = performance.now();
    const begin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setShown(begin + (value - begin) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);
  return <>{fmt(shown, digits)}</>;
}

// Area chart of a yearly series. The latest value is called out; hovering
// (or focusing and using the arrow keys) shows any year's exact figure.
export function TrendCard({
  title,
  rangeLabel,
  series,
  unit,
}: {
  title: string;
  rangeLabel: string;
  series: { year: number; value: number }[];
  unit: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320;
  const H = 150;
  const pad = { l: 34, r: 10, t: 14, b: 22 };
  const max = Math.max(...series.map((d) => d.value), 1);
  const niceMax = Math.ceil(max / 50) * 50;
  const x = (i: number) => pad.l + (i / Math.max(series.length - 1, 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / niceMax) * (H - pad.t - pad.b);
  const line = series.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = series.length ? `${line} L${x(series.length - 1).toFixed(1)},${H - pad.b} L${x(0).toFixed(1)},${H - pad.b} Z` : "";
  const lastIndex = series.length - 1;
  const shownIndex = hover ?? lastIndex;
  const shown = series[shownIndex];
  const ticks = [0, 0.5, 1].map((f) => niceMax * f);
  const yearTicks = series.filter((d) => d.year % 5 === 0);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * lastIndex);
    setHover(Math.min(lastIndex, Math.max(0, i)));
  };
  const onKey = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setHover((h) => Math.min(lastIndex, Math.max(0, (h ?? lastIndex) + (e.key === "ArrowRight" ? 1 : -1))));
  };

  return (
    <section className={`${CARD} p-4`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-medium text-white/90">{title}</h2>
        <span className="rounded-lg border border-white/10 px-2 py-0.5 text-[11px] text-white/60">{rangeLabel}</span>
      </div>
      {series.length === 0 ? (
        <Skeleton className="h-[150px] w-full" />
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none outline-none"
          role="img"
          tabIndex={0}
          aria-label={`${title}. Use the arrow keys to read each year. ${series.map((d) => `${d.year}: ${fmt(d.value)} ${unit}`).join(", ")}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
        >
          <defs>
            <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#f97316" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.06)" />
              <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="rgba(255,255,255,0.55)">
                {fmt(t)}
              </text>
            </g>
          ))}
          {yearTicks.map((d) => (
            <text key={d.year} x={x(series.indexOf(d))} y={H - 6} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.55)">
              {d.year}
            </text>
          ))}
          <path d={area} fill="url(#trend-fill)" />
          <path d={line} fill="none" stroke="#fb923c" strokeWidth="2" strokeLinejoin="round" />
          {hover !== null && (
            <line x1={x(shownIndex)} x2={x(shownIndex)} y1={pad.t} y2={H - pad.b} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3" />
          )}
          <circle cx={x(shownIndex)} cy={y(shown.value)} r="4" fill="#fb923c" stroke="#0f172a" strokeWidth="2" />
          <g transform={`translate(${Math.min(Math.max(x(shownIndex) - 38, 2), W - 78)},${Math.max(y(shown.value) - 28, 2)})`}>
            <rect width="76" height="20" rx="6" fill="#ea580c" />
            <text x="38" y="13.5" textAnchor="middle" fontSize="10" fontWeight="600" fill="#fff">
              {hover !== null ? `${shown.year} · ` : ""}
              {fmt(shown.value)} {unit}
            </text>
          </g>
        </svg>
      )}
    </section>
  );
}

export function RankedBars({
  title,
  caption,
  items,
}: {
  title: string;
  caption?: string;
  items: { label: string; value: number; display: string; icon: LucideIcon; tone: Tone }[];
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <section className={`${CARD} p-4`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-medium text-white/90">{title}</h2>
        {caption && <span className="rounded-lg border border-white/10 px-2 py-0.5 text-[11px] text-white/50">{caption}</span>}
      </div>
      {items.length === 0 ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {items.map((it) => (
            <li key={it.label} className="flex items-center gap-2.5">
              <IconTile icon={it.icon} tone={it.tone} size={26} />
              <span className="w-[7.5rem] shrink-0 truncate text-xs text-white/80" title={it.label}>
                {it.label}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <span className={`block h-full rounded-full ${TONE[it.tone].bar}`} style={{ width: `${Math.max((it.value / max) * 100, 2)}%` }} />
              </span>
              <span className="w-14 shrink-0 text-right text-xs tabular-nums text-white/70">{it.display}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MiniCard({
  icon,
  tone,
  label,
  value,
  unit,
  bars,
  delta,
  caption,
  onClick,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  value: string | null;
  unit?: string;
  bars: number[];
  delta?: React.ReactNode;
  caption?: string;
  onClick?: () => void;
}) {
  const max = Math.max(...bars, 1);
  return (
    <button type="button" onClick={onClick} className={`${CARD} flex min-w-0 flex-col p-4 text-left transition duration-150 hover:border-white/15 hover:bg-[#111a2e]/90 active:scale-[0.99] motion-reduce:transform-none`}>
      <span className="flex items-center gap-2 text-[11px] text-white/55">
        <IconTile icon={icon} tone={tone} size={24} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {onClick && <ChevronRight size={16} className="shrink-0 text-white/40" aria-hidden="true" />}
      </span>
      {value === null ? (
        <Skeleton className="mt-3 h-7 w-24" />
      ) : (
        <span className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
          {value}
          {unit && <span className="ml-1 text-xs font-normal text-white/55">{unit}</span>}
        </span>
      )}
      <span className="mt-3 flex h-10 items-end gap-[3px]" aria-hidden="true">
        {bars.map((b, i) => (
          <span
            key={i}
            className={`flex-1 rounded-sm ${TONE[tone].bar}`}
            style={{ height: `${Math.max((b / max) * 100, 6)}%`, opacity: 0.35 + 0.65 * ((i + 1) / bars.length) }}
          />
        ))}
      </span>
      {(delta || caption) && (
        <span className="mt-3 flex items-center gap-2">
          {delta}
          {caption && <span className="truncate text-[11px] text-white/55">{caption}</span>}
        </span>
      )}
    </button>
  );
}

export function ActionCard({ title, body, cta, onClick, icon: Icon }: { title: string; body: string; cta: string; onClick: () => void; icon: LucideIcon }) {
  return (
    <section className="relative flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.16] via-[#0f172a]/90 to-[#0f172a]/90 p-4">
      <Icon size={96} className="pointer-events-none absolute -right-4 -bottom-4 text-emerald-400/10" aria-hidden="true" />
      <h2 className="text-[15px] font-semibold leading-snug">{title}</h2>
      <p className="mt-1.5 text-[11px] leading-relaxed text-white/60">{body}</p>
      <button
        type="button"
        onClick={onClick}
        className="mt-auto inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-500 px-3.5 py-1.5 text-xs font-medium text-[#04130c] transition hover:brightness-110"
      >
        {cta} <ArrowRight size={13} />
      </button>
    </section>
  );
}
