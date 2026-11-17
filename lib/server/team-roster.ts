import "server-only";
import type { DocumentData, DocumentReference, Firestore } from "firebase-admin/firestore";
import { programPath } from "@/lib/firebase/paths";
import { readMembership, type ProgramId } from "@/lib/memberships/model";
import { getMembershipsEnabled } from "@/lib/server/team-settings";

/**
 * The server side of THE roster seam (`lib/team-roster.ts` is the browser side): who is on a team, for the server readers that used to ask `users where teamId ==`.
 *
 *  - Kill switch OFF: exactly the query those readers ran before (`users where teamId ==`), nothing else.
 *  - Kill switch ON: the same query, plus the team's ACTIVE memberships (`teamId ==`, `status ==`); a person already found through their user document is not
 *    repeated (the user document wins: it is the truth for the active team's role).
 * A row says where it came from, so a reader that must change a user document (or a membership) writes to the right one.
 */
export type ServerRosterRow = { uid: string; source: "user" | "membership"; data: DocumentData; ref: DocumentReference };

/** The people whose user document points at the team: the one query every server roster reader had. */
export async function readPointerRoster(db: Firestore, program: ProgramId, teamId: string): Promise<ServerRosterRow[]> {
  const snap = await db.collection(programPath(program, "users")).where("teamId", "==", teamId).get();
  return snap.docs.map((d) => ({ uid: d.id, source: "user" as const, data: d.data(), ref: d.ref }));
}

/** The whole roster (see above). `enabled` may be passed when the caller already knows the kill switch (a test, or a flow that read it). */
export async function readServerRoster(db: Firestore, program: ProgramId, teamId: string, enabled?: boolean): Promise<ServerRosterRow[]> {
  const rows = await readPointerRoster(db, program, teamId);
  const on = enabled ?? (await getMembershipsEnabled(db).catch(() => false));
  if (!on) return rows;
  const mems = await db.collection(programPath(program, "memberships")).where("teamId", "==", teamId).where("status", "==", "active").get();
  const seen = new Set(rows.map((r) => r.uid));
  for (const d of mems.docs) {
    const m = readMembership(d.data());
    if (m && !seen.has(m.uid)) {
      seen.add(m.uid);
      rows.push({ uid: m.uid, source: "membership", data: d.data(), ref: d.ref });
    }
  }
  return rows;
}
