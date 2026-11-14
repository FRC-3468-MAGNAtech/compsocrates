import { describe, expect, it } from "vitest";
import { ftcDocsToScoutEntries, ftcDocToScoutEntry, isEventEntry, readAccuracy, readEntryValues, readScore, readStickyNotes, type FtcScoutEntryDoc } from "@/data/ftc/scouting";

const stored = (over: FtcScoutEntryDoc = {}): FtcScoutEntryDoc => ({
  teamId: "team-1",
  uid: "uid-ada",
  source: "event",
  mode: null,
  formId: "match-form",
  formVersion: 3,
  scoutName: "Ada",
  eventCode: "USTXAUS1",
  matchType: "Qualification",
  matchNumber: 12,
  teamNumber: 4242,
  values: { autoLeave: true, teleopPoints: 14 },
  score: { auto: 5, teleop: 14, endgame: 3, total: 22 },
  comments: "fast cycles",
  stickyNotes: [{ id: "n1", text: "fast cycles", color: "yellow", createdAt: 1 }],
  submittedAt: "2026-01-10T15:00:00.000Z",
  excluded: false,
  autoFlags: [{ ruleId: "no-teleop", dismissed: true }],
  manualFlags: [{ id: "f1", reason: "Duplicate entry", note: "twice", addedAt: "2026-01-10T16:00:00.000Z" }],
  accuracy: { status: "complete", value: 0.9, scoutedTotal: 22, penaltyPoints: 2, officialScore: 24 },
  sessionId: null,
  libraryMatchId: null,
  ...over,
});

