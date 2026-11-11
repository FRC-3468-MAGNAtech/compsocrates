import type { FormEntry } from "@/lib/form-entries-model";
import type { FormValue } from "@/lib/forms/types";

// REBUILT summaries of the six non-match forms: what CS's analytics pages show for the same data (app/analytics/pit, lead, team-strategy, match-strategy,
// drive-reflection, helper and the Capability Comparison of team-breakdown/[teamNumber]), read from the `values` keys of data/cs/form-field-keys.ts
// (`robotWeight`, `fuelPreloadCapacity`, `robot1_teamNumber`, `robot2_endgameClimb`, `wasSuccessful`, ...). Pure: no React, no Firebase.
//
// CS-shaped values worth knowing: team numbers and the three fuel scales are STRINGS ("254", "10-13", "x"); `skillLevel` is a number where 0 means "unset";
// a disposition is a boolean (an old CSV import stored a string); a robot's `endgameClimb` is "" or "level-1" .. "level-3".

const num = (v: FormValue | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const text = (v: FormValue | undefined): string => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const isTrue = (v: FormValue | undefined): boolean => v === true || (typeof v === "string" && /^(true|yes|y)$/i.test(v.trim()));
const round = (n: number, digits = 2): number => Math.round(n * 10 ** digits) / 10 ** digits;
const avg = (xs: number[]): number | null => (xs.length === 0 ? null : round(xs.reduce((a, b) => a + b, 0) / xs.length));
const byMatchKey = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "", undefined, { numeric: true });

