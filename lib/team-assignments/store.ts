"use client";

import { collection, onSnapshot, query, where, type Query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { normalizeEventKey } from "@/config/event";
import { CS_MATCH_ASSIGNMENTS, CS_PIT_ASSIGNMENTS, CS_TEAM_ASSIGNMENTS, csTeamRowsToDocs, eventKeyVariants, planAssignmentWrite, teamsToCsRows, type CsAssignmentRow } from "@/data/cs/assignments";
import { commitPlan, eventRowsQuery, fetchMemberNames, fetchRows } from "@/lib/assignment-io";
import { auth, db, isFirebaseConfigured } from "@/lib/firebase/client";
import { reportFirestoreError } from "@/lib/firestore-errors";
import type { FormEntryType } from "@/lib/form-entries-model";
import { assignedTeamCounts, type TeamAssignKind, type TeamAssignmentsDoc, type TeamAssignVersion } from "@/lib/team-assignments/model";

// D1: persistence for the Pit Scouting and Team Strategy assignments, in CS's collections (data/cs/assignments.ts):
//   pit            -> pitAssignments   (one doc per team x scout)
//   teamStrategy   -> teamAssignments  (same shape) AND a mirror in matchAssignments (assignmentType "team", matchKey "team"),
//                     which is what CS's scouts read; CS itself falls back to the mirror alone when the primary write is denied.
// CS has no version history, so the app's one level of undo lives in memory for the tab that published (`previousRows`).

export const teamAssignmentDocId = (teamId: string, eventCode: string, kind: TeamAssignKind): string => `${teamId}_${eventCode}_${kind}`;

type KindRows = { primary: CsAssignmentRow[]; mirror: CsAssignmentRow[] };
const previousRows = new Map<string, KindRows>();

function mirrorQuery(teamId: string, eventCode?: string): Query {
  const base = [where("teamId", "==", teamId), where("assignmentType", "==", "team")];
  return query(collection(db, CS_MATCH_ASSIGNMENTS), ...(eventCode ? [...base, where("eventKey", "in", eventKeyVariants(eventCode))] : base));
}

const toRows = (docs: { id: string; data: () => Record<string, unknown> }[]): CsAssignmentRow[] => docs.map((d) => ({ id: d.id, data: d.data() }));

type Held = { teamId: string; pit: CsAssignmentRow[]; team: CsAssignmentRow[]; mirror: CsAssignmentRow[]; answered: readonly string[] };

/**
 * Every Pit Scouting / Team Strategy assignment doc of the team, live: all events and both kinds (the notification, dashboard, form
 * and Scout Status all want several). Three team-scoped queries (pit, team, and the team-strategy mirror) merged into the app's docs.
 */
export function useTeamAssignmentDocs(teamId: string | null): { docs: TeamAssignmentsDoc[]; loaded: boolean } {
  const [held, setHeld] = useState<Held | null>(null);
  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) return;
    const apply = (key: "pit" | "team" | "mirror", rows: CsAssignmentRow[]) =>
      setHeld((prev) => {
        const base: Held = prev?.teamId === teamId ? prev : { teamId, pit: [], team: [], mirror: [], answered: [] };
        return { ...base, [key]: rows, answered: base.answered.includes(key) ? base.answered : [...base.answered, key] };
      });
    const listen = (q: Query, key: "pit" | "team" | "mirror", label: string) =>
      onSnapshot(
        q,
        (snap) => apply(key, toRows(snap.docs)),
        (err) => {
          reportFirestoreError("team assignments subscription failed", err, label);
          apply(key, []);
        }
      );
    const stops = [
      listen(query(collection(db, CS_PIT_ASSIGNMENTS), where("teamId", "==", teamId)), "pit", `${CS_PIT_ASSIGNMENTS} where teamId == ${teamId}`),
      listen(query(collection(db, CS_TEAM_ASSIGNMENTS), where("teamId", "==", teamId)), "team", `${CS_TEAM_ASSIGNMENTS} where teamId == ${teamId}`),
      listen(mirrorQuery(teamId), "mirror", `${CS_MATCH_ASSIGNMENTS} team mirror where teamId == ${teamId}`),
    ];
    return () => stops.forEach((stop) => stop());
  }, [teamId]);

  const current = teamId && held?.teamId === teamId ? held : null;
  const docs = useMemo(() => {
    if (!teamId || !current) return [];
    const pit = csTeamRowsToDocs("pit", current.pit, teamId);
    const strategy = csTeamRowsToDocs("teamStrategy", [...current.team, ...current.mirror], teamId);
    return [...pit, ...strategy].map((d) => {
      const prev = previousRows.get(teamAssignmentDocId(teamId, d.eventCode, d.kind));
      if (!prev) return d;
      const rows = d.kind === "pit" ? prev.primary : [...prev.primary, ...prev.mirror];
      return { ...d, previous: csTeamRowsToDocs(d.kind, rows, teamId).find((p) => p.eventCode === d.eventCode)?.current ?? null };
    });
  }, [teamId, current]);
  if (!teamId || !isFirebaseConfigured()) return { docs: [], loaded: true };
  // Loaded once each of the three listeners has answered (a listener the rules deny answers with an error, which counts).
  return { docs, loaded: (current?.answered.length ?? 0) >= 3 };
}

