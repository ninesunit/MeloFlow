"use client";

import { useState } from "react";

export interface Bar {
  label: string;
  value: number;
  /** Secondary value shown in the tooltip, e.g. kWh. */
  sub?: string;
  tone?: "normal" | "alert" | "forecast";
}

const TONES = {
  normal: "var(--color-violet)",
  alert: "var(--color-pending)",
  forecast: "transparent",
};

/** Lightweight bar chart (no chart library), with a value readout on hover/tap. */
export function BarChart({ bars, format, height = 180, average }: { bars: Bar[]; format: (n: number) => string; height?: number; average?: number | null }) {
  const [active, setActive] = useState<number | null>(null);
  if (bars.length === 0) return null;
  const max = Math.max(...bars.map((b) => b.value), average ?? 0) * 1.12 || 1;
  const w = 100 / bars.length;
  const shown = active ?? bars.length - 1;

  return (
    <figure>
      <figcaption className="mb-2 flex items-baseline justify-between text-sm">
        <span className="text-ink-soft">{bars[shown].label}</span>
        <span className="num font-semibold">
          {format(bars[shown].value)}
          {bars[shown].sub && <span className="ml-2 font-normal text-ink-soft">{bars[shown].sub}</span>}
        </span>
      </figcaption>
      <div className="relative" style={{ height }}>
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label="Monthly bills chart">
          {average != null && average > 0 && (
            <line x1={0} x2={100} y1={height - (average / max) * height} y2={height - (average / max) * height} stroke="var(--color-ink-faint)" strokeDasharray="1.5 1.5" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
          )}
          {bars.map((b, i) => {
            const h = Math.max(1, (b.value / max) * height);
            const tone = b.tone ?? "normal";
            return (
              <rect
                key={i}
                x={i * w + w * 0.18}
                y={height - h}
                width={w * 0.64}
                height={h}
                rx={1}
                fill={TONES[tone]}
                stroke={tone === "forecast" ? "var(--color-violet)" : "none"}
                strokeDasharray={tone === "forecast" ? "3 2" : undefined}
                strokeWidth={tone === "forecast" ? 1.2 : 0}
                vectorEffect="non-scaling-stroke"
                opacity={active === null || active === i ? 1 : 0.55}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex">
          {bars.map((b, i) => (
            <button
              key={i}
              className="h-full flex-1 focus-visible:outline-offset-[-2px]"
              aria-label={`${b.label}: ${format(b.value)}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(i)}
            />
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex text-[0.7rem] text-ink-faint">
        {bars.map((b, i) => (
          <span key={i} className="flex-1 truncate text-center">
            {bars.length > 8 && i % 2 === 1 ? "" : b.label.split(" ")[0]}
          </span>
        ))}
      </div>
    </figure>
  );
}
