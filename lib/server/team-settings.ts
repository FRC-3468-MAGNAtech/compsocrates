import "server-only";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { generateTeamCode } from "@/data/cs/join-requests";

export const APP_SETTINGS_PATH = "appSettings/global";

/**
 * appSettings/global.adminsSeeAllProfiles (additive, Session G): when not `false`, team admins can read every profile of their own
 * team whatever its owner chose. Missing means ON; only an explicit `false` turns it off. The profile rules read the same field.
 */
export async function getAdminsSeeAllProfiles(db: Firestore): Promise<boolean> {
  const snap = await db.doc(APP_SETTINGS_PATH).get();
  return snap.data()?.adminsSeeAllProfiles !== false;
}

/**
 * appSettings/global.avatarUploadsEnabled (additive, Session 8): the platform owner's switch for profile picture uploads. Missing means OFF: uploads are allowed only when
 * the field is explicitly `true` (beta release decision; the owner sets it by hand). Pictures already uploaded keep showing either way.
 */
export async function getAvatarUploadsEnabled(db: Firestore): Promise<boolean> {
  const snap = await db.doc(APP_SETTINGS_PATH).get();
  return snap.data()?.avatarUploadsEnabled === true;
}

/** A random uppercase join code (the `teams/{CODE}` doc id). Collisions are checked by the caller (`pickFreeTeamCode`). */
export function randomJoinCode(length = 6): string {
  return generateTeamCode(Math.random, length);
}

/**
 * appSettings/global.teamCreationEnabled: public team creation. Missing field or missing document means OFF (applications are not open). This read has NO side
 * effects: it never writes appSettings/global. The platform owner turns creation on in the Admin Panel (or by hand in the console).
 */
export async function getTeamCreationEnabled(db: Firestore): Promise<boolean> {
  const snap = await db.doc(APP_SETTINGS_PATH).get();
  return snap.data()?.teamCreationEnabled === true;
}

/**
 * Transaction-safe read for /api/team/create, same meaning as getTeamCreationEnabled. Must be called before any writes in the same transaction, per Firestore's
 * reads-before-writes rule.
 */
export async function getTeamCreationEnabledInTransaction(db: Firestore, txn: Transaction): Promise<boolean> {
  const snap = await txn.get(db.doc(APP_SETTINGS_PATH));
  return snap.data()?.teamCreationEnabled === true;
}

const MEMBERSHIPS_ENABLED_TTL_MS = 30_000;
let membershipsEnabledCache: { value: boolean; at: number } | null = null;

/**
 * appSettings/global.membershipsEnabled (additive, memberships build 1): the kill switch for everything the membership model does on the server
 * (`ensureMembership` on sign-in, `/api/team/switch`, the backfill's `--apply`). Missing field or missing document means OFF; only an explicit `true` turns it on.
 * The owner sets it by hand in the Firestore console. The answer is cached in memory for about 30 seconds per server instance (the production project is on the
 * free read quota, and sign-in asks on every visit), so a flip takes up to that long to reach every instance. A failed read throws and is NOT cached.
 */
export async function getMembershipsEnabled(db: Firestore, nowMs: number = Date.now()): Promise<boolean> {
  if (membershipsEnabledCache && nowMs - membershipsEnabledCache.at < MEMBERSHIPS_ENABLED_TTL_MS) return membershipsEnabledCache.value;
  const snap = await db.doc(APP_SETTINGS_PATH).get();
  const value = snap.data()?.membershipsEnabled === true;
  membershipsEnabledCache = { value, at: nowMs };
  return value;
}

/** Test hook: forget the cached kill-switch answer. */
export function resetMembershipsEnabledCache(): void {
  membershipsEnabledCache = null;
}
