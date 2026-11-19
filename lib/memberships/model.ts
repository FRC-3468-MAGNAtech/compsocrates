/**
 * Memberships (docs/MEMBERSHIP_PLAN.md, build 1): the pure part. No Firebase, no React: types, field mapping, validation and builders, shared by the server
 * module (`lib/server/memberships.ts`), the backfill script and the `useAccountState()` hook.
 *
 * One membership = one account's record in one team: `memberships/{teamId}_{uid}` under the program's path prefix, built with the program path helper (the
 * default program's collection is at the root). The membership uses ONE set of field names; `ProgramConfig.membership.userFields` says which user-document field each is saved
 * from and restored to, so nothing here names a program.
 *
 * Values are stored RAW (a legacy role such as "coach" or "scout" stays as it is). A field absent on the user document is stored as `null`, and restoring a
 * null DELETES the field (never a default): an existing account's displayed role never changes. A value of the wrong shape or size counts as absent.
 * `isPlatformOwner` is never read, stored or restored. The email is never stored.
 */
import { PROGRAMS } from "@/config/programs";
import { PROGRAM_IDS, isProgramId, type ProgramId } from "@/config/programs/types";

export { PROGRAM_IDS, isProgramId };
export type { ProgramId };

/** Where a membership came from. "pointer": derived from a user document's `teamId`, which a client can write (CS-OPEN), so it never grants more than the pointer already does. "verified": created by a server flow that checked the join (a later build session). */
export type MembershipOrigin = "pointer" | "verified";
export type MembershipStatus = "active" | "past";
export type MembershipEndedBy = null | "self" | "admin" | "deleted";

/** The role fields of a membership: raw values, `null` = absent (or not a field of this program). */
export type RoleSnapshot = {
  role: string | null;
  roles: string[] | null;
  secondaryRoles: string[] | null;
  isAdmin: boolean | null;
  isOwner: boolean | null;
  fieldTeamIds: string[] | null;
};

/** A snapshot with every field absent. */
export const EMPTY_ROLES: RoleSnapshot = { role: null, roles: null, secondaryRoles: null, isAdmin: null, isOwner: null, fieldTeamIds: null };

export type MembershipDoc = RoleSnapshot & {
  uid: string;
  teamId: string;
  /** Display-name snapshot. Never an email. */
  name: string;
  status: MembershipStatus;
  origin: MembershipOrigin;
  /** Epoch milliseconds. */
  joinedAt: number;
  leftAt: number | null;
  endedBy: MembershipEndedBy;
  updatedAt: number;
  /** Build 2, additive: set when a past membership of the same team is restored (the original `joinedAt` is kept). */
  rejoinedAt?: number;
  /** Build 2, additive: who verified an existing admin's membership (the platform owner's uid) and when (epoch ms). Absent on memberships verified by a join flow. */
  verifiedBy?: string;
  verifiedAt?: number;
  /** Build 2, additive: the team's label ("Team 3468 · Name") when a build 2 flow made or changed the membership, so the team switcher can name a team the person is not on right now (their rules cannot read it). Absent on older ones. */
  teamLabel?: string;
  /**
   * Build 5, additive, written by SERVER code only (`teamSnapshotOfDoc` in flows.ts): the team's identity, so a label never needs the team document or an id. `teamNumber` is the
   * team number's digits, or the robot teams' numbers joined with " + "; `teamName` is the team's organization name, else the robot teams' names joined, else the team's name.
   * Not personal data. Absent on older memberships (the switch route and the sign-in sync fill it in, once).
   */
  teamNumber?: string;
  teamName?: string;
};

export const MEMBERSHIP_LIMITS = { idPart: 128, name: 120, role: 64, listItems: 50, listItem: 100 } as const;

export type MembershipErrorCode = "no_team" | "invalid_id";

/** A typed refusal with the HTTP status a route answers with. */
export class MembershipError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "MembershipError";
  }
}

/** Is `value` a Firestore-safe id part for a membership key: non-empty, no "_" or "/", not "." or "..", not `__x__`, within the length limit. */
export function isKeyPart(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MEMBERSHIP_LIMITS.idPart &&
    !value.includes("_") &&
    !value.includes("/") &&
    value !== "." &&
    value !== ".." &&
    value.trim() === value
  );
}

