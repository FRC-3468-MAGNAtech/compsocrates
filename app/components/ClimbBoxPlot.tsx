"use client";

import { useMemo, useState } from "react";

type ClimbEntry = {
  teamNumber?: string;
  accuracy?: number;
  endgame?: {
    level?: string;
    result?: string;
    status?: string;
    attemptedClimb?: boolean;
  };
};

type PitClimbEstimate = {
  climbTimeEstimate?: number;
};

type BoxStats = {
  teamNumber: string;
  values: number[];
  q1: number;
  median: number;
  q3: number;
  whiskerLow: number;
  whiskerHigh: number;
  outliers: number[];
  successCount: number;
  attemptCount: number;
};

type ClimbBoxPlotProps = {
  entries: ClimbEntry[];
  teamNumbers: string[];
  accuracyThreshold?: number;
  pitData?: Record<string, PitClimbEstimate>;
  height?: number;
  className?: string;
};

const Y_MIN = 0;
const Y_MAX = 60;

function normalizeTeam(value: string | undefined) {
  return String(value || "").trim().replace(/[^0-9]/g, "");
}

function resolveClimbPoints(entry: ClimbEntry) {
  const raw = String(entry.endgame?.level || entry.endgame?.result || entry.endgame?.status || "")
    .trim()
    .toLowerCase();
  if (!raw || raw === "none" || raw === "failure" || raw === "failed") return 0;
  if (raw.includes("level 1") || raw.includes("level-1") || raw === "l1") return 10;
  if (raw.includes("level 2") || raw.includes("level-2") || raw === "l2") return 20;
  if (raw.includes("level 3") || raw.includes("level-3") || raw === "l3") return 30;
  return 0;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const weight = idx - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function buildBoxStats(values: number[], successCount: number, attemptCount: number, teamNumber: string): BoxStats {
  if (values.length === 0) {
    return {
      teamNumber,
      values,
      q1: 0,
      median: 0,
      q3: 0,
      whiskerLow: 0,
      whiskerHigh: 0,
      outliers: [],
      successCount,
      attemptCount,
    };
  }
  const q1 = percentile(values, 0.25);
  const median = percentile(values, 0.5);
  const q3 = percentile(values, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const sorted = [...values].sort((a, b) => a - b);
  const whiskerLow = sorted.find((v) => v >= lowerFence) ?? sorted[0];
  const whiskerHigh = [...sorted].reverse().find((v) => v <= upperFence) ?? sorted[sorted.length - 1];
  const outliers = sorted.filter((v) => v < lowerFence || v > upperFence);

  return {
    teamNumber,
    values,
    q1,
    median,
    q3,
    whiskerLow,
    whiskerHigh,
    outliers,
    successCount,
    attemptCount,
  };
}

function yToSvg(value: number, top: number, height: number) {
  const clamped = Math.max(Y_MIN, Math.min(Y_MAX, value));
  const ratio = (clamped - Y_MIN) / (Y_MAX - Y_MIN);
  return top + height - ratio * height;
}

export default function ClimbBoxPlot({
  entries,
  teamNumbers,
  accuracyThreshold,
  pitData = {},
  height = 320,
  className,
}: ClimbBoxPlotProps) {
  const [hoveredTeam, setHoveredTeam] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  const stats = useMemo(() => {
    const byTeam = new Map<string, { values: number[]; success: number; attempts: number }>();
    entries.forEach((entry) => {
      const team = normalizeTeam(entry.teamNumber);
      if (!team) return;
      if (typeof accuracyThreshold === "number") {
        const accuracy = typeof entry.accuracy === "number" ? entry.accuracy : NaN;
        if (!Number.isFinite(accuracy) || accuracy < accuracyThreshold) return;
      }
      if (!entry.endgame?.attemptedClimb) return;
      const points = resolveClimbPoints(entry);
      const bucket = byTeam.get(team) || { values: [], success: 0, attempts: 0 };
      bucket.values.push(points);
      bucket.attempts += 1;
      if (points > 0) bucket.success += 1;
      byTeam.set(team, bucket);
    });
    return teamNumbers.map((teamNumber) => {
      const normalized = normalizeTeam(teamNumber);
      const bucket = byTeam.get(normalized) || { values: [], success: 0, attempts: 0 };
      return buildBoxStats(bucket.values, bucket.success, bucket.attempts, normalized || teamNumber);
    });
  }, [entries, teamNumbers, accuracyThreshold]);

  const width = Math.max(240, teamNumbers.length * 120);
  const padding = { top: 20, right: 30, bottom: 40, left: 50 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const step = teamNumbers.length > 0 ? innerWidth / teamNumbers.length : innerWidth;
  const boxWidth = Math.min(48, step * 0.5);

  return (
    <div className={className}>
      <div className="relative overflow-x-auto">
        <svg
          width={width}
          height={height}
          className="block"
          onMouseLeave={() => {
            setHoveredTeam(null);
            setHoverPos(null);
          }}
        >
          {/* Y axis grid */}
          {Array.from({ length: 7 }).map((_, i) => {
            const value = i * 10;
            const y = yToSvg(value, padding.top, innerHeight);
            return (
              <g key={`y-${value}`}>
                <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#e5e7eb" strokeDasharray="4 4" />
                <text x={padding.left - 10} y={y + 4} fontSize={11} textAnchor="end" fill="#6b7280">
                  {value}
                </text>
              </g>
            );
          })}

          {/* X axis */}
          <line x1={padding.left} x2={width - padding.right} y1={padding.top + innerHeight} y2={padding.top + innerHeight} stroke="#9ca3af" />

          {stats.map((row, index) => {
            const xCenter = padding.left + step * index + step / 2;
            const boxLeft = xCenter - boxWidth / 2;
            const q1Y = yToSvg(row.q1, padding.top, innerHeight);
            const q3Y = yToSvg(row.q3, padding.top, innerHeight);
            const medianY = yToSvg(row.median, padding.top, innerHeight);
            const lowY = yToSvg(row.whiskerLow, padding.top, innerHeight);
            const highY = yToSvg(row.whiskerHigh, padding.top, innerHeight);
            const pitEstimate = pitData[row.teamNumber]?.climbTimeEstimate;

            return (
              <g key={`box-${row.teamNumber}`}>
                {/* whisker line */}
                <line x1={xCenter} x2={xCenter} y1={highY} y2={lowY} stroke="#6b7280" strokeWidth={2} />
                {/* whisker caps */}
                <line x1={xCenter - boxWidth * 0.35} x2={xCenter + boxWidth * 0.35} y1={highY} y2={highY} stroke="#6b7280" strokeWidth={2} />
                <line x1={xCenter - boxWidth * 0.35} x2={xCenter + boxWidth * 0.35} y1={lowY} y2={lowY} stroke="#6b7280" strokeWidth={2} />

                {/* box */}
                <rect
                  x={boxLeft}
                  y={q3Y}
                  width={boxWidth}
                  height={Math.max(4, q1Y - q3Y)}
                  fill="#fda4af"
                  stroke="#be123c"
                  strokeWidth={2}
                  onMouseEnter={() => setHoveredTeam(row.teamNumber)}
                  onMouseMove={(event) => {
                    const rect = (event.currentTarget.ownerSVGElement || event.currentTarget).getBoundingClientRect();
                    setHoverPos({ x: event.clientX - rect.left, y: event.clientY - rect.top });
                  }}
                />

                {/* median line */}
                <line x1={boxLeft} x2={boxLeft + boxWidth} y1={medianY} y2={medianY} stroke="#9f1239" strokeWidth={2} />

                {/* outliers */}
                {row.outliers.map((value, idx) => {
                  const y = yToSvg(value, padding.top, innerHeight);
                  return <circle key={`out-${row.teamNumber}-${idx}`} cx={xCenter} cy={y} r={3.5} fill="#ef4444" />;
                })}

                {/* x labels */}
                <text x={xCenter} y={padding.top + innerHeight + 22} fontSize={12} textAnchor="middle" fill="#374151">
                  {row.teamNumber || "—"}
                </text>

                {/* pit estimate label (optional) */}
                {typeof pitEstimate === "number" && (
                  <text x={xCenter} y={padding.top + innerHeight + 36} fontSize={10} textAnchor="middle" fill="#6b7280">
                    Pit: {pitEstimate.toFixed(0)}s
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {hoveredTeam && hoverPos && (
          <div
            className="absolute bg-white border border-gray-200 rounded px-3 py-2 text-xs shadow"
            style={{ left: hoverPos.x + 12, top: hoverPos.y + 12 }}
          >
            <div className="font-semibold text-gray-900">Team {hoveredTeam}</div>
            {(() => {
              const row = stats.find((item) => item.teamNumber === hoveredTeam);
              if (!row) return null;
              return (
                <>
                  <div className="text-gray-700">
                    Successful climbs: {row.successCount} / {row.attemptCount}
                  </div>
                  {typeof pitData[hoveredTeam]?.climbTimeEstimate === "number" && (
                    <div className="text-gray-700">
                      Pit climb time estimate: {pitData[hoveredTeam]?.climbTimeEstimate?.toFixed(1)}s
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
