/**
 * Writes to the FTC collections under `programs/ftc/`. Like `read.ts`, every path comes from `lib/firebase/paths.ts` with an explicit program, and a
 * failure is reported (`reportFirestoreError`) and rethrown so the caller can show it. The documents themselves are built by the pure functions beside
 * this file; only the Firestore calls are here.
 *
 * So far: saving, editing and deleting a Match Scout entry, and setting the active events. (Form entries and form publishing are not ported yet.) Editing and deleting are admin-only in the
 * rules; a refusal is reported and rethrown like any other failure.
 */
import { addDoc, deleteDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { programCollection, programDoc, programPath } from "@/lib/firebase/paths";
import { reportFirestoreError } from "@/lib/firestore-errors";
import type { SaveEntryInput, ScoutEntry } from "@/lib/scout-entries";
import { ftcScoutEntryDoc, ftcScoutEntryPatch } from "@/data/ftc/scouting";
import { ftcActiveEventsFields } from "@/data/ftc/teams";
import type { ActiveEventsState } from "@/lib/active-events";
import { buildAuditEntry, newAuditLogRef } from "@/lib/audit-log";
import { diffEntryValues, formEntryDoc, type FormEntry, type NewFormEntry } from "@/lib/form-entries-model";
import type { FormValues, StickyNote } from "@/lib/forms/types";
import { stripUndefined } from "@/data/ftc/util";
import { ftcAttendanceDoc, ftcAttendanceDocId } from "@/data/ftc/attendance";
import type { MemberAccess } from "@/lib/member-access";
import type { TeamMember } from "@/lib/team-members";

const PROGRAM = "ftc" as const;
const SCOUT_ENTRIES = "scoutEntries";
const TEAMS = "teams";
const FORM_ENTRIES = "formEntries";
const USERS = "users";
const EVENT_ATTENDANCE = "eventAttendance";

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
