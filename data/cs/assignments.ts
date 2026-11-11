/**
 * Adapter between CS's flat assignment collections and the app's assignment model (docs/ROUTES.md D1, D10). No React, no Firebase.
 *
 * CS stores one document per scout x match (`matchAssignments`) or per scout x team (`pitAssignments`, `teamAssignments`,
 * plus a `matchAssignments` mirror of team-strategy rows with `assignmentType: "team"`, `matchKey: "team"`) and
 * `practiceAssignments` (library practice matches: `practiceMatchId`, `matchKey: "pN"`). The app keeps one versioned document with
 * `current.slots[]` (a slot is one robot of one match: `red1` .. `blue3`) and `current.teams[]`. The converters here:
 *
 *  READ   `csRowsToSlots` / `csRowsToVersion`   flat rows -> app slots/version (slot ids derived from the match schedule)
 *         `csTeamRowsToDocs`                   pit/team rows -> app `TeamAssignmentsDoc`s
 *  WRITE  `slotsToCsRows`, `teamsToCsRows`       app version -> the flat docs that should exist
 *         `planAssignmentWrite`                 existing rows + desired rows -> creates / patches / removals (minimal, keyed by
 *                                               match + team, so unchanged rows and their unknown fields are never touched, D10)
 *  EVENT ATTENDANCE (`teams.eventAttendees`)    `attendeeUidsForEvent` (uid or display name on read), `attendeesPatch` (uids on write)
 *
 * Slot derivation (documented fallback): a CS row has a team number and a match key but no robot position. The position is the
 * index of the team in the match's red or blue alliance, from the schedule the caller passes as a `ScheduleLookup`. When the
 * schedule has no such match (not fetched yet, practice-library matches, a team that is not in the match any more) the row is
 * placed in the first free slot of the match in `assignedAt, teamNumber` order. The CS writers never read the position, so
 * the fallback only affects how the app's grid lays the row out, never what is stored.
 */
import { allianceSlots, isSlotId, slotAlliance, slotIndex } from "@/config/alliance";
import { EVENT_CONFIG, expandEventKeyAliases, normalizeEventKey } from "@/config/event";
import { csDocMatchRef, normalizeCsMatchId } from "@/data/cs/match-id";
import type { CsRecord } from "@/data/cs/types";
import { asRecord, cloneValue, digitsToNumber, isoFromMs, isRecord, str, toEpochMs } from "@/data/cs/util";
import type { AssignmentSettings, AssignmentVersion } from "@/lib/assignments";
import type { MatchType } from "@/lib/events/types";
import type { MatchInput, ScheduleSlot, SlotId } from "@/lib/scheduler/types";
import type { TeamAssignKind, TeamAssignmentsDoc, TeamAssignVersion } from "@/lib/team-assignments/model";
import type { TeamAssignRow } from "@/lib/team-assignments/distribute";

// ---------------------------------------------------------------------------------------------------------------------
// Collections and document shapes
// ---------------------------------------------------------------------------------------------------------------------

export const CS_MATCH_ASSIGNMENTS = "matchAssignments";
export const CS_PIT_ASSIGNMENTS = "pitAssignments";
export const CS_TEAM_ASSIGNMENTS = "teamAssignments";
export const CS_PRACTICE_ASSIGNMENTS = "practiceAssignments";

/** A CS assignment document body. Open map: production docs carry fields this adapter does not know (D10). */
export type CsAssignmentDoc = {
  teamId?: string;
  eventKey?: string;
  matchKey?: string;
  matchLabel?: string;
  scoutId?: string;
  scoutName?: string;
  /** A number as written by CS's page; old docs may hold a string. */
  teamNumber?: number | string;
  scoutHumanPlayer?: boolean;
  assignedBy?: string;
  assignedAt?: number;
  /** `"team"` (team-strategy mirror) or `"event-practice"` (an event's practice matches); absent for qualification and playoffs. */
  assignmentType?: string;
  practiceMatchId?: string;
  [key: string]: unknown;
};

/** A document with its id, as `snap.docs.map((d) => ({ id: d.id, data: d.data() }))`. */
export type CsAssignmentRow = { id: string; data: CsRecord };

