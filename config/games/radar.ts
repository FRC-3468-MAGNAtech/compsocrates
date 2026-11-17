/**
 * Robot Radar profiles: what a game's radar plots. A profile is DATA, so the one radar page works for every game:
 *
 *  - `rebuilt`: the hand-built five-axis profile of the default program's game (Auto Prowess, Hub Volume, Hub IQ, Tower Power, Agility, plus the Climb
 *    Reliability box plot). Its numbers come from `lib/analytics/robot-radar.ts`, unchanged.
 *  - `axes`: a profile read from the game's own point table. Each axis is the mean points of some fields (relative to the best team, or out of a fixed
 *    maximum), or the share of matches with no reliability incident. An axis whose fields are an ALLIANCE objective (one scout per alliance records it)
 *    averages over the entries that recorded one of its fields only, and is labelled as an alliance stat.
 *
 * Pure data and one pure resolver (no runtime imports from `lib/`).
 */
import type { GameField, GameFieldPoints } from "@/config/games/definition";

/** What a game declares (field KEYS only; the points come from the game's own `fields`, so there is one source of truth). */
export type RadarAxisSource = {
  key: string;
  /** Short, it is printed around the chart. */
  label: string;
  /** The row header of the table under the chart. */
  full: string;
  help: string;
  /** The axis plots an alliance objective: recorded by one scout per alliance, averaged over the entries that recorded it, labelled as an alliance stat. */
  alliance?: boolean;
  metric: { kind: "points"; fieldKeys: readonly string[]; scale: "best" | { max: number } } | { kind: "clean" };
};

export type RadarSource = { axes: readonly RadarAxisSource[] };

export type RadarAxisMetric =
  | { kind: "points"; fields: readonly { key: string; points: GameFieldPoints }[]; scale: "best" | { max: number } }
  | { kind: "clean"; incidentKeys: readonly string[] };

export type RadarAxis = Omit<RadarAxisSource, "metric"> & { metric: RadarAxisMetric };

/** What a program hands the radar page for one of its games. */
export type RadarProfile = { kind: "rebuilt"; name: string } | { kind: "axes"; name: string; axes: readonly RadarAxis[] };

/** A game's declared radar with the points rules of its fields and its reliability incident fields filled in. An unknown field key throws (a config typo must fail loudly). */
export function resolveRadarSource(name: string, source: RadarSource, fields: readonly GameField[]): RadarProfile {
  const byKey = new Map(fields.map((f) => [f.key, f] as const));
  const incidentKeys = fields.filter((f) => f.statRoles?.includes("reliability")).map((f) => f.key);
  const axes = source.axes.map((axis): RadarAxis => {
    if (axis.metric.kind === "clean") return { ...axis, metric: { kind: "clean", incidentKeys } };
    const { fieldKeys, scale } = axis.metric;
    const resolved = fieldKeys.map((key) => {
      const field = byKey.get(key);
      if (!field) throw new Error(`Radar axis "${axis.key}" names the unknown field "${key}"`);
      if (!field.points) throw new Error(`Radar axis "${axis.key}" names the field "${key}", which scores no points`);
      return { key, points: field.points };
    });
    return { ...axis, metric: { kind: "points", fields: resolved, scale } };
  });
  return { kind: "axes", name, axes };
}
