/**
 * Adapters between FTC `programs/ftc/assignments/*` documents and the app's assignment types. No React, no Firebase.
 *
 * One collection holds three things, told apart by id and `kind`:
 *  - match scouting: `{teamId}_{eventCode}` (no `kind`), `{ teamId, eventCode, current, previous }` where `current` is the published `AssignmentVersion` and
 *    `previous` the one before it (one level of undo);
 *  - pit scouting and team strategy: `{teamId}_{eventCode}_{pit|teamStrategy}` with a `kind` (read by `parseTeamAssignmentsDoc`).
 * Reads are tolerant: a missing or malformed part gets its neutral value and the doc is never dropped for it.
 */
import type { AssignmentMatchSource, AssignmentSettings, AssignmentsDoc, AssignmentVersion } from "@/lib/assignments";
import type { Difficulty } from "@/lib/difficulty";
import type { MatchType } from "@/lib/events/types";
import { parseScheduleSlots } from "@/lib/scheduler/parse";
import type { RotationPattern, ScheduleSlot } from "@/lib/scheduler/types";
import { parseTeamAssignmentsDoc, type TeamAssignKind, type TeamAssignVersion, type TeamAssignmentsDoc } from "@/lib/team-assignments/model";
import { finiteNumber, isRecord, nonEmptyString, numberOr, str, stringList } from "@/data/ftc/util";

/** The id of the match assignments doc of an event: `{teamId}_{eventCode}`. */
export const ftcAssignmentDocId = (teamId: string, eventCode: string): string => `${teamId}_${eventCode}`;

/** The id of a pit or team-strategy assignments doc: `{teamId}_{eventCode}_{kind}`. */
export const ftcTeamAssignmentDocId = (teamId: string, eventCode: string, kind: TeamAssignKind): string => `${teamId}_${eventCode}_${kind}`;

const MATCH_TYPES: readonly MatchType[] = ["Practice", "Qualification", "Playoff"];
const SOURCES: readonly AssignmentMatchSource[] = ["event", "practice", "live"];
const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];
const PATTERNS: readonly RotationPattern[] = ["rotate-each-match", "custom-interval", "constant-same-order"];

function readSettings(raw: unknown): AssignmentSettings {
  const s = isRecord(raw) ? raw : {};
  return {
    matchSource: SOURCES.find((x) => x === s.matchSource) ?? "event",
    seasonId: nonEmptyString(s.seasonId),
    difficulty: DIFFICULTIES.find((x) => x === s.difficulty) ?? null,
    rangesText: str(s.rangesText),
    categories: Array.isArray(s.categories) ? s.categories.filter((c): c is MatchType => MATCH_TYPES.includes(c as MatchType)) : [],
    pattern: PATTERNS.find((x) => x === s.pattern) ?? "rotate-each-match",
    intervalSize: finiteNumber(s.intervalSize),
    scoutUids: stringList(s.scoutUids),
    prioritizedTeams: Array.isArray(s.prioritizedTeams) ? s.prioritizedTeams.filter((n): n is number => finiteNumber(n) !== null) : [],
    seed: numberOr(s.seed, 0),
  };
}

function readCounts(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isRecord(raw)) for (const [uid, n] of Object.entries(raw)) if (finiteNumber(n) !== null) out[uid] = n as number;
  return out;
}

/** A published version, or null when the stored value is not a map. */
export function readAssignmentVersion(raw: unknown): AssignmentVersion | null {
  if (!isRecord(raw)) return null;
  return {
    generatedBy: str(raw.generatedBy),
    generatedAt: str(raw.generatedAt),
    settings: readSettings(raw.settings),
    slots: parseScheduleSlots(raw.slots),
    counts: readCounts(raw.counts),
    fair: raw.fair !== false,
    warning: nonEmptyString(raw.warning),
  };
}

/** Reads a match assignments doc. */
export function ftcDocToAssignments(id: string, doc: Record<string, unknown>): AssignmentsDoc {
  return { id, teamId: str(doc.teamId), eventCode: str(doc.eventCode), current: readAssignmentVersion(doc.current), previous: readAssignmentVersion(doc.previous) };
}

/**
 * The match assignments doc of an event out of the rows of a team-and-event query: the doc with the event's own id, else any row with no `kind` (a pit or
 * team-strategy doc of the same event is not it). Null when the event has none.
 */
export function pickMatchAssignments(teamId: string, eventCode: string, rows: readonly { id: string; data: unknown }[]): AssignmentsDoc | null {
  const wanted = ftcAssignmentDocId(teamId, eventCode);
  const plain = rows.filter((r): r is { id: string; data: Record<string, unknown> } => isRecord(r.data) && r.data.kind === undefined);
  const row = plain.find((r) => r.id === wanted) ?? plain[0];
  return row ? ftcDocToAssignments(row.id, row.data) : null;
}

/** Every pit and team-strategy doc among a team's assignment rows (the match docs, and anything malformed, are skipped). */
export function ftcDocsToTeamAssignments(rows: readonly { id: string; data: unknown }[]): TeamAssignmentsDoc[] {
  return rows.flatMap((r) => {
    const doc = isRecord(r.data) ? parseTeamAssignmentsDoc(r.id, r.data) : null;
    return doc ? [doc] : [];
  });
}

/** What is stored when a version is published: it becomes `current`, the one it replaces becomes `previous`. */
export function ftcAssignmentsDoc(teamId: string, eventCode: string, version: AssignmentVersion, previous: AssignmentVersion | null, now: () => unknown): Record<string, unknown> {
  return { teamId, eventCode, current: version, previous, updatedAt: now() };
}

/** What is stored when a pit or team-strategy version is published. */
export function ftcTeamAssignmentsDoc(
  teamId: string,
  eventCode: string,
  kind: TeamAssignKind,
  version: TeamAssignVersion,
  previous: TeamAssignVersion | null,
  now: () => unknown
): Record<string, unknown> {
  return { teamId, eventCode, kind, current: version, previous, updatedAt: now() };
}

/**
 * One manual cell edit: re-point a single slot at a different scout (or clear it with null), recount each scout's matches and recheck fairness (the counts may
 * differ by at most one). Null when the version has no such slot (nothing to write).
 */
export function applySlotSwap(version: AssignmentVersion, matchType: MatchType, matchNumber: number, slot: ScheduleSlot["slot"], newScoutUid: string | null): AssignmentVersion | null {
  const at = (s: ScheduleSlot) => s.matchType === matchType && s.matchNumber === matchNumber && s.slot === slot;
  if (!version.slots.some(at)) return null;
  const slots = version.slots.map((s) => (at(s) ? { ...s, scoutUid: newScoutUid } : s));
  const counts: Record<string, number> = {};
  for (const uid of Object.keys(version.counts)) counts[uid] = 0;
  for (const s of slots) if (s.scoutUid) counts[s.scoutUid] = (counts[s.scoutUid] ?? 0) + 1;
  const values = Object.values(counts);
  const fair = values.length === 0 || Math.max(...values) - Math.min(...values) <= 1;
  return { ...version, slots, counts, fair, warning: fair ? null : `Assignment counts range from ${Math.min(...values)} to ${Math.max(...values)} after this edit.` };
}
