/**
 * CS's team join model as pure logic: `teamJoinRequests/{id}` documents, the request state machine, the permission check
 * for processing one, team join-code generation, and the CS-shaped documents the server flows write
 * (docs/ROUTES.md D1, D6, D10; docs/AUDIT.md 3.2). No React, no Firebase: the server routes (lib/server/join-requests.ts,
 * app/api/team/**) and the UI both import it.
 *
 * Additive to the data/cs adapter: nothing in users.ts / teams.ts is changed. Every writer here returns ONLY the fields
 * to merge-write, so unknown CS fields (encryptedUserData, priorityTeams*, ...) are never dropped (D10).
 */
import { isCsOwnerUid } from "@/config/cs";
import type { CsRecord, CsUserDoc } from "@/data/cs/types";
import { digitsToNumber, str, toEpochMs } from "@/data/cs/util";
import { isAdminFromCsUser } from "@/data/cs/users";
import { DEFAULT_ROLE_ID, isRoleId, normalizeLegacyRole, type RoleId } from "@/lib/roles";

// --- team codes ----------------------------------------------------------------------------------------------------

/** Characters of a generated join code: uppercase, no ambiguous 0/O/1/I (CE's alphabet; CS codes are uppercase and compared uppercase). */
export const TEAM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const TEAM_CODE_LENGTH = 6;

/** A typed or stored join code, trimmed and uppercased: the form that is the `teams/{id}` doc id. */
export function normalizeTeamCode(value: unknown): string {
  return str(value).trim().toUpperCase();
}

/**
 * Is this usable as a Firestore doc id AND a code people type? 3 to 24 letters/digits (CS data has hand-made codes of
 * varying length, so the check is loose on purpose). Rejects `/`, whitespace and anything else that would break a path.
 */
export function isValidTeamCode(code: string): boolean {
  return /^[A-Z0-9]{3,24}$/.test(code);
}

/** One random code. `random` is injectable for tests (defaults to `Math.random`; a join code is not a secret). */
export function generateTeamCode(random: () => number = Math.random, length: number = TEAM_CODE_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) out += TEAM_CODE_ALPHABET[Math.floor(random() * TEAM_CODE_ALPHABET.length) % TEAM_CODE_ALPHABET.length];
  return out;
}

/**
 * The first generated code that `isTaken` says is free, trying at most `attempts` times; `null` if every try collided
 * (the caller reports a retryable error). `isTaken` is async so it can be a Firestore existence check.
 */
export async function pickFreeTeamCode(isTaken: (code: string) => Promise<boolean> | boolean, random: () => number = Math.random, attempts = 8): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const code = generateTeamCode(random);
    if (!(await isTaken(code))) return code;
  }
  return null;
}

/** CS `/api/team-label` `formatLabel`: the team's name, else its number, else the code; a pure number reads "Team 254". */
export function formatTeamLabel(teamCode: string, teamName: unknown, teamNumber: unknown): string {
  const code = normalizeTeamCode(teamCode);
  const preferred = str(teamName).trim() || str(teamNumber).trim();
  if (preferred) {
    const parsed = Number(preferred);
    if (Number.isFinite(parsed) && parsed > 0) return `Team ${parsed}`;
    return preferred;
  }
  return `Team ${code}`;
}

/** True for the label CS shows when it knows nothing but the code ("Team ABC123"); such labels are not worth caching on a request. */
export function isFallbackCodeLabel(label: string, teamCode: string): boolean {
  const l = label.trim().toLowerCase();
  const code = normalizeTeamCode(teamCode).toLowerCase();
  return l === "" || l === code || l === `team ${code}`;
}

// --- join requests ---------------------------------------------------------------------------------------------------

export type JoinRequestStatus = "pending" | "approved" | "denied" | "canceled";
export type JoinRequestAction = "approve" | "deny" | "cancel";

/** `teamJoinRequests/{id}` as written by CS (docs/AUDIT.md 3.2). Everything optional: old rows were written by a six-step fallback ladder. */
export type CsJoinRequestDoc = {
  userId?: string;
  userEmail?: string;
  userEmailLower?: string;
  userName?: string;
  userRole?: string;
  requestedRole?: string;
  role?: string;
  teamId?: string;
  status?: string;
  createdAt?: unknown;
  processedAt?: unknown;
  processedBy?: string;
  canceledByUser?: boolean;
  profileSyncPending?: boolean;
  profileSyncedAt?: unknown;
  teamDisplayLabel?: string;
  [key: string]: unknown;
};

