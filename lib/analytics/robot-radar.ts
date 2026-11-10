import { CURRENT_GAME_ID } from "@/config/games";
import { robotPrefix } from "@/data/cs/form-field-keys";
import type { FormEntry } from "@/lib/form-entries-model";
import type { FormValues } from "@/lib/forms/types";
import { docsForGame } from "@/lib/analytics/cs-docs";
import { getGamePlugin } from "@/lib/games/registry";
import type { CsDoc, GameId } from "@/lib/games/types";
import type { ScoutEntry } from "@/lib/scout-entries";

// Pure model behind Robot Radar (CS app/analytics/robot-radar + components/RobotRadarChart.tsx): five 0-10 axes per team.
//
//   Auto Prowess   mean auto points (fuel + auto climb) relative to the best team's mean
//   Hub Volume     mean teleop (active-hub) fuel relative to the best team's mean
//   Hub IQ         teleop fuel / all fuel scored, on a 0-10 scale
//   Tower Power    endgame climb weight (TOWER_POWER)
//   Agility        mean lead-scout skill level x 2 (1-5 becomes 2-10)
//
// Phase points come from the game plugin's `scoreDoc`; the fuel split reads the per-section fuel the plugin writes on the
// document it builds. The radar is a REBUILT profile in CS (the page allowed only that game); entries of other games are skipped.

export const RADAR_AXES = [
  { key: "auto", label: "Auto Prowess", full: "Auto Prowess", help: "Average auto points relative to the best team's average." },
  { key: "volume", label: "Hub Volume", full: "Hub Volume", help: "Average active-hub fuel relative to the best team's average." },
  { key: "iq", label: "Hub IQ", full: "Hub IQ (Efficiency)", help: "Active hub fuel as a share of all fuel scored." },
  { key: "tower", label: "Tower Power", full: "Tower Power", help: "Endgame climb weight: level 1 = 3, level 2 = 6, level 3 = 10." },
  { key: "agility", label: "Agility", full: "Agility / Defense", help: "Average lead-scout skill rating, scaled to 0-10." },
] as const;

export type RadarAxisKey = (typeof RADAR_AXES)[number]["key"];

/** CS's tower weight per endgame status. A presentation weight of this chart (not game points), so it lives here rather than in a plugin. */
export const TOWER_POWER: Readonly<Record<string, number>> = { "level-1": 3, "level-2": 6, "level-3": 10 };

/** Axes whose two teams differ by at least this are highlighted when comparing. */
export const RADAR_HIGHLIGHT_GAP = 2;
export const RADAR_MAX_TEAMS = 2;

export type RadarSample = {
  teamNumber: number;
  autoPoints: number;
  activeFuel: number;
  totalFuel: number;
  tower: number;
  /** Climb attempts (CS `endgame.attemptedClimb`) with the endgame points that attempt scored: feeds the Climb Reliability box plot. */
  climbAttempt: { attempted: boolean; points: number };
};

export type RadarTeamStat = {
  teamNumber: number;
  entryCount: number;
  autoAvg: number;
  activeFuelAvg: number;
  totalFuelAvg: number;
  hubIq: number;
  towerAvg: number;
  agilityAvg: number;
  /** How many lead-scout ratings fed the agility axis. */
  ratings: number;
};

export type RadarRow = { key: RadarAxisKey; label: string; full: string; a: number; b: number | null; overlap: number | null; highlight: boolean };

const clamp10 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : 0);
const avg = (xs: readonly number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);

const num = (v: unknown): number => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};
const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The radar's numbers for one scouting document, by the game plugin. */
export function sampleFromDoc(teamNumber: number, doc: CsDoc, gameId: GameId = CURRENT_GAME_ID): RadarSample {
  const score = getGamePlugin(gameId).scoreDoc(doc);
  const auto = rec(doc.auto);
  const teleop = rec(doc.teleop);
  const endgame = rec(doc.endgame);
  // Stored per-section fuel (what `valuesToDoc` writes): autoFuel + teleFuel + endgameFuel, without climb points.
  const totalFuel = num(auto.estimatedFuel) + num(teleop.estimatedFuel) + num(endgame.estimatedFuel);
  const status = String(endgame.status || "").toLowerCase();
  return {
    teamNumber,
    autoPoints: score.auto,
    activeFuel: score.teleop,
    totalFuel,
    tower: TOWER_POWER[status] ?? 0,
    // CS's Climb Reliability reads `endgame.attemptedClimb` and `endgame.level|result|status`; the climb points are the level's.
    climbAttempt: { attempted: Boolean(endgame.attemptedClimb), points: climbPointsFromEndgame(endgame) },
  };
}

/** CS `ClimbBoxPlot.resolveClimbPoints`: endgame level/result/status text to climb points (10 / 20 / 30), else 0. */
export function climbPointsFromEndgame(endgame: Record<string, unknown>): number {
  const raw = String(endgame.level || endgame.result || endgame.status || "").trim().toLowerCase();
  if (!raw || raw === "none" || raw === "failure" || raw === "failed") return 0;
  if (raw.includes("level 1") || raw.includes("level-1") || raw === "l1") return 10;
  if (raw.includes("level 2") || raw.includes("level-2") || raw === "l2") return 20;
  if (raw.includes("level 3") || raw.includes("level-3") || raw === "l3") return 30;
  return 0;
}

