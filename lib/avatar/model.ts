import { presetById, type AvatarChoice, type ProfileVisibility } from "@/lib/profile/config";
import { isGoogleAvatarUrl, profileAccess } from "@/lib/profile/model";

// Session 8: uploaded profile pictures. Pure, shared by the browser (display) and the server routes (validation).
//
// Stored (additive, written ONLY by the avatar routes through the Admin SDK): `avatarUrl`, `avatarBlobPath`, `avatarSource` ("upload") on each account document
// the shared Avatar is fed from. The existing `avatar` field ({type, value}) is never changed by an upload.
//
// WHY resolveAvatar VALIDATES: the rules let a person write any extra field on their own account document (root: any field; the other program: any field but the
// locked ones), so a client CAN write `avatarUrl` itself. Nothing here trusts it: a photo is used only when `avatarSource` is "upload", the URL is on OUR Blob store's host
// and its path is `avatars/<this person's uid>/...`. Anything else falls back to the existing avatar logic.

export const AVATAR_PATH_PREFIX = "avatars/";
export const AVATAR_SOURCE_UPLOAD = "upload";
export const AVATAR_URL_MAX = 500;
const SAFE_UID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_FILE = /^[A-Za-z0-9_-]{16,128}\.(webp|jpg)$/;

/** The stored fields as the readers see them, attached to the avatar the shared Avatar component takes (never written back: see plainAvatar). */
export type UploadedAvatar = {
  /** Whose photo this is (the trust check ties the path to this uid). */
  uid: string;
  url: string;
  path: string | null;
  source: string | null;
  /** The person's profile visibility, when the caller has it (the profile pages do); absent in team lists. */
  visibility?: ProfileVisibility;
};

/** What the avatar prop carries: the stored choice, plus the upload fields when the account has them. Only `type` and `value` are ever written. */
export type AvatarInput = AvatarChoice & { upload?: UploadedAvatar };

/** `avatars/<uid>/<random>.webp` — the random part is chosen by the server (128 bits), never by the client. */
export function avatarBlobPathFor(uid: string, randomHex: string): string {
  if (!SAFE_UID.test(uid)) throw new Error("bad uid");
  if (!/^[0-9a-f]{32,64}$/.test(randomHex)) throw new Error("bad random part");
  return `${AVATAR_PATH_PREFIX}${uid}/${randomHex}.webp`;
}

/** Is this stored path one of THIS person's avatar paths? */
export function isAvatarPathOf(path: unknown, uid: string): boolean {
  if (typeof path !== "string" || !SAFE_UID.test(uid)) return false;
  const prefix = `${AVATAR_PATH_PREFIX}${uid}/`;
  return path.startsWith(prefix) && SAFE_FILE.test(path.slice(prefix.length));
}

/** `https://<host>/<path>` split into its host and decoded path (no leading slash); null for anything that is not a plain https URL. */
export function splitBlobUrl(url: unknown): { host: string; path: string } | null {
  if (typeof url !== "string" || url.length > AVATAR_URL_MAX) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) return null;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
  return { host: parsed.hostname.toLowerCase(), path };
}

/** The ONE trust check for a stored `avatarUrl`: our store's host, and a path inside this person's own avatar folder. */
export function isTrustedAvatarUrl(url: unknown, uid: string, storeHost: string | null | undefined): boolean {
  if (!storeHost) return false;
  const parts = splitBlobUrl(url);
  return !!parts && parts.host === storeHost.toLowerCase() && isAvatarPathOf(parts.path, uid);
}

export type ResolvedAvatar = { kind: "upload"; url: string } | { kind: "google"; url: string } | { kind: "preset"; presetId: string } | { kind: "initials" };

/**
 * Which picture to draw: the uploaded photo (only when it passes the trust check and the viewer may see this person's photo), else the Google picture or
 * preset the person chose, else their initials. `viewerCanSeePhoto: false` (a private profile, for a viewer with limited access) hides ONLY the uploaded photo
 * and falls back to initials.
 */
