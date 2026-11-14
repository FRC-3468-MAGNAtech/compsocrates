import { describe, expect, it } from "vitest";
import { ftcUserToMember, ftcUserToProfile, readMemberFieldTeamIds, rolesFromFtcUser, type FtcUserDoc } from "@/data/ftc/users";
import { parseAvatar } from "@/lib/profile/model";
import { defaultThemeId } from "@/lib/themes";

const stored = (over: FtcUserDoc = {}): FtcUserDoc => ({
  name: "Ada Lovelace",
  email: "ada@example.org",
  teamId: "team-1",
  primaryRole: "match-scout",
  secondaryRoles: ["pit-scout", "lead-scout"],
  isAdmin: false,
  isOwner: false,
  ...over,
});

describe("rolesFromFtcUser", () => {
  it("keeps the primary and orders the secondaries canonically, without the primary or duplicates", () => {
    const { primaryRole, secondaryRoles } = rolesFromFtcUser({ primaryRole: "lead-scout", secondaryRoles: ["pit-scout", "lead-scout", "pit-scout", "match-scout"] });
    expect(primaryRole).toBe("lead-scout");
    expect(secondaryRoles).toHaveLength(2);
    expect(secondaryRoles).toEqual(expect.arrayContaining(["pit-scout", "match-scout"]));
    expect(secondaryRoles).not.toContain("lead-scout");
  });

  it("an unknown or missing primary is a Match Scout; unknown secondaries are dropped", () => {
    expect(rolesFromFtcUser({}).primaryRole).toBe("match-scout");
    expect(rolesFromFtcUser({ primaryRole: "wizard" }).primaryRole).toBe("match-scout");
    expect(rolesFromFtcUser({ primaryRole: "pit-scout", secondaryRoles: ["wizard", 3, "lead-scout"] }).secondaryRoles).toEqual(["lead-scout"]);
  });
});

describe("ftcUserToProfile", () => {
  it("maps a stored user", () => {
    const profile = ftcUserToProfile("uid-ada", stored({ isAdmin: true, themeId: "team", colorMode: "dark", gradientIntensity: "subtle", glassLayerLevel: 1.5 }));
    expect(profile).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@example.org",
      teamId: "team-1",
      primaryRole: "match-scout",
      isAdmin: true,
      isOwner: false,
      isPlatformOwner: false,
      themeId: "team",
      colorMode: "dark",
      gradientIntensity: "subtle",
      glassLayerLevel: 1.5,
    });
  });

  it("admin and owner are exactly the stored flags (no allowlist)", () => {
    expect(ftcUserToProfile("u", stored({ isAdmin: "yes", isOwner: 1 }))).toMatchObject({ isAdmin: false, isOwner: false });
    expect(ftcUserToProfile("u", stored({ isOwner: true, isPlatformOwner: true }))).toMatchObject({ isOwner: true, isPlatformOwner: true });
  });

  it("sparse old docs do not throw; the name falls back to the email", () => {
    const profile = ftcUserToProfile("u", { email: "grace@example.org" });
    expect(profile).toMatchObject({ name: "grace", email: "grace@example.org", teamId: "", primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, themeId: defaultThemeId });
    expect(ftcUserToProfile("u", {})).toMatchObject({ name: "", email: "" });
  });

  it("an unknown theme falls back to the default; bad optional values are left out", () => {
    const profile = ftcUserToProfile("u", stored({ themeId: "nope", colorMode: "sepia", gradientIntensity: "loud", glassLayerLevel: "2", workspaceFormWidth: NaN }));
    expect(profile.themeId).toBe(defaultThemeId);
    for (const key of ["colorMode", "gradientIntensity", "glassLayerLevel", "workspaceFormWidth", "workspacePhoneSplit", "avatar", "lastSeenChangelogAt"]) expect(profile).not.toHaveProperty(key);
  });

  it("reads the avatar through the shared parser", () => {
    const raw = { kind: "preset", id: "owl" };
    expect(ftcUserToProfile("u", stored({ avatar: raw })).avatar).toEqual(parseAvatar(raw));
  });
});

describe("ftcUserToMember", () => {
  it("maps a roster row, with the join time from createdAt", () => {
    const member = ftcUserToMember("uid-ada", stored({ isAdmin: true, createdAt: 1_700_000_000_000 }));
    expect(member).toEqual({
      uid: "uid-ada",
      name: "Ada Lovelace",
      email: "ada@example.org",
      primaryRole: "match-scout",
      secondaryRoles: expect.arrayContaining(["pit-scout", "lead-scout"]),
      isAdmin: true,
      isOwner: false,
      joinedAtMs: 1_700_000_000_000,
    });
  });

  it("reads a Firestore Timestamp-like createdAt; no createdAt leaves the field out", () => {
    expect(ftcUserToMember("u", stored({ createdAt: { toMillis: () => 5000 } })).joinedAtMs).toBe(5000);
    expect(ftcUserToMember("u", stored())).not.toHaveProperty("joinedAtMs");
  });
});

describe("readMemberFieldTeamIds", () => {
  it("returns the assigned ids, or undefined when the doc has no list", () => {
    expect(readMemberFieldTeamIds({ fieldTeamIds: ["ft-1", 2, "ft-3"] })).toEqual(["ft-1", "ft-3"]);
    expect(readMemberFieldTeamIds({ fieldTeamIds: [] })).toEqual([]);
    expect(readMemberFieldTeamIds({})).toBeUndefined();
    expect(readMemberFieldTeamIds({ fieldTeamIds: "ft-1" })).toBeUndefined();
  });
});
