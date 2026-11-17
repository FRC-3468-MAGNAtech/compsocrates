/**
 * The pure half of FTC join requests (no React, no Firebase): reading stored request docs, and the exact documents an approval or denial writes. The reads and
 * writes themselves are in data/ftc/join-requests.ts; the rules that check these shapes are in firestore.rules (`joinRequests` update, `users` create).
 */
import { isRecord, nonEmptyString, str, toEpochMs } from "@/data/ftc/util";

/** The role a person joins with: the lowest one (anything with fewer rights does not exist). */
export const JOIN_REQUEST_MEMBER_ROLE = "match-scout";

export type JoinRequestStatus = "pending" | "approved" | "denied";

export type JoinRequest = {
  /** The applicant's account id (also the request's document id). */
  uid: string;
  name: string;
  status: JoinRequestStatus;
  /** When the request was sent (ms), or null while the server time has not arrived. */
  requestedAtMs: number | null;
  /** The role the person asked for (memberships build 2; absent on older requests). A REQUEST FIELD only: the server decides the real role at approval. */
  requestedRole?: string;
};

const statusOf = (value: unknown): JoinRequestStatus => (value === "approved" || value === "denied" ? value : "pending");

/** Stored request docs -> requests, oldest first. A doc that is not a record, or has no name, is skipped. */
export function ftcDocsToJoinRequests(rows: ReadonlyArray<{ id: string; data: unknown }>): JoinRequest[] {
  const out: JoinRequest[] = [];
  for (const row of rows) {
    if (!isRecord(row.data)) continue;
    const name = nonEmptyString(row.data.name);
    if (!name) continue;
    const requestedRole = nonEmptyString(row.data.requestedRole);
    out.push({ uid: str(row.data.uid) || row.id, name, status: statusOf(row.data.status), requestedAtMs: toEpochMs(row.data.createdAt) || null, ...(requestedRole ? { requestedRole } : {}) });
  }
  return out.sort((a, b) => (a.requestedAtMs ?? Number.MAX_SAFE_INTEGER) - (b.requestedAtMs ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));
}

/** The profile document an approval creates. Exactly the fields the `users` create rule allows. */
export function ftcApprovedProfileDoc(teamId: string, request: Pick<JoinRequest, "name">, teamFieldTeamIds: readonly string[], createdAt: unknown): Record<string, unknown> {
  return {
    name: request.name,
    teamId,
    primaryRole: JOIN_REQUEST_MEMBER_ROLE,
    secondaryRoles: [],
    isAdmin: false,
    isOwner: false,
    // The account is assigned the team's field teams, so the person sees the team's data through `lib/our-team.ts` like any member.
    fieldTeamIds: [...teamFieldTeamIds],
    createdAt,
  };
}

/** The fields of a decision on a request (the rules allow exactly these). */
export function ftcJoinDecisionFields(status: "approved" | "denied", decidedBy: string, decidedAt: unknown): Record<string, unknown> {
  return { status, decidedBy, decidedAt };
}
