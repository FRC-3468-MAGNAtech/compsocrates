import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryMatch } from "@/lib/match-library";
import type { PracticeSession } from "@/lib/practice-sessions";
import type { ScoutEntry } from "@/lib/scout-entries";
import { SAMPLE_FORM } from "@/lib/forms/test-fixtures";
import { RESCORE_CHUNK_SIZE, RescoreApplyError, chunkWrites, runRescoreWrites } from "@/lib/admin/rescore-apply";
import { selectEventRescoreWrites, type EventRescorePatch } from "@/lib/analytics/recompute";

const writes = vi.hoisted(() => ({ session: [] as unknown[][], entry: [] as unknown[][], failEntryId: null as string | null }));
vi.mock("@/lib/practice-sessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/practice-sessions")>()),
  updatePracticeSession: vi.fn(async (...args: unknown[]) => {
    writes.session.push(args);
  }),
}));
vi.mock("@/lib/scout-entries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scout-entries")>()),
  updateEntry: vi.fn(async (...args: unknown[]) => {
    if (args[0] === writes.failEntryId) throw new Error("permission-denied");
    writes.entry.push(args);
  }),
}));

import { applySessionRescorePlan, buildSessionRescorePlan, keepDismissedFlags, summarizeSessionRescore, type SessionRescorePatch } from "@/lib/admin/rescore-sessions";

const resolveForm = () => SAMPLE_FORM;

