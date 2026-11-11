import { describe, expect, it } from "vitest";
import { parseUidList } from "@/config/cs";
import { csThemeIdFor, csUserToMember, csUserToProfile, isAdminFromCsUser, profilePatchToCsUser, resolveTheme, rolesFromCsUser } from "@/data/cs/users";
import type { CsUserDoc } from "@/data/cs/types";
import { normalizeLegacyRole } from "@/lib/roles";

const csUser = (over: CsUserDoc = {}): CsUserDoc => ({
  uid: "uid-ada",
  email: "ada@example.com",
  displayName: "Ada Lovelace",
  role: "match-scout",
  roles: ["match-scout"],
  secondaryRoles: [],
  teamId: "MAG2403",
  isTeamAdmin: false,
  photoURL: "https://example.com/a.png",
  bio: "hi",
  profileVisibility: "team",
  profileComplete: true,
  experiencedScout: true,
  accountThemeId: "dark-compsocrates",
  encryptedUserData: "ciphertext",
  ...over,
});

describe("normalizeLegacyRole", () => {
  it.each([
    ["coach", "team-coach"],
    ["scout", "match-scout"],
    ["lead_scout", "lead-scout"],
    ["lead_strategist", "lead-strategist"],
    ["pit_scout", "pit-scout"],
    ["judge_awards", "judge-awards"],
    ["judgeawards", "judge-awards"],
    ["drive-team", "drive-team"],
    ["  MEDIA ", "media"],
    ["nonsense", "match-scout"],
    [undefined, "match-scout"],
  ])("%s -> %s", (input, expected) => expect(normalizeLegacyRole(input)).toBe(expected));
});

describe("csUserToProfile", () => {
  it("maps a current CS user", () => {
    const p = csUserToProfile("uid-ada", csUser(), { ownerUids: [] });
    expect(p).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@example.com",
      teamId: "MAG2403",
      primaryRole: "match-scout",
      secondaryRoles: [],
      isAdmin: false,
      isOwner: false,
      isPlatformOwner: false,
      themeId: "compsocrates",
      colorMode: "dark",
      bio: "hi",
      photoURL: "https://example.com/a.png",
      profileVisibility: "team",
      profileComplete: true,
      experiencedScout: true,
    });
  });

  it("legacy roles normalize; secondaries exclude the primary, in canonical order, from roles + secondaryRoles", () => {
    const p = csUserToProfile("u", csUser({ role: "lead_scout", roles: ["lead_scout", "scout", "media"], secondaryRoles: ["pit_scout", "lead-scout"] }), { ownerUids: [] });
    expect(p.primaryRole).toBe("lead-scout");
    expect(p.secondaryRoles).toEqual(["match-scout", "pit-scout", "media"]);
  });

  it("no stored role: Drive Team if held, else the first listed role, else match scout", () => {
    expect(rolesFromCsUser({ roles: ["media", "drive-team"] }).primaryRole).toBe("drive-team");
    expect(rolesFromCsUser({ roles: ["media", "pit-team"] }).primaryRole).toBe("media");
    expect(rolesFromCsUser({}).primaryRole).toBe("match-scout");
  });

  it("D6: isTeamAdmin or the legacy coach role is an admin; the owner allowlist is admin + owner", () => {
    expect(isAdminFromCsUser({ isTeamAdmin: true })).toBe(true);
    expect(isAdminFromCsUser({ role: "coach" })).toBe(true);
    expect(isAdminFromCsUser({ role: "team-coach" })).toBe(false);
    expect(csUserToProfile("u", csUser({ role: "coach" }), { ownerUids: [] })).toMatchObject({ isAdmin: true, primaryRole: "team-coach" });
    const owner = csUserToProfile("owner-uid", csUser(), { ownerUids: ["owner-uid"] });
    expect(owner).toMatchObject({ isAdmin: true, isOwner: true, isPlatformOwner: true });
    expect(csUserToProfile("someone", csUser(), { ownerUids: ["owner-uid"] }).isOwner).toBe(false);
  });

  it("theme: a known id is kept, CS ids map, unknown ids fall back to the default", () => {
    expect(resolveTheme({ accountThemeId: "light-compsocrates" })).toEqual({ themeId: "compsocrates", colorMode: "light" });
    expect(resolveTheme({ accountThemeId: "pride-trans" }).themeId).toBe("pride-transgender");
    expect(resolveTheme({ accountThemeId: "pride-lesbian" }).themeId).toBe("pride-lesbian");
    expect(resolveTheme({ accountThemeId: "light-atlantic" }).themeId).toBe("compsocrates");
    expect(resolveTheme({}).themeId).toBe("compsocrates");
    expect(resolveTheme({ themeId: "ocean", colorMode: "light", accountThemeId: "dark-compsocrates" })).toEqual({ themeId: "ocean", colorMode: "light" });
    expect(resolveTheme({ themeId: "not-a-theme" }).themeId).toBe("compsocrates");
  });

  it("sparse old docs do not throw", () => {
    const p = csUserToProfile("u", { email: "x@y.z" }, { ownerUids: [] });
    expect(p).toMatchObject({ name: "x", teamId: "", primaryRole: "match-scout", isAdmin: false });
  });

  it("roster row keeps the raw role", () => {
    expect(csUserToMember("u", csUser({ role: "coach", createdAt: { toMillis: () => 123 } }), { ownerUids: [] })).toMatchObject({ uid: "u", legacyRole: "coach", primaryRole: "team-coach", isAdmin: true, joinedAtMs: 123 });
  });
});

