import { describe, expect, it } from "vitest";
import { applySlotSwap, ftcAssignmentDocId, ftcAssignmentsDoc, ftcDocsToTeamAssignments, ftcDocToAssignments, ftcTeamAssignmentDocId, pickMatchAssignments, readAssignmentVersion } from "@/data/ftc/assignments";

const slots = [
  { matchType: "Qualification", matchNumber: 1, slot: "red1", teamNumber: 100, scoutUid: "a" },
  { matchType: "Qualification", matchNumber: 1, slot: "red2", teamNumber: 200, scoutUid: "b" },
  { matchType: "Qualification", matchNumber: 1, slot: "blue1", teamNumber: 300, scoutUid: "a" },
  { matchType: "Qualification", matchNumber: 1, slot: "blue2", teamNumber: 400, scoutUid: "b" },
];
const stored = (over: Record<string, unknown> = {}) => ({
  generatedBy: "lead",
  generatedAt: "2026-01-10T10:00:00.000Z",
  settings: { matchSource: "event", seasonId: null, difficulty: null, rangesText: "1-4", categories: ["Qualification"], pattern: "rotate-each-match", intervalSize: null, scoutUids: ["a", "b"], prioritizedTeams: [100], seed: 7 },
  slots,
  counts: { a: 2, b: 2 },
  fair: true,
  warning: null,
  ...over,
});

describe("match assignments documents", () => {
  it("ids are the team and event, and the kind for the others", () => {
    expect(ftcAssignmentDocId("t", "EV")).toBe("t_EV");
    expect(ftcTeamAssignmentDocId("t", "EV", "pit")).toBe("t_EV_pit");
  });

  it("reads a published version with its settings, slots (two-robot alliances) and counts", () => {
    const v = readAssignmentVersion(stored());
    expect(v).toMatchObject({ generatedBy: "lead", fair: true, warning: null, counts: { a: 2, b: 2 } });
    expect(v?.slots).toHaveLength(4);
    expect(v?.settings).toEqual({ matchSource: "event", seasonId: null, difficulty: null, rangesText: "1-4", categories: ["Qualification"], pattern: "rotate-each-match", intervalSize: null, scoutUids: ["a", "b"], prioritizedTeams: [100], seed: 7 });
  });

  it("is tolerant: junk settings get neutral values, junk slots and counts are dropped, a non-map version is null", () => {
    const v = readAssignmentVersion({ slots: [{ matchType: "x" }, ...slots.slice(0, 1)], counts: { a: "2", b: 1 }, settings: { matchSource: "bogus", pattern: "x", categories: ["Qualification", 3], seed: "1" } });
    expect(v?.slots).toHaveLength(1);
    expect(v?.counts).toEqual({ b: 1 });
    expect(v?.settings).toMatchObject({ matchSource: "event", pattern: "rotate-each-match", categories: ["Qualification"], seed: 0 });
    expect(v).toMatchObject({ generatedBy: "", fair: true, warning: null });
    expect(readAssignmentVersion("nope")).toBeNull();
    expect(readAssignmentVersion(undefined)).toBeNull();
  });

  it("reads a doc with its current and previous versions", () => {
    const doc = ftcDocToAssignments("t_EV", { teamId: "t", eventCode: "EV", current: stored(), previous: stored({ generatedBy: "old" }) });
    expect(doc).toMatchObject({ id: "t_EV", teamId: "t", eventCode: "EV" });
    expect(doc.current?.generatedBy).toBe("lead");
    expect(doc.previous?.generatedBy).toBe("old");
    expect(ftcDocToAssignments("x", {})).toEqual({ id: "x", teamId: "", eventCode: "", current: null, previous: null });
  });

  it("finds the event's match doc among the rows of a team-and-event query, ignoring pit and team-strategy docs", () => {
    const rows = [
      { id: "t_EV_pit", data: { teamId: "t", eventCode: "EV", kind: "pit" } },
      { id: "t_EV", data: { teamId: "t", eventCode: "EV", current: stored() } },
    ];
    expect(pickMatchAssignments("t", "EV", rows)?.id).toBe("t_EV");
    expect(pickMatchAssignments("t", "EV", [rows[0]])).toBeNull();
    expect(pickMatchAssignments("t", "EV", [])).toBeNull();
  });

  it("lists only the pit and team-strategy docs of a team", () => {
    const team = { teamId: "t", eventCode: "EV", kind: "pit", current: { generatedBy: "l", generatedAt: "x", settings: {}, teams: [{ teamNumber: 5, scoutUids: ["a"] }], counts: {}, uneven: false, warning: null }, previous: null };
    const docs = ftcDocsToTeamAssignments([
      { id: "t_EV_pit", data: team },
      { id: "t_EV", data: { teamId: "t", eventCode: "EV" } },
      { id: "bad", data: null },
    ]);
    expect(docs.map((d) => [d.id, d.kind])).toEqual([["t_EV_pit", "pit"]]);
  });

  it("publishing makes the version current and the one it replaces previous", () => {
    const v = readAssignmentVersion(stored())!;
    expect(ftcAssignmentsDoc("t", "EV", v, null, () => "NOW")).toEqual({ teamId: "t", eventCode: "EV", current: v, previous: null, updatedAt: "NOW" });
  });
});

describe("applySlotSwap", () => {
  const v = readAssignmentVersion(stored())!;

  it("re-points a slot, recounts, and flags unfair counts", () => {
    const next = applySlotSwap(v, "Qualification", 1, "red1", "b")!;
    expect(next.slots.find((s) => s.slot === "red1")?.scoutUid).toBe("b");
    expect(next.counts).toEqual({ a: 1, b: 3 });
    expect(next.fair).toBe(false);
    expect(next.warning).toBe("Assignment counts range from 1 to 3 after this edit.");
  });

  it("clearing a slot lowers that scout's count and stays fair when the counts differ by at most one", () => {
    const next = applySlotSwap(v, "Qualification", 1, "blue1", null)!;
    expect(next.counts).toEqual({ a: 1, b: 2 });
    expect(next).toMatchObject({ fair: true, warning: null });
  });

  it("does not change the version it is given, and does nothing for a slot that is not there", () => {
    applySlotSwap(v, "Qualification", 1, "red1", "b");
    expect(v.counts).toEqual({ a: 2, b: 2 });
    expect(applySlotSwap(v, "Qualification", 9, "red1", "b")).toBeNull();
    expect(applySlotSwap(v, "Qualification", 1, "red3", "b")).toBeNull();
  });
});