/** CS's `formatAnalyticsText`: "outpost-trench" becomes "Outpost Trench". "" stays "". */
export function titleCase(value: unknown): string {
  const raw = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Newest entry of each group, newest first. */
function latestBy(entries: readonly FormEntry[], key: (e: FormEntry) => string): FormEntry[] {
  const best = new Map<string, FormEntry>();
  for (const e of entries) {
    const k = key(e);
    const cur = best.get(k);
    if (!cur || e.createdAtMs > cur.createdAtMs) best.set(k, e);
  }
  return [...best.values()].sort((a, b) => b.createdAtMs - a.createdAtMs);
}

/** How many times each key occurs. */
function countBy(entries: readonly FormEntry[], key: (e: FormEntry) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(key(e), (counts.get(key(e)) ?? 0) + 1);
  return counts;
}

// --- Pit Scout ------------------------------------------------------------------------------------------------

/** One of the three fuel scales (preload capacity, balls per second, carrying capacity). `text` is what the scout typed ("10-13", "x", "" when blank); `value` is a number to sort and average by. */
export type FuelScale = { text: string; value: number | null };

/** CS stores digits, "x" (unknown) or a range such as "10-13". A range's value is its midpoint; "x" and blank have no value. */
export function parseFuelScale(v: FormValue | undefined): FuelScale {
  const raw = text(v);
  const lower = raw.toLowerCase();
  if (!raw || lower === "x") return { text: lower === "x" ? "x" : "", value: null };
  const n = Number(raw);
  if (Number.isFinite(n)) return { text: raw, value: n };
  const range = /^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/.exec(raw);
  if (range) return { text: raw, value: round((Number(range[1]) + Number(range[2])) / 2) };
  return { text: raw, value: null };
}

/** True for a scale a scout actually answered (not blank and not "x"). */
export const fuelScaleKnown = (s: FuelScale): boolean => s.text !== "" && s.text !== "x";

/** The robot weight as pounds. CS stores free text ("118 lbs", "55kg"); a bare number is pounds. Null when no number can be read. */
export function parseWeightLb(v: FormValue | undefined): number | null {
  const raw = text(v);
  const m = /(\d+(?:\.\d+)?)/.exec(raw);
  if (!m) return null;
  const n = Number(m[1]);
  return /kg|kilo/i.test(raw) ? round(n * 2.20462, 1) : n;
}

/** A disposition cell: CS shows the text of an old string value, else Yes / No. */
export type Disposition = { text: string; positive: boolean };
export function disposition(v: FormValue | undefined): Disposition {
  if (typeof v === "string" && v.trim()) return { text: titleCase(v.trim()), positive: isTrue(v) };
  return v === true ? { text: "Yes", positive: true } : { text: "No", positive: false };
}

export const CLIMB_LEVEL_LABELS = ["Level 1", "Level 2", "Level 3"] as const;

export type PitRebuiltRow = {
  teamNumber: number;
  eventCode: string;
  entryId: string;
  scoutName: string;
  createdAtMs: number;
  weightText: string;
  weightLb: number | null;
  rookie: boolean | null;
  /** The robot picture URL (http or https only), or null. */
  pictureUrl: string | null;
  pitDisposition: Disposition;
  driveDisposition: Disposition;
  preload: FuelScale;
  ballsPerSecond: FuelScale;
  carry: FuelScale;
  /** Level 1, 2 and 3 climb. */
  climb: [boolean, boolean, boolean];
  /** The highest level the team says it can climb: 0 = none. */
  highestClimb: 0 | 1 | 2 | 3;
  fuelCycleText: string;
  fuelCycleSeconds: number | null;
  climbTimeText: string;
  climbSeconds: number | null;
  autoCycle: string;
  notes: string;
  /** How many pit entries this team has at this event (the row shown is the latest). */
  entryCount: number;
};

const httpUrl = (v: FormValue | undefined): string | null => {
  const raw = text(v);
  return /^https?:\/\//i.test(raw) ? raw : null;
};

export function pitRebuiltRow(e: FormEntry, entryCount = 1): PitRebuiltRow | null {
  if (typeof e.teamNumber !== "number") return null;
  const climb: [boolean, boolean, boolean] = [isTrue(e.values.climbLevel1), isTrue(e.values.climbLevel2), isTrue(e.values.climbLevel3)];
  const highest = climb[2] ? 3 : climb[1] ? 2 : climb[0] ? 1 : 0;
  return {
    teamNumber: e.teamNumber,
    eventCode: e.eventCode,
    entryId: e.id,
    scoutName: e.scoutName,
    createdAtMs: e.createdAtMs,
    weightText: text(e.values.robotWeight),
    weightLb: parseWeightLb(e.values.robotWeight),
    rookie: typeof e.values.rookieTeam === "boolean" ? e.values.rookieTeam : null,
    pictureUrl: httpUrl(e.values.robotPictureUrl),
    pitDisposition: disposition(e.values.pitDisposition),
    driveDisposition: disposition(e.values.driveDisposition),
    preload: parseFuelScale(e.values.fuelPreloadCapacity),
    ballsPerSecond: parseFuelScale(e.values.fuelBallsPerSecond),
    carry: parseFuelScale(e.values.fuelCarryingCapacity),
    climb,
    highestClimb: highest,
    fuelCycleText: text(e.values.typicalFuelCycleTime),
    fuelCycleSeconds: num(e.values.typicalFuelCycleTime),
    climbTimeText: text(e.values.typicalClimbTime),
    climbSeconds: num(e.values.typicalClimbTime),
    autoCycle: text(e.values.autoCycleDescription),
    notes: text(e.values.notes),
    entryCount,
  };
}

const pitUnit = (e: FormEntry) => `${e.eventCode}|${e.teamNumber ?? ""}`;

/** One row per team and event (the latest entry), or every entry newest first with `latestOnly: false`. Sorted by team number (newest first when `latestOnly` is false). Excluded entries never count. */
export function pitRebuiltRows(entries: readonly FormEntry[], opts: { latestOnly?: boolean } = {}): PitRebuiltRow[] {
  const live = entries.filter((e) => !e.excluded && typeof e.teamNumber === "number");
  const counts = countBy(live, pitUnit);
  if (opts.latestOnly === false) return live.slice().sort((a, b) => b.createdAtMs - a.createdAtMs).flatMap((e) => pitRebuiltRow(e, counts.get(pitUnit(e)) ?? 1) ?? []);
  return latestBy(live, pitUnit)
    .flatMap((e) => pitRebuiltRow(e, counts.get(pitUnit(e)) ?? 1) ?? [])
    .sort((a, b) => a.teamNumber - b.teamNumber || a.eventCode.localeCompare(b.eventCode));
}

/** The headline numbers over the latest row of each team: how many teams can climb each level and the average weight. */
export function pitRebuiltOverview(rows: readonly PitRebuiltRow[]): { teams: number; climbCounts: [number, number, number]; highestClimbCounts: [number, number, number, number]; averageWeightLb: number | null } {
  const latest = [...new Map(rows.map((r) => [r.teamNumber, r])).values()];
  const climbCounts: [number, number, number] = [0, 0, 0];
  const highest: [number, number, number, number] = [0, 0, 0, 0];
  for (const r of latest) {
    r.climb.forEach((on, i) => {
      if (on) climbCounts[i] += 1;
    });
    highest[r.highestClimb] += 1;
  }
  return { teams: latest.length, climbCounts, highestClimbCounts: highest, averageWeightLb: avg(latest.flatMap((r) => (r.weightLb === null ? [] : [r.weightLb]))) };
}

// --- Team Strategy --------------------------------------------------------------------------------------------

/** The four yes/no abilities CS's team strategy form asks, keyed by value key. */
export const STRATEGY_REBUILT_ABILITIES = [
  { key: "clearsBump", label: "Clears bump" },
  { key: "clearsTrench", label: "Clears trench" },
  { key: "canShootWhileIntaking", label: "Shoots while intaking" },
  { key: "canMoveAndShootSimultaneously", label: "Moves and shoots" },
] as const;

export type StrategyRebuiltRow = {
  teamNumber: number;
  eventCode: string;
  entryId: string;
  scoutName: string;
  createdAtMs: number;
  /** Raw values ("outpost-trench", "cycling"); `titleCase` them for display. */
  preferredStartingPosition: string;
  bestAt: string;
  abilities: Record<string, boolean>;
  notes: string;
  entryCount: number;
};

export function strategyRebuiltRow(e: FormEntry, entryCount = 1): StrategyRebuiltRow | null {
  if (typeof e.teamNumber !== "number") return null;
  return {
    teamNumber: e.teamNumber,
    eventCode: e.eventCode,
    entryId: e.id,
    scoutName: e.scoutName,
    createdAtMs: e.createdAtMs,
    preferredStartingPosition: text(e.values.preferredStartingPosition),
    bestAt: text(e.values.bestAt),
    abilities: Object.fromEntries(STRATEGY_REBUILT_ABILITIES.map((a) => [a.key, isTrue(e.values[a.key])])),
    notes: text(e.values.notes),
    entryCount,
  };
}

/** One row per team and event (the latest entry), the counts of teams per best-at and per preferred starting position, and how many teams have each ability. */
export function strategyRebuiltSummary(entries: readonly FormEntry[], opts: { latestOnly?: boolean } = {}): { rows: StrategyRebuiltRow[]; bestAtCounts: Record<string, number>; startCounts: Record<string, number>; abilityCounts: Record<string, number> } {
  const live = entries.filter((e) => !e.excluded && typeof e.teamNumber === "number");
  const counts = countBy(live, pitUnit);
  const rowOf = (e: FormEntry) => strategyRebuiltRow(e, counts.get(pitUnit(e)) ?? 1) ?? [];
  // the counts are always over the latest entry of each team, even when every entry is listed
  const latest = latestBy(live, pitUnit).flatMap(rowOf).sort((a, b) => a.teamNumber - b.teamNumber || a.eventCode.localeCompare(b.eventCode));
  const rows = opts.latestOnly === false ? live.slice().sort((a, b) => b.createdAtMs - a.createdAtMs).flatMap(rowOf) : latest;
  const bestAtCounts: Record<string, number> = {};
  const startCounts: Record<string, number> = {};
  const abilityCounts: Record<string, number> = Object.fromEntries(STRATEGY_REBUILT_ABILITIES.map((a) => [a.key, 0]));
  for (const r of latest) {
    if (r.bestAt) bestAtCounts[r.bestAt] = (bestAtCounts[r.bestAt] ?? 0) + 1;
    if (r.preferredStartingPosition) startCounts[r.preferredStartingPosition] = (startCounts[r.preferredStartingPosition] ?? 0) + 1;
    for (const a of STRATEGY_REBUILT_ABILITIES) if (r.abilities[a.key]) abilityCounts[a.key] += 1;
  }
  return { rows, bestAtCounts, startCounts, abilityCounts };
}

// --- Alliance forms: robots -------------------------------------------------------------------------------------

/** The 1-based robot numbers an entry has values for (`robot1_teamNumber` .. `robot3_teamNumber`), in order. */
export function robotSlots(values: FormEntry["values"]): number[] {
  const out: number[] = [];
  for (const k of Object.keys(values)) {
    const m = /^robot(\d+)_/.exec(k);
    if (m && !out.includes(Number(m[1]))) out.push(Number(m[1]));
  }
  return out.sort((a, b) => a - b);
}

/** A robot's team number, or null for a blank or unreadable one. */
export function robotTeam(values: FormEntry["values"], slot: number): number | null {
  const t = num(values[`robot${slot}_teamNumber`]);
  return t !== null && t > 0 ? t : null;
}

// --- Lead Scout -----------------------------------------------------------------------------------------------

export type LeadRobot = { slot: number; team: number; skill: number | null; notes: string };
export type LeadRebuiltTeamRow = { teamNumber: number; averageSkill: number | null; entries: number; notes: { text: string; scoutName: string; matchKey: string | null }[] };
export type LeadRebuiltAllianceRow = {
  key: string;
  eventCode: string;
  matchKey: string | null;
  alliance: "red" | "blue" | null;
  teams: number[];
  robots: LeadRobot[];
  allianceSkill: number | null;
  allianceNotes: string;
  scoutName: string;
  entryId: string;
};

/** CS stores 0 for a skill nobody set, otherwise 1 to 5. */
const skill = (v: FormValue | undefined): number | null => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};

