/**
 * FTC join requests: the pending requests of a team, and an admin's decision (approve or deny). `programs/ftc/teams/{teamId}/joinRequests/{uid}`.
 *
 * The applicant writes their own request (`requestToJoinTeam`, data/ftc/write.ts). A member-manager of the SAME team reads the team's requests and decides one:
 * - Deny marks the request denied (status, decidedBy, decidedAt).
 * - Approve is ONE batch: the request becomes approved AND the applicant's profile `programs/ftc/users/{uid}` is created as a plain member (the lowest role,
 *   Match Scout; no secondary roles; not admin; not owner) on that team, assigned the team's field teams. The rules (firestore.rules, `joinRequests` update and
 *   `users` create) check the two halves against each other with getAfter, so neither can happen alone.
 * Queries are equality-only and by path under the team (no collection group, no orderBy); the list is sorted in `ftcDocsToJoinRequests` (join-request-docs.ts).
 */
import { collection, getDoc, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { programDoc, programPath } from "@/lib/firebase/paths";
import { reportFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";
import { clearReadFailure, recordReadFailure } from "@/lib/read-failures";
import { stringList } from "@/data/ftc/util";
import { ftcApprovedProfileDoc, ftcDocsToJoinRequests, ftcJoinDecisionFields, type JoinRequest } from "@/data/ftc/join-request-docs";

export { ftcApprovedProfileDoc, ftcDocsToJoinRequests, ftcJoinDecisionFields, JOIN_REQUEST_MEMBER_ROLE, type JoinRequest, type JoinRequestStatus } from "@/data/ftc/join-request-docs";

const PROGRAM = "ftc" as const;
const TEAMS = "teams";
const USERS = "users";
const JOIN_REQUESTS = "joinRequests";

const requestsPath = (teamId: string) => `${programPath(PROGRAM, TEAMS)}/${teamId}/${JOIN_REQUESTS}`;

/** Realtime: the team's pending requests, oldest first. Equality-only query under the team's own path. Failures are reported and recorded for the shell's banner. */
export function subscribePendingJoinRequests(teamId: string, onData: (requests: JoinRequest[]) => void, onError: (failure: FirestoreFailure) => void): Unsubscribe {
  const context = "Couldn't load the join requests";
  const path = `${requestsPath(teamId)} where status == "pending"`;
  const q = query(collection(programDoc(db, PROGRAM, TEAMS, teamId), JOIN_REQUESTS), where("status", "==", "pending"));
  return onSnapshot(
    q,
    (snap) => {
      clearReadFailure(context, path);
      onData(ftcDocsToJoinRequests(snap.docs.map((d) => ({ id: d.id, data: d.data() }))));
    },
    (err) => {
      const failure = reportFirestoreError(context, err, path);
      recordReadFailure(failure);
      onError(failure);
    }
  );
}

async function reported<T>(context: string, path: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    reportFirestoreError(context, err, path);
    throw err;
  }
}

/**
 * Approves a pending request: the request is marked approved and the applicant's profile is created, in one batch. `actorUid` is the admin approving.
 * Reads the team's field teams first (the new profile carries them). Rejects (after reporting) when the rules refuse any part.
 */
export async function approveJoinRequest(teamId: string, request: Pick<JoinRequest, "uid" | "name">, actorUid: string): Promise<void> {
  const requestRef = programDoc(db, PROGRAM, TEAMS, teamId, JOIN_REQUESTS, request.uid);
  return reported("Couldn't approve the request", `${requestsPath(teamId)}/${request.uid}`, async () => {
    const team = await getDoc(programDoc(db, PROGRAM, TEAMS, teamId));
    const fieldTeamIds = stringList(team.data()?.fieldTeamIdList);
    const batch = writeBatch(db);
    batch.update(requestRef, ftcJoinDecisionFields("approved", actorUid, serverTimestamp()));
    batch.set(programDoc(db, PROGRAM, USERS, request.uid), ftcApprovedProfileDoc(teamId, request, fieldTeamIds, serverTimestamp()));
    await batch.commit();
  });
}

/** Denies a pending request (only the request changes; the applicant gets no profile). */
export function denyJoinRequest(teamId: string, requestUid: string, actorUid: string): Promise<void> {
  return reported("Couldn't deny the request", `${requestsPath(teamId)}/${requestUid}`, () =>
    updateDoc(programDoc(db, PROGRAM, TEAMS, teamId, JOIN_REQUESTS, requestUid), ftcJoinDecisionFields("denied", actorUid, serverTimestamp()))
  );
}
