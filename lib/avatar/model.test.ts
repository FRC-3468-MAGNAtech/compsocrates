import { describe, expect, it } from "vitest";
import { AVATAR_PRESETS } from "@/lib/profile/config";
import { avatarBlobPathFor, canViewerSeePhoto, isAvatarPathOf, isTrustedAvatarUrl, plainAvatar, resolveAvatar, splitBlobUrl, uploadFromDoc, withUpload, type AvatarInput } from "./model";

const HOST = "abc123store.public.blob.vercel-storage.com";
const RANDOM = "0123456789abcdef0123456789abcdef";
const good = (uid = "u1") => `https://${HOST}/avatars/${uid}/${RANDOM}.webp`;
const upload = (o: Partial<NonNullable<AvatarInput["upload"]>> = {}): AvatarInput => ({ type: "initials", value: "", upload: { uid: "u1", url: good(), path: `avatars/u1/${RANDOM}.webp`, source: "upload", ...o } });
const GOOGLE = "https://lh3.googleusercontent.com/a/photo=s96-c";

describe("paths", () => {
  it("builds uid-keyed paths with a 128-bit random part, and refuses bad input", () => {
    expect(avatarBlobPathFor("u1", RANDOM)).toBe(`avatars/u1/${RANDOM}.webp`);
    expect(() => avatarBlobPathFor("../x", RANDOM)).toThrow();
    expect(() => avatarBlobPathFor("u1", "short")).toThrow();
  });
  it("isAvatarPathOf: only this person's folder, only a safe file name", () => {
    expect(isAvatarPathOf(`avatars/u1/${RANDOM}.webp`, "u1")).toBe(true);
    expect(isAvatarPathOf(`avatars/u2/${RANDOM}.webp`, "u1")).toBe(false);
    expect(isAvatarPathOf(`avatars/u1/../u2/${RANDOM}.webp`, "u1")).toBe(false);
    expect(isAvatarPathOf(`avatars/u1/${RANDOM}.svg`, "u1")).toBe(false);
    expect(isAvatarPathOf(`avatars/u1/a/${RANDOM}.webp`, "u1")).toBe(false);
    expect(isAvatarPathOf(null, "u1")).toBe(false);
  });
  it("splitBlobUrl takes plain https URLs only", () => {
    expect(splitBlobUrl(good())).toEqual({ host: HOST, path: `avatars/u1/${RANDOM}.webp` });
    for (const bad of ["http://x.test/a", "https://user:pw@x.test/a", "https://x.test:8443/a", "https://x.test/a?x=1", "https://x.test/a#h", "javascript:alert(1)", "data:image/png;base64,AAAA", "not a url", 5, null]) expect(splitBlobUrl(bad)).toBeNull();
  });
});

describe("isTrustedAvatarUrl: forged URLs are refused", () => {
  it("accepts our host with the person's own folder", () => expect(isTrustedAvatarUrl(good(), "u1", HOST)).toBe(true));
  it("refuses another host (also another Blob store)", () => {
    expect(isTrustedAvatarUrl(`https://evil.example.com/avatars/u1/${RANDOM}.webp`, "u1", HOST)).toBe(false);
    expect(isTrustedAvatarUrl(`https://zzz999other.public.blob.vercel-storage.com/avatars/u1/${RANDOM}.webp`, "u1", HOST)).toBe(false);
    expect(isTrustedAvatarUrl(`https://${HOST}.evil.example.com/avatars/u1/${RANDOM}.webp`, "u1", HOST)).toBe(false);
  });
  it("refuses another user's avatar path, a team form-photo path and anything outside avatars/", () => {
    expect(isTrustedAvatarUrl(good("u2"), "u1", HOST)).toBe(false);
    expect(isTrustedAvatarUrl(`https://${HOST}/forms/ALPHA/pit/${RANDOM}.webp`, "u1", HOST)).toBe(false);
    expect(isTrustedAvatarUrl(`https://${HOST}/${RANDOM}.webp`, "u1", HOST)).toBe(false);
    expect(isTrustedAvatarUrl(`https://${HOST}/avatars/u1/../u2/${RANDOM}.webp`, "u1", HOST)).toBe(false);
    expect(isTrustedAvatarUrl(`https://${HOST}/avatars/u1%2F..%2Fu2/${RANDOM}.webp`, "u1", HOST)).toBe(false);
  });
  it("refuses everything while the store host is unknown", () => {
    expect(isTrustedAvatarUrl(good(), "u1", null)).toBe(false);
    expect(isTrustedAvatarUrl(good(), "u1", undefined)).toBe(false);
  });
});

