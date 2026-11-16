import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const HOST = "teststore1.public.blob.vercel-storage.com";
vi.mock("@/lib/avatar/settings", () => ({ useAvatarSettings: () => ({ loaded: true, blobHost: HOST, uploadsEnabled: true }) }));
vi.mock("@/lib/profile/admins-see-all", () => ({ useAdminsSeeAllProfiles: () => true }));

import { AuthContext, type AuthContextValue } from "@/lib/auth";
import type { AvatarInput } from "@/lib/avatar/model";
import { Avatar } from "./avatar";

const RANDOM = "0123456789abcdef0123456789abcdef";
const url = (uid = "u1") => `https://${HOST}/avatars/${uid}/${RANDOM}.webp`;
const withPhoto = (o: Partial<NonNullable<AvatarInput["upload"]>> = {}): AvatarInput => ({ type: "initials", value: "", upload: { uid: "u1", url: url(), path: null, source: "upload", ...o } });
const asViewer = (viewer: { uid: string; isAdmin?: boolean; isPlatformOwner?: boolean } | null, el: React.ReactElement) =>
  renderToString(
    <AuthContext.Provider value={{ user: viewer ? { uid: viewer.uid } : null, profile: viewer ? { isAdmin: !!viewer.isAdmin, isPlatformOwner: !!viewer.isPlatformOwner } : null } as unknown as AuthContextValue}>{el}</AuthContext.Provider>
  );

describe("the shared Avatar", () => {
  it("draws the uploaded photo lazily with its size set and the person's name as alt text", () => {
    const html = asViewer({ uid: "u1" }, <Avatar name="Una Lee" size="sm" avatar={withPhoto()} />);
    expect(html).toContain('data-avatar="upload"');
    expect(html).toContain(`src="${url()}"`);
    expect(html).toContain('alt="Una Lee"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('width="32"');
    expect(html).toContain('height="32"');
  });
  it("shows initials when there is no avatar, and the preset or Google look is unchanged", () => {
    expect(asViewer(null, <Avatar name="Una Lee" />)).toContain('data-avatar="initials"');
    expect(asViewer(null, <Avatar name="Una Lee" avatar={{ type: "preset", value: "bot" }} />)).toContain('data-avatar="preset:bot"');
  });
  it("a forged avatarUrl (other host, another user's folder, a form-photo path, no source) never renders as an image", () => {
    for (const bad of [
      withPhoto({ url: `https://evil.example.com/avatars/u1/${RANDOM}.webp` }),
      withPhoto({ url: url("u2") }),
      withPhoto({ url: `https://${HOST}/forms/ALPHA/pit/${RANDOM}.webp` }),
      withPhoto({ source: null }),
    ]) {
      const html = asViewer({ uid: "u1" }, <Avatar name="Una Lee" avatar={bad} />);
      expect(html).toContain('data-avatar="initials"');
      expect(html).not.toContain("<img");
    }
  });
  it("hidePhoto (the private-profile card) shows initials", () => {
    expect(asViewer({ uid: "v" }, <Avatar name="Una Lee" avatar={withPhoto()} hidePhoto />)).toContain('data-avatar="initials"');
  });
  it("a private profile's photo shows as initials to a teammate and as the photo to the person, a same-team admin and the owner", () => {
    const priv = withPhoto({ visibility: "private" });
    expect(asViewer({ uid: "teammate" }, <Avatar name="Una" avatar={priv} />)).toContain('data-avatar="initials"');
    expect(asViewer({ uid: "u1" }, <Avatar name="Una" avatar={priv} />)).toContain('data-avatar="upload"');
    expect(asViewer({ uid: "boss", isAdmin: true }, <Avatar name="Una" avatar={priv} />)).toContain('data-avatar="upload"');
    expect(asViewer({ uid: "owner", isPlatformOwner: true }, <Avatar name="Una" avatar={priv} />)).toContain('data-avatar="upload"');
  });
  it("a public (or unknown-visibility) profile's photo shows to a teammate", () => {
    expect(asViewer({ uid: "teammate" }, <Avatar name="Una" avatar={withPhoto({ visibility: "public" })} />)).toContain('data-avatar="upload"');
    expect(asViewer({ uid: "teammate" }, <Avatar name="Una" avatar={withPhoto()} />)).toContain('data-avatar="upload"');
  });
  it("outside a signed-in shell (no viewer) a private profile's photo is not shown", () => {
    expect(asViewer(null, <Avatar name="Una" avatar={withPhoto({ visibility: "private" })} />)).toContain('data-avatar="initials"');
  });
});