function match(scoreKnown?: boolean): LibraryMatch {
  return {
    id: "M1", seasonId: "rebuilt", eventCode: "EV1", eventName: "Event", matchType: "Qualification", matchNumber: 1,
    alliances: {
      red: { teams: [100, 200], score: 100, penaltyPoints: 0, difficulty: "medium", ...(scoreKnown === undefined ? {} : { scoreKnown }) },
      blue: { teams: [300, 400], score: 50, penaltyPoints: 0, difficulty: "easy" },
    },
    video: null, importedAt: "2026-01-01T00:00:00.000Z", scoresUpdatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function session(id: string, over: Partial<PracticeSession> = {}): PracticeSession {
  return {
    id, teamId: "T1", uid: id, scoutName: id, kind: "solo", seasonId: "rebuilt", mode: "trial", difficulty: "medium", libraryMatchId: "M1", eventCode: "EV1", alliance: "red", robots: [100, 200],
    status: "completed", completedRobots: [100, 200], entryIds: [], accuracy: 50, scoutedTotal: 50, penaltyPoints: 0, officialScore: 100, platform: "pc", flags: [], excluded: false, lobbyId: null, pairId: null,
    startedAt: "2026-01-02T00:00:00.000Z", finishedAt: "2026-01-02T00:05:00.000Z", matchType: null, matchNumber: null, allianceTeams: null, streamUrl: null, streamStartSec: null, streamEndSec: null, ...over,
  } as PracticeSession;
}

function entry(id: string, sessionId: string, teamNumber: number, over: Partial<ScoutEntry> = {}): ScoutEntry {
  return {
    id, teamId: "T1", uid: id, source: "practice", mode: "trial", formId: "sample", formVersion: 1, scoutName: id, eventCode: "EV1", matchType: "Qualification", matchNumber: 1, teamNumber,
    values: { teleScoreA: 5 }, score: { auto: 0, teleop: 0, endgame: 0, total: 50 }, comments: "", submittedAt: "2026-01-02T00:00:00.000Z", excluded: false, autoFlags: [], manualFlags: [], accuracy: null,
    libraryMatchId: "M1", sessionId, ...over,
  } as ScoutEntry;
}

const entries = [entry("e1", "s1", 100), entry("e2", "s1", 200)];

beforeEach(() => {
  writes.session.length = 0;
  writes.entry.length = 0;
  writes.failEntryId = null;
});

describe("sessions with no official score", () => {
  it("are skipped (nothing is rewritten, never a 0) and counted", () => {
    const sessions = [session("s1")];
    const matches = new Map([["M1", match(false)]]);
    const plan = buildSessionRescorePlan(sessions, entries, matches, new Map(), {}, resolveForm);
    expect(plan).toHaveLength(0);
    expect(summarizeSessionRescore(sessions, plan, matches, {})).toMatchObject({ selected: 1, planned: 0, skippedNoOfficialScore: 1, skippedIncomplete: 0 });
  });

  it("a match whose score is known (or that never said, as in the default program) is rescored as before", () => {
    for (const known of [true, undefined]) {
      const matches = new Map([["M1", match(known)]]);
      const plan = buildSessionRescorePlan([session("s1")], entries, matches, new Map(), {}, resolveForm);
      expect(plan).toHaveLength(1);
      expect(plan[0].after).not.toBeNull();
    }
  });

  it("an incomplete session (an entry missing) is counted as incomplete, not as unscored", () => {
    const sessions = [session("s1")];
    const matches = new Map([["M1", match(true)]]);
    const plan = buildSessionRescorePlan(sessions, [entries[0]], matches, new Map(), {}, resolveForm);
    expect(summarizeSessionRescore(sessions, plan, matches, {})).toMatchObject({ planned: 0, skippedNoOfficialScore: 0, skippedIncomplete: 1 });
  });
});

describe("what a rescore writes", () => {
  it("only derived fields: session accuracy, totals and flags; entry score. Never the scouted values.", () => {
    const plan = buildSessionRescorePlan([session("s1")], entries, new Map([["M1", match(true)]]), new Map(), {}, resolveForm);
    for (const w of plan[0].sessionWrites) expect(Object.keys(w.patch).sort()).toEqual(["accuracy", "flags", "officialScore", "penaltyPoints", "scoutedTotal"]);
    for (const w of plan[0].entryWrites) expect(Object.keys(w.patch)).toEqual(["score"]);
  });

  it("an admin's dismissal survives when the flag is raised again (stores that keep flags on the session); the default is the evaluated flags as before", () => {
    const previous = [{ type: "zero-score", title: "Zero", detail: "", dismissed: true }] as PracticeSession["flags"];
    const raised = [
      { type: "zero-score", title: "Zero", detail: "", dismissed: false },
      { type: "other", title: "Other", detail: "", dismissed: false },
    ] as PracticeSession["flags"];
    expect(keepDismissedFlags(previous, raised).map((f) => [f.type, f.dismissed])).toEqual([["zero-score", true], ["other", false]]);
    expect(keepDismissedFlags([], raised)).toEqual(raised);
  });
});

describe("applying a plan", () => {
  const plan = (): SessionRescorePatch[] =>
    buildSessionRescorePlan([session("s1")], entries, new Map([["M1", match(true)]]), new Map(), {}, resolveForm);

  it("writes through the program it is given, to that program's store only", async () => {
    const { written } = await applySessionRescorePlan(plan(), undefined, "ftc");
    expect(written).toBeGreaterThan(0);
    expect(writes.session.every((a) => a[3] === "ftc")).toBe(true);
    expect(writes.entry.every((a) => a[3] === "ftc")).toBe(true);
  });

  it("the default program is written as before (the default program is the last argument)", async () => {
    await applySessionRescorePlan(plan());
    expect(writes.session.every((a) => a[3] === "frc")).toBe(true);
  });

  it("a failed write stops the run with exactly what went through, and re-running writes the rest", async () => {
    writes.failEntryId = "e2";
    await expect(applySessionRescorePlan(plan(), undefined, "ftc")).rejects.toMatchObject({ name: "RescoreApplyError", written: 2, total: 3 });
    const done = writes.session.length + writes.entry.length;
    expect(done).toBe(2);
    writes.failEntryId = null;
    await applySessionRescorePlan(plan(), undefined, "ftc"); // idempotent: the same values are written again
    expect(writes.session.length + writes.entry.length).toBe(2 + 3);
  });
});

describe("batching", () => {
  it("chunks of 400", () => {
    expect(RESCORE_CHUNK_SIZE).toBe(400);
    expect(chunkWrites(Array.from({ length: 1000 }, (_, i) => i)).map((c) => c.length)).toEqual([400, 400, 200]);
    expect(chunkWrites([])).toEqual([]);
  });

  it("runs chunk by chunk, reports progress, and stops after the chunk with a failure", async () => {
    const seen: number[] = [];
    const ok = Array.from({ length: 900 }, () => async () => {});
    await expect(runRescoreWrites(ok, (done) => seen.push(done))).resolves.toEqual({ written: 900 });
    expect(seen).toEqual([400, 800, 900]);

    let ran = 0;
    const second: (() => Promise<void>)[] = Array.from({ length: 900 }, (_, i) => async () => {
      ran++;
      if (i === 450) throw new Error("boom");
    });
    const err = await runRescoreWrites(second).catch((e) => e);
    expect(err).toBeInstanceOf(RescoreApplyError);
    expect(err).toMatchObject({ written: 799, total: 900 });
    expect(ran).toBe(800); // the third chunk never started
    expect(err.message).toContain("run it again");
  });
});

describe("event rescore with no official score", () => {
  const acc = (value: number | null) => ({ status: value === null ? "awaiting-results" : "complete", value, scoutedTotal: null }) as never;
  const patch = (id: string, before: number | null, after: number | null): EventRescorePatch => ({ entryId: id, matchLabel: "Q1", teamNumber: 1, before: acc(before), after: acc(after), autoFlags: [] });

  it("the default program writes everything, as always", () => {
    const patches = [patch("a", 0.9, 0.8), patch("b", 0.9, null)];
    expect(selectEventRescoreWrites(patches, false)).toEqual({ apply: patches, skippedNoOfficialScore: 0 });
  });

  it("a program with its own store leaves an entry whose official score is missing exactly as it is, and counts it", () => {
    const patches = [patch("a", 0.9, 0.8), patch("b", 0.9, null), patch("c", null, null)];
    const { apply, skippedNoOfficialScore } = selectEventRescoreWrites(patches, true);
    expect(apply.map((p) => p.entryId)).toEqual(["a"]);
    expect(skippedNoOfficialScore).toBe(2);
  });
});