export function radarSamples(entries: readonly ScoutEntry[], gameId: GameId = CURRENT_GAME_ID): { samples: RadarSample[]; skipped: number } {
  const { items, skipped } = docsForGame(entries, gameId);
  return { samples: items.map(({ entry, doc }) => sampleFromDoc(entry.teamNumber, doc, gameId)).filter((s) => s.teamNumber > 0), skipped };
}

// --- lead-scout skill (agility) ------------------------------------------------------------------------------------------

const digitsOf = (v: unknown): string => String(v ?? "").trim().replace(/[^0-9]/g, "");

/**
 * Skill ratings (already x 2) per team from lead-scout entries, as CS's `resolveSkillLevel`: a robot's own `skillLevel` when it is a
 * number, else the alliance's `overallAlliance.skillLevel`, else no rating. Reads the CS value keys (`robot1_teamNumber`,
 * `robot1_skillLevel`, `overallAlliance_skillLevel`) and the built-in lead form's per-slot keys (`t1_team`, `t1_skill`, `allianceSkill`).
 */
export function leadSkillByTeam(leadEntries: readonly Pick<FormEntry, "values">[], maxRobots = 6): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const entry of leadEntries) {
    const v: FormValues = entry.values ?? {};
    const alliance = typeof v.overallAlliance_skillLevel === "number" ? v.overallAlliance_skillLevel : typeof v.allianceSkill === "number" ? v.allianceSkill : null;
    for (let i = 0; i < maxRobots; i += 1) {
      const team = digitsOf(v[`${robotPrefix(i)}_teamNumber`] ?? v[`t${i + 1}_team`]);
      if (!team) continue;
      const own = v[`${robotPrefix(i)}_skillLevel`] ?? v[`t${i + 1}_skill`];
      const level = typeof own === "number" ? own * 2 : alliance !== null ? alliance * 2 : null;
      if (level === null) continue;
      const n = Number(team);
      out.set(n, [...(out.get(n) ?? []), level]);
    }
  }
  return out;
}

// --- team stats and axes -------------------------------------------------------------------------------------------------

/** Per-team averages from every sample, and the best team's auto / active-fuel averages the axes are scaled against. */
export function buildRadarStats(samples: readonly RadarSample[], skill: ReadonlyMap<number, number[]> = new Map()): { stats: Map<number, RadarTeamStat>; maxAuto: number; maxActiveFuel: number } {
  const byTeam = new Map<number, RadarSample[]>();
  for (const s of samples) byTeam.set(s.teamNumber, [...(byTeam.get(s.teamNumber) ?? []), s]);

  const stats = new Map<number, RadarTeamStat>();
  let maxAuto = 0;
  let maxActiveFuel = 0;
  for (const [teamNumber, list] of byTeam) {
    const activeFuelAvg = avg(list.map((s) => s.activeFuel));
    const totalFuelAvg = avg(list.map((s) => s.totalFuel));
    const autoAvg = avg(list.map((s) => s.autoPoints));
    const ratings = skill.get(teamNumber) ?? [];
    stats.set(teamNumber, {
      teamNumber,
      entryCount: list.length,
      autoAvg,
      activeFuelAvg,
      totalFuelAvg,
      hubIq: totalFuelAvg > 0 ? (activeFuelAvg / totalFuelAvg) * 10 : 0,
      towerAvg: avg(list.map((s) => s.tower)),
      agilityAvg: avg(ratings),
      ratings: ratings.length,
    });
    maxAuto = Math.max(maxAuto, autoAvg);
    maxActiveFuel = Math.max(maxActiveFuel, activeFuelAvg);
  }
  return { stats, maxAuto: maxAuto || 1, maxActiveFuel: maxActiveFuel || 1 };
}

function axisValues(stat: RadarTeamStat | undefined, maxAuto: number, maxActiveFuel: number): Record<RadarAxisKey, number> {
  return {
    auto: clamp10(((stat?.autoAvg ?? 0) / maxAuto) * 10),
    volume: clamp10(((stat?.activeFuelAvg ?? 0) / maxActiveFuel) * 10),
    iq: clamp10(stat?.hubIq ?? 0),
    tower: clamp10(stat?.towerAvg ?? 0),
    agility: clamp10(stat?.agilityAvg ?? 0),
  };
}

/** The five axes for team A (and B when comparing): values, the overlap (the lower of the two) and the axes that differ by 2 or more. */
export function radarRows(a: RadarTeamStat | undefined, b: RadarTeamStat | undefined, maxAuto: number, maxActiveFuel: number): RadarRow[] {
  const av = axisValues(a, maxAuto, maxActiveFuel);
  const bv = b ? axisValues(b, maxAuto, maxActiveFuel) : null;
  return RADAR_AXES.map((axis) => ({
    key: axis.key,
    label: axis.label,
    full: axis.full,
    a: av[axis.key],
    b: bv ? bv[axis.key] : null,
    overlap: bv ? Math.min(av[axis.key], bv[axis.key]) : null,
    highlight: bv ? Math.abs(av[axis.key] - bv[axis.key]) >= RADAR_HIGHLIGHT_GAP : false,
  }));
}

/** Team numbers typed or stored as text, reduced to at most two valid numbers (the page keeps two teams). */
export function normalizeSelectedTeams(teams: readonly string[]): number[] {
  return teams
    .map((t) => Number(digitsOf(t)))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, RADAR_MAX_TEAMS);
}