/** `assignmentType: "team"` rows are team-strategy mirrors inside `matchAssignments` (CS `isTeamAssignmentRow`). */
export function isTeamMirrorRow(data: CsRecord): boolean {
  return data.assignmentType === "team" || data.matchKey === "team";
}

/** `assignmentType: "event-practice"` (CS `isEventPracticeAssignment`). */
export function isEventPracticeRow(data: CsRecord): boolean {
  return data.assignmentType === "event-practice";
}

/** The Firestore `eventKey` values to query for an event code: the canonical key plus every legacy alias. */
export function eventKeyVariants(eventCode: string): string[] {
  return expandEventKeyAliases(eventCode);
}

/** Does a stored row belong to this event (aliases resolved)? */
export function rowIsForEvent(data: CsRecord, eventCode: string): boolean {
  return normalizeEventKey(str(data.eventKey)) === normalizeEventKey(eventCode);
}

// ---------------------------------------------------------------------------------------------------------------------
// Match keys <-> app (matchType, matchNumber)
// ---------------------------------------------------------------------------------------------------------------------

const MATCH_TYPE_ORDER: Record<MatchType, number> = { Practice: 0, Qualification: 1, Playoff: 2 };

/** The app match a `matchAssignments` row is for (matchKey, then matchLabel), or null for a row that is not a match (`"team"`). */
export function csAssignmentMatchRef(data: CsRecord): { matchType: MatchType; matchNumber: number } | null {
  if (isTeamMirrorRow(data)) return null;
  const ref = csDocMatchRef({ matchKey: data.matchKey, matchLabel: data.matchLabel });
  return ref.matchNumber > 0 ? ref : null;
}

/**
 * The `matchKey` CS's assignments page writes for an app match: a TBA key for the event schedule (`2026arli_qm12`, bracket slot
 * `2026arli_sf3m1`, finals game `2026arli_f1m2`) and `pN` for a practice match. All of them parse back through
 * `normalizeCsMatchId` to the short id CS's scout form compares against.
 */
export function appMatchToCsKey(eventKey: string, matchType: MatchType, matchNumber: number): string {
  const n = Math.max(0, Math.trunc(matchNumber));
  if (matchType === "Practice") return `p${n}`;
  const key = normalizeEventKey(eventKey);
  if (matchType === "Qualification") return `${key}_qm${n}`;
  const { bracketSlots, finalsOffset } = EVENT_CONFIG.playoff;
  if (n > bracketSlots) return `${key}_f1m${n - finalsOffset}`;
  return `${key}_sf${n}m1`;
}

/** The `matchLabel` CS writes (`matchLabel()` in its assignments page). */
export function appMatchToCsLabel(matchType: MatchType, matchNumber: number): string {
  const n = Math.max(0, Math.trunc(matchNumber));
  if (matchType === "Practice") return `Practice ${n}`;
  if (matchType === "Qualification") return `Qualification ${n}`;
  const { bracketSlots, finalsOffset } = EVENT_CONFIG.playoff;
  if (n > bracketSlots) return `Finals ${n - finalsOffset}`;
  return `Semifinal ${n}-1`;
}

