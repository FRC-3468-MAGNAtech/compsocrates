import { FieldValue } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { MembershipError, buildMembershipFromUser, isKeyPart, membershipKey, membershipProblem, nameSnapshot, pointerOf, readMembership, readRoleSnapshot, restorePatch } from "./model";

// The pure part of memberships: both programs' user-document shapes, raw values, null = absent, the key rules.

const rootUser = { displayName: "Ann", email: "ann@example.com", teamId: "ABC123", role: "coach", roles: ["coach", "scout"], secondaryRoles: ["pit-scout"], isTeamAdmin: true, isOwner: false, isPlatformOwner: true };
const ftcUser = { name: "Fay", email: "fay@example.com", teamId: "k3j9xq2m", primaryRole: "drive-team", secondaryRoles: ["media"], isAdmin: false, isOwner: false, isPlatformOwner: false, fieldTeamIds: ["ft-1", "ft-2"] };

describe("buildMembershipFromUser", () => {
  it("root: raw role fields (legacy values kept), no field teams, origin pointer, no email, no platform-owner flag", () => {
    const r = buildMembershipFromUser("frc", "u1", rootUser, 1000);
    expect(r).toMatchObject({ ok: true, id: "ABC123_u1" });
    if (!r.ok) throw new Error("unreachable");
    expect(r.doc).toEqual({
      uid: "u1",
      teamId: "ABC123",
      role: "coach",
      roles: ["coach", "scout"],
      secondaryRoles: ["pit-scout"],
      isAdmin: true,
      isOwner: false,
      fieldTeamIds: null,
      name: "Ann",
      status: "active",
      origin: "pointer",
      joinedAt: 1000,
      leftAt: null,
      endedBy: null,
      updatedAt: 1000,
    });
    expect(JSON.stringify(r.doc)).not.toContain("example.com");
    expect(membershipProblem(r.doc)).toBeNull();
  });

  it("ftc: primaryRole maps to role, no roles array, field teams carried", () => {
    const r = buildMembershipFromUser("ftc", "u2", ftcUser, 5);
    if (!r.ok) throw new Error("unreachable");
    expect(r.id).toBe("k3j9xq2m_u2");
    expect(r.doc).toMatchObject({ role: "drive-team", roles: null, secondaryRoles: ["media"], isAdmin: false, isOwner: false, fieldTeamIds: ["ft-1", "ft-2"], name: "Fay", origin: "pointer" });
    expect(membershipProblem(r.doc)).toBeNull();
  });

  it("an absent field is null, never a default", () => {
    const r = buildMembershipFromUser("frc", "u1", { teamId: "T1", displayName: "x" }, 1);
    if (!r.ok) throw new Error("unreachable");
    expect(r.doc).toMatchObject({ role: null, roles: null, secondaryRoles: null, isAdmin: null, isOwner: null });
  });

  it("a value of the wrong shape or size counts as absent", () => {
    const snap = readRoleSnapshot("frc", { role: 7, roles: "coach", secondaryRoles: ["a", 2], isTeamAdmin: "yes", isOwner: null });
    expect(snap).toEqual({ role: null, roles: null, secondaryRoles: null, isAdmin: null, isOwner: null, fieldTeamIds: null });
    expect(readRoleSnapshot("frc", { roles: new Array(51).fill("x") }).roles).toBeNull();
  });

  it("refuses a missing pointer and ids that cannot make a key (typed, no throw)", () => {
    expect(buildMembershipFromUser("frc", "u1", { teamId: "" }, 1)).toEqual({ ok: false, error: "no_team" });
    expect(buildMembershipFromUser("frc", "u1", { teamId: "  " }, 1)).toEqual({ ok: false, error: "no_team" });
    expect(buildMembershipFromUser("frc", "u1", {}, 1)).toEqual({ ok: false, error: "no_team" });
    expect(buildMembershipFromUser("frc", "u1", { teamId: "A_B" }, 1)).toEqual({ ok: false, error: "invalid_id" });
    expect(buildMembershipFromUser("frc", "u_1", { teamId: "AB" }, 1)).toEqual({ ok: false, error: "invalid_id" });
    expect(buildMembershipFromUser("frc", "u1", { teamId: "A/B" }, 1)).toEqual({ ok: false, error: "invalid_id" });
  });

  it("uses the pointer exactly as stored (no case change)", () => {
    const r = buildMembershipFromUser("frc", "u1", { teamId: "abc12x" }, 1);
    expect(r).toMatchObject({ ok: true, id: "abc12x_u1" });
  });
});

