"use client";

import { CLIMB_AXIS_MAX, CLIMB_AXIS_STEP, type ClimbBox } from "@/lib/analytics/climb-box";

// Climb Reliability box plot as plain SVG on the theme tokens, with the same numbers in a table.

const HEIGHT = 260;
const PAD = { top: 16, right: 16, bottom: 34, left: 40 };
const WIDTH_PER_TEAM = 140;

export function ClimbBoxPlot({ boxes }: { boxes: ClimbBox[] }) {
  const width = Math.max(260, boxes.length * WIDTH_PER_TEAM);
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const step = innerW / Math.max(1, boxes.length);
  const boxW = Math.min(48, step * 0.5);
  const y = (v: number) => PAD.top + innerH - (Math.max(0, Math.min(CLIMB_AXIS_MAX, v)) / CLIMB_AXIS_MAX) * innerH;
  const ticks = Array.from({ length: CLIMB_AXIS_MAX / CLIMB_AXIS_STEP + 1 }, (_, i) => i * CLIMB_AXIS_STEP);
  const attempted = boxes.some((b) => b.attemptCount > 0);

  return (
    <div className="flex flex-col gap-3">
      {attempted && (
        <div className="overflow-x-auto">
          <svg width={width} height={HEIGHT} role="img" aria-label={`Climb points box plot for ${boxes.map((b) => `team ${b.teamNumber}: ${b.attemptCount === 0 ? "no attempts" : `median ${b.median}, ${b.successCount} of ${b.attemptCount} successful`}`).join("; ")}. The table below lists the same numbers.`}>
            {ticks.map((t) => (
              <g key={t} aria-hidden>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--glass-border)" strokeWidth={1} strokeDasharray={t === 0 ? undefined : "4 4"} />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted-foreground)" className="tabular-nums">
                  {t}
                </text>
              </g>
            ))}
            {boxes.map((b, i) => {
              const cx = PAD.left + step * i + step / 2;
              const left = cx - boxW / 2;
              return (
                <g key={b.teamNumber} aria-hidden>
                  {b.attemptCount > 0 && (
                    <>
                      <line x1={cx} x2={cx} y1={y(b.whiskerHigh)} y2={y(b.whiskerLow)} stroke="var(--muted-foreground)" strokeWidth={2} />
                      <line x1={cx - boxW * 0.35} x2={cx + boxW * 0.35} y1={y(b.whiskerHigh)} y2={y(b.whiskerHigh)} stroke="var(--muted-foreground)" strokeWidth={2} />
                      <line x1={cx - boxW * 0.35} x2={cx + boxW * 0.35} y1={y(b.whiskerLow)} y2={y(b.whiskerLow)} stroke="var(--muted-foreground)" strokeWidth={2} />
                      <rect x={left} y={y(b.q3)} width={boxW} height={Math.max(4, y(b.q1) - y(b.q3))} fill="var(--color-accent)" fillOpacity={0.35} stroke="var(--color-accent)" strokeWidth={2} rx={3} />
                      <line x1={left} x2={left + boxW} y1={y(b.median)} y2={y(b.median)} stroke="var(--foreground)" strokeWidth={2} />
                      {b.outliers.map((v, k) => (
                        <circle key={k} cx={cx} cy={y(v)} r={3.5} fill="var(--color-primary)" stroke="var(--background)" strokeWidth={1.5} />
                      ))}
                    </>
                  )}
                  <text x={cx} y={PAD.top + innerH + 20} textAnchor="middle" fontSize={12} fill="var(--foreground)">
                    {b.teamNumber}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-sm">
          <caption className="sr-only">Climb attempts and climb points by team</caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              <th scope="col" className="px-3 py-2 font-medium">
                Team
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Successful
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Q1
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Median
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Q3
              </th>
            </tr>
          </thead>
          <tbody>
            {boxes.map((b) => (
              <tr key={b.teamNumber} className="border-t border-[var(--glass-border)]">
                <th scope="row" className="px-3 py-2 text-left font-semibold tabular-nums">
                  {b.teamNumber}
                </th>
                <td className="px-3 py-2 text-right tabular-nums">
                  {b.successCount} / {b.attemptCount}
                </td>
                {b.attemptCount > 0 ? (
                  <>
                    <td className="px-3 py-2 text-right tabular-nums">{b.q1}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.median}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.q3}</td>
                  </>
                ) : (
                  <td colSpan={3} className="px-3 py-2 text-right text-[var(--muted-foreground)]">
                    No climb attempts recorded
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