/** Stable key of a match across both representations (short CS id of a stored row, or the id built from the app's number). */
function matchIdentity(matchType: MatchType, matchNumber: number): string {
  return `${matchType}:${matchNumber}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Slot derivation
// ---------------------------------------------------------------------------------------------------------------------

export type MatchTeams = { red: readonly number[]; blue: readonly number[] };
/** The alliances of a scheduled match, or null when the schedule does not have it. */
export type ScheduleLookup = (matchType: MatchType, matchNumber: number) => MatchTeams | null;

/** A lookup over the scheduler's match inputs (an excluded alliance, `null`, counts as empty). */
export function buildScheduleLookup(matches: readonly MatchInput[]): ScheduleLookup {
  const byMatch = new Map<string, MatchTeams>();
  for (const m of matches) byMatch.set(matchIdentity(m.matchType, m.matchNumber), { red: m.red ?? [], blue: m.blue ?? [] });
  return (matchType, matchNumber) => byMatch.get(matchIdentity(matchType, matchNumber)) ?? null;
}

/** The robot position of a team in a match (`red1` .. `blue3`), or null when the team is not in it. */
export function deriveSlot(teams: MatchTeams, teamNumber: number): SlotId | null {
  const red = teams.red.indexOf(teamNumber);
  if (red >= 0) return `red${red + 1}` as SlotId;
  const blue = teams.blue.indexOf(teamNumber);
  if (blue >= 0) return `blue${blue + 1}` as SlotId;
  return null;
}

type MatchRowCandidate = { id: string; matchType: MatchType; matchNumber: number; teamNumber: number; scoutUid: string | null; assignedAt: number };

/** Slots of one match: schedule position when derivable and free, else the first free slot (see the file header). */
function placeMatchRows(rows: MatchRowCandidate[], teams: MatchTeams | null): Array<MatchRowCandidate & { slot: SlotId }> {
  const ordered = [...rows].sort((a, b) => a.assignedAt - b.assignedAt || a.teamNumber - b.teamNumber || a.id.localeCompare(b.id));
  const used = new Set<string>();
  const out: Array<MatchRowCandidate & { slot: SlotId }> = [];
  const pending: MatchRowCandidate[] = [];
  for (const row of ordered) {
    const derived = teams ? deriveSlot(teams, row.teamNumber) : null;
    if (derived && !used.has(derived)) {
      used.add(derived);
      out.push({ ...row, slot: derived });
    } else {
      pending.push(row);
    }
  }
  const pool = allianceSlots();
  // More rows than robots (a duplicate scout row): continue past the alliance size so nothing is dropped.
  let extra = pool.length / 2;
  for (const row of pending) {
    let slot: string | undefined = pool.find((s) => !used.has(s));
    while (!slot && extra < 9) {
      extra += 1;
      if (!used.has(`red${extra}`)) slot = `red${extra}`;
    }
    if (!slot) continue;
    used.add(slot);
    out.push({ ...row, slot: slot as SlotId });
  }
  return out;
}

function compareSlots(a: ScheduleSlot, b: ScheduleSlot): number {
  return (
    MATCH_TYPE_ORDER[a.matchType] - MATCH_TYPE_ORDER[b.matchType] ||
    a.matchNumber - b.matchNumber ||
    (slotAlliance(a.slot) === slotAlliance(b.slot) ? 0 : slotAlliance(a.slot) === "red" ? -1 : 1) ||
    slotIndex(a.slot) - slotIndex(b.slot)
  );
}

/**
 * `matchAssignments` (and `practiceAssignments`) rows -> app slots. Team-strategy mirrors and rows whose match cannot be parsed are
 * skipped. When two rows are for the same match and team (`matchAssignments` row wins over a `practiceAssignments` one) the
 * earlier row in `rows` is kept, so pass the primary collection first.
 */
export function csRowsToSlots(rows: readonly CsAssignmentRow[], lookup?: ScheduleLookup | null): ScheduleSlot[] {
  const byMatch = new Map<string, MatchRowCandidate[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    const ref = csAssignmentMatchRef(row.data);
    if (!ref) continue;
    const teamNumber = digitsToNumber(row.data.teamNumber);
    if (teamNumber <= 0) continue;
    const scoutId = str(row.data.scoutId).trim();
    const dedupe = `${matchIdentity(ref.matchType, ref.matchNumber)}|${teamNumber}|${scoutId}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const key = matchIdentity(ref.matchType, ref.matchNumber);
    const list = byMatch.get(key) ?? [];
    list.push({ id: row.id, ...ref, teamNumber, scoutUid: scoutId || null, assignedAt: toEpochMs(row.data.assignedAt) });
    byMatch.set(key, list);
  }
  const slots: ScheduleSlot[] = [];
  for (const list of byMatch.values()) {
    const teams = lookup ? lookup(list[0].matchType, list[0].matchNumber) : null;
    for (const placed of placeMatchRows(list, teams)) {
      slots.push({ matchType: placed.matchType, matchNumber: placed.matchNumber, slot: placed.slot, teamNumber: placed.teamNumber, scoutUid: placed.scoutUid });
    }
  }
  return slots.sort(compareSlots);
}

