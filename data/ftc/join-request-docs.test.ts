import { describe, expect, it } from "vitest";
import { ftcApprovedProfileDoc, ftcDocsToJoinRequests, ftcJoinDecisionFields, JOIN_REQUEST_MEMBER_ROLE } from "@/data/ftc/join-request-docs";

describe("ftcDocsToJoinRequests", () => {
  it("reads pending requests oldest first and skips docs with no name or no data", () => {
    const rows = [
      { id: "b", data: { uid: "b", name: "Bea", status: "pending", createdAt: new Date(2000) } },
      { id: "a", data: { uid: "a", name: "Al", status: "pending", createdAt: new Date(1000) } },
      { id: "x", data: { uid: "x", name: "  ", status: "pending" } },
      { id: "y", data: null },
      { id: "c", data: { name: "Cy" } },
    ];
    const out = ftcDocsToJoinRequests(rows);
    expect(out.map((r) => r.uid)).toEqual(["a", "b", "c"]);
    expect(out[0]).toMatchObject({ name: "Al", status: "pending", requestedAtMs: 1000 });
    expect(out[2].requestedAtMs).toBeNull(); // no time yet sorts last
  });
});

describe("ftcApprovedProfileDoc", () => {
  it("is a plain member on the team with the team's field teams, never an admin or owner", () => {
    const doc = ftcApprovedProfileDoc("TEAM1234", { name: "Al" }, ["ft-1", "ft-2"], "NOW");
    expect(doc).toEqual({ name: "Al", teamId: "TEAM1234", primaryRole: JOIN_REQUEST_MEMBER_ROLE, secondaryRoles: [], isAdmin: false, isOwner: false, fieldTeamIds: ["ft-1", "ft-2"], createdAt: "NOW" });
  });
});

describe("ftcJoinDecisionFields", () => {
  it("carries exactly the decision", () => {
    expect(ftcJoinDecisionFields("denied", "admin1", "NOW")).toEqual({ status: "denied", decidedBy: "admin1", decidedAt: "NOW" });
  });
});
