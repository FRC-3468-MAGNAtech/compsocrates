/**
 * Writes to the FTC collections under `programs/ftc/`. Like `read.ts`, every path comes from `lib/firebase/paths.ts` with an explicit program, and a
 * failure is reported (`reportFirestoreError`) and rethrown so the caller can show it. The documents themselves are built by the pure functions beside
 * this file; only the Firestore calls are here.
 *
 * So far: saving, editing and deleting a Match Scout entry. (Form entries and form publishing are not ported yet.) Editing and deleting are admin-only in the
 * rules; a refusal is reported and rethrown like any other failure.
 */
import { addDoc, deleteDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { programCollection, programDoc, programPath } from "@/lib/firebase/paths";
import { reportFirestoreError } from "@/lib/firestore-errors";
import type { SaveEntryInput, ScoutEntry } from "@/lib/scout-entries";
import { ftcScoutEntryDoc, ftcScoutEntryPatch } from "@/data/ftc/scouting";

const PROGRAM = "ftc" as const;
const SCOUT_ENTRIES = "scoutEntries";

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