/** The teams in an alliance's overall text ("RED / 254, 1678, 118"): the numbers after the slash. Used only when no robot names a team. */
export function teamsInText(raw: string): number[] {
  const afterSlash = raw.includes("/") ? raw.slice(raw.indexOf("/") + 1) : raw;
  return (afterSlash.match(/\d+/g) ?? []).map(Number).filter((n) => n > 0);
}

export const leadRobots = (e: FormEntry): LeadRobot[] =>
  robotSlots(e.values).flatMap((slot) => {
    const team = robotTeam(e.values, slot);
    return team === null ? [] : [{ slot, team, skill: skill(e.values[`robot${slot}_skillLevel`]), notes: text(e.values[`robot${slot}_notes`]) }];
  });

/** Average 1-5 skill per team (over every rating, zero meaning unset is skipped), the alliance rows with each robot's skill and notes, and every note. Excluded entries never count. */
export function leadRebuiltSummary(entries: readonly FormEntry[]): { teams: LeadRebuiltTeamRow[]; alliances: LeadRebuiltAllianceRow[] } {
  // oldest first, so a team's notes read in the order they were written
  const live = entries.filter((e) => !e.excluded).sort((x, y) => x.createdAtMs - y.createdAtMs);
  const byTeam = new Map<number, { skills: number[]; notes: LeadRebuiltTeamRow["notes"]; entries: number }>();
  const alliances: LeadRebuiltAllianceRow[] = [];
  for (const e of live) {
    const robots = leadRobots(e);
    for (const r of robots) {
      const row = byTeam.get(r.team) ?? { skills: [], notes: [], entries: 0 };
      row.entries += 1;
      if (r.skill !== null) row.skills.push(r.skill);
      if (r.notes) row.notes.push({ text: r.notes, scoutName: e.scoutName, matchKey: e.matchKey ?? null });
      byTeam.set(r.team, row);
    }
    alliances.push({
      key: `${e.eventCode}|${e.matchKey ?? ""}|${e.alliance ?? ""}|${e.id}`,
      eventCode: e.eventCode,
      matchKey: e.matchKey ?? null,
      alliance: e.alliance ?? null,
      teams: robots.length > 0 ? robots.map((r) => r.team) : teamsInText(text(e.values.overallAlliance_teams)),
      robots,
      allianceSkill: skill(e.values.overallAlliance_skillLevel),
      allianceNotes: text(e.values.overallAlliance_notes),
      scoutName: e.scoutName,
      entryId: e.id,
    });
  }
  const teams = [...byTeam.entries()].map(([teamNumber, r]) => ({ teamNumber, averageSkill: avg(r.skills), entries: r.entries, notes: r.notes })).sort((a, b) => a.teamNumber - b.teamNumber);
  alliances.sort((a, b) => a.eventCode.localeCompare(b.eventCode) || byMatchKey(a.matchKey, b.matchKey) || (a.alliance ?? "").localeCompare(b.alliance ?? ""));
  return { teams, alliances };
}

