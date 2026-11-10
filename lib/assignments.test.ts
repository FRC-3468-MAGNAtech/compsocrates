import { describe, expect, it } from "vitest";
import { evaluateSlotSwap, parseAssignmentsDoc, type AssignmentVersion } from "./assignments";

function baseVersion(overrides: Partial<AssignmentVersion> = {}): AssignmentVersion {
  return {
    generatedBy: "admin-1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    settings: {
      matchSource: "event",
      seasonId: null,
      difficulty: null,
      rangesText: "",
      categories: ["Qualification"],
      pattern: "rotate-each-match",
      intervalSize: null,
      scoutUids: ["a", "b"],
      prioritizedTeams: [],
      seed: 1,
    },
    slots: [
      { matchType: "Qualification", matchNumber: 1, slot: "red1", teamNumber: 100, scoutUid: "a" },
      { matchType: "Qualification", matchNumber: 1, slot: "red2", teamNumber: 200, scoutUid: "b" },
    ],
    counts: { a: 1, b: 1 },
    fair: true,
    warning: null,
    ...overrides,
  };
}

describe("evaluateSlotSwap", () => {
  it("has no warnings for a clean swap", () => {
    const { warnings } = evaluateSlotSwap(baseVersion(), "Qualification", 1, "red1", "a");
    expect(warnings).toHaveLength(0);
  });

  it("warns about double-booking the same scout in one match", () => {
    const { warnings } = evaluateSlotSwap(baseVersion(), "Qualification", 1, "red1", "b");
    expect(warnings.some((w) => w.includes("already assigned"))).toBe(true);
  });

  it("warns when the swap would unbalance counts by more than 1", () => {
    const version = baseVersion({
      slots: [
        { matchType: "Qualification", matchNumber: 1, slot: "red1", teamNumber: 100, scoutUid: "a" },
        { matchType: "Qualification", matchNumber: 1, slot: "red2", teamNumber: 200, scoutUid: "b" },
        { matchType: "Qualification", matchNumber: 2, slot: "red1", teamNumber: 100, scoutUid: "a" },
      ],
      counts: { a: 2, b: 1 },
    });
    const { warnings } = evaluateSlotSwap(version, "Qualification", 1, "red2", "a");
    expect(warnings.some((w) => w.includes("uneven"))).toBe(true);
  });

  it("has no warnings when clearing a slot", () => {
    const { warnings } = evaluateSlotSwap(baseVersion(), "Qualification", 1, "red1", null);
    expect(warnings).toHaveLength(0);
  });
});

describe("evaluateSlotSwap — third slot", () => {
  it("warns about double-booking a scout across red3 and another slot in the same match", () => {
    const version = baseVersion({
      slots: [
        { matchType: "Qualification", matchNumber: 1, slot: "red1", teamNumber: 100, scoutUid: "a" },
        { matchType: "Qualification", matchNumber: 1, slot: "red3", teamNumber: 300, scoutUid: "c" },
      ],
      counts: { a: 1, c: 1 },
    });
    expect(evaluateSlotSwap(version, "Qualification", 1, "red3", "a").warnings.some((w) => w.includes("already assigned"))).toBe(true);
    expect(evaluateSlotSwap(version, "Qualification", 1, "blue3", "c").warnings.some((w) => w.includes("already assigned"))).toBe(true);
  });
});

describe("parseAssignmentsDoc", () => {
  const legacy = {
    teamId: "t1",
    eventCode: "EVT",
    current: {
      generatedBy: "admin-1",
      generatedAt: "2026-01-01T00:00:00.000Z",
      settings: {},
      slots: [
        { matchType: "Qualification", matchNumber: 1, slot: "red1", teamNumber: 100, scoutUid: "a" },
        { matchType: "Qualification", matchNumber: 1, slot: "red2", teamNumber: 200, scoutUid: null },
        { matchType: "Qualification", matchNumber: 1, slot: "blue1", teamNumber: 300, scoutUid: "b" },
        { matchType: "Qualification", matchNumber: 1, slot: "blue2", teamNumber: 400, scoutUid: "c" },
      ],
      counts: { a: 1, b: 1, c: 1 },
      fair: true,
      warning: null,
    },
    previous: null,
  };

  it("reads a legacy 2-slot-per-alliance doc unchanged", () => {
    const doc = parseAssignmentsDoc("t1_EVT", legacy);
    expect(doc.current?.slots.map((s) => s.slot)).toEqual(["red1", "red2", "blue1", "blue2"]);
    expect(doc.current?.slots[1].scoutUid).toBeNull();
    expect(doc.previous).toBeNull();
    expect(doc.id).toBe("t1_EVT");
  });

  it("reads a 3-slot-per-alliance doc", () => {
    const slots = [...legacy.current.slots, { matchType: "Qualification", matchNumber: 1, slot: "red3", teamNumber: 500, scoutUid: "d" }, { matchType: "Qualification", matchNumber: 1, slot: "blue3", teamNumber: 600, scoutUid: "e" }];
    const doc = parseAssignmentsDoc("t1_EVT", { ...legacy, current: { ...legacy.current, slots }, previous: { ...legacy.current, slots: legacy.current.slots } });
    expect(doc.current?.slots.map((s) => s.slot)).toContain("red3");
    expect(doc.current?.slots.map((s) => s.slot)).toContain("blue3");
    expect(doc.current?.slots).toHaveLength(6);
    expect(doc.previous?.slots).toHaveLength(4);
  });

  it("drops malformed slots instead of throwing", () => {
    const doc = parseAssignmentsDoc("t1_EVT", { ...legacy, current: { ...legacy.current, slots: [...legacy.current.slots, { slot: "left1" }, null, { matchType: "Qualification", matchNumber: 1, slot: "red9x", teamNumber: 1 }] } });
    expect(doc.current?.slots).toHaveLength(4);
  });
});
