/**
 * Writes to the FTC collections under `programs/ftc/`. Like `read.ts`, every path comes from `lib/firebase/paths.ts` with an explicit program, and a
 * failure is reported (`reportFirestoreError`) and rethrown so the caller can show it. The documents themselves are built by the pure functions beside
 * this file; only the Firestore calls are here.
 *
 * So far: saving, editing and deleting a Match Scout entry, and setting the active events. (Form entries and form publishing are not ported yet.) Editing and deleting are admin-only in the
 * rules; a refusal is reported and rethrown like any other failure.
 */
import { addDoc, deleteDoc, deleteField, runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { programCollection, programDoc, programPath } from "@/lib/firebase/paths";
import { reportFirestoreError } from "@/lib/firestore-errors";
import type { SaveEntryInput, ScoutEntry } from "@/lib/scout-entries";
import { ftcScoutEntryDoc, ftcScoutEntryPatch } from "@/data/ftc/scouting";
import { ftcAccountTeamsFields, ftcActiveEventsFields } from "@/data/ftc/teams";
import type { ActiveEventsState } from "@/lib/active-events";
import { buildAuditEntry, newAuditLogRef } from "@/lib/audit-log";
import { diffEntryValues, formEntryDoc, type FormEntry, type NewFormEntry } from "@/lib/form-entries-model";
import type { FormValues, StickyNote } from "@/lib/forms/types";
import type { FormSubmissionSettings } from "@/lib/forms/submission-settings";
import { stripUndefined } from "@/data/ftc/util";
import { ftcProfilePatch, type FtcProfilePatch } from "@/data/ftc/users";
import { ftcAttendanceDoc, ftcAttendanceDocId } from "@/data/ftc/attendance";
import { ftcPickListDoc, ftcPickListId } from "@/data/ftc/pick-list";
import { applySlotSwap, ftcAssignmentDocId, ftcAssignmentsDoc, ftcTeamAssignmentDocId, ftcTeamAssignmentsDoc } from "@/data/ftc/assignments";
import { getAssignments } from "@/data/ftc/read";
import type { AssignmentVersion } from "@/lib/assignments";
import type { MatchType } from "@/lib/events/types";
import type { ScheduleSlot } from "@/lib/scheduler/types";
import type { TeamAssignKind, TeamAssignVersion, TeamAssignmentsDoc } from "@/lib/team-assignments/model";
import { applyPickOp, samePicks, sanitizePicks, type PickOp } from "@/lib/pick-list/ops";
import type { MemberAccess } from "@/lib/member-access";
import type { TeamMember } from "@/lib/team-members";
import type { AccountTeamsChange } from "@/lib/account-teams";

const PROGRAM = "ftc" as const;
const SCOUT_ENTRIES = "scoutEntries";
const TEAMS = "teams";
const FORM_ENTRIES = "formEntries";
const USERS = "users";
const EVENT_ATTENDANCE = "eventAttendance";
const PICK_LISTS = "pickLists";
const ASSIGNMENTS = "assignments";

/** Runs a write; a failure is reported with its path and rethrown, so the caller can show it. */
async function reported<T>(context: string, path: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    reportFirestoreError(context, err, path);
    throw err;
  }
}

/** Saves a new Match Scout entry as `uid`, for `teamId`. Offline, the write waits in Firestore's queue and this stays pending, as it does for every save. */
export async function saveScoutEntry(teamId: string, uid: string, input: SaveEntryInput): Promise<void> {
  try {
    await addDoc(programCollection(db, PROGRAM, SCOUT_ENTRIES), ftcScoutEntryDoc(teamId, uid, input, serverTimestamp));
  } catch (err) {
    reportFirestoreError("Couldn't save the scout entry", err, programPath(PROGRAM, SCOUT_ENTRIES));
    throw err;
  }
}

/**
 * Writes imported entries in ONE batch (the caller sends at most 400: Firestore allows 500 writes), each under the stable id it was given, as `uid`, for `teamId`.
 * The same id written twice is the same document, so a repeat import adds nothing; the caller leaves out ids that already exist (a set over one would be an
 * update, which only an admin may do). Resolves with the ids written.
 */
export async function importScoutEntries(teamId: string, uid: string, rows: { id: string; input: SaveEntryInput }[]): Promise<string[]> {
  if (rows.length === 0) return [];
  try {
    const batch = writeBatch(db);
    for (const row of rows) batch.set(programDoc(db, PROGRAM, SCOUT_ENTRIES, row.id), ftcScoutEntryDoc(teamId, uid, row.input, serverTimestamp));
    await batch.commit();
    return rows.map((r) => r.id);
  } catch (err) {
    reportFirestoreError("Couldn't import the scout entries", err, programPath(PROGRAM, SCOUT_ENTRIES));
    throw err;
  }
}