// --- Match Strategy and Drive Reflection ------------------------------------------------------------------------

/** One robot of a plan or a reflection. `startingPosition` and `role` are raw values; `endgameClimb` is "" (none) or "level-1" .. "level-3". */
export type PlanRobot = { slot: number; team: number; startingPosition: string; role: string; autoClimb: boolean; endgameClimb: string };

export type PlanRebuiltRow = {
  /** Event, match, alliance and the teams: two alliances of one match never share a key, even when CS stored no alliance (it has no column there). */
  key: string;
  eventCode: string;
  matchKey: string | null;
  alliance: "red" | "blue" | null;
  entryId: string;
  scoutName: string;
  createdAtMs: number;
  robots: PlanRobot[];
  notes: string;
  planDifferences: number | undefined;
  linkedEntryId: string | null;
};

export const planRobots = (e: FormEntry): PlanRobot[] =>
  robotSlots(e.values).flatMap((slot) => {
    const team = robotTeam(e.values, slot);
    if (team === null) return [];
    return [{ slot, team, startingPosition: text(e.values[`robot${slot}_startingPosition`]), role: text(e.values[`robot${slot}_role`]), autoClimb: isTrue(e.values[`robot${slot}_autoClimb`]), endgameClimb: text(e.values[`robot${slot}_endgameClimb`]) }];
  });

