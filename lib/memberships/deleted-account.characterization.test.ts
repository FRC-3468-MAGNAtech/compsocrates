import { describe, expect, it } from "vitest";
import { mergeRosterRows, rosterRowFromMembership, type RosterRow } from "@/lib/memberships/flows";
import { membershipProblem, readMembership } from "@/lib/memberships/model";

// Characterization (Build 4): a membership ended as `deleted` (uid rewritten to an opaque id, name "Deleted Account", role and dates kept) is still a valid
// membership document, still becomes a roster row for the past-members list, and never replaces a live person's row.
const OPAQUE = "deleted-0123456789abcdef0123456789abcdef";
const deleted = {
  uid: OPAQUE, teamId: "t1", role: "match-scout", roles: null, secondaryRoles: [], isAdmin: false, isOwner: false, fieldTeamIds: null, name: "Deleted Account", status: "past", origin: "verified",
  joinedAt: 1000, leftAt: 2000, endedBy: "deleted", updatedAt: 2000,
};

describe("a deleted membership", () => {
  it("passes the membership validator and keeps its role, dates and team", () => {
    expect(membershipProblem(deleted as never)).toBeNull();
    const m = readMembership(deleted as never);
    expect(m).toMatchObject({ uid: OPAQUE, name: "Deleted Account", role: "match-scout", joinedAt: 1000, leftAt: 2000, endedBy: "deleted", teamId: "t1" });
  });

  it("becomes a roster row named Deleted Account and does not displace live rows", () => {
    const m = readMembership(deleted as never);
    expect(m).not.toBeNull();
    const row = rosterRowFromMembership(m!);
    expect(row.name).toBe("Deleted Account");
    const live: RosterRow = { uid: "u1", name: "Ada", isAdmin: true, isOwner: false, pointer: true };
    expect(mergeRosterRows([live], [row]).map((r) => r.name)).toEqual(["Ada", "Deleted Account"]);
  });
});
