import "server-only";
import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { PROGRAMS } from "@/config/programs";
import { avatarBlobPathFor, AVATAR_SOURCE_UPLOAD, CLEARED_AVATAR_FIELDS, isAvatarPathOf, splitBlobUrl } from "@/lib/avatar/model";
import { AVATAR_MAX_BYTES, processAvatar, type AvatarImageError } from "@/lib/server/avatar-image";
import { deleteAvatarBlobs, type AvatarBlobStore } from "@/lib/server/avatar-blobs";
import { callerMembership, programOf, type AchievementCaller, type RouteResult } from "@/lib/server/achievement-config";
import { teamAuditDoc } from "@/lib/server/audit";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { getAvatarUploadsEnabled } from "@/lib/server/team-settings";

/**
 * Session 8: profile picture uploads. Server only, through the Admin SDK; no Firestore rule is added or relied on.
 *
 *  - upload: verified caller, switch on, rate limited, body capped, type decided by the bytes, RE-ENCODED (a centered 512 px WebP with no metadata), stored under
 *    `avatars/<uid>/<random>.webp`, then `avatarUrl` / `avatarBlobPath` / `avatarSource: "upload"` are set on EVERY account document of this person that exists
 *    (the root `users/{uid}` and the other program's `users/{uid}`), then the previous blobs are deleted. Clients never write these fields (they can, under the
 *    current rules; resolveAvatar's trust check is what protects the display).
 *  - remove (self) and removeMemberAvatar (team admin of the member's team, or the platform owner): delete every blob under the person's folder and clear the fields.
 *    Both are idempotent; the admin removal writes a team audit entry under the program's own path and notifies nobody.
 * The `profiles` documents are NOT mirrored: a member's own profile save replaces that whole document (and its rules allow only six keys), so a mirror there would be
 * erased by the next bio edit. The Avatar is fed from the account documents.
 */

const HOUR_MS = 60 * 60 * 1000;
export const UPLOADS_PER_HOUR = 10;
const REMOVES_PER_HOUR = 30;
const MEMBER_REMOVES_PER_HOUR = 60;

const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): RouteResult => ({ status, body: { ok: false, code, error, ...extra } });

const IMAGE_ERRORS: Record<AvatarImageError, { status: number; code: string; error: string }> = {
  "bad-type": { status: 415, code: "wrong-type", error: "Use a JPEG, PNG or WebP picture." },
  animated: { status: 415, code: "wrong-type", error: "Animated pictures aren't supported. Use a still JPEG, PNG or WebP picture." },
  "too-many-pixels": { status: 413, code: "too-big", error: "That picture is too large. Try a smaller one." },
  "bad-image": { status: 422, code: "bad-image", error: "That picture couldn't be read. Try a different file." },
};

/** Every namespace an account document of this person can live in (the root program and the other one). */
const accountDocPaths = (uid: string) => [...new Set(Object.values(PROGRAMS).map((p) => `${p.firestorePrefix}users/${uid}`))];

async function existingAccountDocs(db: Firestore, uid: string) {
  const out: { path: string; data: Record<string, unknown> }[] = [];
  for (const path of accountDocPaths(uid)) {
    const snap = await db.doc(path).get();
    if (snap.exists) out.push({ path, data: (snap.data() ?? {}) as Record<string, unknown> });
  }
  return out;
}

export type UploadDeps = { db: Firestore; store: AvatarBlobStore; storeHost: string | null; random?: () => string };

export async function uploadAvatar(deps: UploadDeps, caller: { uid: string }, body: Uint8Array): Promise<RouteResult> {
  const { db, store } = deps;
  if (!(await getAvatarUploadsEnabled(db))) return fail(403, "uploads-off", "Picture uploads are turned off for now.");
  if (body.byteLength === 0) return fail(400, "empty", "No picture was sent.");
  if (body.byteLength > AVATAR_MAX_BYTES) return fail(413, "too-big", "That picture is too large. Try a smaller one.");
  const limit = await consumeRateLimit(db, `avatar-upload_${caller.uid}`, UPLOADS_PER_HOUR, HOUR_MS);
  if (!limit.allowed) return fail(429, "rate-limited", "Too many pictures uploaded. Try again in a while.");

  const docs = await existingAccountDocs(db, caller.uid);
  if (docs.length === 0) return fail(403, "no-account", "Your account isn't set up yet.");

  const image = await processAvatar(body);
  if (!image.ok) {
    const e = IMAGE_ERRORS[image.code];
    return fail(e.status, e.code, e.error);
  }

  const path = avatarBlobPathFor(caller.uid, (deps.random ?? (() => randomBytes(16).toString("hex")))());
  let url: string;
  try {
    ({ url } = await store.put(path, image.data, image.contentType));
  } catch (err) {
    console.error("avatar store failed:", err instanceof Error ? err.message : err);
    return fail(502, "store-failed", "The picture couldn't be saved. Try again.");
  }
  // Fail closed if the store answered with a URL the display would refuse: nothing is left behind.
  const parts = splitBlobUrl(url);
  if (!parts || parts.path !== path || (deps.storeHost && parts.host !== deps.storeHost)) {
    await store.remove([url]).catch(() => {});
    console.error("avatar store returned an unexpected URL host");
    return fail(502, "store-failed", "The picture couldn't be saved. Try again.");
  }

  const fields = { avatarUrl: url, avatarBlobPath: path, avatarSource: AVATAR_SOURCE_UPLOAD };
  for (const d of docs) await db.doc(d.path).update(fields);

  // The previous photo(s): whatever the documents pointed at, and anything else under the folder except the new file.
  const previous = new Set<string>();
  for (const d of docs) if (typeof d.data.avatarUrl === "string" && d.data.avatarUrl !== url && isAvatarPathOf(d.data.avatarBlobPath, caller.uid)) previous.add(d.data.avatarUrl);
  try {
    for (const u of await store.listUrls(`avatars/${caller.uid}/`)) if (u !== url) previous.add(u);
    await store.remove([...previous]);
  } catch (err) {
    // The new picture is already saved; a stray old file is cleaned up by the next upload or removal.
    console.error("old avatar cleanup failed:", err instanceof Error ? err.message : err);
  }
  return { status: 200, body: { ok: true, url, path } };
}