const planKey = (e: FormEntry): string => `${e.eventCode}|${e.matchKey ?? ""}|${e.alliance ?? ""}|${planRobots(e).map((r) => r.team).sort((a, b) => a - b).join("-")}`;

function planRow(e: FormEntry): PlanRebuiltRow {
  return { key: planKey(e), eventCode: e.eventCode, matchKey: e.matchKey ?? null, alliance: e.alliance ?? null, entryId: e.id, scoutName: e.scoutName, createdAtMs: e.createdAtMs, robots: planRobots(e), notes: text(e.values.notes), planDifferences: e.planDifferences, linkedEntryId: e.linkedEntryId ?? null };
}

const byMatchRow = (a: PlanRebuiltRow, b: PlanRebuiltRow) => a.eventCode.localeCompare(b.eventCode) || byMatchKey(a.matchKey, b.matchKey) || (a.alliance ?? "").localeCompare(b.alliance ?? "") || b.createdAtMs - a.createdAtMs;

/** One row per match, alliance and set of teams (the latest entry), or every entry with `latestOnly: false`. Ordered by event, then match. Excluded entries never count. */
export function planRebuiltRows(entries: readonly FormEntry[], opts: { latestOnly?: boolean } = {}): PlanRebuiltRow[] {
  const live = entries.filter((e) => !e.excluded);
  return (opts.latestOnly === false ? live : latestBy(live, planKey)).map(planRow).sort(byMatchRow);
}

export type ReflectionDifference = { team: number; field: "startingPosition" | "autoClimb" | "endgameClimb"; planned: string; actual: string };
export type ReflectionRebuiltRow = PlanRebuiltRow & {
  /** The plan it was compared with (by link, else the plan of the same event and match sharing the most robots), or null when nobody planned the match. */
  plan: PlanRebuiltRow | null;
  differences: ReflectionDifference[];
};

const norm = (v: string) => v.trim().toLowerCase();
const climbText = (v: string) => (v ? titleCase(v) : "None");

/**
 * What differs between a robot's plan and what happened. Mirrors CS's drive reflection form (compareRobotToPlan): a starting position differs unless one side is blank
 * or the plan said "any"; auto climb differs when the booleans do; endgame climb differs only when both sides chose one. The role is NOT compared: CS's two forms
 * offer different role lists (Offense / Defense / Feeder against Cycler / Passer / Shooter / Stealer), so it would always differ.
 */
