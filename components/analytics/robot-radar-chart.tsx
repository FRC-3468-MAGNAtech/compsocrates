"use client";

import { RADAR_AXES, type RadarRow } from "@/lib/analytics/robot-radar";

// The five-axis robot profile as plain SVG on the theme tokens (no chart dependency). The same numbers are printed in a table under the
// chart, which is the screen-reader view: the SVG itself is a labelled image.

const SIZE = 320;
const CENTER = SIZE / 2;
const RADIUS = 104;
const RINGS = [2, 4, 6, 8, 10];

const angle = (i: number, n: number) => -Math.PI / 2 + (i / n) * Math.PI * 2;
const point = (i: number, n: number, value: number) => {
  const r = (Math.max(0, Math.min(12, value)) / 10) * RADIUS;
  return [CENTER + r * Math.cos(angle(i, n)), CENTER + r * Math.sin(angle(i, n))] as const;
};
const polygon = (values: number[]) => values.map((v, i) => point(i, values.length, v).map((n) => n.toFixed(1)).join(",")).join(" ");

export function RobotRadarChart({ rows, teamA, teamB }: { rows: RadarRow[]; teamA: number; teamB: number | null }) {
  const n = rows.length;
  const summary = rows.map((r) => `${r.full} ${r.a.toFixed(1)}${r.b !== null ? ` versus ${r.b.toFixed(1)}` : ""}`).join(", ");

  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-auto w-full max-w-[26rem]" role="img" aria-label={`Radar chart on a 0 to 10 scale for team ${teamA}${teamB !== null ? ` and team ${teamB}` : ""}: ${summary}.`}>
        {RINGS.map((ring) => (
          <g key={ring} aria-hidden>
            <polygon points={polygon(rows.map(() => ring))} fill="none" stroke="var(--glass-border)" strokeWidth={1} />
            <text x={CENTER + 4} y={CENTER - (ring / 10) * RADIUS} dy="-0.2em" fontSize={9} fill="var(--muted-foreground)" className="tabular-nums">
              {ring}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const [x, y] = point(i, n, 10);
          const [lx, ly] = point(i, n, 11.9);
          const cos = Math.cos(angle(i, n));
          return (
            <g key={r.key} aria-hidden>
              <line x1={CENTER} y1={CENTER} x2={x} y2={y} stroke="var(--glass-border)" strokeWidth={1} />
              <text
                x={lx}
                y={ly}
                dy="0.32em"
                textAnchor={Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end"}
                fontSize={12}
                fontWeight={r.highlight ? 700 : 500}
                fill={r.highlight ? "var(--color-primary)" : "var(--muted-foreground)"}
              >
                {r.label}
              </text>
            </g>
          );
        })}

        {teamB !== null && <polygon points={polygon(rows.map((r) => r.overlap ?? 0))} fill="var(--muted-foreground)" fillOpacity={0.25} stroke="var(--muted-foreground)" strokeWidth={1} aria-hidden />}
        <polygon points={polygon(rows.map((r) => r.a))} fill="var(--color-primary)" fillOpacity={0.35} stroke="var(--color-primary)" strokeWidth={2} strokeLinejoin="round" aria-hidden />
        {teamB !== null && <polygon points={polygon(rows.map((r) => r.b ?? 0))} fill="var(--color-accent)" fillOpacity={0.35} stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" strokeDasharray="5 3" aria-hidden />}
      </svg>

      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: "var(--color-primary)" }} />
          Team {teamA}
        </li>
        {teamB !== null && (
          <>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 rounded-full border-t-2 border-dashed" style={{ borderColor: "var(--color-accent)" }} />
              Team {teamB}
            </li>
            <li className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
              <span aria-hidden className="h-2 w-4 rounded-sm" style={{ background: "var(--muted-foreground)", opacity: 0.35 }} />
              Overlap
            </li>
          </>
        )}
      </ul>

      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[20rem] text-sm">
          <caption className="sr-only">Radar scores out of 10 by axis</caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              <th scope="col" className="px-3 py-2 font-medium">
                Axis
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Team {teamA}
              </th>
              {teamB !== null && (
                <>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Team {teamB}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Overlap
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-[var(--glass-border)]">
                <th scope="row" className={r.highlight ? "px-3 py-2 text-left font-semibold" : "px-3 py-2 text-left font-normal"}>
                  {r.full}
                  {r.highlight && <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">(differs by 2 or more)</span>}
                </th>
                <td className="px-3 py-2 text-right tabular-nums">{r.a.toFixed(1)}</td>
                {teamB !== null && (
                  <>
                    <td className="px-3 py-2 text-right tabular-nums">{(r.b ?? 0).toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{(r.overlap ?? 0).toFixed(1)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="grid w-full gap-1 text-xs text-[var(--muted-foreground)]">
        {RADAR_AXES.map((a) => (
          <div key={a.key} className="flex flex-wrap gap-x-2">
            <dt className="font-semibold text-[var(--foreground)]">{a.full}:</dt>
            <dd>{a.help}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
