import { describe, expect, it } from "vitest";
import { ftcUserToMember, ftcUserToProfile } from "@/data/ftc/users";
import { deriveAccountState } from "@/lib/account-state";
import { membershipOfProfile } from "@/components/program/program-gate";
import { isHolding } from "@/lib/memberships/switching";

// Memberships build 2: a person who leaves their only team keeps their FTC profile with `teamId: ""`. Every place that decides "has a team" must read that as NO TEAM.

describe("an FTC profile with an empty team id counts as no team everywhere", () => {
  it("the port's profile mapping gives an empty team id for '', blank, missing and null values", () => {
    for (const teamId of ["", "   ", undefined, null]) {
      const profile = ftcUserToProfile("u1", { name: "Lee", teamId } as never);
      expect(profile.teamId, String(teamId)).toBe("");
      expect(ftcUserToMember("u1", { name: "Lee", teamId } as never).uid).toBe("u1");
    }
    expect(ftcUserToProfile("u1", { name: "Lee", teamId: " ABCD2345 " } as never).teamId).toBe("ABCD2345");
  });

  it("the program gate treats an existing profile with no team as the setup screen's job (and a missing profile too), and a real team as a member", () => {
    expect(membershipOfProfile(false, undefined)).toBe("none");
    expect(membershipOfProfile(true, { teamId: "" })).toBe("left");
    expect(membershipOfProfile(true, { teamId: "  " })).toBe("left");
    expect(membershipOfProfile(true, {})).toBe("left");
    expect(membershipOfProfile(true, { teamId: 7 })).toBe("left");
    expect(membershipOfProfile(true, { teamId: "ABCD2345" })).toBe("member");
  });

  it("the account state is 'no-team' for an empty pointer and 'team' for a real one (the program layout, sidebar and page access key on the same truthiness)", () => {
    const base = { program: "ftc" as const, uid: "u1", authLoading: false, entry: { state: "done" as const, memberships: [], error: null } };
    const profile = (teamId: string) => ({ ...ftcUserToProfile("u1", { name: "Lee", teamId } as never) });
    expect(deriveAccountState({ ...base, profile: profile("") }).status).toBe("no-team");
    expect(deriveAccountState({ ...base, profile: profile("  ") }).activeTeamId).toBeNull();
    expect(deriveAccountState({ ...base, profile: profile("ABCD2345") })).toMatchObject({ status: "team", activeTeamId: "ABCD2345" });
    expect(deriveAccountState({ ...base, profile: null }).status).toBe("no-team");
    // the shell's own tests are `!profile?.teamId`, and an empty string is falsy
    expect(!profile("").teamId).toBe(true);
  });

  it("the switch hold: holding only while the profile has not shown the target team", () => {
    expect(isHolding(null, "A")).toBe(false);
    expect(isHolding("B", "A")).toBe(true);
    expect(isHolding("B", "")).toBe(true);
    expect(isHolding("B", undefined)).toBe(true);
    expect(isHolding("B", "B")).toBe(false);
  });
});
