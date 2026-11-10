import { describe, expect, it } from "vitest";
import { highAccuracyMatches, leadVerificationRows, rescoutGame, scheduleAlliances, toLeadLog } from "@/lib/analytics/accuracy-verification";
import { analyticsEntry, rebuiltEntry } from "@/lib/analytics/cs-test-fixtures";
import { entryToDoc } from "@/lib/analytics/cs-docs";
import type { OfficialMatch } from "@/lib/analytics/match-breakdown";

// A lead log is a full scouting document as the form writes it (with the stored per-section fuel), so it is built through the plugin.
const lead = (id: string, o: Parameters<typeof rebuiltEntry>[1] = {}, extra: Record<string, unknown> = {}) => {
  const doc = entryToDoc(rebuiltEntry(id, { match: "q5", ...o }))!;
  const log = toLeadLog(id, { ...doc, entryType: "lead", isLeadScouting: true, ...extra });
  if (!log) throw new Error("fixture lead log was rejected");
  return log;
};
const junior = (id: string, o: Parameters<typeof rebuiltEntry>[1] = {}) => {
  const entry = rebuiltEntry(id, { match: "q5", ...o });
  return { entry, doc: entryToDoc(entry)! };
};

describe("toLeadLog", () => {
  it("normalises the event and match and rejects rows that name neither", () => {
    const log = toLeadLog("a", { eventKey: "2026ARLI", matchLabel: "Qualification 12", submittedAt: 5 });
    expect(log?.eventKey).toBe("2026arli");
    expect(log?.matchId).toBe("q12");
    expect(log?.time).toBe(5);
    expect(toLeadLog("b", { eventKey: "2026arli" })).toBeNull();
    expect(toLeadLog("c", { matchId: "q1" })).toBeNull();
  });
});

describe("leadVerificationRows", () => {
  it("verifies a junior who matches the lead on at least 85% of the metrics", () => {
    const rows = leadVerificationRows([junior("j", { autoFuel: 10, teleFuel: 20, endFuel: 5, status: "level-2" })], [lead("l", { autoFuel: 11, teleFuel: 22, endFuel: 5, status: "level-2" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].result.verified).toBe(true);
    expect(rows[0].result.accuracy).toBe(100);
  });

  it("flags a junior outside the tolerances for review and names the mismatches", () => {
    const [row] = leadVerificationRows([junior("j", { autoFuel: 10, teleFuel: 20 })], [lead("l", { autoFuel: 30, teleFuel: 60, status: "level-3" })]);
    expect(row.result.verified).toBe(false);
    expect(row.result.mismatches.map((m) => m.label)).toEqual(expect.arrayContaining(["Auto Fuel", "Teleop Fuel", "Endgame Status"]));
  });

  it("pairs by event and match only, takes the latest lead log, orders by accuracy and caps the list", () => {
    const juniors = [junior("a", { autoFuel: 10, match: "q5" }), junior("b", { autoFuel: 10, match: "q6" }), junior("c", { autoFuel: 10, match: "q5", event: "2026lake" })];
    const leads = [lead("old", { autoFuel: 99 }), lead("new", { autoFuel: 10 }, { submittedAt: 1_800_000_000_000 }), lead("q6", { autoFuel: 99, match: "q6" })];
    const rows = leadVerificationRows(juniors, leads);
    expect(rows.map((r) => r.entry.id)).toEqual(["a", "b"]);
    expect(rows[0].result.accuracy).toBeGreaterThan(rows[1].result.accuracy);
    expect(leadVerificationRows(juniors, leads, 1)).toHaveLength(1);
  });

  it("returns nothing without a lead log", () => {
    expect(leadVerificationRows([junior("a")], [])).toEqual([]);
  });
});

describe("highAccuracyMatches", () => {
  const names = (code: string) => (code === "2026arli" ? "Arkansas" : code);
  const trio = (alliance: "red" | "blue" | undefined, accuracy: number | null, match = "q5") =>
    [1, 2, 3].map((t, i) => analyticsEntry(`${alliance ?? "x"}${match}${t}`, { team: String(t + (alliance === "blue" ? 10 : 0)), match, alliance, scout: `Scout${i}` }, accuracy));

  it("offers a full alliance at 75% or better", () => {
    const [match] = highAccuracyMatches(trio("red", 80), new Map(), names);
    expect(match.eventName).toBe("Arkansas");
    expect(match.matchLabel).toBe("Qualification 5");
    expect(match.alliances).toHaveLength(1);
    expect(match.alliances[0]).toMatchObject({ alliance: "red", teams: [1, 2, 3], accuracy: 80 });
    expect(match.matchAccuracy).toBe(80);
  });

  it("rejects an alliance below 75%, one missing a robot, and one with no known accuracy", () => {
    expect(highAccuracyMatches(trio("red", 74), new Map(), names)).toEqual([]);
    expect(highAccuracyMatches(trio("red", 90).slice(0, 2), new Map(), names)).toEqual([]);
    expect(highAccuracyMatches(trio("red", null), new Map(), names)).toEqual([]);
  });

  it("places an entry with no alliance by the schedule", () => {
    const matches: OfficialMatch[] = [{ eventCode: "2026arli", matchType: "Qualification", matchNumber: 5, played: true, red: { teams: [1, 2, 3], score: 100, penaltyPoints: 0 }, blue: { teams: [11, 12, 13], score: 90, penaltyPoints: 0 } }];
    const found = highAccuracyMatches(trio(undefined, 88), scheduleAlliances(matches), names);
    expect(found[0].alliances[0].alliance).toBe("red");
    expect(highAccuracyMatches(trio(undefined, 88), new Map(), names)).toEqual([]);
  });

  it("orders by accuracy, then event, then later matches first", () => {
    const list = highAccuracyMatches([...trio("red", 80, "q5"), ...trio("red", 95, "q2"), ...trio("blue", 80, "q9")], new Map(), names);
    expect(list.map((m) => m.matchKey)).toEqual(["q2", "q9", "q5"]);
  });

  it("ignores practice-session entries", () => {
    const practice = trio("red", 90).map((e) => ({ ...e, source: "practice" as const }));
    expect(highAccuracyMatches(practice, new Map(), names)).toEqual([]);
  });
});

describe("rescoutGame", () => {
  it("uses the entries' game, else the current one", () => {
    expect(rescoutGame([{ game: undefined }, { game: "REBUILT" }])).toBe("REBUILT");
    expect(rescoutGame([])).toBe("REBUILT");
  });
});
