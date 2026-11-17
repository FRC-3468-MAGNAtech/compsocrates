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