describe("keys", () => {
  it("isKeyPart", () => {
    expect(isKeyPart("ABC123")).toBe(true);
    for (const bad of ["", "a_b", "a/b", ".", "..", " a", "a ", "x".repeat(129), 5, null]) expect(isKeyPart(bad)).toBe(false);
  });
  it("membershipKey", () => {
    expect(membershipKey("T1", "u1")).toEqual({ ok: true, id: "T1_u1" });
    expect(membershipKey("", "u1")).toEqual({ ok: false, error: "no_team" });
    expect(membershipKey("T_1", "u1")).toEqual({ ok: false, error: "invalid_id" });
  });
  it("pointerOf", () => {
    expect(pointerOf({ teamId: "T1" })).toBe("T1");
    expect(pointerOf({ teamId: 4 })).toBe("");
    expect(pointerOf(undefined)).toBe("");
  });
});

describe("restorePatch", () => {
  it("writes values and DELETES the fields the snapshot holds as null (never a default)", () => {
    const del = FieldValue.delete();
    const patch = restorePatch("frc", { role: "coach", roles: null, secondaryRoles: [], isAdmin: true, isOwner: null, fieldTeamIds: null }, del);
    expect(patch).toEqual({ role: "coach", roles: del, secondaryRoles: [], isTeamAdmin: true, isOwner: del });
  });
  it("ftc: names the program's own fields, leaves out `roles`, never mentions isPlatformOwner or teamId", () => {
    const del = FieldValue.delete();
    const patch = restorePatch("ftc", { role: "media", roles: ["x"], secondaryRoles: [], isAdmin: false, isOwner: false, fieldTeamIds: null }, del);
    expect(Object.keys(patch).sort()).toEqual(["fieldTeamIds", "isAdmin", "isOwner", "primaryRole", "secondaryRoles"]);
    expect(patch.fieldTeamIds).toBe(del);
  });
});

describe("name, validation, tolerant read", () => {
  it("nameSnapshot reads the program's name fields, trims, cuts to the limit, never an email", () => {
    expect(nameSnapshot("frc", { displayName: "  ", name: "Bo" })).toBe("Bo");
    expect(nameSnapshot("ftc", { name: "x".repeat(300) })).toHaveLength(120);
    expect(nameSnapshot("ftc", { email: "a@b.c" })).toBe("");
  });
  it("membershipProblem rejects unknown keys (an email cannot ride along) and bad values", () => {
    const ok = buildMembershipFromUser("frc", "u1", rootUser, 1);
    if (!ok.ok) throw new Error("unreachable");
    expect(membershipProblem({ ...ok.doc, email: "a@b.c" })).toContain("email");
    expect(membershipProblem({ ...ok.doc, status: "gone" })).toBe("status");
    expect(membershipProblem({ ...ok.doc, origin: "admin" })).toBe("origin");
    expect(membershipProblem({ ...ok.doc, teamId: "A_B" })).toBe("teamId");
    expect(membershipProblem({ ...ok.doc, isAdmin: "yes" })).toBe("isAdmin");
  });
  it("readMembership is tolerant and defaults a missing origin to pointer", () => {
    expect(readMembership({ uid: "u1", teamId: "T1", status: "past", origin: "verified", leftAt: 9, endedBy: "self" })).toMatchObject({ status: "past", origin: "verified", leftAt: 9, endedBy: "self" });
    expect(readMembership({ uid: "u1", teamId: "T1" })).toMatchObject({ status: "active", origin: "pointer" });
    expect(readMembership({ teamId: "T1" })).toBeNull();
  });
  it("MembershipError carries a status and a code", () => {
    const e = new MembershipError(403, "not_a_member", "no");
    expect([e.status, e.code]).toEqual([403, "not_a_member"]);
  });
});
