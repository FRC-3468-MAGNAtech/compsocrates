import { describe, expect, it } from "vitest";
import type { AvatarInput } from "@/lib/avatar/model";
import { ftcProfilePatch, ftcUserToMember, ftcUserToProfile } from "@/data/ftc/users";

const doc = { name: "Una", email: "una@example.test", teamId: "ZED", avatar: { type: "google", value: "https://lh3.googleusercontent.com/a/x" }, avatarSource: "upload", avatarUrl: "https://s.public.blob.vercel-storage.com/avatars/u1/0123456789abcdef0123456789abcdef.webp", avatarBlobPath: "avatars/u1/0123456789abcdef0123456789abcdef.webp" };

describe("the other program's account documents carry the uploaded picture to the Avatar", () => {
  it("the profile and the roster row get the stored choice plus the upload fields", () => {
    for (const a of [ftcUserToProfile("u1", doc).avatar, ftcUserToMember("u1", doc).avatar] as (AvatarInput | undefined)[]) {
      expect(a?.type).toBe("google");
      expect(a?.upload).toMatchObject({ uid: "u1", url: doc.avatarUrl, source: "upload" });
    }
  });
  it("without the source there is no upload", () => {
    expect((ftcUserToMember("u1", { ...doc, avatarSource: null }).avatar as AvatarInput).upload).toBeUndefined();
    expect(ftcUserToMember("u1", { name: "x", email: "x@example.test" }).avatar).toBeUndefined();
  });
  it("writing a choice never writes the upload fields back (the rules accept only type and value)", () => {
    const attached = ftcUserToProfile("u1", doc).avatar!;
    const out = ftcProfilePatch({ avatar: attached });
    expect(out.avatar).toEqual({ type: "google", value: "https://lh3.googleusercontent.com/a/x" });
    expect(Object.keys(out.avatar as object)).toEqual(["type", "value"]);
  });
});