/** Assigned-slot count per scout (every uid in `scoutUids` is present, even at 0), and whether the counts are within 1 of each other. */
export function summarizeSlots(slots: readonly ScheduleSlot[], scoutUids: readonly string[] = []): { counts: Record<string, number>; fair: boolean; warning: string | null } {
  const counts: Record<string, number> = {};
  for (const uid of scoutUids) counts[uid] = 0;
  for (const s of slots) if (s.scoutUid) counts[s.scoutUid] = (counts[s.scoutUid] ?? 0) + 1;
  const values = Object.values(counts);
  const fair = values.length === 0 || Math.max(...values) - Math.min(...values) <= 1;
  return { counts, fair, warning: fair ? null : `Assignment counts range from ${Math.min(...values)} to ${Math.max(...values)}.` };
}

function defaultSettings(slots: readonly ScheduleSlot[], counts: Record<string, number>): AssignmentSettings {
  const categories = [...new Set(slots.map((s) => s.matchType))].sort((a, b) => MATCH_TYPE_ORDER[a] - MATCH_TYPE_ORDER[b]);
  return {
    matchSource: "event",
    seasonId: null,
    difficulty: null,
    rangesText: "",
    categories,
    pattern: "rotate-each-match",
    intervalSize: null,
    scoutUids: Object.keys(counts),
    prioritizedTeams: [],
    seed: 0,
  };
}

/**
 * Flat rows -> the version the Assignments page shows. CS keeps no version metadata, so `generatedBy` is the `assignedBy` of
 * the newest row, `generatedAt` is that row's `assignedAt` (ISO), `settings` are neutral defaults and `counts` / `fair` /
 * `warning` are recomputed. Null when no row maps to a slot.
 */
export function csRowsToVersion(rows: readonly CsAssignmentRow[], lookup?: ScheduleLookup | null): AssignmentVersion | null {
  const slots = csRowsToSlots(rows, lookup);
  if (slots.length === 0) return null;
  let newest = 0;
  let by = "";
  for (const row of rows) {
    if (!csAssignmentMatchRef(row.data)) continue;
    const at = toEpochMs(row.data.assignedAt);
    if (at >= newest) {
      newest = at;
      by = str(row.data.assignedBy);
    }
  }
  const { counts, fair, warning } = summarizeSlots(slots, [...new Set(slots.map((s) => s.scoutUid).filter((u): u is string => u !== null))]);
  return { generatedBy: by, generatedAt: isoFromMs(newest), settings: defaultSettings(slots, counts), slots, counts, fair, warning };
}

// ---------------------------------------------------------------------------------------------------------------------
// Write: app slots -> flat docs
// ---------------------------------------------------------------------------------------------------------------------

export type AssignmentWriteContext = {
  teamId: string;
  eventKey: string;
  /** uid of the person publishing (`assignedBy`). */
  actorUid: string;
  /** Epoch ms; row i gets `now + i` like CS's randomizer so a later sort by `assignedAt` keeps the schedule order. */
  now: number;
  /** uid -> display name (`scoutName`). A uid with no entry is written with an empty name. */
  scoutNames: ReadonlyMap<string, string>;
};

/** The two robots CS marks as human-player scouts: index 0 and `floor(n / 2)` of a 6-slot match, i.e. `red1` and `blue1`. */
export function isHumanPlayerSlot(slot: string): boolean {
  return slotIndex(slot) === 0 && isSlotId(slot);
}

/**
 * The `matchAssignments` docs for a set of slots, one per slot with a scout. `Practice` slots get `assignmentType:
 * "event-practice"` (CS's event-practice schedule). `target: "practice"` instead builds `practiceAssignments` docs (library
 * practice matches: `practiceMatchId`, no human-player flag).
 */
export function slotsToCsRows(slots: readonly ScheduleSlot[], ctx: AssignmentWriteContext, target: "match" | "practice" = "match"): CsAssignmentDoc[] {
  const eventKey = normalizeEventKey(ctx.eventKey);
  const ordered = [...slots].filter((s) => s.scoutUid).sort(compareSlots);
  return ordered.map((s, index) => {
    const base: CsAssignmentDoc = {
      teamId: ctx.teamId,
      eventKey,
      matchKey: appMatchToCsKey(eventKey, s.matchType, s.matchNumber),
      matchLabel: appMatchToCsLabel(s.matchType, s.matchNumber),
      scoutId: s.scoutUid as string,
      scoutName: ctx.scoutNames.get(s.scoutUid as string) ?? "",
      teamNumber: s.teamNumber,
      assignedBy: ctx.actorUid,
      assignedAt: ctx.now + index,
    };
    if (target === "practice") return { ...base, practiceMatchId: `practice_${eventKey}_${s.matchNumber}` };
    return { ...base, scoutHumanPlayer: isHumanPlayerSlot(s.slot), ...(s.matchType === "Practice" ? { assignmentType: "event-practice" } : {}) };
  });
}

