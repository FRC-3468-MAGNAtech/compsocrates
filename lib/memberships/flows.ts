/**
 * Memberships build 2: the PURE rules of join, leave, removal and role edits (no Firebase, no React). The server flows (`lib/server/membership-flows.ts`) read
 * documents, ask these functions what to do, and write the answer in one transaction. Nothing here names a program: every field name comes from
 * `ProgramConfig.membership`.
 */
import { PROGRAMS } from "@/config/programs";
import { composeTeamIdentity } from "@/lib/team-label";
import { parseTeamNumber, readTeamIdentity, teamLabel } from "@/lib/team-number";
import { DEFAULT_ROLE_ID, isRoleId, normalizeLegacyRole, sortRolesCanonical, type RoleId } from "@/lib/roles";
import {
  MembershipError,
  readRoleSnapshot,
  roleSnapshotOf,
  type MembershipDoc,
  type MembershipEndedBy,
  type ProgramId,
  type RoleSnapshot,
} from "@/lib/memberships/model";

/** The team-document switch (default OFF): may a joiner ask for a role? Read as exactly `true`. */
export const ALLOW_ROLE_CHOICE_FIELD = "allowMemberRoleChoice";

/** Roles a joiner may ask for, and an approval may grant from a request. Admin and owner are FLAGS, not roles, and a request never carries them. The coach role is also left out: the program's legacy coach value is an admin value in the rules. */
export const NON_REQUESTABLE_ROLES: readonly string[] = ["team-coach"];

export function isRequestableRole(value: unknown): value is RoleId {
  return isRoleId(value) && !NON_REQUESTABLE_ROLES.includes(value);
}

/**
 * The role an approval grants. The requested role only when the team's switch is exactly `true` AND the role is a valid non-admin role; otherwise the program's
 * default join role. `honored` says whether the request's own choice won (for the audit entry).
 */
export function resolveApprovedRole(input: { program: ProgramId; allowChoice: unknown; requested: unknown }): { role: RoleId; honored: boolean } {
  const fallback = PROGRAMS[input.program].membership.defaultJoinRole;
  const fallbackRole: RoleId = isRoleId(fallback) ? fallback : DEFAULT_ROLE_ID;
  if (input.allowChoice === true && isRequestableRole(input.requested)) return { role: input.requested, honored: true };
  return { role: fallbackRole, honored: false };
}

type Doc = Record<string, unknown> | undefined | null;

/** Is this user document an admin by the program's own field (and its legacy admin role value, when it has one)? */
export function userIsAdmin(program: ProgramId, doc: Doc): boolean {
  const m = PROGRAMS[program].membership;
  if (doc?.[m.userFields.isAdmin] === true) return true;
  const legacy = m.flows.legacyAdminRole;
  return !!legacy && typeof doc?.[m.userFields.role] === "string" && (doc[m.userFields.role] as string).trim().toLowerCase() === legacy;
}

export function userIsOwner(program: ProgramId, doc: Doc): boolean {
  return doc?.[PROGRAMS[program].membership.userFields.isOwner] === true;
}