/** `{teamId}_{uid}`, or the reason the pair cannot make a key. The pointer is used exactly as stored (no case change). */
export function membershipKey(teamId: string, uid: string): { ok: true; id: string } | { ok: false; error: "no_team" | "invalid_id" } {
  if (typeof teamId !== "string" || teamId.trim() === "") return { ok: false, error: "no_team" };
  if (!isKeyPart(teamId) || !isKeyPart(uid)) return { ok: false, error: "invalid_id" };
  return { ok: true, id: `${teamId}_${uid}` };
}

/** The user document's active-team pointer exactly as stored; "" when it is missing, not a string or blank. */
export function pointerOf(userDoc: Record<string, unknown> | undefined | null): string {
  const value = userDoc?.teamId;
  return typeof value === "string" && value.trim() !== "" ? value : "";
}

function stringOrNull(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

function listOrNull(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MEMBERSHIP_LIMITS.listItems) return null;
  return value.every((v) => typeof v === "string" && v.length <= MEMBERSHIP_LIMITS.listItem) ? [...(value as string[])] : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** The role fields of a user document, by the program's field map. A field the program does not have is `null`. */
export function readRoleSnapshot(program: ProgramId, userDoc: Record<string, unknown> | undefined | null): RoleSnapshot {
  const f = PROGRAMS[program].membership.userFields;
  const get = (name: string | null | undefined) => (!name || !userDoc ? undefined : userDoc[name]);
  return {
    role: stringOrNull(get(f.role), MEMBERSHIP_LIMITS.role),
    roles: listOrNull(get(f.roles)),
    secondaryRoles: listOrNull(get(f.secondaryRoles)),
    isAdmin: boolOrNull(get(f.isAdmin)),
    isOwner: boolOrNull(get(f.isOwner)),
    fieldTeamIds: listOrNull(get(f.fieldTeamIds)),
  };
}

/** The role fields as stored on a membership document (tolerant: anything of the wrong shape is `null`). */
export function roleSnapshotOf(doc: Record<string, unknown> | undefined | null): RoleSnapshot {
  return {
    role: stringOrNull(doc?.role, MEMBERSHIP_LIMITS.role),
    roles: listOrNull(doc?.roles),
    secondaryRoles: listOrNull(doc?.secondaryRoles),
    isAdmin: boolOrNull(doc?.isAdmin),
    isOwner: boolOrNull(doc?.isOwner),
    fieldTeamIds: listOrNull(doc?.fieldTeamIds),
  };
}

/**
 * The user-document patch that restores a snapshot: each mapped field gets its value, or `remove` (pass `FieldValue.delete()`) when the snapshot holds null.
 * A field the program does not have is left out entirely. `isPlatformOwner` and `teamId` are not touched here.
 */
export function restorePatch(program: ProgramId, snapshot: RoleSnapshot, remove: unknown): Record<string, unknown> {
  const f = PROGRAMS[program].membership.userFields;
  const patch: Record<string, unknown> = {};
  const put = (field: string | null | undefined, value: unknown) => {
    if (field) patch[field] = value === null ? remove : value;
  };
  put(f.role, snapshot.role);
  put(f.roles, snapshot.roles);
  put(f.secondaryRoles, snapshot.secondaryRoles);
  put(f.isAdmin, snapshot.isAdmin);
  put(f.isOwner, snapshot.isOwner);
  put(f.fieldTeamIds, snapshot.fieldTeamIds);
  return patch;
}

/** The display-name snapshot of a user document (first non-empty of the program's name fields), trimmed and cut to the limit. Never an email. */
export function nameSnapshot(program: ProgramId, userDoc: Record<string, unknown> | undefined | null): string {
  for (const field of PROGRAMS[program].membership.nameFields) {
    const v = userDoc?.[field];
    if (typeof v === "string" && v.trim() !== "") return v.trim().slice(0, MEMBERSHIP_LIMITS.name);
  }
  return "";
}

export type BuildResult = { ok: true; id: string; doc: MembershipDoc } | { ok: false; error: MembershipErrorCode };

/**
 * A membership built from a user document: the active team is the user's pointer, the role fields are what the document carries now, the origin is
 * "pointer" (a client can write that pointer), status active. Pure; `nowMs` is the clock. Refuses a missing pointer ("no_team") and a `teamId` or `uid`
 * that cannot make a key ("invalid_id").
 */
export function buildMembershipFromUser(program: ProgramId, uid: string, userDoc: Record<string, unknown> | undefined | null, nowMs: number): BuildResult {
  const teamId = pointerOf(userDoc);
  const key = membershipKey(teamId, uid);
  if (!key.ok) return key;
  return {
    ok: true,
    id: key.id,
    doc: {
      uid,
      teamId,
      ...readRoleSnapshot(program, userDoc),
      name: nameSnapshot(program, userDoc),
      status: "active",
      origin: "pointer",
      joinedAt: nowMs,
      leftAt: null,
      endedBy: null,
      updatedAt: nowMs,
    },
  };
}

const KEYS: readonly string[] = ["uid", "teamId", "role", "roles", "secondaryRoles", "isAdmin", "isOwner", "fieldTeamIds", "name", "status", "origin", "joinedAt", "leftAt", "endedBy", "updatedAt", "rejoinedAt", "verifiedBy", "verifiedAt", "teamLabel", "teamNumber", "teamName"];

/** Shape and size check of a membership document before it is written. Returns the first problem, or null. Rejects unknown keys (so an email can never ride along). */
export function membershipProblem(doc: Record<string, unknown>): string | null {
  for (const k of Object.keys(doc)) if (!KEYS.includes(k)) return `unexpected field ${k}`;
  if (!isKeyPart(doc.uid)) return "uid";
  if (!isKeyPart(doc.teamId)) return "teamId";
  if (typeof doc.name !== "string" || doc.name.length > MEMBERSHIP_LIMITS.name) return "name";
  if (doc.status !== "active" && doc.status !== "past") return "status";
  if (doc.origin !== "pointer" && doc.origin !== "verified") return "origin";
  if (!Number.isFinite(doc.joinedAt) || !Number.isFinite(doc.updatedAt)) return "timestamps";
  if (doc.leftAt !== null && !Number.isFinite(doc.leftAt)) return "leftAt";
  if (doc.endedBy !== null && doc.endedBy !== "self" && doc.endedBy !== "admin" && doc.endedBy !== "deleted") return "endedBy";
  if (doc.rejoinedAt !== undefined && !Number.isFinite(doc.rejoinedAt)) return "rejoinedAt";
  if (doc.verifiedBy !== undefined && !isKeyPart(doc.verifiedBy)) return "verifiedBy";
  if (doc.verifiedAt !== undefined && !Number.isFinite(doc.verifiedAt)) return "verifiedAt";
  if (doc.teamLabel !== undefined && (typeof doc.teamLabel !== "string" || doc.teamLabel.length > MEMBERSHIP_LIMITS.name)) return "teamLabel";
  for (const k of ["teamNumber", "teamName"] as const) if (doc[k] !== undefined && (typeof doc[k] !== "string" || (doc[k] as string).length > MEMBERSHIP_LIMITS.name)) return k;
  if (doc.role !== null && stringOrNull(doc.role, MEMBERSHIP_LIMITS.role) === null) return "role";
  for (const k of ["roles", "secondaryRoles", "fieldTeamIds"] as const) if (doc[k] !== null && listOrNull(doc[k]) === null) return k;
  for (const k of ["isAdmin", "isOwner"] as const) if (doc[k] !== null && typeof doc[k] !== "boolean") return k;
  return null;
}

/** A stored membership document read tolerantly (for the hook and the roster readers). Null when it has no usable uid, team or status. */
export function readMembership(data: Record<string, unknown> | undefined | null): MembershipDoc | null {
  if (!data || typeof data.uid !== "string" || typeof data.teamId !== "string" || data.teamId === "") return null;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    uid: data.uid,
    teamId: data.teamId,
    ...roleSnapshotOf(data),
    name: typeof data.name === "string" ? data.name : "",
    status: data.status === "past" ? "past" : "active",
    origin: data.origin === "verified" ? "verified" : "pointer",
    joinedAt: num(data.joinedAt),
    leftAt: typeof data.leftAt === "number" ? data.leftAt : null,
    endedBy: data.endedBy === "self" || data.endedBy === "admin" || data.endedBy === "deleted" ? data.endedBy : null,
    updatedAt: num(data.updatedAt),
    ...(typeof data.rejoinedAt === "number" ? { rejoinedAt: data.rejoinedAt } : {}),
    ...(typeof data.verifiedBy === "string" ? { verifiedBy: data.verifiedBy } : {}),
    ...(typeof data.verifiedAt === "number" ? { verifiedAt: data.verifiedAt } : {}),
    ...(typeof data.teamLabel === "string" && data.teamLabel !== "" ? { teamLabel: data.teamLabel } : {}),
    ...(typeof data.teamNumber === "string" && data.teamNumber !== "" ? { teamNumber: data.teamNumber } : {}),
    ...(typeof data.teamName === "string" && data.teamName !== "" ? { teamName: data.teamName } : {}),
  };
}