export function resolveAvatar(input: { avatar?: AvatarInput | null; storeHost?: string | null; viewerCanSeePhoto?: boolean }): ResolvedAvatar {
  const a = input.avatar;
  const up = a?.upload;
  if (up && up.source === AVATAR_SOURCE_UPLOAD) {
    if (input.viewerCanSeePhoto === false) return { kind: "initials" };
    if (isTrustedAvatarUrl(up.url, up.uid, input.storeHost)) return { kind: "upload", url: up.url };
  }
  if (a?.type === "google" && isGoogleAvatarUrl(a.value)) return { kind: "google", url: a.value };
  if (a?.type === "preset" && presetById(a.value)) return { kind: "preset", presetId: a.value };
  return { kind: "initials" };
}

/**
 * May this viewer see this person's uploaded photo? The Session G function decides: a "limited" profile access means initials. `sameTeam` is true for the
 * team lists (a roster is the team's); the platform owner and the person themselves always see it. Where the photo's owner visibility is unknown (a team list
 * has no profile document), the answer is "yes": that is the limit of what the app can enforce there (see docs/SESSION8_RESULTS.md).
 */
export function canViewerSeePhoto(input: {
  viewerUid: string | null;
  viewerIsAdmin: boolean;
  viewerIsPlatformOwner: boolean;
  adminsSeeAll: boolean | null | undefined;
  targetUid: string;
  visibility: ProfileVisibility | null | undefined;
}): boolean {
  if (!input.viewerUid) return input.visibility !== "private";
  return (
    profileAccess({
      viewerUid: input.viewerUid,
      viewerIsAdmin: input.viewerIsAdmin,
      viewerIsPlatformOwner: input.viewerIsPlatformOwner,
      sameTeam: true,
      targetUid: input.targetUid,
      visibility: input.visibility,
      adminsSeeAll: input.adminsSeeAll,
    }) === "full"
  );
}

/** The account's upload fields from a raw stored document (any program), or null. Only the shape is checked here; the trust check runs at display time. */
export function uploadFromDoc(uid: string, doc: Record<string, unknown> | null | undefined): UploadedAvatar | null {
  if (!doc || doc.avatarSource !== AVATAR_SOURCE_UPLOAD || typeof doc.avatarUrl !== "string" || doc.avatarUrl === "" || doc.avatarUrl.length > AVATAR_URL_MAX) return null;
  return { uid, url: doc.avatarUrl, path: typeof doc.avatarBlobPath === "string" ? doc.avatarBlobPath : null, source: AVATAR_SOURCE_UPLOAD };
}

/** The avatar the readers hand to the components: the stored choice (initials when none) with the account's upload attached when it has one. */
export function withUpload(avatar: AvatarChoice | undefined, uid: string, doc: Record<string, unknown> | null | undefined): AvatarChoice | undefined {
  const upload = uploadFromDoc(uid, doc);
  if (!upload) return avatar;
  return { ...(avatar ?? { type: "initials", value: "" }), upload } as AvatarInput;
}

/** The choice to draw (the profile's own, else the roster's) with the roster's uploaded picture attached, and the visibility the caller knows. */
export function withUploadOf(choice: AvatarChoice | undefined, roster: AvatarChoice | undefined, visibility?: ProfileVisibility): AvatarInput | undefined {
  const upload = (roster as AvatarInput | undefined)?.upload;
  if (!upload) return choice;
  return { ...(choice ?? { type: "initials", value: "" }), upload: { ...upload, ...(visibility ? { visibility } : {}) } };
}

/** What may be written to a Firestore `avatar` field: the stored choice without the attached upload (the rules accept only `type` and `value`; the upload fields belong to the server). */
export function plainAvatar(avatar: AvatarChoice | AvatarInput): AvatarChoice {
  // Only the attached upload is removed; everything else is written exactly as it was before uploads existed.
  const { upload: _upload, ...rest } = avatar as AvatarInput;
  void _upload;
  return rest;
}

/** The fields the avatar routes clear when an upload is removed. */
export const CLEARED_AVATAR_FIELDS = { avatarUrl: null, avatarBlobPath: null, avatarSource: null } as const;