/** The uid a team document names as its owner ("" when none). */
export function teamOwnerUid(program: ProgramId, team: Doc): string {
  for (const field of PROGRAMS[program].membership.flows.ownerFields) {
    const v = team?.[field];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return "";
}

/** One person of a team's roster as the guards see them. */
export type RosterRow = { uid: string; name: string; isAdmin: boolean; isOwner: boolean; pointer: boolean };

export type Refusal = { status: number; code: string; message: string };

/**
 * May `target` leave or be removed, given everyone ELSE active on the team? The sole remaining member may always go. An owner must transfer ownership first
 * (the existing transfer flow). The only active admin of a team that still has other members cannot go (that would leave a team nobody can manage). A platform owner's
 * `force` skips both (recovery).
 */
export function guardEnding(input: { target: RosterRow; others: readonly RosterRow[]; teamOwnerUid: string; force: boolean }): Refusal | null {
  if (input.force || input.others.length === 0) return null;
  if (input.target.isOwner || (input.teamOwnerUid !== "" && input.teamOwnerUid === input.target.uid)) {
    return { status: 409, code: "owner_must_transfer", message: "The owner has to transfer ownership to another admin first (Team Settings), then leave." };
  }
  if (input.target.isAdmin && !input.others.some((r) => r.isAdmin)) {
    return { status: 409, code: "last_admin", message: "You are the only admin and the team still has other members. Make another member an admin first." };
  }
  return null;
}

/** An admin removing their own admin flag while nobody else is an admin. */
export function guardSelfDemotion(input: { actorUid: string; targetUid: string; makesAdmin: boolean | undefined; currentlyAdmin: boolean; others: readonly RosterRow[] }): Refusal | null {
  if (input.makesAdmin !== false || !input.currentlyAdmin || input.actorUid !== input.targetUid) return null;
  if (input.others.some((r) => r.isAdmin)) return null;
  return { status: 409, code: "last_admin", message: "You are the only admin. Make another member an admin before you step down." };
}

export type AccessChanges = { primaryRole?: RoleId; secondaryRoles?: RoleId[]; isAdmin?: boolean };

/** Validates a role-edit request body. Role ids must be real; admin must be a boolean; `isOwner` and `isPlatformOwner` are never accepted. */
export function parseAccessChanges(input: unknown): { ok: true; changes: AccessChanges } | { ok: false; message: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, message: "Nothing to change." };
  const raw = input as Record<string, unknown>;
  const extra = Object.keys(raw).filter((k) => k !== "primaryRole" && k !== "secondaryRoles" && k !== "isAdmin");
  if (extra.length > 0) return { ok: false, message: "That field cannot be changed here." };
  const out: AccessChanges = {};
  if (raw.primaryRole !== undefined) {
    if (!isRoleId(raw.primaryRole)) return { ok: false, message: "That is not a role." };
    out.primaryRole = raw.primaryRole;
  }
  if (raw.secondaryRoles !== undefined) {
    if (!Array.isArray(raw.secondaryRoles) || raw.secondaryRoles.length > 9 || !raw.secondaryRoles.every(isRoleId)) return { ok: false, message: "Those are not roles." };
    out.secondaryRoles = [...new Set(raw.secondaryRoles as RoleId[])];
  }
  if (raw.isAdmin !== undefined) {
    if (typeof raw.isAdmin !== "boolean") return { ok: false, message: "Admin must be on or off." };
    out.isAdmin = raw.isAdmin;
  }
  if (Object.keys(out).length === 0) return { ok: false, message: "Nothing to change." };
  return { ok: true, changes: out };
}

/** A user document's roles as the app reads them (CS rule: the stored `role`, else the first listed one, else the default). */
export function rolesOf(program: ProgramId, doc: Doc): { primaryRole: RoleId; secondaryRoles: RoleId[] } {
  const f = PROGRAMS[program].membership.userFields;
  const listed = [...(f.roles && Array.isArray(doc?.[f.roles]) ? (doc?.[f.roles] as unknown[]) : []), ...(Array.isArray(doc?.[f.secondaryRoles]) ? (doc?.[f.secondaryRoles] as unknown[]) : [])]
    .filter((v): v is string => typeof v === "string")
    .map((v) => normalizeLegacyRole(v));
  const rawPrimary = typeof doc?.[f.role] === "string" ? (doc?.[f.role] as string).trim() : "";
  const primaryRole: RoleId = rawPrimary ? normalizeLegacyRole(rawPrimary) : (listed[0] ?? DEFAULT_ROLE_ID);
  return { primaryRole, secondaryRoles: sortRolesCanonical(listed.filter((r) => r !== primaryRole)) };
}

/**
 * The user-document patch for a role edit of the ACTIVE team's member, by the program's field map. The legacy admin role value (`flows.legacyAdminRole`, where a program has one) is handled like
 * the client editor did: demoting such an admin rewrites the roles, and changing the role of one keeps it an admin. Never touches `isOwner` or `isPlatformOwner`.
 */
export function accessUserPatch(program: ProgramId, current: Doc, changes: AccessChanges): Record<string, unknown> {
  const m = PROGRAMS[program].membership;
  const f = m.userFields;
  const legacy = m.flows.legacyAdminRole;
  const rawRole = typeof current?.[f.role] === "string" ? (current[f.role] as string).trim().toLowerCase() : "";
  const isLegacyAdmin = !!legacy && rawRole === legacy;
  const rolesTouched = changes.primaryRole !== undefined || changes.secondaryRoles !== undefined;
  const out: Record<string, unknown> = {};
  if (rolesTouched || (changes.isAdmin === false && isLegacyAdmin)) {
    const now = rolesOf(program, current);
    const primary = changes.primaryRole ?? now.primaryRole;
    const secondary = sortRolesCanonical((changes.secondaryRoles ?? now.secondaryRoles).filter((r) => r !== primary));
    out[f.role] = primary;
    if (f.roles) out[f.roles] = [primary, ...secondary];
    out[f.secondaryRoles] = secondary;
    if (rolesTouched && changes.isAdmin === undefined && isLegacyAdmin && primary !== "team-coach") out[f.isAdmin] = true;
  }
  if (changes.isAdmin !== undefined) out[f.isAdmin] = changes.isAdmin;
  return out;
}

