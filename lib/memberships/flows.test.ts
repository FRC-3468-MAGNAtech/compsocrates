import { describe, expect, it } from "vitest";
import { PROGRAMS } from "@/config/programs";
import { PROGRAM_IDS } from "@/config/programs/types";
import {
  accessMembershipPatch,
  accessUserPatch,
  buildVerifiedMembership,
  clearedUserPatch,
  endedMembershipPatch,
  guardEnding,
  guardSelfDemotion,
  isRequestableRole,
  teamSnapshotOfDoc,
  mergeRosterRows,
  parseAccessChanges,
  pickNextActive,
  resolveApprovedRole,
  restoredMembershipPatch,
  teamLabelOfDoc,
  teamOwnerUid,
  userIsAdmin,
  type RosterRow,
} from "@/lib/memberships/flows";
import { membershipProblem, readMembership, type MembershipDoc } from "@/lib/memberships/model";
import { ROLES } from "@/lib/roles";

const row = (uid: string, over: Partial<RosterRow> = {}): RosterRow => ({ uid, name: uid, isAdmin: false, isOwner: false, pointer: true, ...over });
const mem = (teamId: string, updatedAt: number, over: Partial<MembershipDoc> = {}): MembershipDoc => ({
  uid: "u", teamId, role: "match-scout", roles: null, secondaryRoles: [], isAdmin: false, isOwner: false, fieldTeamIds: null, name: "P", status: "active", origin: "pointer", joinedAt: 1, leftAt: null, endedBy: null, updatedAt, ...over,
});

describe("role choice (the server decides)", () => {
  it("never accepts an admin or coach value, and only honors a role when the switch is exactly true", () => {
    for (const program of PROGRAM_IDS) {
      const def = PROGRAMS[program].membership.defaultJoinRole;
      expect(resolveApprovedRole({ program, allowChoice: true, requested: "lead-scout" })).toEqual({ role: "lead-scout", honored: true });
      for (const bad of ["admin", "owner", "coach", "team-coach", "isAdmin", "", null, undefined, 3, {}]) expect(resolveApprovedRole({ program, allowChoice: true, requested: bad }), String(bad)).toEqual({ role: def, honored: false });
      for (const off of [false, undefined, null, "true", 1, "yes"]) expect(resolveApprovedRole({ program, allowChoice: off, requested: "lead-scout" }), String(off)).toEqual({ role: def, honored: false });
    }
  });

  it("every role a joiner can pick is a real role id and none is the coach role", () => {
    const requestable = ROLES.filter((r) => isRequestableRole(r.id));
    expect(requestable.length).toBeGreaterThan(5);
    expect(requestable.map((r) => r.id)).not.toContain("team-coach");
  });
});

describe("the guards", () => {
  const owner = row("own", { isAdmin: true, isOwner: true });
  it("the sole remaining member may always go", () => {
    expect(guardEnding({ target: owner, others: [], teamOwnerUid: "own", force: false })).toBeNull();
  });
  it("the owner must transfer first, even when another admin exists", () => {
    expect(guardEnding({ target: owner, others: [row("a", { isAdmin: true })], teamOwnerUid: "own", force: false })).toMatchObject({ status: 409, code: "owner_must_transfer" });
    // the team document names the owner even when the person's own flag is missing
    expect(guardEnding({ target: row("own", { isAdmin: true }), others: [row("x")], teamOwnerUid: "own", force: false })?.code).toBe("owner_must_transfer");
  });
  it("the only admin of a team that still has members cannot go; with another admin they can", () => {
    const admin = row("adm", { isAdmin: true });
    expect(guardEnding({ target: admin, others: [row("m")], teamOwnerUid: "", force: false })).toMatchObject({ status: 409, code: "last_admin" });
    expect(guardEnding({ target: admin, others: [row("m"), row("a2", { isAdmin: true })], teamOwnerUid: "", force: false })).toBeNull();
    expect(guardEnding({ target: row("m"), others: [admin], teamOwnerUid: "", force: false })).toBeNull();
  });
  it("a platform owner's force skips both", () => {
    expect(guardEnding({ target: owner, others: [row("m")], teamOwnerUid: "own", force: true })).toBeNull();
  });
  it("an admin stepping down as the only admin is refused; with another admin or for another person it is not", () => {
    expect(guardSelfDemotion({ actorUid: "a", targetUid: "a", makesAdmin: false, currentlyAdmin: true, others: [row("m")] })?.code).toBe("last_admin");
    expect(guardSelfDemotion({ actorUid: "a", targetUid: "a", makesAdmin: false, currentlyAdmin: true, others: [row("x", { isAdmin: true })] })).toBeNull();
    expect(guardSelfDemotion({ actorUid: "a", targetUid: "b", makesAdmin: false, currentlyAdmin: true, others: [] })).toBeNull();
    expect(guardSelfDemotion({ actorUid: "a", targetUid: "a", makesAdmin: true, currentlyAdmin: true, others: [] })).toBeNull();
  });
});

