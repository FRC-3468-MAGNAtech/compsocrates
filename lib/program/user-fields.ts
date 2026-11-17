// One writer for the signed-in person's own user document, for fields the shared UI keeps there (glass level, workspace layout, changelog
// last-seen, push tokens). The root program writes `users/{uid}` exactly as it always did; a program with a data port writes its own user
// doc through the port (its own `users/{uid}` under the program prefix), because an account that only exists in that program has no root document and a
// write there fails with not-found. A failed write is reported and THROWN with a message the caller can show; nothing here swallows it.

import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { describeFirestoreError, reportFirestoreError } from "@/lib/firestore-errors";
import type { ProgramData } from "@/lib/program/data";

export class UserFieldsSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFieldsSaveError";
  }
}

/** `port` is `useProgramData()` (null for the root program). `fields` may carry Firestore sentinels (`serverTimestamp()`, `arrayUnion()`). */
export async function saveUserFields(port: Pick<ProgramData, "profile"> | null, uid: string, fields: Record<string, unknown>, context = "Couldn't save your settings"): Promise<void> {
  try {
    if (port) await port.profile.updateFields(uid, fields);
    else await updateDoc(doc(db, "users", uid), fields);
  } catch (err) {
    // A port has already reported its own failure; the root path reports here.
    const failure = port ? describeFirestoreError(context, err, null) : reportFirestoreError(context, err, `users/${uid}`);
    throw new UserFieldsSaveError(`${context}. ${failure.message}`);
  }
}