/** The same edit applied to a membership's stored snapshot (an INACTIVE team's member). */
export function accessMembershipPatch(program: ProgramId, current: RoleSnapshot, changes: AccessChanges): Partial<RoleSnapshot> {
  const f = PROGRAMS[program].membership.userFields;
  const out: Partial<RoleSnapshot> = {};
  if (changes.primaryRole !== undefined || changes.secondaryRoles !== undefined) {
    const stored = current.role ? normalizeLegacyRole(current.role) : DEFAULT_ROLE_ID;
    const storedSecondary = sortRolesCanonical((current.secondaryRoles ?? []).filter((r): r is RoleId => isRoleId(r)));
    const primary = changes.primaryRole ?? stored;
    const secondary = sortRolesCanonical((changes.secondaryRoles ?? storedSecondary).filter((r) => r !== primary));
    out.role = primary;
    if (f.roles) out.roles = [primary, ...secondary];
    out.secondaryRoles = secondary;
  }
  if (changes.isAdmin !== undefined) out.isAdmin = changes.isAdmin;
  return out;
}

/**
 * The user-document patch when a person's LAST team ends: the pointer is emptied and the team-specific fields go back to "no team" exactly as the program's
 * own fields require (the default role, no secondary roles, not admin, not owner, no field teams, plus the program's extras). Preferences are not touched.
 * `remove` is `FieldValue.delete()`.
 */
export function clearedUserPatch(program: ProgramId, remove: unknown): Record<string, unknown> {
  const m = PROGRAMS[program].membership;
  const f = m.userFields;
  const role = m.defaultJoinRole;
  const out: Record<string, unknown> = { teamId: "", [f.role]: role, [f.secondaryRoles]: [], [f.isAdmin]: false, [f.isOwner]: false };
  if (f.roles) out[f.roles] = [role];
  if (f.fieldTeamIds) out[f.fieldTeamIds] = remove;
  for (const [k, v] of Object.entries(m.flows.leaveExtras)) out[k] = Array.isArray(v) ? [] : v;
  return out;
}

/** A VERIFIED membership: created by a server flow that checked the join (approval, creation, transfer, rejoin). */
export function buildVerifiedMembership(input: { program: ProgramId; uid: string; teamId: string; name: string; teamLabel?: string; snapshot?: TeamSnapshot | null; role: string; isAdmin?: boolean; isOwner?: boolean; fieldTeamIds: string[] | null; nowMs: number }): MembershipDoc {
  const hasRoles = !!PROGRAMS[input.program].membership.userFields.roles;
  return {
    uid: input.uid,
    teamId: input.teamId,
    role: input.role,
    roles: hasRoles ? [input.role] : null,
    secondaryRoles: [],
    isAdmin: input.isAdmin === true,
    isOwner: input.isOwner === true,
    fieldTeamIds: PROGRAMS[input.program].membership.userFields.fieldTeamIds ? input.fieldTeamIds : null,
    name: input.name.slice(0, 120),
    ...(input.teamLabel ? { teamLabel: input.teamLabel.slice(0, 120) } : {}),
    ...(input.snapshot ?? {}),
    status: "active",
    origin: "verified",
    joinedAt: input.nowMs,
    leftAt: null,
    endedBy: null,
    updatedAt: input.nowMs,
  };
}

/** "Team 3468 · Name" (or "Team 3468", or the name, or "") from a team document, for the switcher. Never throws. */
export function teamLabelOfDoc(team: Doc): string {
  const { number, name } = readTeamIdentity(team as { teamNumber?: unknown; teamName?: unknown; number?: unknown; name?: unknown } | null | undefined);
  if (number !== null) return teamLabel(number, name);
  return name ?? "";
}

/** The identity snapshot a membership carries (`teamNumber`, `teamName`; see MembershipDoc). */
export type TeamSnapshot = { teamNumber: string; teamName: string };

const snapText = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

