import { describe, expect, it } from "vitest";
import { buildMatchComparison, compareEntries, exemplarFor, groupComparisons, meanDiff, originalEntriesByKey, originalEntriesForMatch, practiceEntriesBySession } from "@/lib/analytics/rescout-compare";
import { rebuiltEntry } from "@/lib/analytics/cs-test-fixtures";
import { groupRescouts, toRescout } from "@/lib/analytics/rescouts";

const original = (id: string, team: string, o: Parameters<typeof rebuiltEntry>[1] = {}) => rebuiltEntry(id, { team, match: "q5", alliance: "red", ...o });
const exemplar = (id: string, team: string, o: Parameters<typeof rebuiltEntry>[1] = {}) => rebuiltEntry(id, { team, match: "q5", practice: true, ...o });
const rescout = (id: string, team: number, extra: Record<string, unknown> = {}) =>
  toRescout(id, { eventKey: "2026arli", matchKey: "q5", alliance: "red", teamNumber: team, status: "submitted", practiceSessionId: "S1", scoutedScore: 40, officialScore: 130, ...extra });

describe("entry lookups", () => {
  const entries = [
    original("o1", "254", { submittedAt: 2000 }),
    original("o1-early", "254", { submittedAt: 1000 }),
    original("o2", "1678", { alliance: undefined }),
    original("blue", "118", { alliance: "blue" }),
    original("o-other-match", "254", { match: "q6" }),
    exemplar("e1", "254"),
  ];

  it("takes the earliest real-event entry per robot for the match and alliance, accepting an unknown alliance", () => {
    const map = originalEntriesForMatch(entries, "2026ARLI", "Q5", "red");
    expect([...map.keys()].sort((a, b) => a - b)).toEqual([254, 1678]);
    expect(map.get(254)?.id).toBe("o1-early");
  });

  it("keys originals by alliance and ignores entries with no alliance (the verification lookup)", () => {
    const map = originalEntriesByKey(entries);
    expect(map.has("2026arli::q5::red::254")).toBe(true);
    expect(map.has("2026arli::q5::red::1678")).toBe(false);
    expect(map.has("2026arli::q5::blue::118")).toBe(true);
  });

  it("indexes practice entries by session and finds a robot's exemplar", () => {
    const sessions = practiceEntriesBySession(entries);
    expect(sessions.get("S1")?.map((e) => e.id)).toEqual(["e1"]);
    expect(exemplarFor({ practiceSessionId: "S1", teamNumber: 254 }, sessions)?.id).toBe("e1");
    expect(exemplarFor({ practiceSessionId: "S1", teamNumber: 9 }, sessions)).toBeNull();
    expect(exemplarFor({ practiceSessionId: "", teamNumber: 254 }, sessions)).toBeNull();
  });
});

describe("compareEntries", () => {
  it("is zero for identical scouting and grows with the differences", () => {
    const same = compareEntries(original("a", "254", { autoFuel: 10 }), exemplar("b", "254", { autoFuel: 10 }));
    expect(same?.diffPercent).toBe(0);
    const off = compareEntries(original("a", "254", { autoFuel: 10 }), exemplar("b", "254", { autoFuel: 20, status: "level-3" }));
    expect(off?.diffPercent).toBeGreaterThan(0);
    expect(off?.fields.find((f) => f.key === "auto.counterOverride")?.diff).toBe(1);
  });

  it("returns null when an entry's game cannot be rebuilt", () => {
    const other = { ...original("a", "254"), formId: "reefscape", game: "REEFSCAPE" as const };
    expect(compareEntries(other, exemplar("b", "254"))).toBeNull();
  });
});

describe("meanDiff", () => {
  it("averages to one decimal and is null for none", () => {
    expect(meanDiff([1, 2, 2])).toBe(1.7);
    expect(meanDiff([])).toBeNull();
  });
});

describe("buildMatchComparison", () => {
  const entries = [original("o1", "254", { autoFuel: 10 }), original("o2", "1678", { autoFuel: 10 }), exemplar("e1", "254", { autoFuel: 10 })];

  it("pairs each re-scouted robot with its original and exemplar and averages the differences", () => {
    const result = buildMatchComparison({ entries, rescouts: [rescout("r1", 254), rescout("r2", 1678)], eventKey: "2026arli", matchKey: "q5", alliance: "red" });
    expect(result.teams.map((t) => [t.teamNumber, t.robotLabel])).toEqual([
      [254, "Robot 1"],
      [1678, "Robot 2"],
    ]);
    expect(result.teams[0].original?.id).toBe("o1");
    expect(result.teams[0].exemplar?.id).toBe("e1");
    expect(result.teams[0].diff?.diffPercent).toBe(0);
    expect(result.teams[1].exemplar).toBeNull();
    expect(result.teams[1].diff).toBeNull();
    expect(result.summaryPercent).toBe(0);
  });

  it("falls back to the live scouting's robots when nothing is re-scouted", () => {
    const result = buildMatchComparison({ entries, rescouts: [], eventKey: "2026arli", matchKey: "q5", alliance: "red" });
    expect(result.teams.map((t) => t.teamNumber)).toEqual([254, 1678]);
    expect(result.summaryPercent).toBeNull();
  });

  it("ignores re-scouts of another match or alliance, and pending ones", () => {
    const result = buildMatchComparison({
      entries,
      rescouts: [rescout("r1", 254, { matchKey: "q6" }), rescout("r2", 1678, { alliance: "blue" }), rescout("r3", 9, { status: "pending", practiceSessionId: "" })],
      eventKey: "2026arli",
      matchKey: "q5",
      alliance: "red",
    });
    expect(result.teams.map((t) => t.teamNumber)).toEqual([254, 1678]); // fell back to the originals
  });
});

describe("groupComparisons", () => {
  it("only compares complete groups at or above the accuracy bar", () => {
    const entries = [1, 2, 3].flatMap((t) => [original(`o${t}`, String(t), { autoFuel: 10 }), exemplar(`e${t}`, String(t), { autoFuel: 10 })]);
    // all three exemplars live in session S1 but differ by team
    const rows = [1, 2, 3].map((t) => rescout(`r${t}`, t, { scoutedScore: 40, officialScore: 130, penaltyPoints: 10 }));
    const groups = groupRescouts(rows);
    const result = groupComparisons(groups.values(), originalEntriesByKey(entries), practiceEntriesBySession(entries), 95);
    // (3 x 40) + 10 = 130 against 130 -> 100%, identical entries -> 0%
    expect(result.get([...groups.keys()][0])).toEqual({ diffPercent: 0 });
    expect(groupComparisons(groups.values(), originalEntriesByKey(entries), practiceEntriesBySession(entries), 101).size).toBe(0);
  });
});