/** Applies an app-shaped patch to a stored entry: only its editable fields are written (see `ftcScoutEntryPatch`). A patch with nothing to write does nothing. */
export async function updateScoutEntry(id: string, patch: Partial<ScoutEntry>): Promise<void> {
  const fields = ftcScoutEntryPatch(patch);
  if (Object.keys(fields).length === 0) return;
  try {
    await updateDoc(programDoc(db, PROGRAM, SCOUT_ENTRIES, id), fields);
  } catch (err) {
    reportFirestoreError("Couldn't update the scout entry", err, `${programPath(PROGRAM, SCOUT_ENTRIES)}/${id}`);
    throw err;
  }
}

/** Deletes a stored entry. */
export async function deleteScoutEntry(id: string): Promise<void> {
  try {
    await deleteDoc(programDoc(db, PROGRAM, SCOUT_ENTRIES, id));
  } catch (err) {
    reportFirestoreError("Couldn't delete the scout entry", err, `${programPath(PROGRAM, SCOUT_ENTRIES)}/${id}`);
    throw err;
  }
}

/** Sets the account's active events (admins and the owner, by the rules). Writes the five active-event fields and nothing else on the team doc. */
export async function setActiveEvents(teamId: string, state: ActiveEventsState): Promise<void> {
  try {
    await updateDoc(programDoc(db, PROGRAM, TEAMS, teamId), ftcActiveEventsFields(state));
  } catch (err) {
    reportFirestoreError("Couldn't save the active events", err, `${programPath(PROGRAM, TEAMS)}/${teamId}`);
    throw err;
  }
}

/** Sets the account's archived event codes (ADDITIVE field `archivedEvents`; admins and the owner, by the rules). Writes that field and nothing else. */
export async function setArchivedEvents(teamId: string, codes: string[]): Promise<void> {
  try {
    await updateDoc(programDoc(db, PROGRAM, TEAMS, teamId), { archivedEvents: codes });
  } catch (err) {
    reportFirestoreError("Couldn't save the archived events", err, `${programPath(PROGRAM, TEAMS)}/${teamId}`);
    throw err;
  }
}

/** Sets the team's "joiners may choose their role" switch (ADDITIVE field `allowMemberRoleChoice`; admins and the owner, by the rules, which also require a boolean). Writes that field and nothing else. */
export async function setAllowMemberRoleChoice(teamId: string, value: boolean): Promise<void> {
  try {
    await updateDoc(programDoc(db, PROGRAM, TEAMS, teamId), { allowMemberRoleChoice: value === true });
  } catch (err) {
    reportFirestoreError("Couldn't save the join setting", err, `${programPath(PROGRAM, TEAMS)}/${teamId}`);
    throw err;
  }
}

/** Sets the team's optional organization name (`accountName`, at most 60 characters: the rules bound it); an empty name removes the field. Admins and the owner, by the rules. Writes that field and nothing else. */
export async function setAccountName(teamId: string, value: string): Promise<void> {
  const name = value.trim().slice(0, 60);
  try {
    await updateDoc(programDoc(db, PROGRAM, TEAMS, teamId), { accountName: name === "" ? deleteField() : name });
  } catch (err) {
    reportFirestoreError("Couldn't save the organization name", err, `${programPath(PROGRAM, TEAMS)}/${teamId}`);
    throw err;
  }
}

/** Sets the team's form-submission switches (ADDITIVE field `formSubmissionSettings`; admins and the owner, by the rules). Writes that field and nothing else. */
export async function setFormSubmissionSettings(teamId: string, settings: FormSubmissionSettings): Promise<void> {
  try {
    await updateDoc(programDoc(db, PROGRAM, TEAMS, teamId), { formSubmissionSettings: stripUndefined({ ...settings }) });
  } catch (err) {
    reportFirestoreError("Couldn't save the submission settings", err, `${programPath(PROGRAM, TEAMS)}/${teamId}`);
    throw err;
  }
}

/**
 * Team Settings: the account's teams and which members are assigned to which, in ONE batch with its audit entry. The team doc is written first, then each
 * affected member's `fieldTeamIds` (the rules check them against the team doc AFTER the batch, so a team can be added and assigned together), then the log.
 * `teams` null leaves the team list alone (an assignment-only change). Admins and the owner only, by the rules; a member cannot change their own list.
 * Nothing here touches an entry: entries belong to the account, so a removed team leaves every entry as it was.
 */
