import { beforeEach, describe, expect, it, vi } from "vitest";

// The firebase client modules are replaced: this suite is about WHAT the seam asks for, counted by its injected dependencies, not about Firestore.
vi.mock("@/lib/firebase/client", () => ({ db: {}, isFirebaseConfigured: () => true }));
vi.mock("firebase/firestore", () => ({ getDocs: vi.fn(), query: vi.fn(), where: vi.fn() }));

import { clearRosterCache, loadRosterExtras, membershipToMember, mergeMembers, withRosterExtras, type RosterDeps } from "@/lib/team-roster";
import type { TeamMember } from "@/lib/team-members";
import type { MembershipDoc } from "@/lib/memberships/model";

const mem = (uid: string, over: Partial<MembershipDoc> = {}): MembershipDoc => ({
  uid,
  teamId: "T1",
  role: "pit-scout",
  roles: null,
  secondaryRoles: ["drive-team"],
  isAdmin: false,
  isOwner: false,
  fieldTeamIds: null,
  name: `Name ${uid}`,
  status: "active",
  origin: "pointer",
  joinedAt: 5,
  leftAt: null,
  endedBy: null,
  updatedAt: 6,
  ...over,
});
const user = (uid: string, over: Partial<TeamMember> = {}): TeamMember => ({ uid, name: `User ${uid}`, email: `${uid}@x.test`, primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false, ...over });

function deps(enabled: boolean, rows: MembershipDoc[] | Error) {
  const read = vi.fn(async () => {
    if (rows instanceof Error) throw rows;
    return rows;
  });
  const d: RosterDeps = { enabled: async () => enabled, readActiveMemberships: read };
  return { d, read };
}

beforeEach(() => clearRosterCache());

describe("the roster seam (browser side)", () => {
  it("runs NO query while the kill switch is OFF, however many times it is asked", async () => {
    const { d, read } = deps(false, [mem("a")]);
    for (let i = 0; i < 5; i += 1) expect(await loadRosterExtras("frc", "T1", d)).toEqual({ members: [], denied: false });
    expect(await withRosterExtras("ftc", "T1", [user("u1")], d)).toEqual([user("u1")]);
    expect(read).not.toHaveBeenCalled();
  });

  it("runs ONE membership query per program and team per page load while ON, shared by every reader", async () => {
    const { d, read } = deps(true, [mem("a"), mem("b")]);
    const results = await Promise.all([loadRosterExtras("frc", "T1", d), loadRosterExtras("frc", "T1", d), withRosterExtras("frc", "T1", [], d)]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(results[0].members.map((m) => m.uid)).toEqual(["a", "b"]);
    await loadRosterExtras("ftc", "T1", d);
    await loadRosterExtras("frc", "T2", d);
    expect(read).toHaveBeenCalledTimes(3);
    clearRosterCache();
    await loadRosterExtras("frc", "T1", d);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("falls back to the user rows alone when the memberships read is denied, remembers it, and does not retry", async () => {
    const denied = Object.assign(new Error("denied"), { code: "permission-denied" });
    const { d, read } = deps(true, denied);
    expect(await loadRosterExtras("frc", "T1", d)).toEqual({ members: [], denied: true });
    expect(await withRosterExtras("frc", "T1", [user("u1")], d)).toEqual([user("u1")]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("merges: a user row wins over a membership row for the same person, the rest are added", async () => {
    const { d } = deps(true, [mem("u1", { name: "Stale" }), mem("away", { isAdmin: true, role: "lead-scout" })]);
    const merged = await withRosterExtras("frc", "T1", [user("u1")], d);
    expect(merged.map((m) => m.uid)).toEqual(["u1", "away"]);
    expect(merged[0].name).toBe("User u1");
    expect(merged[1]).toMatchObject({ uid: "away", primaryRole: "lead-scout", isAdmin: true, email: "" });
  });

  it("builds a member from a membership: legacy role normalized, no email, secondary roles without the primary", () => {
    const m = membershipToMember(mem("x", { role: "coach", secondaryRoles: ["team-coach", "pit-scout", "bogus"], fieldTeamIds: ["f1"] }));
    expect(m.primaryRole).toBe("team-coach");
    expect(m.secondaryRoles).toEqual(["pit-scout"]);
    expect(m.email).toBe("");
    expect(m.assignedTeamIds).toEqual(["f1"]);
    expect(mergeMembers([user("a")], [])).toEqual([user("a")]);
  });
});