describe("ftcDocToScoutEntry", () => {
  it("maps a stored entry", () => {
    const entry = ftcDocToScoutEntry("e1", stored());
    expect(entry).toMatchObject({
      id: "e1",
      teamId: "team-1",
      uid: "uid-ada",
      source: "event",
      mode: null,
      formId: "match-form",
      formVersion: 3,
      scoutName: "Ada",
      eventCode: "USTXAUS1",
      matchType: "Qualification",
      matchNumber: 12,
      teamNumber: 4242,
      values: { autoLeave: true, teleopPoints: 14 },
      score: { auto: 5, teleop: 14, endgame: 3, total: 22 },
      comments: "fast cycles",
      submittedAt: "2026-01-10T15:00:00.000Z",
      excluded: false,
      autoFlags: [{ ruleId: "no-teleop", dismissed: true }],
      manualFlags: [{ id: "f1", reason: "Duplicate entry", note: "twice", addedAt: "2026-01-10T16:00:00.000Z" }],
      accuracy: { status: "complete", value: 0.9, scoutedTotal: 22, penaltyPoints: 2, officialScore: 24 },
      sessionId: null,
      libraryMatchId: null,
    });
    expect(entry.stickyNotes).toHaveLength(1);
    // optional parts the doc does not have stay absent
    for (const key of ["scored", "alliance", "linkedEntryId", "planDifferences"]) expect(entry).not.toHaveProperty(key);
  });

  it("a sparse doc does not throw and gets neutral values", () => {
    const entry = ftcDocToScoutEntry("e2", {});
    expect(entry).toMatchObject({
      id: "e2",
      teamId: "",
      source: "event",
      mode: null,
      formId: "",
      formVersion: 0,
      matchType: "Qualification",
      matchNumber: 0,
      teamNumber: 0,
      score: { auto: 0, teleop: 0, endgame: 0, total: 0 },
      comments: "",
      submittedAt: "1970-01-01T00:00:00.000Z",
      excluded: false,
      autoFlags: [],
      manualFlags: [],
      accuracy: null,
      sessionId: null,
      libraryMatchId: null,
    });
    expect(entry).not.toHaveProperty("values");
  });

  it("an entry without `source` is an event entry; practice and live sessions keep theirs", () => {
    expect(isEventEntry(ftcDocToScoutEntry("a", stored({ source: undefined })))).toBe(true);
    const practice = ftcDocToScoutEntry("b", stored({ source: "practice", mode: "trial", sessionId: "s1", libraryMatchId: "lm1" }));
    expect(practice).toMatchObject({ source: "practice", mode: "trial", sessionId: "s1", libraryMatchId: "lm1" });
    expect(isEventEntry(practice)).toBe(false);
    expect(ftcDocToScoutEntry("c", stored({ source: "live" })).source).toBe("live");
    expect(ftcDocToScoutEntry("d", stored({ source: "bogus", mode: "bogus" }))).toMatchObject({ source: "event", mode: null });
  });

  it("falls back to createdAt for the submit time", () => {
    const entry = ftcDocToScoutEntry("e", stored({ submittedAt: "", createdAt: { toMillis: () => 1_700_000_000_000 } }));
    expect(entry.submittedAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("keeps the optional fields a lead or strategy-style entry carries", () => {
    const entry = ftcDocToScoutEntry("e", stored({ alliance: "red", linkedEntryId: "plan-1", planDifferences: 2, scored: false }));
    expect(entry).toMatchObject({ alliance: "red", linkedEntryId: "plan-1", planDifferences: 2, scored: false });
    expect(ftcDocToScoutEntry("e", stored({ alliance: "green", planDifferences: "2" }))).not.toHaveProperty("alliance");
  });

  it("drops malformed flags and notes instead of failing", () => {
    const entry = ftcDocToScoutEntry(
      "e",
      stored({
        autoFlags: [{ ruleId: "", dismissed: true }, "x", { ruleId: "ok" }],
        manualFlags: [{ id: "a" }, { reason: "Other" }, { id: "b", reason: "Other" }],
        stickyNotes: [{ id: "n", text: "t" }, { id: "m" }, 5],
      })
    );
    expect(entry.autoFlags).toEqual([{ ruleId: "ok", dismissed: false }]);
    expect(entry.manualFlags).toEqual([{ id: "b", reason: "Other", addedAt: "" }]);
    expect(entry.stickyNotes).toHaveLength(1);
  });
});

describe("readEntryValues (schema v1 entries)", () => {
  it("uses the stored values when there are some", () => {
    expect(readEntryValues({ values: { a: 1 }, fields: { b: 2 } })).toEqual({ a: 1 });
  });

  it("reads a pre-values entry as its typed fields plus the comments", () => {
    expect(readEntryValues({ fields: { autoLeave: true, teleTipHive: 2 }, comments: "ok" })).toEqual({ autoLeave: true, teleTipHive: 2, comments: "ok" });
    expect(readEntryValues({ fields: { autoLeave: true } })).toEqual({ autoLeave: true });
    const entry = ftcDocToScoutEntry("old", { teamId: "t", fields: { redCard: true }, comments: "bad" });
    expect(entry.values).toEqual({ redCard: true, comments: "bad" });
  });

  it("has no values when the doc has neither", () => {
    expect(readEntryValues({ comments: "x" })).toBeUndefined();
  });
});

describe("readScore / readAccuracy / readStickyNotes", () => {
  it("score numbers default to 0; byPhase only when it holds numbers", () => {
    expect(readScore({ auto: "5", teleop: 2 })).toEqual({ auto: 0, teleop: 2, endgame: 0, total: 0 });
    expect(readScore({ total: 9, byPhase: { custom: 4, bad: "x" } })).toMatchObject({ total: 9, byPhase: { custom: 4 } });
    expect(readScore({ byPhase: { bad: "x" } })).not.toHaveProperty("byPhase");
    expect(readScore(null)).toEqual({ auto: 0, teleop: 0, endgame: 0, total: 0 });
  });

  it("accuracy needs a known status; its numbers are null unless finite", () => {
    expect(readAccuracy({ status: "awaiting-results" })).toEqual({ status: "awaiting-results", value: null, scoutedTotal: null, penaltyPoints: null, officialScore: null });
    expect(readAccuracy({ status: "complete", value: 0, scoutedTotal: "9" })).toMatchObject({ value: 0, scoutedTotal: null });
    expect(readAccuracy({ status: "nope" })).toBeNull();
    expect(readAccuracy(undefined)).toBeNull();
  });

  it("sticky notes keep only maps with an id and text", () => {
    expect(readStickyNotes([{ id: "a", text: "" }, { text: "x" }, null])).toHaveLength(1);
    expect(readStickyNotes("nope")).toEqual([]);
  });
});

describe("ftcDocsToScoutEntries", () => {
  it("converts rows in order and skips bodies that are not maps", () => {
    const entries = ftcDocsToScoutEntries([
      { id: "1", data: stored({ matchNumber: 1 }) },
      { id: "x", data: null },
      { id: "2", data: stored({ matchNumber: 2 }) },
    ]);
    expect(entries.map((e) => [e.id, e.matchNumber])).toEqual([
      ["1", 1],
      ["2", 2],
    ]);
  });
});