export function compareRobotToPlan(actual: PlanRobot, planned: PlanRobot): ReflectionDifference[] {
  const out: ReflectionDifference[] = [];
  const a = norm(actual.startingPosition);
  const p = norm(planned.startingPosition);
  if (a && p && p !== "any" && p !== "anywhere" && a !== p) out.push({ team: actual.team, field: "startingPosition", planned: titleCase(planned.startingPosition), actual: titleCase(actual.startingPosition) });
  if (actual.autoClimb !== planned.autoClimb) out.push({ team: actual.team, field: "autoClimb", planned: planned.autoClimb ? "Yes" : "No", actual: actual.autoClimb ? "Yes" : "No" });
  const ae = norm(actual.endgameClimb);
  const pe = norm(planned.endgameClimb);
  if (ae && pe && ae !== pe) out.push({ team: actual.team, field: "endgameClimb", planned: climbText(planned.endgameClimb), actual: climbText(actual.endgameClimb) });
  return out;
}

/** The plan a reflection is judged against: the linked one, else the latest plan of the same event and match with the most robots in common (at least one). */
export function planForReflection(reflection: FormEntry, plans: readonly FormEntry[]): FormEntry | null {
  if (reflection.linkedEntryId) {
    const linked = plans.find((p) => p.id === reflection.linkedEntryId);
    if (linked) return linked;
  }
  const mine = new Set(planRobots(reflection).map((r) => r.team));
  let best: { plan: FormEntry; overlap: number } | null = null;
  for (const p of plans) {
    if (p.excluded || p.eventCode !== reflection.eventCode || (p.matchKey ?? "") !== (reflection.matchKey ?? "")) continue;
    if (p.alliance && reflection.alliance && p.alliance !== reflection.alliance) continue;
    const overlap = planRobots(p).filter((r) => mine.has(r.team)).length;
    if (overlap > 0 && (!best || overlap > best.overlap || (overlap === best.overlap && p.createdAtMs > best.plan.createdAtMs))) best = { plan: p, overlap };
  }
  return best?.plan ?? null;
}

/** Reflections joined to their plan, with every difference listed. */
export function reflectionRebuiltRows(reflections: readonly FormEntry[], plans: readonly FormEntry[], opts: { latestOnly?: boolean } = {}): ReflectionRebuiltRow[] {
  const live = reflections.filter((e) => !e.excluded);
  const source = opts.latestOnly === false ? live : latestBy(live, planKey);
  return source
    .map((e): ReflectionRebuiltRow => {
      const row = planRow(e);
      const planEntry = planForReflection(e, plans);
      const plan = planEntry ? planRow(planEntry) : null;
      const differences = plan ? row.robots.flatMap((r) => { const p = plan.robots.find((x) => x.team === r.team); return p ? compareRobotToPlan(r, p) : []; }) : [];
      return { ...row, plan, differences };
    })
    .sort(byMatchRow);
}

/** "% of matches that went to plan": of the reflections that had a plan, the share with no differences. Null when none had a plan. */
export function wentToPlanRebuilt(rows: readonly ReflectionRebuiltRow[]): { planned: number; onPlan: number; percent: number | null } {
  const planned = rows.filter((r) => r.plan !== null);
  const onPlan = planned.filter((r) => r.differences.length === 0).length;
  return { planned: planned.length, onPlan, percent: planned.length === 0 ? null : Math.round((onPlan / planned.length) * 100) };
}

// --- Helper ---------------------------------------------------------------------------------------------------

export type HelperRebuiltScoutRow = { scoutName: string; assists: number; successful: number; rate: number | null };

