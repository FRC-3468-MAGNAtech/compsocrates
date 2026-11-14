/**
 * Writes to the FTC collections under `programs/ftc/`. Like `read.ts`, every path comes from `lib/firebase/paths.ts` with an explicit program, and a
 * failure is reported (`reportFirestoreError`) and rethrown so the caller can show it. The documents themselves are built by the pure functions beside
 * this file; only the Firestore calls are here.
 *
 * So far: saving a Match Scout entry. (Edits, flags, deletes, form entries and form publishing are not ported yet.)
 */
import { addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { programCollection, programPath } from "@/lib/firebase/paths";
import { reportFirestoreError } from "@/lib/firestore-errors";
import type { SaveEntryInput } from "@/lib/scout-entries";
import { ftcScoutEntryDoc } from "@/data/ftc/scouting";

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