/** A normalized join request for the UI and the permission checks. */
export type JoinRequest = {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  requestedRole: RoleId;
  /** The team code, uppercase. */
  teamId: string;
  status: JoinRequestStatus;
  createdAtMs: number;
  processedAtMs: number;
  processedBy: string;
  profileSyncPending: boolean;
  teamDisplayLabel: string;
};

/**
 * Status of a stored row. CS's own client fallback cancelled a request by writing `denied` + `canceledByUser: true`,
 * so that pair reads as "canceled"; a missing/unknown status counts as "pending" only when it is absent (CS treats a row
 * with no status as pending), anything else unrecognised is "denied" (never silently approvable).
 */
export function readJoinRequestStatus(doc: Pick<CsJoinRequestDoc, "status" | "canceledByUser">): JoinRequestStatus {
  const raw = str(doc.status).trim().toLowerCase();
  if (raw === "") return "pending";
  if (raw === "pending" || raw === "approved") return raw;
  if (raw === "canceled" || raw === "cancelled") return "canceled";
  if (raw === "denied" || raw === "rejected") return doc.canceledByUser === true ? "canceled" : "denied";
  return "denied";
}

/** "User ab12cd34" is CS's placeholder for a request with no name (deriveJoinRequestName). */
export function isPlaceholderName(name: string): boolean {
  return /^User [A-Za-z0-9]{1,12}$/.test(name.trim());
}

