"use client";

import { DEFAULT_PROGRAM, type ProgramId } from "@/config/programs/types";
import { logAuditEvent } from "@/lib/audit-log";
import { programData } from "@/lib/program/data";
import { deletePracticeSession, updatePracticeSession, type PracticeSession } from "@/lib/practice-sessions";
import { deleteEntry, getEntriesForSession } from "@/lib/scout-entries";

// Every action takes the program last (default: the default program, whose reads and writes are exactly what they were). A program with its own session store
// writes the session's flags on the session itself and its audit entry under its own prefix, through the same functions.

/**
 * Admin-only (`can('manageScoutData')` — gate at the call site; rules
 * enforce it for real too). Matches by `type` rather than array index — the
 * caller only ever has the *active* (non-dismissed) subset of
 * `session.flags` to pick from, whose indices don't line up with the full
 * array this writes back.
 */
export async function dismissSessionFlag(
  teamId: string,
  actorUid: string,
  actorName: string,
  session: PracticeSession,
  flagType: string,
  program: ProgramId = DEFAULT_PROGRAM
): Promise<void> {
  const before = session.flags;
  const after = session.flags.map((f) => (f.type === flagType ? { ...f, dismissed: true } : f));
  await updatePracticeSession(session.id, { flags: after }, undefined, program);
  await logAuditEvent(teamId, actorUid, actorName, "dismiss-flag", { sessionId: session.id, scoutUid: session.uid, flagType }, before, after, program);
}

/** Toggles a practice session's `excluded` flag — "Exclude Score From Percentage Average" / "Include". */
export async function setSessionExcluded(
  teamId: string,
  actorUid: string,
  actorName: string,
  session: PracticeSession,
  excluded: boolean,
  program: ProgramId = DEFAULT_PROGRAM
): Promise<void> {
  await updatePracticeSession(session.id, { excluded }, undefined, program);
  await logAuditEvent(
    teamId,
    actorUid,
    actorName,
    excluded ? "exclude-session" : "include-session",
    { sessionId: session.id, scoutUid: session.uid },
    { excluded: session.excluded },
    { excluded },
    program
  );
}

/** The entries a session owns: a program with its own store reads them (a session lists no entry ids it can be trusted on); the default program uses the session's list. */
async function entryIdsOfSession(teamId: string, session: PracticeSession, program: ProgramId): Promise<string[]> {
  if (programData(program)?.practice) return (await getEntriesForSession(teamId, session.id, program)).map((e) => e.id);
  return session.entryIds;
}

/**
 * Permanently deletes every completed `solo` session (and its scout
 * entries) for one scout in one practice category — "Hard Reset Scout
 * Data," practice-only (Real Event's own data belongs to the team's match
 * records and is never bulk-deletable).
 */
export async function hardResetScoutData(
  teamId: string,
  actorUid: string,
  actorName: string,
  targetUid: string,
  targetName: string,
  category: "trial" | "competitive",
  sessions: PracticeSession[],
  program: ProgramId = DEFAULT_PROGRAM
): Promise<void> {
  const toReset = sessions.filter((s) => s.uid === targetUid && s.kind === "solo" && s.mode === category);
  let entryCount = 0;
  for (const s of toReset) {
    const entryIds = await entryIdsOfSession(teamId, s, program);
    for (const entryId of entryIds) {
      await deleteEntry(entryId, program);
    }
    entryCount += entryIds.length;
    await deletePracticeSession(s.id, program);
  }
  await logAuditEvent(
    teamId,
    actorUid,
    actorName,
    "hard-reset-scout-data",
    { targetUid, targetName, category },
    { sessionCount: toReset.length, entryCount },
    { sessionCount: 0, entryCount: 0 },
    program
  );
}
