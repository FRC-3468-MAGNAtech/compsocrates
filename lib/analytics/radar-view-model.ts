import type { RadarProfile } from "@/config/games/radar";
import { buildClimbBoxes, type ClimbBox } from "@/lib/analytics/climb-box";
import { axesRows, axisFullLabel, buildAxesStats } from "@/lib/analytics/radar-axes";
import { RADAR_AXES, buildRadarStats, leadSkillByTeam, radarRows, radarSamples, type RadarRow } from "@/lib/analytics/robot-radar";
import type { FormEntry } from "@/lib/form-entries-model";
import type { ScoutEntry } from "@/lib/scout-entries";

// What the Robot Radar page shows for one game, behind one interface: the page asks this model for teams, rows, notes and the optional box plot, and never
// knows which profile produced them. The "rebuilt" profile wraps the existing functions unchanged (pinned by robot-radar.golden.test.ts).

export type RadarModel = {
  /** The game's name, for the page text. */
  name: string;
  /** Printed under the chart: the axis name and what it measures. */
  axes: readonly { key: string; full: string; help: string }[];
  /** Entries of another game, left out. */
  skipped: number;
  /** Teams with data, by team number. */
  teams: { teamNumber: number; entryCount: number }[];
  rows(a: number | undefined, b: number | undefined): RadarRow[];
  /** The Climb Reliability box plot, or null when the game has no such element (it is then not shown at all). */
  climbBoxes: ((teams: readonly number[]) => ClimbBox[]) | null;
  /** Lines under the chart for the chosen teams (what a number rests on, what reads 0 and why). */
  notes(a: number | undefined, b: number | undefined): string[];
  /** Does the profile read Lead Scout entries (the Agility axis)? When not, the page need not read them. */
  needsLeadEntries: boolean;
};

export function buildRadarModel(profile: RadarProfile, entries: readonly ScoutEntry[], leadEntries: readonly Pick<FormEntry, "values">[]): RadarModel {
  if (profile.kind === "rebuilt") {
    const { samples, skipped } = radarSamples(entries);
    const { stats, maxAuto, maxActiveFuel } = buildRadarStats(samples, leadSkillByTeam(leadEntries));
    return {
      name: profile.name,
      axes: RADAR_AXES,
      skipped,
      teams: [...stats.values()].sort((x, y) => x.teamNumber - y.teamNumber).map((t) => ({ teamNumber: t.teamNumber, entryCount: t.entryCount })),
      rows: (a, b) => radarRows(a !== undefined ? stats.get(a) : undefined, b !== undefined ? stats.get(b) : undefined, maxAuto, maxActiveFuel),
      climbBoxes: (teams) => buildClimbBoxes(samples, teams),
      notes: (a, b) => {
        const statA = a !== undefined ? stats.get(a) : undefined;
        const statB = b !== undefined ? stats.get(b) : undefined;
        return (statA && statA.ratings === 0) || (statB && statB.ratings === 0) ? ["Agility reads 0 for a team with no Lead Scout rating in these events."] : [];
      },
      needsLeadEntries: true,
    };
  }

  const { stats, best } = buildAxesStats(entries, profile.axes);
  const matchesWord = (n: number) => `${n} ${n === 1 ? "match" : "matches"}`;
  return {
    name: profile.name,
    axes: profile.axes.map((axis) => ({ key: axis.key, full: axisFullLabel(axis), help: axis.help })),
    skipped: 0,
    teams: [...stats.values()].sort((x, y) => x.teamNumber - y.teamNumber).map((t) => ({ teamNumber: t.teamNumber, entryCount: t.entryCount })),
    rows: (a, b) => axesRows(profile.axes, a !== undefined ? stats.get(a) : undefined, b !== undefined ? stats.get(b) : undefined, best),
    climbBoxes: null,
    notes: (a, b) => {
      const lines: string[] = [];
      for (const team of [a, b]) {
        const stat = team !== undefined ? stats.get(team) : undefined;
        if (!stat) continue;
        lines.push(`Team ${stat.teamNumber}: the numbers rest on ${matchesWord(stat.entryCount)} scouted.`);
        for (const axis of profile.axes) {
          if (!axis.alliance) continue;
          const n = stat.recorded[axis.key] ?? 0;
          lines.push(
            n === 0
              ? `Team ${stat.teamNumber}: no match recorded ${axis.full}, so it reads 0.`
              : `Team ${stat.teamNumber}: ${axis.full} is an alliance stat, averaged over the ${matchesWord(n)} where it was recorded (of ${stat.entryCount}).`
          );
        }
      }
      return lines;
    },
    needsLeadEntries: false,
  };
}