/** A name for a request row: the typed name, else a prettified email local part, else "User <uid prefix>" (CS `deriveJoinRequestName`). */
export function deriveJoinRequestName(input: { userName?: unknown; userEmail?: unknown; userId?: unknown }): string {
  const name = str(input.userName).trim();
  if (name && !isPlaceholderName(name)) return name;
  const email = str(input.userEmail).trim();
  const local = email.includes("@") ? email.split("@")[0] : "";
  const chunks = local
    .replace(/\d+/g, " ")
    .split(/[._-]+|\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (chunks.length > 0) return chunks.map((c) => c.charAt(0).toUpperCase() + c.slice(1).toLowerCase()).join(" ");
  if (name) return name;
  const uid = str(input.userId).trim();
  return uid ? `User ${uid.slice(0, 8)}` : "Unknown User";
}

/** Reads a stored row. Never throws. */
export function readJoinRequest(id: string, doc: CsJoinRequestDoc): JoinRequest {
  const requestedRaw = str(doc.requestedRole).trim() || str(doc.userRole).trim() || str(doc.role).trim();
  return {
    id,
    userId: str(doc.userId).trim(),
    userEmail: str(doc.userEmail).trim(),
    userName: deriveJoinRequestName(doc),
    requestedRole: requestedRaw ? normalizeLegacyRole(requestedRaw) : DEFAULT_ROLE_ID,
    teamId: normalizeTeamCode(doc.teamId),
    status: readJoinRequestStatus(doc),
    createdAtMs: toEpochMs(doc.createdAt),
    processedAtMs: toEpochMs(doc.processedAt),
    processedBy: str(doc.processedBy).trim(),
    profileSyncPending: doc.profileSyncPending === true,
    teamDisplayLabel: str(doc.teamDisplayLabel).trim(),
  };
}

export type NewJoinRequestInput = {
  userId: string;
  userEmail: string;
  userName: string;
  requestedRole: unknown;
  teamId: string;
  teamDisplayLabel?: string;
};

/** The one full-shape payload CS writes (its first fallback payload), with the label when it is known. Epoch-ms `createdAt` like CS. */
export function buildJoinRequestDoc(input: NewJoinRequestInput, nowMs: number): CsJoinRequestDoc {
  const role = isRoleId(input.requestedRole) ? input.requestedRole : normalizeLegacyRole(typeof input.requestedRole === "string" ? input.requestedRole : "");
  const label = (input.teamDisplayLabel ?? "").trim();
  return {
    userId: input.userId,
    userEmail: input.userEmail,
    userEmailLower: input.userEmail.trim().toLowerCase(),
    userName: deriveJoinRequestName(input),
    userRole: role,
    requestedRole: role,
    teamId: normalizeTeamCode(input.teamId),
    status: "pending",
    createdAt: nowMs,
    ...(label && !isFallbackCodeLabel(label, input.teamId) ? { teamDisplayLabel: label } : {}),
  };
}

export type ActorContext = {
  uid: string;
  /** The actor's own user doc (as stored), or null when they have none. */
  user: CsUserDoc | null;
  /** Platform owner uids; defaults to `CS_OWNER_UIDS`. */
  ownerUids?: readonly string[];
};

/** Is the actor a platform owner (CS's hidden owner layer, `CS_OWNER_UIDS`)? */
export function isOwnerActor(actor: ActorContext): boolean {
  return actor.ownerUids ? isCsOwnerUid(actor.uid, actor.ownerUids) : isCsOwnerUid(actor.uid);
}

/** Is the actor an admin (CS `isTeamAdmin`, or the legacy `role == "coach"`) of exactly this team? */
export function isTeamAdminOf(actor: ActorContext, teamId: string): boolean {
  const team = normalizeTeamCode(teamId);
  if (!team || !actor.user) return false;
  return normalizeTeamCode(actor.user.teamId) === team && isAdminFromCsUser(actor.user);
}

export type JoinRequestFailure = "not-pending" | "not-allowed" | "not-requester" | "bad-request" | "wrong-team";
export type JoinRequestDecision = { ok: true; next: JoinRequestStatus } | { ok: false; code: JoinRequestFailure; message: string };

/**
 * The join-request state machine. Only `pending` rows move:
 *   approve / deny: a team admin of the request's team, or a platform owner. (CS: the approve route required the caller's own
 *     `teamId` to equal the request's team and `isTeamAdmin`; the production rules also allow the owner to update any request.)
 *   cancel: only the person who asked (`userId == actor.uid`), never an admin (an admin denies instead).
 * An already-processed request answers "not-pending" (a 409 in the routes), so a double click is harmless.
 */
export function decideJoinRequest(request: Pick<JoinRequest, "status" | "userId" | "teamId">, action: JoinRequestAction, actor: ActorContext): JoinRequestDecision {
  if (!request.userId || !request.teamId) return { ok: false, code: "bad-request", message: "This request is missing its user or team. Ask for a new request." };
  if (action === "cancel") {
    if (request.userId !== actor.uid) return { ok: false, code: "not-requester", message: "You can only cancel your own request." };
    if (request.status !== "pending") return { ok: false, code: "not-pending", message: `This request is already ${request.status}.` };
    return { ok: true, next: "canceled" };
  }
  const allowed = isOwnerActor(actor) || isTeamAdminOf(actor, request.teamId);
  if (!allowed) {
    const isAdmin = actor.user ? isAdminFromCsUser(actor.user) : false;
    return !isAdmin
      ? { ok: false, code: "not-allowed", message: "Only team admins can handle join requests." }
      : { ok: false, code: "wrong-team", message: "You can only handle requests for your own team." };
  }
  if (request.status !== "pending") return { ok: false, code: "not-pending", message: `This request is already ${request.status}.` };
  return { ok: true, next: action === "approve" ? "approved" : "denied" };
}

/**
 * Can this user ask to join a team? A user who is already on a team (non-empty `teamId`) cannot (leaving a team is a
 * team-admin action), and a repeat request to a team they already have a pending request for is reported as a duplicate.
 */
export function canRequestToJoin(input: { user: CsUserDoc | null; teamId: string; existing: readonly Pick<JoinRequest, "teamId" | "status">[] }): { ok: true } | { ok: false; code: "already-member" | "duplicate"; message: string } {
  if (input.user && str(input.user.teamId).trim() !== "") return { ok: false, code: "already-member", message: "You're already on a team." };
  const team = normalizeTeamCode(input.teamId);
  if (input.existing.some((r) => r.status === "pending" && r.teamId === team)) {
    return { ok: false, code: "duplicate", message: "You already asked to join that team and your request is still pending." };
  }
  return { ok: true };
}

// --- documents the server writes ---------------------------------------------------------------------------------------

/** The user-doc fields a team-less signed-in user gets on first contact (CS `signUp`/Google signup: `teamId: ""`, `profileComplete: true`). */
export function buildBaseUserDoc(input: { uid: string; email: string; displayName: string; photoURL?: string; role?: unknown }, nowMs: number): CsUserDoc {
  const role = isRoleId(input.role) ? input.role : DEFAULT_ROLE_ID;
  return {
    uid: input.uid,
    email: input.email,
    displayName: input.displayName,
    role,
    roles: [role],
    secondaryRoles: [],
    teamId: "",
    isTeamAdmin: false,
    profileVisibility: "team",
    bio: "",
    photoURL: input.photoURL ?? "",
    emailVerificationExempt: false,
    profileComplete: true,
    createdAt: nowMs,
  };
}

/**
 * The merge-patch for an approved request (CS approve route + `syncApprovedJoinRequest`): `teamId`, `role`, `roles`, and cleared
 * special roles. `secondaryRoles` is reset so `role`/`roles`/`secondaryRoles` stay consistent (data/cs/users.ts), and
 * `isTeamAdmin` is false (CS's client fallback wrote the same; an approved joiner is a plain member, an admin promotes them).
 */
export function buildApprovalUserPatch(request: Pick<JoinRequest, "teamId" | "requestedRole">): CsRecord {
  return {
    teamId: request.teamId,
    role: request.requestedRole,
    roles: [request.requestedRole],
    secondaryRoles: [],
    specialRole: null,
    specialRoles: [],
    isTeamAdmin: false,
  };
}

/** The request-doc patch for each outcome. `processedAt` is epoch ms, like CS. */
export function buildRequestOutcomePatch(next: JoinRequestStatus, actorUid: string, nowMs: number, extra: { userName?: string; userEmail?: string; profileSyncPending?: boolean } = {}): CsRecord {
  const patch: CsRecord = { status: next, processedAt: nowMs, processedBy: actorUid };
  if (next === "canceled") patch.canceledByUser = true;
  if (next === "approved") {
    patch.profileSyncPending = extra.profileSyncPending === true;
    if (extra.profileSyncPending !== true) patch.profileSyncedAt = nowMs;
  }
  if (extra.userName) patch.userName = extra.userName;
  if (extra.userEmail) patch.userEmail = extra.userEmail;
  return patch;
}

export type NewTeamInput = {
  teamNumber: number;
  teamName?: string | null;
  ownerUid: string;
};

/**
 * `teams/{CODE}` as CS stores it (+ CE additive fields). `teamNumber` is a STRING, `verifiedOwnerId` is the owner, and
 * `selectedEvents` starts empty. The doc id is the uppercase code, which the caller chooses (`pickFreeTeamCode`).
 */
export function buildNewTeamDoc(input: NewTeamInput, nowMs: number): CsRecord {
  const name = (input.teamName ?? "").trim();
  return {
    teamName: name,
    teamNumber: String(digitsToNumber(input.teamNumber) || input.teamNumber),
    verifiedOwnerId: input.ownerUid,
    selectedEvents: [],
    createdAt: nowMs,
  };
}

/**
 * The user-doc patch for the creator of a team: a team admin on the new team (CS signup passed `isTeamAdmin: true` with the
 * team code as `teamId`). `isOwner` is the additive CE mirror of `verifiedOwnerId`, written only by server routes.
 */
export function buildCreatorUserPatch(input: { teamId: string; role?: unknown }): CsRecord {
  const role = isRoleId(input.role) ? input.role : DEFAULT_ROLE_ID;
  return {
    teamId: normalizeTeamCode(input.teamId),
    role,
    roles: [role],
    secondaryRoles: [],
    isTeamAdmin: true,
    isOwner: true,
  };
}

/** The owner uid of a raw team doc: CS's `verifiedOwnerId`, else CE's additive `ownerUid`. "" when there is none. */
export function ownerUidOfTeam(team: CsRecord | null | undefined): string {
  if (!team) return "";
  return str(team.verifiedOwnerId).trim() || str(team.ownerUid).trim();
}