describe("profilePatchToCsUser", () => {
  it("name -> displayName", () => expect(profilePatchToCsUser({ name: "New" })).toEqual({ displayName: "New" }));

  it("role changes write role + roles + secondaryRoles consistently", () => {
    expect(profilePatchToCsUser({ primaryRole: "lead-scout", secondaryRoles: ["media", "match-scout"] }, csUser())).toEqual({
      role: "lead-scout",
      roles: ["lead-scout", "match-scout", "media"],
      secondaryRoles: ["match-scout", "media"],
    });
    // only the primary changes: the stored secondaries are kept
    expect(profilePatchToCsUser({ primaryRole: "pit-scout" }, csUser({ role: "match-scout", roles: ["match-scout", "media"], secondaryRoles: ["media"] }))).toEqual({
      role: "pit-scout",
      roles: ["pit-scout", "media"],
      secondaryRoles: ["media"],
    });
  });

  it("the primary never appears among the secondaries", () => {
    expect(profilePatchToCsUser({ primaryRole: "media", secondaryRoles: ["media", "pit-team"] }, csUser()).secondaryRoles).toEqual(["pit-team"]);
  });

  it("isAdmin -> isTeamAdmin; demoting a legacy coach also rewrites role; re-roling a legacy coach keeps them admin", () => {
    expect(profilePatchToCsUser({ isAdmin: true })).toEqual({ isTeamAdmin: true });
    expect(profilePatchToCsUser({ isAdmin: false }, csUser({ role: "coach" }))).toMatchObject({ isTeamAdmin: false, role: "team-coach" });
    expect(profilePatchToCsUser({ primaryRole: "media" }, csUser({ role: "coach", roles: ["coach"] }))).toMatchObject({ role: "media", isTeamAdmin: true });
  });

  it("theme writes the app fields plus the CS id where CS has the theme", () => {
    expect(profilePatchToCsUser({ themeId: "compsocrates", colorMode: "dark" })).toEqual({ themeId: "compsocrates", colorMode: "dark", accountThemeId: "dark-compsocrates" });
    expect(profilePatchToCsUser({ themeId: "ocean" })).toEqual({ themeId: "ocean" });
    expect(profilePatchToCsUser({ colorMode: "light" }, csUser({ themeId: "compsocrates" }))).toMatchObject({ colorMode: "light", accountThemeId: "light-compsocrates" });
    expect(csThemeIdFor("pride-bisexual")).toBe("pride-bi");
    expect(csThemeIdFor("pride-lesbian")).toBe("pride-lesbian");
  });

  it("passes additive fields through and never writes protected ones", () => {
    const out = profilePatchToCsUser({ avatar: { kind: "initials" } as never, gradientIntensity: "subtle", bio: "b" });
    expect(out).toEqual({ avatar: { kind: "initials" }, gradientIntensity: "subtle", bio: "b" });
    const all = profilePatchToCsUser({ name: "n", primaryRole: "media", isAdmin: true, themeId: "ocean" }, csUser());
    for (const key of ["encryptedUserData", "userDataEncryptedAt", "teamId", "email", "isOwner", "isPlatformOwner"]) expect(key in all).toBe(false);
  });
});

describe("parseUidList", () => {
  it("splits, trims and de-duplicates", () => {
    expect(parseUidList(" a, b ;c  a,, ")).toEqual(["a", "b", "c"]);
    expect(parseUidList(undefined)).toEqual([]);
  });
});