/**
 * Pure: the identity snapshot of a team document, for the membership. Never throws, never contains an id.
 *  - SEVERAL robot teams (`ProgramConfig.membership.flows.robotTeamsField`): the number is their numbers joined with " + ", the name the organization name (`accountName`) when set, else their names joined with " + ".
 *  - otherwise the team's own number, and the organization name when set, else the team's own name.
 * Null when neither a number nor a name can be read (nothing is written then).
 */
export function teamSnapshotOfDoc(program: ProgramId, team: Doc): TeamSnapshot | null {
  if (!team) return null;
  const field = PROGRAMS[program].membership.flows.robotTeamsField;
  const raw = field ? (team as Record<string, unknown>)[field] : null;
  const robots = Array.isArray(raw)
    ? raw
        .map((r) => (r && typeof r === "object" ? { number: parseTeamNumber(snapText((r as { number?: unknown }).number)), name: snapText((r as { name?: unknown }).name) } : null))
        .filter((r): r is { number: number; name: string } => r !== null && r.number !== null)
    : [];
  const own = readTeamIdentity(team as { teamNumber?: unknown; teamName?: unknown; number?: unknown; name?: unknown });
  const identity = composeTeamIdentity({ number: own.number, name: own.name, org: snapText((team as Record<string, unknown>).accountName), robots });
  return identity ? { teamNumber: identity.number, teamName: identity.name } : null;
}

/** The patch that restores a PAST membership of the same team: active again, `rejoinedAt` set, the original `joinedAt` kept, the role set fresh by the approver. */
export function restoredMembershipPatch(input: { program: ProgramId; name: string; teamLabel?: string; snapshot?: TeamSnapshot | null; role: string; fieldTeamIds: string[] | null; nowMs: number }): Record<string, unknown> {
  const f = PROGRAMS[input.program].membership.userFields;
  return {
    status: "active",
    leftAt: null,
    endedBy: null,
    rejoinedAt: input.nowMs,
    origin: "verified",
    role: input.role,
    roles: f.roles ? [input.role] : null,
    secondaryRoles: [],
    isAdmin: false,
    isOwner: false,
    fieldTeamIds: f.fieldTeamIds ? input.fieldTeamIds : null,
    name: input.name.slice(0, 120),
    ...(input.teamLabel ? { teamLabel: input.teamLabel.slice(0, 120) } : {}),
    ...(input.snapshot ?? {}),
    updatedAt: input.nowMs,
  };
}

/** The patch that ends a membership (leave or removal): past, with when and by whom, and the freshest name and role snapshot we have. */
export function endedMembershipPatch(input: { endedBy: Exclude<MembershipEndedBy, null | "deleted">; snapshot: RoleSnapshot; name: string; nowMs: number }): Record<string, unknown> {
  return { status: "past", leftAt: input.nowMs, endedBy: input.endedBy, ...input.snapshot, name: input.name.slice(0, 120), updatedAt: input.nowMs };
}

/** From a person's active memberships, the most recently active one that is not `excludeTeamId` (the pointer's next home), or null. */
export function pickNextActive(rows: readonly MembershipDoc[], excludeTeamId: string): MembershipDoc | null {
  const candidates = rows.filter((r) => r.status === "active" && r.teamId !== excludeTeamId);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => b.updatedAt - a.updatedAt || a.teamId.localeCompare(b.teamId))[0];
}

/** One roster row from a user document that points at the team (the user document is the truth for the active team's role). */
export function rosterRowFromUser(program: ProgramId, uid: string, doc: Doc): RosterRow {
  const m = PROGRAMS[program].membership;
  let name = "";
  for (const field of m.nameFields) {
    const v = doc?.[field];
    if (typeof v === "string" && v.trim() !== "") {
      name = v.trim();
      break;
    }
  }
  return { uid, name, isAdmin: userIsAdmin(program, doc), isOwner: userIsOwner(program, doc), pointer: true };
}

/** One roster row from a membership of a team the person is NOT currently pointed at. */
export function rosterRowFromMembership(m: MembershipDoc): RosterRow {
  return { uid: m.uid, name: m.name, isAdmin: m.isAdmin === true, isOwner: m.isOwner === true, pointer: false };
}

/** A user row wins over a membership row for the same uid. */
export function mergeRosterRows(userRows: readonly RosterRow[], membershipRows: readonly RosterRow[]): RosterRow[] {
  const seen = new Set(userRows.map((r) => r.uid));
  return [...userRows, ...membershipRows.filter((r) => !seen.has(r.uid))];
}

export { MembershipError, readRoleSnapshot, roleSnapshotOf };