export type AssignmentWritePlan = {
  /** New documents to add (auto ids, like CS's `addDoc`). */
  create: CsAssignmentDoc[];
  /** Existing documents to merge a patch into (the scout changed for the same match and team). */
  update: Array<{ id: string; patch: CsAssignmentDoc }>;
  /** Existing documents to delete. */
  remove: string[];
};

/** Identity of a row inside its collection: the match (or `team`) and the team number. */
function rowKey(data: CsRecord): string {
  const matchKey = str(data.matchKey);
  const match = matchKey === "team" || matchKey === "" ? "team" : normalizeCsMatchId(matchKey) || matchKey;
  return `${match}|${digitsToNumber(data.teamNumber)}`;
}

/**
 * Minimal writes that turn `existing` into `desired`. Rows are matched by match + team: an existing row for the same match and
 * team keeps its document (and every field the adapter does not know), getting only a patch when the scout changed; a desired
 * row with no counterpart is created; an existing row with no counterpart (or a duplicate of one) is removed. When one match
 * has two desired rows for the same team (two scouts on a team) rows pair up with existing ones by scout id first.
 */
export function planAssignmentWrite(existing: readonly CsAssignmentRow[], desired: readonly CsAssignmentDoc[]): AssignmentWritePlan {
  const plan: AssignmentWritePlan = { create: [], update: [], remove: [] };
  const existingBy = new Map<string, CsAssignmentRow[]>();
  for (const row of existing) {
    const key = rowKey(row.data);
    const list = existingBy.get(key) ?? [];
    list.push(row);
    existingBy.set(key, list);
  }
  const desiredBy = new Map<string, CsAssignmentDoc[]>();
  for (const doc of desired) {
    const key = rowKey(doc);
    const list = desiredBy.get(key) ?? [];
    list.push(doc);
    desiredBy.set(key, list);
  }
  for (const [key, wanted] of desiredBy) {
    const have = [...(existingBy.get(key) ?? [])];
    const unmatched: CsAssignmentDoc[] = [];
    for (const doc of wanted) {
      const sameScout = have.findIndex((row) => str(row.data.scoutId) === str(doc.scoutId));
      if (sameScout >= 0) have.splice(sameScout, 1);
      else unmatched.push(doc);
    }
    for (const doc of unmatched) {
      const row = have.shift();
      if (row) {
        plan.update.push({ id: row.id, patch: { scoutId: doc.scoutId, scoutName: doc.scoutName, assignedBy: doc.assignedBy, assignedAt: doc.assignedAt } });
      } else {
        plan.create.push(doc);
      }
    }
    for (const row of have) plan.remove.push(row.id);
  }
  for (const [key, rows] of existingBy) {
    if (!desiredBy.has(key)) for (const row of rows) plan.remove.push(row.id);
  }
  return plan;
}

/** The post-write state of rows under `plan`, for tests and optimistic callers: existing minus removed, with patches merged, plus created. */
export function applyAssignmentPlan(existing: readonly CsAssignmentRow[], plan: AssignmentWritePlan): CsAssignmentRow[] {
  const removed = new Set(plan.remove);
  const patches = new Map(plan.update.map((u) => [u.id, u.patch]));
  const kept = existing
    .filter((row) => !removed.has(row.id))
    .map((row) => ({ id: row.id, data: { ...cloneValue(row.data), ...(patches.get(row.id) ?? {}) } as CsRecord }));
  return [...kept, ...plan.create.map((data, i) => ({ id: `new-${i}`, data: data as CsRecord }))];
}

