import { describe, expect, it } from "vitest";
import { pastMembersAccess } from "@/components/assignments/past-members-access";
import { MEMBERSHIP_TEXT } from "@/lib/memberships/strings";

const verifiedAdmin = { status: "active", origin: "verified", isAdmin: true as boolean | null };

describe("Past Team Members: who sees what", () => {
  it("is hidden while the memberships switch is OFF and for anyone who is not an admin", () => {
    expect(pastMembersAccess({ enabled: false, isAdmin: true, membership: verifiedAdmin })).toBe("hidden");
    expect(pastMembersAccess({ enabled: true, isAdmin: false, membership: verifiedAdmin })).toBe("hidden");
  });

  it("an active admin whose own membership is not verified gets the hint, not the data (pointer origin, implicit, ended, or not an admin on record)", () => {
    for (const membership of [undefined, { ...verifiedAdmin, origin: "pointer" }, { ...verifiedAdmin, implicit: true }, { ...verifiedAdmin, status: "past" }, { ...verifiedAdmin, isAdmin: false }, { ...verifiedAdmin, isAdmin: null }]) {
      expect(pastMembersAccess({ enabled: true, isAdmin: true, membership }), JSON.stringify(membership)).toBe("unverified");
    }
  });

  it("a verified, active admin membership opens the section", () => {
    expect(pastMembersAccess({ enabled: true, isAdmin: true, membership: verifiedAdmin })).toBe("verified");
  });

  it("the hint is the agreed sentence", () => {
    expect(MEMBERSHIP_TEXT.past.needsVerification).toBe("Ask the platform owner to verify team admins to see past members");
  });
});
