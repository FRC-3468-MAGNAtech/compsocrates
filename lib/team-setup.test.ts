import { describe, expect, it } from "vitest";
import { applicationsState, closedRequestNotice, parseJoinCode, requestSentText, TEAM_CREATION_CLOSED_TEXT, validateJoin } from "@/lib/team-setup";

describe("parseJoinCode", () => {
  it("uppercases and trims, and rejects anything that cannot be a document id", () => {
    expect(parseJoinCode(" ab3d9xk2 ")).toBe("AB3D9XK2");
    expect(parseJoinCode("")).toBeNull();
    expect(parseJoinCode("ab/cd")).toBeNull();
    expect(parseJoinCode("ab cd")).toBeNull();
  });
});

describe("validateJoin (the one setup form of both programs)", () => {
  it("needs a usable code and a name", () => {
    expect(validateJoin({ joinCode: " abcd2345 ", displayName: "Ada" })).toEqual({ code: "ABCD2345", errors: {} });
    expect(validateJoin({ joinCode: "a/b", displayName: " " }).errors).toEqual({ joinCode: expect.any(String), displayName: expect.any(String) });
    expect(validateJoin({ joinCode: "ABCD2345", displayName: "x".repeat(81) }).errors.displayName).toMatch(/under 80/);
  });
});

describe("applicationsState (the Apply tab's state, one rule for every program)", () => {
  it("is unknown while loading, open only on an explicit true, otherwise closed", () => {
    expect(applicationsState(null)).toBe("loading");
    expect(applicationsState(true)).toBe("open");
    expect(applicationsState(false)).toBe("closed");
  });
  it("the closed notice says applications are not open yet and points at the join code", () => {
    expect(TEAM_CREATION_CLOSED_TEXT).toContain("aren't open yet");
    expect(TEAM_CREATION_CLOSED_TEXT).toContain("join code");
  });
});

describe("the shared sentences", () => {
  it("Request sent keeps the FTC wording word for word", () => {
    expect(requestSentText("ABCD2345")).toBe("Request sent for code ABCD2345. A team admin has to approve it. This page moves on by itself once they do.");
  });
  it("the denied and canceled notices", () => {
    expect(closedRequestNotice("denied")).toContain("denied");
    expect(closedRequestNotice("canceled")).toContain("canceled");
  });
});
