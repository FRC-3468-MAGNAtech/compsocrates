"use client";

import { onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { getSeasonFromEventKey, normalizeEventKey } from "@/config/event";
import {
  buildScheduleLookup,
  csAssignmentMatchRef,
  csRowsToSlots,
  csRowsToVersion,
  CS_MATCH_ASSIGNMENTS,
  CS_PRACTICE_ASSIGNMENTS,
  isTeamMirrorRow,
  planAssignmentWrite,
  slotsToCsRows,
  type CsAssignmentRow,
} from "@/data/cs/assignments";
import { commitPlan, eventRowsQuery, fetchMemberNames, fetchRows } from "@/lib/assignment-io";
import { getMatchesForEvent } from "@/lib/events/actions";
import { getDefaultSeason } from "@/lib/events/config";
import { useEventQuery } from "@/lib/events/use-event-query";
import { auth, isFirebaseConfigured } from "@/lib/firebase/client";
import { useProgramConfig } from "@/lib/program/context";
import type { Difficulty } from "@/lib/difficulty";
import type { MatchType } from "@/lib/events/types";
import { eventMatchesToInputs } from "@/lib/scheduler/sources";
import { parseScheduleSlots } from "@/lib/scheduler/parse";
import type { RotationPattern, ScheduleSlot } from "@/lib/scheduler/types";

export type AssignmentMatchSource = "event" | "practice" | "live";

export type AssignmentSettings = {
  matchSource: AssignmentMatchSource;
  /** Practice-library source only. */
  seasonId: string | null;
  difficulty: Difficulty | null;
  rangesText: string;
  categories: MatchType[];
  pattern: RotationPattern;
  intervalSize: number | null;
  scoutUids: string[];
  prioritizedTeams: number[];
  seed: number;
};

export type AssignmentVersion = {
  generatedBy: string;
  /** ISO. */
  generatedAt: string;
  settings: AssignmentSettings;
  slots: ScheduleSlot[];
  counts: Record<string, number>;
  fair: boolean;
  warning: string | null;
};

export type AssignmentsDoc = {
  id: string;
  teamId: string;
  eventCode: string;
  current: AssignmentVersion | null;
  previous: AssignmentVersion | null;
};

// D1: persistence is CS's flat collections, not the app's `assignments/{teamId}_{eventCode}` doc (see data/cs/assignments.ts).
//   matchAssignments      the event schedule (qualification, playoffs, and `assignmentType: "event-practice"` practice matches)
//   practiceAssignments   practice-library matches (published with the "Practice library" source)
// CS has no version history, so the one level of undo the app offered lives in memory for the tab that published (see `previousRows`).

function docId(teamId: string, eventCode: string): string {
  return `${teamId}_${eventCode}`;
}

function normalizeVersion(raw: unknown): AssignmentVersion | null {
  if (!raw || typeof raw !== "object") return null;
  return { ...(raw as AssignmentVersion), slots: parseScheduleSlots((raw as { slots?: unknown }).slots) };
}

/**
 * An app-shaped `assignments/{teamId}_{eventCode}` doc (the 2-robot app's versioned `current.slots[]`) as `AssignmentsDoc`. Production no
 * longer reads or writes that collection; this stays for app exports and backups, which still carry the shape.
 */
export function parseAssignmentsDoc(id: string, data: Record<string, unknown>): AssignmentsDoc {
  return {
    id,
    teamId: typeof data.teamId === "string" ? data.teamId : "",
    eventCode: typeof data.eventCode === "string" ? data.eventCode : "",
    current: normalizeVersion(data.current),
    previous: normalizeVersion(data.previous),
  };
}

type PreviousRows = { match: CsAssignmentRow[]; practice: CsAssignmentRow[] };
/** The rows as they were before this tab's last publish, by doc id: the app's single level of undo. Gone on reload (CS keeps no history). */
const previousRows = new Map<string, PreviousRows>();

/** The event's schedule as a slot lookup, fetched through the event facade (cached by `useEventQuery`, shared with the Assignments page). */
function useEventSchedule(eventCode: string | null, enabled: boolean) {
  const season = (eventCode ? getSeasonFromEventKey(eventCode) : null) ?? getDefaultSeason();
  const key = (type: string) => (enabled && eventCode ? `assign:${eventCode}:${type}:${season}` : null);
  const qual = useEventQuery(key("Q"), () => getMatchesForEvent(eventCode!, "Qualification", season));
  const playoff = useEventQuery(key("F"), () => getMatchesForEvent(eventCode!, "Playoff", season));
  const practice = useEventQuery(key("P"), () => getMatchesForEvent(eventCode!, "Practice", season));
  return useMemo(
    () => buildScheduleLookup(eventMatchesToInputs([...(qual.data ?? []), ...(playoff.data ?? []), ...(practice.data ?? [])])),
    [qual.data, playoff.data, practice.data]
  );
}

/** Realtime — the Assignments page, Match Scout Form's "next assignment," and the Dashboard/My Scouting "upcoming assignments" card all read this. */
export function useAssignments(teamId: string | null, eventCode: string | null) {
  // A program that has not connected assignments yet has none: this hook reads the default program's collections only (never another program's).
  const { assignments: connected } = useProgramConfig().connection.features;
  const [held, setHeld] = useState<{ key: string; match: CsAssignmentRow[]; practice: CsAssignmentRow[]; matchLoaded: boolean } | null>(null);
  const subscriptionKey = teamId && eventCode ? docId(teamId, eventCode) : null;

  useEffect(() => {
    if (!connected || !teamId || !eventCode || !isFirebaseConfigured() || !subscriptionKey) return;
    const toRows = (docs: { id: string; data: () => Record<string, unknown> }[]): CsAssignmentRow[] => docs.map((d) => ({ id: d.id, data: d.data() }));
    const apply = (patch: Partial<{ match: CsAssignmentRow[]; practice: CsAssignmentRow[]; matchLoaded: boolean }>) =>
      setHeld((prev) => ({ match: [], practice: [], matchLoaded: false, ...(prev?.key === subscriptionKey ? prev : {}), ...patch, key: subscriptionKey }));
    const unsubMatch = onSnapshot(
      eventRowsQuery(CS_MATCH_ASSIGNMENTS, teamId, eventCode),
      (snap) => apply({ match: toRows(snap.docs), matchLoaded: true }),
      (err) => {
        console.error("matchAssignments subscription failed:", err);
        apply({ match: [], matchLoaded: true });
      }
    );
    // Practice-library rows are optional: a team whose rules do not allow the read just has none.
    const unsubPractice = onSnapshot(
      eventRowsQuery(CS_PRACTICE_ASSIGNMENTS, teamId, eventCode),
      (snap) => apply({ practice: toRows(snap.docs) }),
      (err) => console.warn("practiceAssignments subscription failed:", err)
    );
    return () => {
      unsubMatch();
      unsubPractice();
    };
  }, [connected, teamId, eventCode, subscriptionKey]);

  const current = held && held.key === subscriptionKey ? held : null;
  const rows = useMemo(() => [...(current?.match ?? []).filter((r) => !isTeamMirrorRow(r.data)), ...(current?.practice ?? [])], [current]);
  const lookup = useEventSchedule(eventCode, rows.length > 0);
  const assignments = useMemo<AssignmentsDoc | null>(() => {
    if (!teamId || !eventCode || rows.length === 0) return null;
    const previous = previousRows.get(docId(teamId, eventCode));
    return {
      id: docId(teamId, eventCode),
      teamId,
      eventCode,
      current: csRowsToVersion(rows, lookup),
      previous: previous ? csRowsToVersion([...previous.match.filter((r) => !isTeamMirrorRow(r.data)), ...previous.practice], lookup) : null,
    };
  }, [teamId, eventCode, rows, lookup]);

  if (!connected || !teamId || !eventCode || !isFirebaseConfigured()) return { assignments: null, loaded: true };
  return { assignments, loaded: Boolean(current?.matchLoaded) };
}

/** The rows a publish may replace: every non-team `matchAssignments` row of the event, or every `practiceAssignments` row. */
async function loadScope(teamId: string, eventCode: string): Promise<PreviousRows> {
  const [match, practice] = await Promise.all([fetchRows(eventRowsQuery(CS_MATCH_ASSIGNMENTS, teamId, eventCode)), fetchRows(eventRowsQuery(CS_PRACTICE_ASSIGNMENTS, teamId, eventCode)).catch(() => [] as CsAssignmentRow[])]);
  return { match: match.filter((r) => !isTeamMirrorRow(r.data)), practice };
}

/**
 * Admin-only. Turns the version's slots into CS's flat docs and applies the difference to what exists (rows for the same match
 * and team keep their document; others are added or removed). The "Practice library" source writes `practiceAssignments`, every
 * other source writes `matchAssignments`. The rows as they were are kept in memory as `previous` (one level of undo).
 */
export async function publishAssignments(teamId: string, eventCode: string, version: AssignmentVersion): Promise<void> {
  const [scope, scoutNames] = await Promise.all([loadScope(teamId, eventCode), fetchMemberNames(teamId)]);
  previousRows.set(docId(teamId, eventCode), scope);
  const target = version.settings.matchSource === "practice" ? "practice" : "match";
  const desired = slotsToCsRows(version.slots, { teamId, eventKey: normalizeEventKey(eventCode), actorUid: version.generatedBy, now: Date.now(), scoutNames }, target);
  const plan = planAssignmentWrite(target === "practice" ? scope.practice : scope.match, desired);
  await commitPlan(target === "practice" ? CS_PRACTICE_ASSIGNMENTS : CS_MATCH_ASSIGNMENTS, plan);
}

/** Admin-only. Restores the rows from before this tab's last publish (a single level of undo, not a history; lost on reload). */
export async function undoAssignments(teamId: string, eventCode: string): Promise<void> {
  const id = docId(teamId, eventCode);
  const previous = previousRows.get(id);
  if (!previous) return;
  const scope = await loadScope(teamId, eventCode);
  const toDocs = (rows: CsAssignmentRow[]) => rows.map((r) => r.data);
  await commitPlan(CS_MATCH_ASSIGNMENTS, planAssignmentWrite(scope.match, toDocs(previous.match)));
  await commitPlan(CS_PRACTICE_ASSIGNMENTS, planAssignmentWrite(scope.practice, toDocs(previous.practice)));
  previousRows.delete(id);
}

/**
 * One manual cell edit: re-point a single slot at a different scout (or clear it with `null`). `knownSlots` are the slots the page
 * is showing (their positions come from the schedule); without them the position is derived from the stored rows alone. The row for
 * that match and team gets the new scout (a merge patch), or is deleted when cleared. No-op when the slot does not exist.
 */
export async function swapAssignmentSlot(
  teamId: string,
  eventCode: string,
  matchType: MatchType,
  matchNumber: number,
  slot: ScheduleSlot["slot"],
  newScoutUid: string | null,
  knownSlots?: readonly ScheduleSlot[]
): Promise<void> {
  const scope = await loadScope(teamId, eventCode);
  const slots = knownSlots ?? csRowsToSlots([...scope.match, ...scope.practice]);
  const target = slots.find((s) => s.matchType === matchType && s.matchNumber === matchNumber && s.slot === slot);
  if (!target) return;
  const sameMatchTeam = (row: CsAssignmentRow) => {
    const ref = csAssignmentMatchRef(row.data);
    return ref?.matchType === matchType && ref.matchNumber === matchNumber && Number(String(row.data.teamNumber ?? "").replace(/[^\d]/g, "")) === target.teamNumber;
  };
  const inMatch = scope.match.filter(sameMatchTeam);
  const inPractice = scope.practice.filter(sameMatchTeam);
  const scoutNames = newScoutUid ? await fetchMemberNames(teamId) : new Map<string, string>();
  const actorUid = auth?.currentUser?.uid ?? "";
  const now = Date.now();
  if (inMatch.length + inPractice.length === 0) {
    if (!newScoutUid) return;
    const [created] = slotsToCsRows([{ ...target, scoutUid: newScoutUid }], { teamId, eventKey: normalizeEventKey(eventCode), actorUid, now, scoutNames });
    await commitPlan(CS_MATCH_ASSIGNMENTS, { create: [created], update: [], remove: [] });
    return;
  }
  for (const [name, rows] of [[CS_MATCH_ASSIGNMENTS, inMatch], [CS_PRACTICE_ASSIGNMENTS, inPractice]] as const) {
    if (rows.length === 0) continue;
    const [first, ...rest] = rows;
    await commitPlan(
      name,
      newScoutUid
        ? { create: [], update: [{ id: first.id, patch: { scoutId: newScoutUid, scoutName: scoutNames.get(newScoutUid) ?? "", assignedAt: now } }], remove: rest.map((r) => r.id) }
        : { create: [], update: [], remove: rows.map((r) => r.id) }
    );
  }
}

/** A manual swap's warnings, computed *before* writing — the UI shows these in a confirm step rather than blocking the edit outright (the prompt says "warn," not "block"). */
export function evaluateSlotSwap(
  version: AssignmentVersion,
  matchType: MatchType,
  matchNumber: number,
  slot: ScheduleSlot["slot"],
  newScoutUid: string | null
): { warnings: string[] } {
  const warnings: string[] = [];
  if (newScoutUid === null) return { warnings };

  const sameMatchOther = version.slots.some(
    (s) => s.matchType === matchType && s.matchNumber === matchNumber && s.slot !== slot && s.scoutUid === newScoutUid
  );
  if (sameMatchOther) warnings.push("This scout is already assigned to another robot in this same match.");

  const counts: Record<string, number> = { ...version.counts };
  const existingSlot = version.slots.find((s) => s.matchType === matchType && s.matchNumber === matchNumber && s.slot === slot);
  if (existingSlot?.scoutUid) counts[existingSlot.scoutUid] = (counts[existingSlot.scoutUid] ?? 1) - 1;
  counts[newScoutUid] = (counts[newScoutUid] ?? 0) + 1;
  const values = Object.values(counts);
  if (values.length > 0 && Math.max(...values) - Math.min(...values) > 1) {
    warnings.push("This swap would make the assignment counts uneven by more than 1.");
  }

  return { warnings };
}