// ---------------------------------------------------------------------------------------------------------------------
// Pit scouting / team strategy (app `TeamAssignmentsDoc`)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Rows of one kind -> app docs, one per event. `pit` rows come from `pitAssignments`; `teamStrategy` rows from
 * `teamAssignments` plus the `matchAssignments` mirror (`assignmentType: "team"`), merged by event + team + scout. CS has one
 * scout per row, so an app team with two scouts is two rows. `locked` (an app-only flag) is not stored and reads false.
 */
export function csTeamRowsToDocs(kind: TeamAssignKind, rows: readonly CsAssignmentRow[], teamId: string): TeamAssignmentsDoc[] {
  const byEvent = new Map<string, Map<number, Set<string>>>();
  const meta = new Map<string, { at: number; by: string }>();
  for (const row of rows) {
    const eventKey = normalizeEventKey(str(row.data.eventKey));
    const teamNumber = digitsToNumber(row.data.teamNumber);
    const scoutId = str(row.data.scoutId).trim();
    if (!eventKey || teamNumber <= 0 || !scoutId) continue;
    const teams = byEvent.get(eventKey) ?? new Map<number, Set<string>>();
    const scouts = teams.get(teamNumber) ?? new Set<string>();
    scouts.add(scoutId);
    teams.set(teamNumber, scouts);
    byEvent.set(eventKey, teams);
    const at = toEpochMs(row.data.assignedAt);
    const known = meta.get(eventKey);
    if (!known || at >= known.at) meta.set(eventKey, { at, by: str(row.data.assignedBy) });
  }
  const docs: TeamAssignmentsDoc[] = [];
  for (const [eventKey, teams] of byEvent) {
    const teamRows: TeamAssignRow[] = [...teams.entries()].sort((a, b) => a[0] - b[0]).map(([teamNumber, scouts]) => ({ teamNumber, scoutUids: [...scouts], locked: false }));
    const counts: Record<string, number> = {};
    for (const r of teamRows) for (const uid of r.scoutUids) counts[uid] = (counts[uid] ?? 0) + 1;
    const values = Object.values(counts);
    const uneven = values.length > 0 && Math.max(...values) - Math.min(...values) > 1;
    const m = meta.get(eventKey) ?? { at: 0, by: "" };
    const current: TeamAssignVersion = {
      generatedBy: m.by,
      generatedAt: isoFromMs(m.at),
      settings: { scoutUids: Object.keys(counts), priorityTeams: [], priorityCoverage: 2, mode: "balanced-random", includeOurs: false, seed: 0 },
      teams: teamRows,
      counts,
      uneven,
      warning: uneven ? `Teams per scout range from ${Math.min(...values)} to ${Math.max(...values)}.` : null,
    };
    docs.push({ id: `${teamId}_${eventKey}_${kind}`, teamId, eventCode: eventKey, kind, current, previous: null });
  }
  return docs.sort((a, b) => a.eventCode.localeCompare(b.eventCode));
}

