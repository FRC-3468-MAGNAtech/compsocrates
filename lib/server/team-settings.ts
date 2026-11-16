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
 * appSettings/global.avatarUploadsEnabled (additive, Session 8): the platform owner's switch for profile picture uploads. Missing means ON; only an explicit `false`
 * turns it off (the Upload option disappears and the upload route refuses; pictures already uploaded keep showing).
 */
export async function getAvatarUploadsEnabled(db: Firestore): Promise<boolean> {
  const snap = await db.doc(APP_SETTINGS_PATH).get();
  return snap.data()?.avatarUploadsEnabled !== false;
}

/** A random uppercase join code (the `teams/{CODE}` doc id). Collisions are checked by the caller (`pickFreeTeamCode`). */
export function randomJoinCode(length = 6): string {
  return generateTeamCode(Math.random, length);
}

/** The default when appSettings/global doesn't exist yet: enabled only if no team exists. */
async function computeDefaultTeamCreationEnabled(db: Firestore, txn?: Transaction): Promise<boolean> {
  const teamsQuery = db.collection("teams").limit(1);
  const snap = txn ? await txn.get(teamsQuery) : await teamsQuery.get();
  return snap.empty;
}

/**
 * Plain (non-transactional) read for the public config route: if the
 * settings doc doesn't exist yet, computes and persists the default so
 * later reads (and the create-team transaction) see a stable value instead
 * of recomputing "does any team exist" forever.
 */
export async function getTeamCreationEnabled(db: Firestore): Promise<boolean> {
  const ref = db.doc(APP_SETTINGS_PATH);
  const snap = await ref.get();
  if (snap.exists) return Boolean(snap.data()?.teamCreationEnabled);
  const computed = await computeDefaultTeamCreationEnabled(db);
  await ref.set({ teamCreationEnabled: computed }, { merge: true });
  return computed;
}

/**
 * Transaction-safe read for /api/team/create — reads (and, if missing,
 * computes but does not persist — the transaction's own write does that)
 * the current value. Must be called before any writes in the same
 * transaction, per Firestore's reads-before-writes rule.
 */
export async function getTeamCreationEnabledInTransaction(db: Firestore, txn: Transaction): Promise<boolean> {
  const ref = db.doc(APP_SETTINGS_PATH);
  const snap = await txn.get(ref);
  if (snap.exists) return Boolean(snap.data()?.teamCreationEnabled);
  return computeDefaultTeamCreationEnabled(db, txn);
}