export function helperRebuiltAnalytics(entries: readonly FormEntry[]): { log: FormEntry[]; perScout: HelperRebuiltScoutRow[]; total: number; successful: number; rate: number | null } {
  const live = entries.filter((e) => !e.excluded).sort((a, b) => b.createdAtMs - a.createdAtMs);
  const by = new Map<string, { assists: number; successful: number }>();
  for (const e of live) {
    const r = by.get(e.scoutName) ?? { assists: 0, successful: 0 };
    r.assists += 1;
    if (isTrue(e.values.wasSuccessful)) r.successful += 1;
    by.set(e.scoutName, r);
  }
  const successful = live.filter((e) => isTrue(e.values.wasSuccessful)).length;
  return {
    log: live,
    perScout: [...by.entries()].map(([scoutName, r]) => ({ scoutName, ...r, rate: r.assists === 0 ? null : Math.round((r.successful / r.assists) * 100) })).sort((a, b) => b.assists - a.assists || a.scoutName.localeCompare(b.scoutName)),
    total: live.length,
    successful,
    rate: live.length === 0 ? null : Math.round((successful / live.length) * 100),
  };
}

export const helperWasSuccessful = (e: FormEntry): boolean => isTrue(e.values.wasSuccessful);
export const helperIssue = (e: FormEntry): string => text(e.values.issueSolved);

// --- Team Profile ---------------------------------------------------------------------------------------------

/** The most common non-empty value, the first to reach it winning a tie (CS's `mode`). Null when there is none. */
export function modeOf(values: readonly (string | undefined | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let winner: string | null = null;
  let best = 0;
  for (const [value, n] of counts) {
    if (n > best) {
      best = n;
      winner = value;
    }
  }
  return winner;
}

/** What the plans (or the reflections) say about one team, over every entry: CS's Capability Comparison column. */
export type PlanCapability = {
  /** How many entries named the team. */
  entries: number;
  startingPosition: string | null;
  role: string | null;
  /** Share (0-100) of the robots whose auto climb was planned (or happened). Null with no robots. */
  autoClimbRate: number | null;
  endgameClimb: string | null;
};

export function planCapability(teamNumber: number, entries: readonly FormEntry[]): PlanCapability {
  const rows = entries.filter((e) => !e.excluded).flatMap((e) => planRobots(e).filter((r) => r.team === teamNumber));
  return {
    entries: rows.length,
    startingPosition: modeOf(rows.map((r) => r.startingPosition)),
    role: modeOf(rows.map((r) => r.role)),
    autoClimbRate: rows.length === 0 ? null : Math.round((rows.filter((r) => r.autoClimb).length / rows.length) * 100),
    endgameClimb: modeOf(rows.map((r) => r.endgameClimb)),
  };
}

export type TeamRebuiltProfile = {
  pit: PitRebuiltRow | null;
  strategy: StrategyRebuiltRow | null;
  /** Average Lead Scout skill for the team, over every rating, and the notes about it (newest first). */
  lead: { skill: number | null; ratings: number; notes: LeadRebuiltTeamRow["notes"] };
  plan: PlanCapability;
  reflection: PlanCapability;
  /** True when there is anything to show. */
  any: boolean;
};

/** What the Team Profile's "Pit and strategy" section shows for one team on REBUILT data: its latest pit and strategy entry, its lead-scout skill, and how its plans and reflections compare. */
export function teamRebuiltProfile(teamNumber: number, entries: readonly FormEntry[]): TeamRebuiltProfile {
  const of = (type: FormEntry["formType"]) => entries.filter((e) => e.formType === type);
  const mine = (type: FormEntry["formType"]) => of(type).filter((e) => e.teamNumber === teamNumber);
  const pits = pitRebuiltRows(mine("pit-scout"), { latestOnly: false });
  const pit = pits[0] ?? null;
  const strategy = strategyRebuiltSummary(mine("team-strategy"), { latestOnly: false }).rows[0] ?? null;
  const leadTeam = leadRebuiltSummary(of("lead-scout")).teams.find((t) => t.teamNumber === teamNumber);
  const plan = planCapability(teamNumber, of("match-strategy"));
  const reflection = planCapability(teamNumber, of("drive-reflection"));
  const lead = { skill: leadTeam?.averageSkill ?? null, ratings: leadTeam?.entries ?? 0, notes: [...(leadTeam?.notes ?? [])].reverse() };
  return { pit, strategy, lead, plan, reflection, any: !!pit || !!strategy || lead.ratings > 0 || plan.entries > 0 || reflection.entries > 0 };
}
