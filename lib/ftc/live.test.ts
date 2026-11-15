import { describe, expect, it } from "vitest";
import { diffKeys, ftcLiveEntryPatch, openLiveMatchKeys, readPresence } from "@/lib/ftc/live";
import type { AccuracyResult } from "@/lib/scout-entries";

const live = (over: Record<string, unknown> = {}) => ({ kind: "live" as const, status: "in-progress" as const, eventCode: "USTXHOU", matchType: "Qualification" as const, matchNumber: 7, ...over });

describe("openLiveMatchKeys: the match keys FTC derives from the team's own live sessions (replaces the collection-group query on `scouts`)", () => {
  it("one key per match, in a stable order, from open (in-progress or paused) live sessions", () => {
    const keys = openLiveMatchKeys([live(), live({ matchNumber: 3 }), live({ status: "paused", matchNumber: 7 }), live({ matchType: "Playoff", matchNumber: 1 })]);
    expect(keys).toEqual(["USTXHOU_F1", "USTXHOU_Q3", "USTXHOU_Q7"]);
  });

  it("ignores finished sessions (their scout has left the match), other kinds, and sessions with no match yet", () => {
    expect(
      openLiveMatchKeys([live({ status: "completed" }), live({ kind: "solo" }), live({ kind: "lobby" }), live({ eventCode: null }), live({ matchType: null }), live({ matchNumber: null })])
    ).toEqual([]);
  });

  it("match number 0 is a real match number, not a missing one", () => {
    expect(openLiveMatchKeys([live({ matchNumber: 0 })])).toEqual(["USTXHOU_Q0"]);
  });
});

describe("diffKeys", () => {
  it("adds the new keys and drops the ones nobody is on any more", () => {
    expect(diffKeys(new Set(["a", "b"]), ["b", "c"])).toEqual({ add: ["c"], remove: ["a"] });
    expect(diffKeys(new Set(), ["a"])).toEqual({ add: ["a"], remove: [] });
    expect(diffKeys(new Set(["a"]), [])).toEqual({ add: [], remove: ["a"] });
  });
});

describe("readPresence", () => {
  const ok = { uid: "u1", teamId: "T1", name: "Ana", robot: 8120, alliance: "blue", sessionId: "LV-ABC123", lastSeen: { toMillis: () => 5 } };

  it("reads a presence doc", () => {
    expect(readPresence(ok)).toEqual({ ...ok });
  });

  it("is tolerant: a missing name, robot or session reads as empty, an unknown alliance as red, a missing lastSeen as null", () => {
    expect(readPresence({ uid: "u1", teamId: "T1" })).toEqual({ uid: "u1", teamId: "T1", name: "", robot: 0, alliance: "red", sessionId: "", lastSeen: null });
  });

  it("is not a presence doc without a uid or a team", () => {
    expect(readPresence({ teamId: "T1" })).toBeNull();
    expect(readPresence({ uid: "u1" })).toBeNull();
    expect(readPresence(null)).toBeNull();
    expect(readPresence("x")).toBeNull();
  });
});

describe("ftcLiveEntryPatch: what the poller writes on a scout's entry", () => {
  const accuracy: AccuracyResult = { status: "complete", value: 0.9, scoutedTotal: 90, penaltyPoints: 4, officialScore: 100 };

  it("is the accuracy and the automatic flags, and nothing that identifies the entry", () => {
    expect(ftcLiveEntryPatch(accuracy, [{ ruleId: "zero-main-scoring", dismissed: false }])).toEqual({ accuracy, autoFlags: [{ ruleId: "zero-main-scoring", dismissed: false }] });
  });

  it("no flags is an empty list (the stored flags are replaced), never undefined", () => {
    expect(ftcLiveEntryPatch(accuracy, [])).toEqual({ accuracy, autoFlags: [] });
  });
});