describe("resolveAvatar precedence", () => {
  it("an uploaded photo (source upload, trusted URL) wins over a Google picture and a preset", () => {
    expect(resolveAvatar({ avatar: upload(), storeHost: HOST })).toEqual({ kind: "upload", url: good() });
    expect(resolveAvatar({ avatar: { ...upload(), type: "google", value: GOOGLE }, storeHost: HOST })).toEqual({ kind: "upload", url: good() });
    expect(resolveAvatar({ avatar: { ...upload(), type: "preset", value: AVATAR_PRESETS[0].id }, storeHost: HOST })).toEqual({ kind: "upload", url: good() });
  });
  it("falls back to the existing avatar choice: Google, then preset, then initials", () => {
    expect(resolveAvatar({ avatar: { type: "google", value: GOOGLE }, storeHost: HOST })).toEqual({ kind: "google", url: GOOGLE });
    expect(resolveAvatar({ avatar: { type: "preset", value: AVATAR_PRESETS[1].id }, storeHost: HOST })).toEqual({ kind: "preset", presetId: AVATAR_PRESETS[1].id });
    expect(resolveAvatar({ avatar: { type: "preset", value: "no-such-preset" }, storeHost: HOST })).toEqual({ kind: "initials" });
    expect(resolveAvatar({ avatar: { type: "google", value: "https://evil.example.com/x.png" }, storeHost: HOST })).toEqual({ kind: "initials" });
    expect(resolveAvatar({ avatar: { type: "initials", value: "" }, storeHost: HOST })).toEqual({ kind: "initials" });
    expect(resolveAvatar({ avatar: null, storeHost: HOST })).toEqual({ kind: "initials" });
    expect(resolveAvatar({ storeHost: HOST })).toEqual({ kind: "initials" });
  });
  it("a missing or wrong source ignores avatarUrl", () => {
    expect(resolveAvatar({ avatar: upload({ source: null }), storeHost: HOST })).toEqual({ kind: "initials" });
    expect(resolveAvatar({ avatar: upload({ source: "google" }), storeHost: HOST })).toEqual({ kind: "initials" });
    expect(resolveAvatar({ avatar: { ...upload({ source: null }), type: "google", value: GOOGLE }, storeHost: HOST })).toEqual({ kind: "google", url: GOOGLE });
  });
  it("a forged URL (other host, another user's path, a form-photo path) is ignored and the old choice shows", () => {
    const preset = { type: "preset" as const, value: AVATAR_PRESETS[0].id };
    for (const url of [`https://evil.example.com/avatars/u1/${RANDOM}.webp`, good("u2"), `https://${HOST}/forms/ALPHA/pit/${RANDOM}.webp`]) {
      expect(resolveAvatar({ avatar: { ...preset, upload: { uid: "u1", url, path: null, source: "upload" } }, storeHost: HOST })).toEqual({ kind: "preset", presetId: preset.value });
    }
  });
  it("is the initials while the store host is not known yet", () => {
    expect(resolveAvatar({ avatar: upload(), storeHost: null })).toEqual({ kind: "initials" });
  });
  it("a viewer who may not see the profile gets initials (not the Google picture or preset either: only the upload is hidden)", () => {
    expect(resolveAvatar({ avatar: upload(), storeHost: HOST, viewerCanSeePhoto: false })).toEqual({ kind: "initials" });
    expect(resolveAvatar({ avatar: { type: "preset", value: AVATAR_PRESETS[0].id, upload: upload().upload }, storeHost: HOST, viewerCanSeePhoto: false })).toEqual({ kind: "initials" });
    expect(resolveAvatar({ avatar: { type: "preset", value: AVATAR_PRESETS[0].id }, storeHost: HOST, viewerCanSeePhoto: false })).toEqual({ kind: "preset", presetId: AVATAR_PRESETS[0].id });
  });
});

describe("viewer visibility (the Session G function)", () => {
  const base = { viewerUid: "v", viewerIsAdmin: false, viewerIsPlatformOwner: false, adminsSeeAll: true, targetUid: "t" };
  it("a public profile: everyone sees the photo", () => expect(canViewerSeePhoto({ ...base, visibility: "public" })).toBe(true));
  it("a private profile: a teammate gets initials; the person, a same-team admin (switch on) and the owner see it", () => {
    expect(canViewerSeePhoto({ ...base, visibility: "private" })).toBe(false);
    expect(canViewerSeePhoto({ ...base, visibility: "private", viewerUid: "t" })).toBe(true);
    expect(canViewerSeePhoto({ ...base, visibility: "private", viewerIsAdmin: true })).toBe(true);
    expect(canViewerSeePhoto({ ...base, visibility: "private", viewerIsAdmin: true, adminsSeeAll: false })).toBe(false);
    expect(canViewerSeePhoto({ ...base, visibility: "private", viewerIsPlatformOwner: true })).toBe(true);
  });
  it("unknown visibility follows the default (public), the limit of what a team list can enforce", () => expect(canViewerSeePhoto({ ...base, visibility: undefined })).toBe(true));
});

describe("reading and writing the fields", () => {
  it("uploadFromDoc needs source upload and a URL; withUpload attaches it to the stored choice (or initials)", () => {
    expect(uploadFromDoc("u1", { avatarSource: "upload", avatarUrl: good(), avatarBlobPath: "p" })).toMatchObject({ uid: "u1", url: good(), path: "p", source: "upload" });
    expect(uploadFromDoc("u1", { avatarUrl: good() })).toBeNull();
    expect(uploadFromDoc("u1", { avatarSource: "upload", avatarUrl: "" })).toBeNull();
    expect(uploadFromDoc("u1", { avatarSource: "upload", avatarUrl: null })).toBeNull();
    expect(uploadFromDoc("u1", undefined)).toBeNull();
    const a = withUpload({ type: "preset", value: "bot" }, "u1", { avatarSource: "upload", avatarUrl: good() }) as AvatarInput;
    expect(a.type).toBe("preset");
    expect(a.upload?.url).toBe(good());
    expect((withUpload(undefined, "u1", { avatarSource: "upload", avatarUrl: good() }) as AvatarInput).type).toBe("initials");
    expect(withUpload({ type: "preset", value: "bot" }, "u1", {})).toEqual({ type: "preset", value: "bot" });
  });
  it("plainAvatar writes only type and value, never the upload fields (the rules accept no other key)", () => {
    expect(plainAvatar(upload())).toEqual({ type: "initials", value: "" });
    expect(Object.keys(plainAvatar({ ...upload(), type: "google", value: GOOGLE }))).toEqual(["type", "value"]);
  });
});
