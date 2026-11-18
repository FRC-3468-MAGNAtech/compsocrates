import "server-only";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { generateTeamCode } from "@/data/cs/join-requests";
import { DEFAULT_RUN_WRITES, MAX_RUN_WRITES } from "@/lib/deletion/constants";

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

/**
 * ONE cached read of appSettings/global per server instance (about 30 s), shared by the memberships switch, the account deletion settings, the read meter switch and the
 * public config route (which used to read the document up to five times per call). A failed read throws and is NOT cached. The write routes call
 * `invalidateAppSettingsCache()`, so the instance that served a toggle shows it at once; other instances catch up within the TTL. The uncached getters above stay as
 * they are for the routes that gate an action on the setting.
 */
const APP_SETTINGS_TTL_MS = 30_000;
let appSettingsCache: { data: Record<string, unknown>; at: number } | null = null;
let readMeterOn = false;

export async function readAppSettings(db: Firestore, nowMs: number = Date.now()): Promise<Record<string, unknown>> {
  if (appSettingsCache && nowMs - appSettingsCache.at < APP_SETTINGS_TTL_MS) return appSettingsCache.data;
  const data = ((await db.doc(APP_SETTINGS_PATH).get()).data() ?? {}) as Record<string, unknown>;
  appSettingsCache = { data, at: nowMs };
  readMeterOn = data.readMeterEnabled === true;
  return data;
}

/** Forget the shared snapshot (a settings write just happened, or a test). */
export function invalidateAppSettingsCache(): void {
  appSettingsCache = null;
}

/** The public flags the browser learns from /api/public/config, all from the one shared snapshot. Same defaults as the individual getters. */
export async function getPublicSettings(db: Firestore, nowMs: number = Date.now()) {
  const data = await readAppSettings(db, nowMs);
  return {
    teamCreationEnabled: data.teamCreationEnabled === true,
    adminsSeeAllProfiles: data.adminsSeeAllProfiles !== false,
    avatarUploadsEnabled: data.avatarUploadsEnabled === true,
    membershipsEnabled: data.membershipsEnabled === true,
    accountDeletionEnabled: data.accountDeletionEnabled === true,
    readMeterEnabled: data.readMeterEnabled === true,
  };
}

/** appSettings/global.readMeterEnabled (missing = OFF): the read meter. Asked only by the meter's own routes; the answer rides on the shared snapshot above. */
export async function getReadMeterEnabled(db: Firestore, nowMs: number = Date.now()): Promise<boolean> {
  return (await readAppSettings(db, nowMs)).readMeterEnabled === true;
}

/** The last answer this instance saw, with NO read: false until some route has loaded the shared snapshot. Lets the server instrumentation cost a boolean while OFF. */
export function isReadMeterOnSync(): boolean {
  return readMeterOn;
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
  const value = (await readAppSettings(db, nowMs)).membershipsEnabled === true;
  membershipsEnabledCache = { value, at: nowMs };
  return value;
}

/** Test hook: forget the cached kill-switch answer. */
export function resetMembershipsEnabledCache(): void {
  membershipsEnabledCache = null;
  appSettingsCache = null;
}

/**
 * appSettings/global.accountDeletionEnabled and accountDeletionRunBudget (additive, memberships build 4). The kill switch for account deletion: missing = OFF; only an
 * explicit `true` turns it on, so while it is OFF the routes answer 404 `deletion_disabled` and the dialog and the Admin Panel tab are hidden. `accountDeletionRunBudget`
 * is the most documents one run may write (a positive integer; missing or invalid = 3,000; never more than 10,000), so the owner can lower it on a busy day.
 * Read ONCE per ~30 s per server instance (the production project is on the free read quota); a failed read throws and is not cached.
 */
export type AccountDeletionSettings = { enabled: boolean; runWrites: number };
const ACCOUNT_DELETION_TTL_MS = 30_000;
let accountDeletionCache: { value: AccountDeletionSettings; at: number } | null = null;

export function parseRunBudget(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw) || raw <= 0) return DEFAULT_RUN_WRITES;
  return Math.min(raw, MAX_RUN_WRITES);
}

export async function getAccountDeletionSettings(db: Firestore, nowMs: number = Date.now()): Promise<AccountDeletionSettings> {
  if (accountDeletionCache && nowMs - accountDeletionCache.at < ACCOUNT_DELETION_TTL_MS) return accountDeletionCache.value;
  const data = await readAppSettings(db, nowMs);
  const value = { enabled: data.accountDeletionEnabled === true, runWrites: parseRunBudget(data.accountDeletionRunBudget) };
  accountDeletionCache = { value, at: nowMs };
  return value;
}

export async function getAccountDeletionEnabled(db: Firestore, nowMs: number = Date.now()): Promise<boolean> {
  return (await getAccountDeletionSettings(db, nowMs)).enabled;
}

/** Test hook: forget the cached answer. */
export function resetAccountDeletionSettingsCache(): void {
  accountDeletionCache = null;
  appSettingsCache = null;
}