describe("a role edit", () => {
  it("accepts only roles, admin as a boolean, and nothing about owners", () => {
    expect(parseAccessChanges({ primaryRole: "lead-scout", secondaryRoles: ["pit-scout", "pit-scout"], isAdmin: true })).toEqual({ ok: true, changes: { primaryRole: "lead-scout", secondaryRoles: ["pit-scout"], isAdmin: true } });
    for (const bad of [null, [], "x", {}, { isOwner: true }, { isPlatformOwner: true }, { primaryRole: "boss" }, { secondaryRoles: "pit-scout" }, { secondaryRoles: Array(10).fill("pit-scout") }, { isAdmin: 1 }, { teamId: "X" }]) {
      expect(parseAccessChanges(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("builds the patch from each program's own field names, and never touches the owner or platform-owner fields", () => {
    for (const program of PROGRAM_IDS) {
      const f = PROGRAMS[program].membership.userFields;
      const patch = accessUserPatch(program, { [f.role]: "match-scout", [f.secondaryRoles]: [] }, { primaryRole: "drive-team", secondaryRoles: ["pit-scout"], isAdmin: true });
      expect(patch[f.role]).toBe("drive-team");
      expect(patch[f.secondaryRoles]).toEqual(["pit-scout"]);
      expect(patch[f.isAdmin]).toBe(true);
      expect(f.roles ? patch[f.roles] : "none").toEqual(f.roles ? ["drive-team", "pit-scout"] : "none");
      for (const k of Object.keys(patch)) expect([f.isOwner, "isPlatformOwner", "teamId"]).not.toContain(k);
    }
  });

  it("the legacy admin role value stays an admin when its role changes, and demoting it rewrites the roles", () => {
    const f = PROGRAMS.frc.membership.userFields;
    expect(accessUserPatch("frc", { role: "coach", roles: ["coach"] }, { primaryRole: "lead-scout" })).toMatchObject({ [f.role]: "lead-scout", [f.isAdmin]: true });
    expect(accessUserPatch("frc", { role: "coach", roles: ["coach"] }, { isAdmin: false })).toMatchObject({ [f.role]: "team-coach", [f.isAdmin]: false });
    expect(userIsAdmin("frc", { role: "coach" })).toBe(true);
    expect(userIsAdmin("ftc", { primaryRole: "coach" })).toBe(false);
  });

  it("applies the same edit to a membership snapshot", () => {
    const snap = { role: "match-scout", roles: null, secondaryRoles: [], isAdmin: false, isOwner: false, fieldTeamIds: null };
    expect(accessMembershipPatch("ftc", snap, { primaryRole: "pit-scout", isAdmin: true })).toEqual({ role: "pit-scout", secondaryRoles: [], isAdmin: true });
    expect(accessMembershipPatch("frc", snap, { primaryRole: "pit-scout" })).toMatchObject({ role: "pit-scout", roles: ["pit-scout"] });
  });
});

describe("memberships that end, restart or move the pointer", () => {
  it("clears exactly the team-specific fields of each program and leaves preferences alone", () => {
    for (const program of PROGRAM_IDS) {
      const m = PROGRAMS[program].membership;
      const patch = clearedUserPatch(program, "REMOVE");
      expect(patch.teamId).toBe("");
      expect(patch[m.userFields.role]).toBe(m.defaultJoinRole);
      expect(patch[m.userFields.secondaryRoles]).toEqual([]);
      expect(patch[m.userFields.isAdmin]).toBe(false);
      expect(patch[m.userFields.isOwner]).toBe(false);
      if (m.userFields.fieldTeamIds) expect(patch[m.userFields.fieldTeamIds]).toBe("REMOVE");
      for (const k of ["themeId", "avatar", "bio", "isPlatformOwner", "email", "name", "displayName"]) expect(patch, k).not.toHaveProperty(k);
    }
  });

  it("builds a verified, valid membership and a restore that keeps joinedAt (it is not in the patch)", () => {
    const doc = buildVerifiedMembership({ program: "ftc", uid: "u1", teamId: "T1", name: "Ann", teamLabel: "Team 1 · Robo", role: "lead-scout", fieldTeamIds: ["f1"], nowMs: 5 });
    expect(membershipProblem(doc as unknown as Record<string, unknown>)).toBeNull();
    expect(doc).toMatchObject({ origin: "verified", status: "active", isAdmin: false, isOwner: false, fieldTeamIds: ["f1"], teamLabel: "Team 1 · Robo", joinedAt: 5 });
    expect(readMembership(doc as unknown as Record<string, unknown>)?.teamLabel).toBe("Team 1 · Robo");
    const restore = restoredMembershipPatch({ program: "ftc", name: "Ann", role: "pit-scout", fieldTeamIds: ["f1"], nowMs: 9 });
    expect(restore).toMatchObject({ status: "active", rejoinedAt: 9, leftAt: null, endedBy: null, origin: "verified", isAdmin: false });
    expect(restore).not.toHaveProperty("joinedAt");
    expect(endedMembershipPatch({ endedBy: "admin", snapshot: { role: "x", roles: null, secondaryRoles: [], isAdmin: true, isOwner: false, fieldTeamIds: null }, name: "Ann", nowMs: 7 })).toMatchObject({ status: "past", leftAt: 7, endedBy: "admin", isAdmin: true });
  });

  it("picks the most recently active OTHER membership, or none", () => {
    const rows = [mem("A", 10), mem("B", 50), mem("C", 30, { status: "past" }), mem("D", 50)];
    expect(pickNextActive(rows, "A")?.teamId).toBe("B"); // tie between B and D: the lower id
    expect(pickNextActive(rows, "B")?.teamId).toBe("D");
    expect(pickNextActive([mem("A", 1)], "A")).toBeNull();
    expect(pickNextActive([], "A")).toBeNull();
  });

  it("merges rosters with the user row winning, and reads team owners and labels from the program's own fields", () => {
    expect(mergeRosterRows([row("a", { name: "User A" })], [row("a", { name: "Stale", pointer: false }), row("b", { pointer: false })]).map((r) => `${r.uid}:${r.name}`)).toEqual(["a:User A", "b:b"]);
    expect(teamOwnerUid("frc", { verifiedOwnerId: "v", ownerUid: "o" })).toBe("v");
    expect(teamOwnerUid("frc", { ownerUid: "o" })).toBe("o");
    expect(teamOwnerUid("ftc", { verifiedOwnerId: "v", ownerUid: "o" })).toBe("o");
    expect(teamLabelOfDoc({ teamNumber: "3468", teamName: "MAGNAtech" })).toBe("Team 3468 · MAGNAtech");
    expect(teamLabelOfDoc({ number: 35792, name: "" })).toBe("Team 35792");
    expect(teamLabelOfDoc({})).toBe("");
  });
});

describe("teamSnapshotOfDoc (the identity snapshot a membership carries)", () => {
  it("is the team's own number and name for a team with one number (FRC)", () => {
    expect(teamSnapshotOfDoc("frc", { teamNumber: "3468", teamName: "MAGNAtech" })).toEqual({ teamNumber: "3468", teamName: "MAGNAtech" });
    expect(teamSnapshotOfDoc("frc", { teamNumber: "3468", teamName: "MAGNAtech", accountName: "  Our Club " })).toEqual({ teamNumber: "3468", teamName: "Our Club" });
  });
  it("joins the robot teams' numbers with \" + \" when there are several, and names them, unless an organization name is set (FTC)", () => {
    const team = { number: 35792, name: "Rebels A", fieldTeams: [{ id: "a", number: 35792, name: "MAGNAtech Rebels A" }, { id: "b", number: 35794, name: "MAGNAtech Rebels B" }] };
    expect(teamSnapshotOfDoc("ftc", team)).toEqual({ teamNumber: "35792 + 35794", teamName: "MAGNAtech Rebels A + MAGNAtech Rebels B" });
    expect(teamSnapshotOfDoc("ftc", { ...team, accountName: "MAGNAtech" })).toEqual({ teamNumber: "35792 + 35794", teamName: "MAGNAtech" });
  });
  it("uses the team's own number and name when it has one robot team, and nothing when nothing can be read", () => {
    expect(teamSnapshotOfDoc("ftc", { number: 35792, name: "Rebels A", fieldTeams: [{ id: "a", number: 35792, name: "Rebels A" }] })).toEqual({ teamNumber: "35792", teamName: "Rebels A" });
    expect(teamSnapshotOfDoc("ftc", {})).toBeNull();
    expect(teamSnapshotOfDoc("ftc", null)).toBeNull();
  });
  it("never reads the join code or any id", () => {
    const out = JSON.stringify(teamSnapshotOfDoc("frc", { teamNumber: "3468", teamName: "MAGNAtech", joinCode: "W0065V", id: "W0065V" }));
    expect(out).not.toContain("W0065V");
  });
});
