import { describe, expect, it } from "vitest";
import { PENDING_LABEL_TEXT, composeTeamIdentity, legacyLabelParts, resolveTeamLabel } from "@/lib/team-label";

describe("composeTeamIdentity", () => {
  it("uses the team's own number and name for one robot team, the organization name when set", () => {
    expect(composeTeamIdentity({ number: 3468, name: "MAGNAtech" })).toEqual({ number: "3468", name: "MAGNAtech" });
    expect(composeTeamIdentity({ number: 3468, name: "MAGNAtech", org: " Club " })).toEqual({ number: "3468", name: "Club" });
    expect(composeTeamIdentity({ number: 1, name: "A", robots: [{ number: 1, name: "A" }] })).toEqual({ number: "1", name: "A" });
  });
  it("joins several robot teams' numbers with ' + ' and names them unless an organization name is set", () => {
    const robots = [{ number: 35792, name: "Rebels A" }, { number: 35794, name: "Rebels B" }];
    expect(composeTeamIdentity({ number: 35792, name: "Rebels A", robots })).toEqual({ number: "35792 + 35794", name: "Rebels A + Rebels B" });
    expect(composeTeamIdentity({ number: 35792, name: "Rebels A", org: "MAGNAtech", robots })).toEqual({ number: "35792 + 35794", name: "MAGNAtech" });
  });
  it("is null when nothing is known", () => {
    expect(composeTeamIdentity({ number: null, name: null })).toBeNull();
  });
});

describe("legacyLabelParts", () => {
  it("reads the stored 'Team N · Name' string, a bare number or a bare name", () => {
    expect(legacyLabelParts("Team 3468 · MAGNAtech")).toEqual({ number: "3468", name: "MAGNAtech" });
    expect(legacyLabelParts("Team 3468")).toEqual({ number: "3468", name: null });
    expect(legacyLabelParts("Just A Name")).toEqual({ number: null, name: "Just A Name" });
    expect(legacyLabelParts("")).toBeNull();
    expect(legacyLabelParts(undefined)).toBeNull();
  });
});

describe("resolveTeamLabel", () => {
  it("takes the first source with anything usable, whole, and builds the text", () => {
    expect(resolveTeamLabel([null, { number: 3468, name: "MAGNAtech" }, { number: 9, name: "Other" }])).toEqual({ state: "ready", number: "3468", name: "MAGNAtech", text: "Team 3468 · MAGNAtech" });
    expect(resolveTeamLabel([{ number: "35792 + 35794", name: null }]).text).toBe("Team 35792 + 35794");
    expect(resolveTeamLabel([{ number: null, name: "Only a name" }]).text).toBe("Only a name");
  });
  it("is pending (never an id) with nothing usable", () => {
    const label = resolveTeamLabel([null, undefined, { number: null, name: "" }]);
    expect(label).toMatchObject({ state: "pending", number: null, name: null, text: PENDING_LABEL_TEXT });
  });
  it("drops a piece equal to a forbidden id or join code, and a number that is not a number", () => {
    expect(resolveTeamLabel([{ number: "W0065V", name: "W0065V" }], { forbid: ["W0065V"] }).state).toBe("pending");
    expect(resolveTeamLabel([{ number: "W0065V", name: "MAGNAtech" }]).text).toBe("MAGNAtech");
    expect(resolveTeamLabel([{ number: null, name: "Team w0065v" }], { forbid: ["W0065V"] }).state).toBe("pending");
    expect(resolveTeamLabel([{ number: "12345", name: "Real" }, null], { forbid: ["12345"] }).text).toBe("Real");
    // the next source is used when the first held only an id
    expect(resolveTeamLabel([{ number: null, name: "K7Xq9ZpLm2" }, { number: 254, name: "Cheesy" }], { forbid: ["K7Xq9ZpLm2"] }).text).toBe("Team 254 · Cheesy");
  });
});
