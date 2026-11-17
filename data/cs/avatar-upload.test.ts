import { describe, expect, it } from "vitest";
import type { AvatarInput } from "@/lib/avatar/model";
import { csUserToMember, csUserToProfile, profilePatchToCsUser } from "@/data/cs/users";

const doc = { displayName: "Una", email: "una@example.test", teamId: "ALPHA", avatar: { type: "preset", value: "bot" }, avatarSource: "upload", avatarUrl: "https://s.public.blob.vercel-storage.com/avatars/u1/0123456789abcdef0123456789abcdef.webp", avatarBlobPath: "avatars/u1/0123456789abcdef0123456789abcdef.webp" };

describe("root-program account documents carry the uploaded picture to the Avatar", () => {
  it("the profile and the roster row get the stored choice plus the upload fields; the stored choice is unchanged", () => {
    for (const a of [csUserToProfile("u1", doc).avatar, csUserToMember("u1", doc).avatar] as (AvatarInput | undefined)[]) {
      expect(a?.type).toBe("preset");
      expect(a?.value).toBe("bot");
      expect(a?.upload).toMatchObject({ uid: "u1", url: doc.avatarUrl, source: "upload" });
    }
  });
  it("without the source (or with it cleared) there is no upload", () => {
    expect((csUserToMember("u1", { ...doc, avatarSource: null }).avatar as AvatarInput).upload).toBeUndefined();
    expect((csUserToMember("u1", { ...doc, avatarUrl: null, avatarSource: null, avatarBlobPath: null }).avatar as AvatarInput).upload).toBeUndefined();
    expect(csUserToMember("u1", { displayName: "x" }).avatar).toBeUndefined();
  });
  it("an upload with no stored choice still shows (the choice reads as initials)", () => {
    const a = csUserToMember("u1", { ...doc, avatar: undefined }).avatar as AvatarInput;
    expect(a.type).toBe("initials");
    expect(a.upload?.url).toBe(doc.avatarUrl);
  });
  it("writing a choice never writes the upload fields back", () => {
    const attached = csUserToProfile("u1", doc).avatar!;
    const out = profilePatchToCsUser({ avatar: attached }, doc as never);
    expect(out.avatar).toEqual({ type: "preset", value: "bot" });
    expect(JSON.stringify(out)).not.toContain("avatarUrl");
  });
});