export function saveAccountTeams(actor: { teamId: string; uid: string; name: string }, change: AccountTeamsChange): Promise<void> {
  if (change.teams === null && change.assignments.length === 0) return Promise.resolve();
  if (change.assignments.length > 400) return Promise.reject(new Error("Too many members to change at once."));
  return reported("Couldn't save the teams", `${programPath(PROGRAM, TEAMS)}/${actor.teamId}`, async () => {
    const batch = writeBatch(db);
    if (change.teams) batch.update(programDoc(db, PROGRAM, TEAMS, actor.teamId), ftcAccountTeamsFields(change.teams));
    for (const a of change.assignments) batch.update(programDoc(db, PROGRAM, USERS, a.uid), { fieldTeamIds: a.assignedTeamIds });
    batch.set(newAuditLogRef(PROGRAM), buildAuditEntry(actor.teamId, actor.uid, actor.name, change.action, change.target, change.before, change.after));
    await batch.commit();
  });
}

/** Sets the form a season uses (`activeForms.{season}`), with its audit entry in the same batch. Admins and the owner only. */
export function setActiveForm(actor: { teamId: string; uid: string; name: string }, seasonId: string, formId: string, previousFormId: string | null): Promise<void> {
  return reported("Couldn't save the active form", `${programPath(PROGRAM, TEAMS)}/${actor.teamId}`, async () => {
    const batch = writeBatch(db);
    batch.update(programDoc(db, PROGRAM, TEAMS, actor.teamId), { [`activeForms.${seasonId}`]: formId });
    batch.set(newAuditLogRef(PROGRAM), buildAuditEntry(actor.teamId, actor.uid, actor.name, "set-active-form", { seasonId }, { formId: previousFormId }, { formId }));
    await batch.commit();
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// formEntries (the team's other forms)
// ---------------------------------------------------------------------------------------------------------------------

const formEntryPath = (id?: string) => (id ? `${programPath(PROGRAM, FORM_ENTRIES)}/${id}` : programPath(PROGRAM, FORM_ENTRIES));

/** Saves an entry as yourself. Resolves with its id (so a photo still uploading can be attached to it afterwards). */
export function saveFormEntry(teamId: string, uid: string, input: NewFormEntry): Promise<string> {
  return reported("Couldn't save the form entry", formEntryPath(), async () => (await addDoc(programCollection(db, PROGRAM, FORM_ENTRIES), formEntryDoc(teamId, uid, input))).id);
}

/** The writer may change only values and notes (the rules decide); an attached photo is written this way once its upload finishes. */
export function updateFormEntry(id: string, patch: { values?: FormValues; stickyNotes?: StickyNote[] }): Promise<void> {
  return reported("Couldn't update the form entry", formEntryPath(id), () => updateDoc(programDoc(db, PROGRAM, FORM_ENTRIES, id), stripUndefined({ ...patch, updatedAt: serverTimestamp() })));
}

/**
 * A scout edits their own earlier entry: the new values and notes, and an `edit-form-entry` audit entry with what changed, in one batch. The rules let the
 * writer change only `values`, `stickyNotes` and `updatedAt`.
 */
export function editOwnFormEntry(
  actor: { teamId: string; uid: string; name: string },
  entry: Pick<FormEntry, "id" | "formId" | "eventCode" | "teamNumber" | "values" | "stickyNotes">,
  patch: { values: FormValues; stickyNotes: StickyNote[] }
): Promise<void> {
  return reported("Couldn't save your changes", formEntryPath(entry.id), async () => {
    const batch = writeBatch(db);
    batch.update(programDoc(db, PROGRAM, FORM_ENTRIES, entry.id), { values: patch.values, stickyNotes: patch.stickyNotes, updatedAt: serverTimestamp() });
    batch.set(
      newAuditLogRef(PROGRAM),
      buildAuditEntry(
        actor.teamId,
        actor.uid,
        actor.name,
        "edit-form-entry",
        { entryId: entry.id, formId: entry.formId, eventCode: entry.eventCode, teamNumber: entry.teamNumber ?? null },
        { values: entry.values, notes: entry.stickyNotes.length },
        { values: patch.values, notes: patch.stickyNotes.length, changedKeys: diffEntryValues(entry.values, patch.values) }
      )
    );
    await batch.commit();
  });
}

/** Admins only (the rules decide): exclude an entry, set its flags, or fix its values. */
export function adminUpdateFormEntry(id: string, patch: { excluded?: boolean; flags?: FormEntry["flags"]; values?: FormValues }): Promise<void> {
  return reported("Couldn't update the form entry", formEntryPath(id), () => updateDoc(programDoc(db, PROGRAM, FORM_ENTRIES, id), stripUndefined({ ...patch, updatedAt: serverTimestamp() })));
}

/** Admins only. */
export function deleteFormEntry(id: string): Promise<void> {
  return reported("Couldn't delete the form entry", formEntryPath(id), () => deleteDoc(programDoc(db, PROGRAM, FORM_ENTRIES, id)));
}

// ---------------------------------------------------------------------------------------------------------------------
// the team's people
// ---------------------------------------------------------------------------------------------------------------------

/** Records who attends an event: one doc per team and event. Allowed by the rules to whoever has the Assignments page (a lead scout by default; admins always). */
export function setEventAttendance(teamId: string, eventCode: string, uids: string[]): Promise<void> {
  const id = ftcAttendanceDocId(teamId, eventCode);
  return reported("Couldn't save who is attending", `${programPath(PROGRAM, EVENT_ATTENDANCE)}/${id}`, () => setDoc(programDoc(db, PROGRAM, EVENT_ATTENDANCE, id), ftcAttendanceDoc(teamId, eventCode, uids, serverTimestamp)));
}

/**
 * Saves what the Team Management editor changed (primary role, secondary roles, admin flag) and its `edit-member-roles` audit entry in one batch, so a role
 * change can never land without its audit record. The member's doc already uses the app's own field names, so the changes are written as they are. Admins
 * and the owner only, by the rules (an owner's row only by that owner; nobody removes their own admin flag). No-op for an empty change.
 */
export function updateMemberAccess(
  actor: { teamId: string; uid: string; name: string },
  member: Pick<TeamMember, "uid" | "name"> & MemberAccess,
  changes: Partial<MemberAccess>
): Promise<void> {
  if (Object.keys(changes).length === 0) return Promise.resolve();
  const before: MemberAccess = { primaryRole: member.primaryRole, secondaryRoles: member.secondaryRoles, isAdmin: member.isAdmin };
  const after: MemberAccess = { ...before, ...changes };
  return reported("Couldn't save the member's roles", `${programPath(PROGRAM, USERS)}/${member.uid}`, async () => {
    const batch = writeBatch(db);
    batch.update(programDoc(db, PROGRAM, USERS, member.uid), stripUndefined({ ...changes }));
    batch.set(newAuditLogRef(PROGRAM), buildAuditEntry(actor.teamId, actor.uid, actor.name, "edit-member-roles", { targetUid: member.uid, targetName: member.name }, before, after));
    await batch.commit();
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// the shared pick list
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Applies one edit to an event's pick list inside a transaction: read the latest stored list, apply the edit to THAT, write it back with an `edit-pick-list`
 * audit entry, so two people editing at once compose instead of one overwriting the other and a change can never land unlogged. Resolves false (writing
 * nothing) when the edit changes nothing. The editors are admins and the roles the rules name; anyone else is refused.
 */
export function editPickList(ctx: { teamId: string; eventCode: string; uid: string; name: string }, op: PickOp): Promise<boolean> {
  const id = ftcPickListId(ctx.teamId, ctx.eventCode);
  return reported("Couldn't save the pick list", `${programPath(PROGRAM, PICK_LISTS)}/${id}`, () =>
    runTransaction(db, async (tx) => {
      const ref = programDoc(db, PROGRAM, PICK_LISTS, id);
      const snap = await tx.get(ref);
      const before = sanitizePicks(snap.exists() ? snap.data().picked : []);
      const after = applyPickOp(before, op);
      if (samePicks(before, after)) return false;
      tx.set(ref, ftcPickListDoc(ctx, after, serverTimestamp));
      tx.set(newAuditLogRef(PROGRAM), buildAuditEntry(ctx.teamId, ctx.uid, ctx.name, "edit-pick-list", { eventCode: ctx.eventCode, op: op.type }, { picked: before }, { picked: after }));
      return true;
    })
  );
}

/** A person changes their own profile (name, theme, avatar). Nothing is written for a change with no allowed field; the rules refuse any change to roles, team or flags. */
export function updateUserProfile(uid: string, patch: FtcProfilePatch): Promise<void> {
  const fields = ftcProfilePatch(patch);
  if (Object.keys(fields).length === 0) return Promise.resolve();
  return reported("Couldn't save your profile", `${programPath(PROGRAM, USERS)}/${uid}`, () => updateDoc(programDoc(db, PROGRAM, USERS, uid), fields));
}

/**
 * Preference fields of the person's own profile that shared UI saves (glass level, workspace layout, changelog last-seen, push tokens). Values may be
 * Firestore sentinels. The fields the rules lock (team, roles, flags, fieldTeamIds, avatar) are refused here too, before any write.
 */
const LOCKED_USER_FIELDS = ["teamId", "primaryRole", "secondaryRoles", "isAdmin", "isOwner", "isPlatformOwner", "fieldTeamIds", "avatar"];

export function updateUserFields(uid: string, fields: Record<string, unknown>): Promise<void> {
  const locked = Object.keys(fields).find((k) => LOCKED_USER_FIELDS.includes(k));
  if (locked) return Promise.reject(new Error(`"${locked}" can't be changed from here.`));
  if (Object.keys(fields).length === 0) return Promise.resolve();
  return reported("Couldn't save your settings", `${programPath(PROGRAM, USERS)}/${uid}`, () => updateDoc(programDoc(db, PROGRAM, USERS, uid), fields));
}

// ---------------------------------------------------------------------------------------------------------------------
// assignments
// ---------------------------------------------------------------------------------------------------------------------

const assignmentPath = (id: string) => `${programPath(PROGRAM, ASSIGNMENTS)}/${id}`;

/**
 * Publishes a version of an event's match assignments: it becomes `current` and the one it replaces becomes `previous` (a single level of undo). Allowed by the
 * rules to whoever has the Assignments page (a lead scout by default; admins always).
 */
export async function publishAssignments(teamId: string, eventCode: string, version: AssignmentVersion): Promise<void> {
  const id = ftcAssignmentDocId(teamId, eventCode);
  const existing = await getAssignments(teamId, eventCode);
  await reported("Couldn't publish the assignments", assignmentPath(id), () => setDoc(programDoc(db, PROGRAM, ASSIGNMENTS, id), ftcAssignmentsDoc(teamId, eventCode, version, existing?.current ?? null, serverTimestamp)));
}

/** Swaps `current` back to `previous` and clears `previous`. Nothing to undo does nothing. */
export async function undoAssignments(teamId: string, eventCode: string): Promise<void> {
  const existing = await getAssignments(teamId, eventCode);
  if (!existing?.previous) return;
  const id = ftcAssignmentDocId(teamId, eventCode);
  await reported("Couldn't undo the assignments", assignmentPath(id), () => updateDoc(programDoc(db, PROGRAM, ASSIGNMENTS, id), { current: existing.previous, previous: null, updatedAt: serverTimestamp() }));
}

/** One manual cell edit of the published version: re-point a slot at another scout, or clear it. Nothing published, or no such slot, does nothing. */
export async function swapAssignmentSlot(teamId: string, eventCode: string, matchType: MatchType, matchNumber: number, slot: ScheduleSlot["slot"], newScoutUid: string | null): Promise<void> {
  const existing = await getAssignments(teamId, eventCode);
  if (!existing?.current) return;
  const next = applySlotSwap(existing.current, matchType, matchNumber, slot, newScoutUid);
  if (!next) return;
  const id = existing.id;
  await reported("Couldn't change that assignment", assignmentPath(id), () => updateDoc(programDoc(db, PROGRAM, ASSIGNMENTS, id), { current: next, updatedAt: serverTimestamp() }));
}

/** Publishes a pit scouting or team strategy version (one doc per team, event and kind). */
export function publishTeamAssignments(teamId: string, eventCode: string, kind: TeamAssignKind, version: TeamAssignVersion, existing: TeamAssignmentsDoc | null): Promise<void> {
  const id = ftcTeamAssignmentDocId(teamId, eventCode, kind);
  return reported("Couldn't publish the assignments", assignmentPath(id), () => setDoc(programDoc(db, PROGRAM, ASSIGNMENTS, id), ftcTeamAssignmentsDoc(teamId, eventCode, kind, version, existing?.current ?? null, serverTimestamp)));
}

/** Swaps a pit scouting or team strategy `current` back to `previous`. */
export function undoTeamAssignments(teamId: string, eventCode: string, kind: TeamAssignKind, existing: TeamAssignmentsDoc): Promise<void> {
  if (!existing.previous) return Promise.resolve();
  const id = ftcTeamAssignmentDocId(teamId, eventCode, kind);
  return reported("Couldn't undo the assignments", assignmentPath(id), () => setDoc(programDoc(db, PROGRAM, ASSIGNMENTS, id), ftcTeamAssignmentsDoc(teamId, eventCode, kind, existing.previous as TeamAssignVersion, null, serverTimestamp)));
}