/** One CS doc per team x scout. `mirror: true` builds the `matchAssignments` team-strategy mirror (`matchKey: "team"`). */
export function teamsToCsRows(teams: readonly TeamAssignRow[], ctx: AssignmentWriteContext, mirror = false): CsAssignmentDoc[] {
  const eventKey = normalizeEventKey(ctx.eventKey);
  const out: CsAssignmentDoc[] = [];
  let i = 0;
  for (const row of [...teams].sort((a, b) => a.teamNumber - b.teamNumber)) {
    for (const uid of row.scoutUids) {
      const base: CsAssignmentDoc = {
        teamId: ctx.teamId,
        eventKey,
        teamNumber: row.teamNumber,
        scoutId: uid,
        scoutName: ctx.scoutNames.get(uid) ?? "",
        assignedBy: ctx.actorUid,
        assignedAt: ctx.now + i++,
      };
      out.push(mirror ? { ...base, assignmentType: "team", matchKey: "team", matchLabel: "Team Strategy", scoutHumanPlayer: false } : base);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Event attendance (`teams.eventAttendees`)
// ---------------------------------------------------------------------------------------------------------------------

export type AttendeeMember = { uid: string; name: string };

function eventAttendeeEntries(attendees: unknown, eventCode: string): string[] {
  if (!isRecord(attendees)) return [];
  const out: string[] = [];
  for (const variant of eventKeyVariants(eventCode)) {
    const list = attendees[variant];
    if (Array.isArray(list)) for (const v of list) if (typeof v === "string" && v.trim()) out.push(v.trim());
  }
  return out;
}

/**
 * The uids attending an event. CS stored a uid or, on older docs, a display name: a name resolves to the member's uid
 * (case-insensitive, exact), a uid passes through, an entry that is neither is dropped from the result (but kept by
 * `attendeesPatch`). Order of the stored list is kept; duplicates collapse.
 */
export function attendeeUidsForEvent(attendees: unknown, eventCode: string, members: readonly AttendeeMember[]): string[] {
  const byUid = new Set(members.map((m) => m.uid));
  const byName = new Map(members.map((m) => [m.name.trim().toLowerCase(), m.uid] as const));
  const out: string[] = [];
  for (const entry of eventAttendeeEntries(attendees, eventCode)) {
    const uid = byUid.has(entry) ? entry : byName.get(entry.toLowerCase());
    if (uid && !out.includes(uid)) out.push(uid);
  }
  return out;
}

/**
 * The merge-write body that saves `uids` as an event's attendees: `{ eventAttendees: { [eventKey]: [...] } }` (a nested merge, so
 * the other events and every other team field stay as they are). Uids are written. A stored entry that is a member's name is
 * replaced by that uid (CS's own toggle does the same); an entry that is neither a uid nor a known name is kept, so nothing
 * CS recorded is lost (D10). Legacy alias keys (`2025lake`) are folded into the canonical key.
 */
export function attendeesPatch(existing: unknown, eventCode: string, uids: readonly string[], members: readonly AttendeeMember[]): { eventAttendees: Record<string, string[]> } {
  const known = new Set(members.map((m) => m.uid));
  const names = new Set(members.map((m) => m.name.trim().toLowerCase()));
  const keep = eventAttendeeEntries(existing, eventCode).filter((entry) => !known.has(entry) && !names.has(entry.toLowerCase()));
  const key = normalizeEventKey(eventCode);
  return { eventAttendees: { [key]: [...new Set([...uids, ...keep])] } };
}

/** The alias keys of `existing` that `attendeesPatch` folded into the canonical key: delete these with `deleteField()` when they differ. */
export function staleAttendeeKeys(existing: unknown, eventCode: string): string[] {
  const canonical = normalizeEventKey(eventCode);
  if (!isRecord(existing)) return [];
  return Object.keys(existing).filter((k) => k !== canonical && normalizeEventKey(k) === canonical);
}

/** CS `manualTeamListsByEvent[eventKey]` -> team numbers (it is stored as numbers; a string list and `"254, 971"` also read). */
export function manualTeamList(lists: unknown, eventCode: string): number[] {
  const record = asRecord(lists);
  for (const variant of eventKeyVariants(eventCode)) {
    const raw = record[variant];
    const items = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,;]+/) : [];
    const nums = items.map((v) => digitsToNumber(v)).filter((n) => n > 0);
    if (nums.length > 0) return [...new Set(nums)];
  }
  return [];
}

/** One recorded event of `teams.eventAttendees`, in the app's `EventAttendance` shape (`id` is `{teamId}_{eventKey}`). */
export type AttendanceRecord = { id: string; teamId: string; eventCode: string; uids: string[]; updatedAt: null };

/**
 * Every event with at least one stored attendee, as app attendance records (alias keys folded into the canonical key). CS keeps no
 * per-event timestamp, so `updatedAt` is null. Entries that are a uid or a member's display name resolve to uids.
 */
export function attendanceRecordsFromTeam(teamId: string, attendees: unknown, members: readonly AttendeeMember[]): AttendanceRecord[] {
  if (!isRecord(attendees)) return [];
  const events = new Set<string>();
  for (const key of Object.keys(attendees)) if (eventAttendeeEntries(attendees, key).length > 0) events.add(normalizeEventKey(key));
  return [...events]
    .sort()
    .map((eventCode) => ({ id: `${teamId}_${eventCode}`, teamId, eventCode, uids: attendeeUidsForEvent(attendees, eventCode, members), updatedAt: null }));
}
