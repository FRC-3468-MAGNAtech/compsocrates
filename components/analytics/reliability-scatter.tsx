"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { niceTicks } from "@/lib/analytics/chart";
import { isLowSample, type TeamReliability } from "@/lib/analytics/performance-reliability";

// Power (mean score) against consistency (standard deviation) as plain SVG on the theme tokens, one dot per team. The dots are
// keyboard-reachable buttons and the page prints the same numbers in a table, so nothing is chart-only.

const HEIGHT = 300;
const PAD = { top: 16, right: 20, bottom: 46, left: 52 };

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function ReliabilityScatter({
  teams,
  activeTeam,
  highlightedTeam,
  onSelect,
}: {
  teams: TeamReliability[];
  activeTeam: number | null;
  highlightedTeam: number | null;
  onSelect: (teamNumber: number) => void;
}) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const xTicks = useMemo(() => niceTicks(Math.max(...teams.map((t) => t.avgScore), 1)), [teams]);
  const yTicks = useMemo(() => niceTicks(Math.max(...teams.map((t) => t.stdDev), 1)), [teams]);
  const xMax = xTicks[xTicks.length - 1];
  const yMax = yTicks[yTicks.length - 1];
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (v: number) => PAD.left + (v / xMax) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;

  const shown = teams.find((t) => t.teamNumber === hover) ?? null;
  const flip = shown !== null && width > 0 && x(shown.avgScore) > width * 0.6;

  return (
    <div ref={wrapRef} className="relative w-full select-none">
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="group" aria-label={`Power versus consistency for ${teams.length} ${teams.length === 1 ? "team" : "teams"}. The table below lists the same numbers.`}>
          {yTicks.map((t) => (
            <g key={`y${t}`} aria-hidden>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--glass-border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted-foreground)" className="tabular-nums">
                {t}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={`x${t}`} x={x(t)} y={PAD.top + innerH + 16} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)" className="tabular-nums" aria-hidden>
              {t}
            </text>
          ))}
          <text x={PAD.left + innerW / 2} y={HEIGHT - 6} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)" aria-hidden>
            Average match score (power)
          </text>
          <text transform={`translate(12 ${PAD.top + innerH / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)" aria-hidden>
            Std dev of match scores (consistency)
          </text>

          {teams.map((t) => {
            const active = t.teamNumber === activeTeam;
            const highlighted = t.teamNumber === highlightedTeam;
            const cx = x(t.avgScore);
            const cy = y(t.stdDev);
            return (
              <g
                key={t.teamNumber}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                aria-label={`Team ${t.teamNumber}: power ${t.avgScore.toFixed(1)}, consistency ${t.stdDev.toFixed(1)}, ${t.entriesCount} ${t.entriesCount === 1 ? "match" : "matches"}`}
                className="cursor-pointer outline-none [&:focus-visible>.ring]:opacity-100"
                onClick={() => onSelect(t.teamNumber)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(t.teamNumber);
                  }
                }}
                onPointerEnter={() => setHover(t.teamNumber)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(t.teamNumber)}
                onBlur={() => setHover(null)}
              >
                {/* 44px touch target */}
                <circle cx={cx} cy={cy} r={22} fill="transparent" />
                <circle className="ring opacity-0" cx={cx} cy={cy} r={11} fill="none" stroke="var(--color-primary)" strokeWidth={2} />
                <circle
                  cx={cx}
                  cy={cy}
                  r={active ? 7 : 5.5}
                  fill={active ? "var(--color-primary)" : "var(--color-accent)"}
                  fillOpacity={isLowSample(t.entriesCount) && !active ? 0.55 : 1}
                  stroke={highlighted ? "var(--foreground)" : "var(--background)"}
                  strokeWidth={highlighted ? 2.5 : 2}
                />
              </g>
            );
          })}
        </svg>
      )}

      {shown && (
        <div
          role="status"
          className="glass-overlay pointer-events-none absolute z-10 w-44 rounded-xl p-3 text-xs shadow-xl"
          style={{ top: PAD.top, left: flip ? undefined : x(shown.avgScore) + 14, right: flip ? width - x(shown.avgScore) + 14 : undefined }}
        >
          <div className="font-semibold">Team {shown.teamNumber}</div>
          <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[var(--muted-foreground)]">
            <dt>Power</dt>
            <dd className="tabular-nums text-[var(--foreground)]">{shown.avgScore.toFixed(1)}</dd>
            <dt>Consistency</dt>
            <dd className="tabular-nums text-[var(--foreground)]">{shown.stdDev.toFixed(1)}</dd>
            <dt>Matches</dt>
            <dd className="tabular-nums text-[var(--foreground)]">{shown.entriesCount}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