/** One event's doc of one kind, from the shared subscription's list. */
export const findTeamAssignments = (docs: readonly TeamAssignmentsDoc[], eventCode: string | null, kind: TeamAssignKind): TeamAssignmentsDoc | null => docs.find((d) => d.eventCode === eventCode && d.kind === kind) ?? null;

/** Teams per scout (the Scout Status target prefill), added up over the given events. Null when no event has a published version for this kind. */
export function useAssignedTeamCounts(teamId: string | null, eventCodes: readonly string[], kind: TeamAssignKind): ReadonlyMap<string, number> | null {
  const { docs } = useTeamAssignmentDocs(teamId);
  return useMemo(() => assignedTeamCounts(docs, eventCodes, kind), [docs, eventCodes, kind]);
}

async function loadKindRows(teamId: string, eventCode: string, kind: TeamAssignKind): Promise<KindRows> {
  if (kind === "pit") return { primary: await fetchRows(eventRowsQuery(CS_PIT_ASSIGNMENTS, teamId, eventCode)), mirror: [] };
  const none = [] as CsAssignmentRow[];
  const [primary, mirror] = await Promise.all([fetchRows(eventRowsQuery(CS_TEAM_ASSIGNMENTS, teamId, eventCode)).catch(() => none), fetchRows(mirrorQuery(teamId, eventCode)).catch(() => none)]);
  return { primary, mirror };
}

function isPermissionError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  return message.includes("permission") || message.includes("insufficient");
}

/** Writes rows so the stored state equals `teams` (plans against what exists; unchanged rows keep their documents). */
async function writeKind(teamId: string, eventCode: string, kind: TeamAssignKind, teams: TeamAssignVersion["teams"], actorUid: string, existing: KindRows): Promise<void> {
  const scoutNames = await fetchMemberNames(teamId);
  const ctx = { teamId, eventKey: normalizeEventKey(eventCode), actorUid, now: Date.now(), scoutNames };
  const primaryName = kind === "pit" ? CS_PIT_ASSIGNMENTS : CS_TEAM_ASSIGNMENTS;
  try {
    await commitPlan(primaryName, planAssignmentWrite(existing.primary, teamsToCsRows(teams, ctx)));
  } catch (error) {
    // CS's own fallback: a team-strategy write the rules deny still lands in the matchAssignments mirror.
    if (kind === "pit" || !isPermissionError(error)) throw error;
  }
  if (kind === "teamStrategy") await commitPlan(CS_MATCH_ASSIGNMENTS, planAssignmentWrite(existing.mirror, teamsToCsRows(teams, ctx, true)));
}

/**
 * Publishes a version: one CS doc per team x scout replaces what exists for the event and kind (a row for the same team and
 * scout keeps its document). The rows as they were are kept in memory as `previous` (one level of undo). `existing` is accepted for
 * call-site compatibility; the stored rows are read here instead.
 */
export async function publishTeamAssignments(teamId: string, eventCode: string, kind: TeamAssignKind, version: TeamAssignVersion, existing: TeamAssignmentsDoc | null): Promise<void> {
  void existing;
  const rows = await loadKindRows(teamId, eventCode, kind);
  previousRows.set(teamAssignmentDocId(teamId, eventCode, kind), rows);
  await writeKind(teamId, eventCode, kind, version.teams, version.generatedBy || auth?.currentUser?.uid || "", rows);
}

/** Restores the rows from before this tab's last publish (a single level of undo, lost on reload: CS keeps no history). */
export async function undoTeamAssignments(teamId: string, eventCode: string, kind: TeamAssignKind, existing: TeamAssignmentsDoc): Promise<void> {
  const id = teamAssignmentDocId(teamId, eventCode, kind);
  if (!previousRows.get(id) || !existing.previous) return;
  const now = await loadKindRows(teamId, eventCode, kind);
  await writeKind(teamId, eventCode, kind, existing.previous.teams, existing.previous.generatedBy || auth?.currentUser?.uid || "", now);
  previousRows.delete(id);
}

/** The form entry type each kind is done with. */
export const KIND_FORM_TYPE: Record<TeamAssignKind, FormEntryType> = { pit: "pit-scout", teamStrategy: "team-strategy" };
