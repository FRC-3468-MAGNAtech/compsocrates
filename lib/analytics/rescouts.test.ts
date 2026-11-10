import { describe, expect, it } from "vitest";
import {
  calculateRescoutAccuracy,
  groupRescouts,
  isDeletedRescout,
  isSubmittedRescout,
  planRescoutUpdates,
  rescoutedTeamKeys,
  toRescout,
  type GroupComparison,
  type Rescout,
} from "@/lib/analytics/rescouts";

const rescout = (o: Partial<Rescout> & { id: string; teamNumber: number }): Rescout =>
  toRescout(o.id, {
    teamId: "T1",
    eventKey: "2026arli",
    matchKey: "q5",
    alliance: "red",
    status: "submitted",
    scoutedScore: 30,
    officialScore: 100,
    penaltyPoints: 10,
    submittedAt: 1000,
    ...o,
  });

describe("toRescout", () => {
  it("reads a stored document tolerantly", () => {
    const r = toRescout("x", { teamNumber: "254", alliance: "Blue", accuracy: 97, criticalFlag: true, originalScouts: ["a", 5], createdAt: { toMillis: () => 42 } });
    expect(r.teamNumber).toBe(254);
    expect(r.alliance).toBe("blue");
    expect(r.accuracy).toBe(97);
    expect(r.criticalFlag).toBe(true);
    expect(r.originalScouts).toEqual(["a"]);
    expect(r.createdAt).toBe(42);
    expect(r.status).toBe("");
  });
  it("tells submitted and deleted rows apart", () => {
    expect(isSubmittedRescout(toRescout("a", { status: "submitted" }))).toBe(true);
    expect(isSubmittedRescout(toRescout("a", { status: "pending", practiceSessionId: "S1" }))).toBe(true);
    expect(isSubmittedRescout(toRescout("a", { status: "pending" }))).toBe(false);
    expect(isDeletedRescout(toRescout("a", { status: "Deleted" }))).toBe(true);
  });
});

describe("calculateRescoutAccuracy", () => {
  it("is whole percent, floored at zero, zero without an official score", () => {
    expect(calculateRescoutAccuracy(95, 100)).toBe(95);
    expect(calculateRescoutAccuracy(120, 100)).toBe(80);
    expect(calculateRescoutAccuracy(300, 100)).toBe(0);
    expect(calculateRescoutAccuracy(50, 0)).toBe(0);
  });
});

describe("groupRescouts", () => {
  const rows = [
    rescout({ id: "1", teamNumber: 1, scoutedScore: 30 }),
    rescout({ id: "2", teamNumber: 2, scoutedScore: 30 }),
    rescout({ id: "3", teamNumber: 3, scoutedScore: 30 }),
    // a later duplicate for team 3 loses to the earlier one
    rescout({ id: "4", teamNumber: 3, scoutedScore: 99, submittedAt: 2000 }),
    rescout({ id: "5", teamNumber: 9, alliance: "blue", scoutedScore: 5 }),
    toRescout("6", { teamNumber: 7, eventKey: "2026arli", matchKey: "q5", alliance: "red", status: "pending" }),
  ];
  const groups = groupRescouts(rows);

  it("groups submitted rows by event, match and alliance and ignores pending ones", () => {
    expect([...groups.keys()].sort()).toEqual(["2026arli::q5::blue", "2026arli::q5::red"]);
    const red = groups.get("2026arli::q5::red")!;
    expect(red.teamNumbers).toEqual([1, 2, 3]);
    expect(red.rescouts.find((r) => r.teamNumber === 3)?.id).toBe("3");
  });

  it("computes accuracy only when every robot is re-scouted: (90 + penalty) against the official score", () => {
    const red = groups.get("2026arli::q5::red")!;
    expect(red.complete).toBe(true);
    expect(red.totalScoutedScore).toBe(100);
    expect(red.accuracy).toBe(100);
    const blue = groups.get("2026arli::q5::blue")!;
    expect(blue.complete).toBe(false);
    expect(blue.accuracy).toBeNull();
  });
});

describe("planRescoutUpdates", () => {
  const complete = (accuracyRows: Partial<Rescout>) =>
    groupRescouts([1, 2, 3].map((t) => rescout({ id: `r${t}`, teamNumber: t, scoutedScore: 30, ...accuracyRows })));

  it("writes the group accuracy to rows that differ and nothing to rows that match", () => {
    const g = complete({});
    const plan = planRescoutUpdates(g.values(), new Map(), 5);
    expect(plan.filter((p) => "accuracy" in p.patch).map((p) => p.id).sort()).toEqual(["r1", "r2", "r3"]);
    const already = complete({ accuracy: 100 });
    expect(planRescoutUpdates(already.values(), new Map(), 5).filter((p) => "accuracy" in p.patch)).toEqual([]);
  });

  it("flags a 95%+ group as critical only when the difference is above 5%", () => {
    const g = complete({ accuracy: 100 });
    const key = [...g.keys()][0];
    const calm = planRescoutUpdates(g.values(), new Map<string, GroupComparison>([[key, { diffPercent: 5 }]]), 7);
    expect(calm.every((p) => p.patch.criticalFlag === false && p.patch.comparisonDiffPercent === 5 && p.patch.comparisonComputedAt === 7)).toBe(true);
    const hot = planRescoutUpdates(g.values(), new Map<string, GroupComparison>([[key, { diffPercent: 5.1 }]]), 7);
    expect(hot.every((p) => p.patch.criticalFlag === true)).toBe(true);
  });

  it("does not rewrite rows that already hold the result, and clears flags below 95%", () => {
    const done = complete({ accuracy: 100, criticalFlag: true, comparisonDiffPercent: 9 });
    const key = [...done.keys()][0];
    expect(planRescoutUpdates(done.values(), new Map([[key, { diffPercent: 9 }]]), 1)).toEqual([]);
    const low = groupRescouts([1, 2, 3].map((t) => rescout({ id: `r${t}`, teamNumber: t, scoutedScore: 10, accuracy: 40, criticalFlag: true })));
    const plan = planRescoutUpdates(low.values(), new Map(), 1);
    expect(plan.filter((p) => p.patch.criticalFlag === false)).toHaveLength(3);
  });

  it("leaves incomplete groups alone", () => {
    const g = groupRescouts([rescout({ id: "a", teamNumber: 1 })]);
    expect(planRescoutUpdates(g.values(), new Map(), 1)).toEqual([]);
  });
});

describe("rescoutedTeamKeys", () => {
  it("lists re-scouted robots, but frees those of a finished group that missed the compare accuracy", () => {
    const good = groupRescouts([1, 2, 3].map((t) => rescout({ id: `g${t}`, teamNumber: t, scoutedScore: 30 })));
    expect([...rescoutedTeamKeys([1, 2, 3].map((t) => rescout({ id: `g${t}`, teamNumber: t })), good.values())].sort()).toEqual(["2026arli::q5::1", "2026arli::q5::2", "2026arli::q5::3"]);
    const rows = [1, 2, 3].map((t) => rescout({ id: `b${t}`, teamNumber: t, scoutedScore: 5 }));
    expect(rescoutedTeamKeys(rows, groupRescouts(rows).values()).size).toBe(0);
    const partial = [rescout({ id: "p", teamNumber: 4 })];
    expect([...rescoutedTeamKeys(partial, groupRescouts(partial).values())]).toEqual(["2026arli::q5::4"]);
  });
});