async function clearFields(db: Firestore, docs: { path: string }[]) {
  for (const d of docs) await db.doc(d.path).update({ ...CLEARED_AVATAR_FIELDS });
}

/** Removes the caller's own uploaded photo: every blob under their folder, and the fields on every account document. Idempotent. */
export async function removeOwnAvatar(deps: { db: Firestore; store: AvatarBlobStore }, caller: { uid: string }): Promise<RouteResult> {
  const { db, store } = deps;
  const limit = await consumeRateLimit(db, `avatar-remove_${caller.uid}`, REMOVES_PER_HOUR, HOUR_MS);
  if (!limit.allowed) return fail(429, "rate-limited", "Too many requests. Try again in a while.");
  const docs = await existingAccountDocs(db, caller.uid);
  let removed: number;
  try {
    removed = await deleteAvatarBlobs(caller.uid, store); // blobs first: a failure here changes nothing
  } catch (err) {
    console.error("avatar removal failed:", err instanceof Error ? err.message : err);
    return fail(502, "store-failed", "Your photo couldn't be removed. Try again.");
  }
  const had = docs.some((d) => d.data.avatarSource === AVATAR_SOURCE_UPLOAD || typeof d.data.avatarUrl === "string");
  if (had) await clearFields(db, docs);
  return { status: 200, body: { ok: true, removed: removed > 0 || had } };
}

/**
 * An admin removes a member's photo. Allowed: the platform owner, or an admin of the SAME team as the member (both read from their own account documents in the
 * program the request names; no team id is taken from the request). Idempotent. Writes the team audit entry under the program's path; notifies nobody.
 */
export async function removeMemberAvatar(
  deps: { db: Firestore; store: AvatarBlobStore },
  caller: AchievementCaller,
  input: { program?: unknown; uid?: unknown }
): Promise<RouteResult> {
  const { db, store } = deps;
  const p = programOf(input.program);
  if (!p.ok) return p.result;
  if (typeof input.uid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.uid)) return fail(400, "invalid_member", "That is not a valid member.");
  const target = input.uid;

  const me = await callerMembership(db, p.program, caller.uid);
  const member = await callerMembership(db, p.program, target);
  const sameTeamAdmin = me.isAdmin && me.teamId !== "" && me.teamId === member.teamId;
  if (!caller.isPlatformOwner && !sameTeamAdmin) return fail(403, "forbidden", "Only an admin of this member's team can remove their photo.");
  const limit = await consumeRateLimit(db, `avatar-member-remove_${caller.uid}`, MEMBER_REMOVES_PER_HOUR, HOUR_MS);
  if (!limit.allowed) return fail(429, "rate-limited", "Too many requests. Try again in a while.");

  const docs = await existingAccountDocs(db, target);
  const had = docs.some((d) => d.data.avatarSource === AVATAR_SOURCE_UPLOAD || typeof d.data.avatarUrl === "string");
  let removed: number;
  try {
    removed = await deleteAvatarBlobs(target, store);
  } catch (err) {
    console.error("member avatar removal failed:", err instanceof Error ? err.message : err);
    return fail(502, "store-failed", "The photo couldn't be removed. Try again.");
  }
  if (had) await clearFields(db, docs);
  if (had || removed > 0) {
    const prefix = PROGRAMS[p.program].firestorePrefix;
    await db
      .collection(`${prefix}auditLog`)
      .doc()
      .set(teamAuditDoc(member.teamId || me.teamId, caller.uid, caller.name ?? me.name ?? "Admin", "remove-member-photo", { targetUid: target }, { hadPhoto: true }, { hadPhoto: false }));
  }
  return { status: 200, body: { ok: true, removed: had || removed > 0 } };
}
