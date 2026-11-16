import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { PROGRAMS } from "@/config/programs";
import { isProgramId, type ProgramId } from "@/config/programs/types";
import { EMPTY_ACHIEVEMENT_CONFIG, parseAchievementConfig, validateConfigInput, type AchievementConfig } from "@/lib/achievements/config";
import { teamAuditDoc } from "@/lib/server/audit";
import { blobUserFromAppDoc, blobUserFromCsDoc } from "@/lib/server/blob-auth";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import type { CsUserDoc } from "@/data/cs/types";

/**
 * Session 8: a team's achievement settings, `teams/{teamId}/achievementConfig/main` (the other program: the same under its own prefix, `programs/<id>/`).
 * Written and read ONLY here, through the Admin SDK: the Firestore rules deny clients (the catch-all), and nothing is added to them.
 *
 *  - READ (`readAchievementConfig`): any signed-in caller gets the effective config of THEIR OWN active team, taken from their user document in the program they
 *    name (never a team id from the client). An account with no team gets the built-ins only (the empty config), not an error.
 *  - WRITE (`saveAchievementConfig`): a team admin (or team owner) of the caller's team, or the platform owner for any team. Everything is validated here
 *    (`validateConfigInput`); `expectedVersion` must equal the stored version or the answer is 409 `conflict` with the latest; the audit entry is written in the
 *    same transaction as the document.
 * Nothing outside `{prefix}teams/{teamId}/achievementConfig/main` and `{prefix}auditLog` is ever written.
 */

export type RouteResult = { status: number; body: Record<string, unknown> };
export type AchievementCaller = { uid: string; name: string | null; isPlatformOwner: boolean };

const HOUR_MS = 60 * 60 * 1000;
const WRITES_PER_HOUR = 30;
const READS_PER_HOUR = 600;
const TEAM_ID = /^[A-Za-z0-9_-]{1,40}$/;

const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): RouteResult => ({ status, body: { ok: false, code, error, ...extra } });

export function programOf(value: unknown): { ok: true; program: ProgramId } | { ok: false; result: RouteResult } {
  if (typeof value !== "string" || value === "") return { ok: false, result: fail(400, "program_required", "Say which program this is for.") };
  if (!isProgramId(value)) return { ok: false, result: fail(400, "unknown_program", "Unknown program.") };
  return { ok: true, program: value };
}

export const achievementConfigPath = (program: ProgramId, teamId: string) => `${PROGRAMS[program].firestorePrefix}teams/${teamId}/achievementConfig/main`;
const auditPath = (program: ProgramId) => `${PROGRAMS[program].firestorePrefix}auditLog`;

/** The caller's own team, admin flag and name, from THEIR user document in the program's namespace. */
export async function callerMembership(db: Firestore, program: ProgramId, uid: string): Promise<{ teamId: string; isAdmin: boolean; name: string | null }> {
  const prefix = PROGRAMS[program].firestorePrefix;
  const snap = await db.doc(`${prefix}users/${uid}`).get();
  if (!snap.exists) return { teamId: "", isAdmin: false, name: null };
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const user = prefix === "" ? blobUserFromCsDoc(uid, data as CsUserDoc) : blobUserFromAppDoc(data);
  const teamId = typeof user.teamId === "string" ? user.teamId : "";
  const name = typeof data.displayName === "string" ? data.displayName : typeof data.name === "string" ? data.name : null;
  return { teamId: TEAM_ID.test(teamId) ? teamId : "", isAdmin: user.isAdmin === true || user.isOwner === true, name };
}

export async function readAchievementConfig(db: Firestore, caller: AchievementCaller, programInput: unknown): Promise<RouteResult> {
  const p = programOf(programInput);
  if (!p.ok) return p.result;
  const limit = await consumeRateLimit(db, `achievements-read_${caller.uid}`, READS_PER_HOUR, HOUR_MS);
  if (!limit.allowed) return fail(429, "rate_limited", "Too many requests. Try again later.");
  const member = await callerMembership(db, p.program, caller.uid);
  if (!member.teamId) return { status: 200, body: { ok: true, teamId: null, canEdit: false, config: EMPTY_ACHIEVEMENT_CONFIG } };
  const snap = await db.doc(achievementConfigPath(p.program, member.teamId)).get();
  return { status: 200, body: { ok: true, teamId: member.teamId, canEdit: member.isAdmin || caller.isPlatformOwner, config: snap.exists ? parseAchievementConfig(snap.data()) : EMPTY_ACHIEVEMENT_CONFIG } };
}

export type SaveInput = { program?: unknown; teamId?: unknown; expectedVersion?: unknown; overrides?: unknown; custom?: unknown; order?: unknown };

export async function saveAchievementConfig(db: Firestore, caller: AchievementCaller, input: SaveInput, now: () => number = Date.now): Promise<RouteResult> {
  const p = programOf(input.program);
  if (!p.ok) return p.result;
  const { program } = p;

  // Who may write, and for which team: from the caller's own document, never from the request.
  const member = await callerMembership(db, program, caller.uid);
  let teamId = member.teamId;
  if (input.teamId !== undefined) {
    if (typeof input.teamId !== "string" || !TEAM_ID.test(input.teamId)) return fail(400, "invalid_team", "That is not a valid team.");
    if (input.teamId !== member.teamId && !caller.isPlatformOwner) return fail(403, "forbidden", "You can only change your own team's achievements.");
    teamId = input.teamId;
  }
  if (!teamId) return fail(403, "forbidden", "Only a team admin can change achievements.");
  if (!caller.isPlatformOwner && !member.isAdmin) return fail(403, "forbidden", "Only a team admin can change achievements.");

  const expected = input.expectedVersion;
  if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 0) return fail(400, "invalid_version", "Missing the version you started from.");
  const valid = validateConfigInput({ overrides: input.overrides, custom: input.custom, order: input.order }, PROGRAMS[program].achievementMetrics);
  if (!valid.ok) return fail(400, valid.code, valid.error);

  const limit = await consumeRateLimit(db, `achievements-write_${caller.uid}`, WRITES_PER_HOUR, HOUR_MS);
  if (!limit.allowed) return fail(429, "rate_limited", "Too many changes. Try again later.");

  const ref = db.doc(achievementConfigPath(program, teamId));
  const outcome = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    const current: AchievementConfig = snap.exists ? parseAchievementConfig(snap.data()) : EMPTY_ACHIEVEMENT_CONFIG;
    if (current.version !== expected) return { conflict: current };
    const next: AchievementConfig = { version: current.version + 1, overrides: valid.overrides, custom: valid.custom, order: valid.order, updatedAt: now(), updatedBy: caller.uid };
    txn.set(ref, next);
    const summary = (c: AchievementConfig) => ({ version: c.version, renamed: Object.keys(c.overrides).length, custom: c.custom.map((d) => d.name) });
    txn.set(db.collection(auditPath(program)).doc(), teamAuditDoc(teamId, caller.uid, caller.name ?? member.name ?? "Admin", "edit-achievements", { teamId }, summary(current), summary(next)));
    return { saved: next };
  });
  if ("conflict" in outcome) return fail(409, "conflict", "Someone else changed the achievements while you were editing.", { config: outcome.conflict });
  return { status: 200, body: { ok: true, teamId, config: outcome.saved } };
}
