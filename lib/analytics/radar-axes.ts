import type { RadarAxis } from "@/config/games/radar";
import { ALLIANCE_STAT_SUFFIX } from "@/lib/analytics/team-card";
import { RADAR_HIGHLIGHT_GAP, type RadarRow } from "@/lib/analytics/robot-radar";
import { isRecorded } from "@/lib/forms/alliance-role";
import { pointsFor } from "@/lib/games/point-table";
import type { ScoutEntry } from "@/lib/scout-entries";

// The Robot Radar for a game that declares its axes (`config/games/radar.ts`). Pure: entries in, per-team means and 0-10 rows out.
//
// Alliance objectives are recorded by ONE scout per alliance and stored absent for the other (never 0), so an alliance axis averages over the entries that
// recorded one of its fields and says how many that was. Every other axis is asked of every entry.

export type AxesTeamStat = {
  teamNumber: number;
  entryCount: number;
  /** Raw mean per axis key: points for a points axis, the share of incident-free matches (0-1) for a reliability axis. */
  mean: Record<string, number>;
  /** How many entries each axis rests on (an alliance axis: the entries that recorded it). */
  recorded: Record<string, number>;
};

const clamp10 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : 0);
const avg = (xs: readonly number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);

const valuesOf = (e: Pick<ScoutEntry, "values">): Record<string, unknown> => e.values ?? {};

const isOn = (v: unknown): boolean => v === true || (typeof v === "number" && v > 0) || (typeof v === "string" && v.trim() !== "" && v !== "false" && v !== "0");

function axisPoints(axis: Extract<RadarAxis["metric"], { kind: "points" }>, entry: Pick<ScoutEntry, "values">): number {
  return axis.fields.reduce((sum, f) => sum + pointsFor(f.points, valuesOf(entry)[f.key]), 0);
}

/** Per-team means for every axis, and the best team's mean per axis (what a "best" scale is relative to). */
export function buildAxesStats(entries: readonly Pick<ScoutEntry, "teamNumber" | "values">[], axes: readonly RadarAxis[]): { stats: Map<number, AxesTeamStat>; best: Record<string, number> } {
  const byTeam = new Map<number, Pick<ScoutEntry, "teamNumber" | "values">[]>();
  for (const e of entries) {
    if (!Number.isFinite(e.teamNumber) || e.teamNumber <= 0) continue;
    byTeam.set(e.teamNumber, [...(byTeam.get(e.teamNumber) ?? []), e]);
  }

  const stats = new Map<number, AxesTeamStat>();
  const best: Record<string, number> = Object.fromEntries(axes.map((a) => [a.key, 0]));
  for (const [teamNumber, list] of byTeam) {
    const mean: Record<string, number> = {};
    const recorded: Record<string, number> = {};
    for (const axis of axes) {
      if (axis.metric.kind === "clean") {
        const { incidentKeys } = axis.metric;
        const clean = list.filter((e) => !incidentKeys.some((k) => isOn(valuesOf(e)[k]))).length;
        mean[axis.key] = list.length ? clean / list.length : 0;
        recorded[axis.key] = list.length;
      } else {
        const metric = axis.metric;
        const used = axis.alliance ? list.filter((e) => metric.fields.some((f) => isRecorded(valuesOf(e), f.key))) : list;
        mean[axis.key] = avg(used.map((e) => axisPoints(metric, e)));
        recorded[axis.key] = used.length;
      }
      best[axis.key] = Math.max(best[axis.key], mean[axis.key]);
    }
    stats.set(teamNumber, { teamNumber, entryCount: list.length, mean, recorded });
  }
  return { stats, best };
}

function axisValue(axis: RadarAxis, stat: AxesTeamStat | undefined, best: Record<string, number>): number {
  const mean = stat?.mean[axis.key] ?? 0;
  if (axis.metric.kind === "clean") return clamp10(mean * 10);
  if (axis.metric.scale === "best") return clamp10((mean / (best[axis.key] || 1)) * 10);
  return clamp10((mean / axis.metric.scale.max) * 10);
}

/** The table header of an axis: an alliance objective carries the alliance-stat label. */
export const axisFullLabel = (axis: Pick<RadarAxis, "full" | "alliance">): string => (axis.alliance ? `${axis.full} ${ALLIANCE_STAT_SUFFIX}` : axis.full);

/** The rows for team A (and B when comparing): 0-10 values, the overlap and the axes that differ by 2 or more. Any number of axes. */
export function axesRows(axes: readonly RadarAxis[], a: AxesTeamStat | undefined, b: AxesTeamStat | undefined, best: Record<string, number>): RadarRow[] {
  return axes.map((axis) => {
    const av = axisValue(axis, a, best);
    const bv = b ? axisValue(axis, b, best) : null;
    return {
      key: axis.key,
      label: axis.label,
      full: axisFullLabel(axis),
      a: av,
      b: bv,
      overlap: bv !== null ? Math.min(av, bv) : null,
      highlight: bv !== null ? Math.abs(av - bv) >= RADAR_HIGHLIGHT_GAP : false,
    };
  });
}
