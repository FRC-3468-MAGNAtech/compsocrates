// The single place a Firestore collection or document path gets its program scope.
//
// FRC returns the name untouched (`teams` stays `teams`), so existing FRC queries are exactly what they were.
// The other program gets its namespace prefix. Callers pass the program explicitly; nothing reads it from ambient state.

import { collection, doc, type Firestore } from "firebase/firestore";
import { PROGRAMS } from "@/config/programs";
import type { ProgramId } from "@/config/programs/types";

/** "teams" -> "teams" for the root program, the namespaced path for the other. */
export function programPath(program: ProgramId, name: string): string {
  return `${PROGRAMS[program].firestorePrefix}${name}`;
}

export function programCollection(db: Firestore, program: ProgramId, name: string) {
  return collection(db, programPath(program, name));
}

export function programDoc(db: Firestore, program: ProgramId, name: string, ...ids: string[]) {
  return doc(db, programPath(program, name), ...ids);
}
