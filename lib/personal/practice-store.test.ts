import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/client", () => ({ db: {}, isFirebaseConfigured: () => false }));

import { personalEntryDoc, toPersonalEntry, toPersonalSession } from "@/lib/personal/practice-store";
import { practiceOutcome } from "@/lib/practice-outcome";
import { personalScopeUid, setPersonalScope } from "@/lib/personal/scope";
import type { SaveEntryInput } from "@/lib/scout-entries";

const INPUT = {
  scoutName: "Ada",
  eventCode: "2026x",
  matchType: "Qualification",
  matchNumber: 3,
  teamNumber: 254,
  formId: "f",
  formVersion: 1,
  values: { a: 1 },
  score: { auto: 1, teleop: 2, endgame: 3, total: 6 },
  comments: "",
  source: "practice",
  mode: "trial",
  sessionId: "PS-ABC123",
  libraryMatchId: "M1",
  gate: { seasonId: "s" },
} as unknown as SaveEntryInput;

describe("a personal practice document never carries a team", () => {
  it("the entry document has no teamId key, no gate, and is the person's own", () => {
    const doc = personalEntryDoc("u1", { ...INPUT, teamId: "SNEAKY" } as unknown as SaveEntryInput, "2026-01-01T00:00:00.000Z");
    expect(doc).not.toHaveProperty("teamId");
    expect(doc).not.toHaveProperty("gate");
    expect(doc).toMatchObject({ uid: "u1", source: "practice", sessionId: "PS-ABC123", excluded: false, accuracy: null, submittedAt: "2026-01-01T00:00:00.000Z" });
    expect(Object.values(doc).includes(undefined)).toBe(false);
  });

  it("a stored session reads as a session with an in-memory empty team id, safe defaults, and never throws", () => {
    const s = toPersonalSession("PS-1", { uid: "u1", status: "completed", accuracy: 0.8, robots: [1, 2], mode: "competitive" });
    expect(s).toMatchObject({ id: "PS-1", teamId: "", uid: "u1", kind: "solo", status: "completed", accuracy: 0.8, robots: [1, 2], mode: "competitive", flags: [], completedRobots: [] });
    expect(toPersonalSession("PS-2", {})).toMatchObject({ status: "in-progress", accuracy: null, officialScore: null, finishedAt: null });
    expect(toPersonalSession("PS-3", { accuracy: "bad", robots: "x" })).toMatchObject({ accuracy: null, robots: [] });
  });

  it("a stored entry reads as an entry with the document's own id", () => {
    expect(toPersonalEntry("E1", { uid: "u1", teamNumber: 254, submittedAt: "t" })).toMatchObject({ id: "E1", teamId: "", uid: "u1", excluded: false, autoFlags: [] });
  });
});

describe("accuracy in personal practice is the shared outcome code against the official score", () => {
  it("is a number against a known official score, and null (never 0) with none", () => {
    const known = practiceOutcome({ robotScores: [10, 10], official: { score: 20, penaltyPoints: 0, scoreKnown: true }, scoringEnabled: true });
    expect(known.accuracy).not.toBeNull();
    const unknown = practiceOutcome({ robotScores: [10, 10], official: { score: 0, penaltyPoints: 0, scoreKnown: false }, scoringEnabled: true });
    expect(unknown.accuracy).toBeNull();
    expect(unknown.officialScore).toBeNull();
  });
});

describe("the personal scope", () => {
  it("is off by default and set and cleared by the shell", () => {
    expect(personalScopeUid()).toBeNull();
    setPersonalScope("u1");
    expect(personalScopeUid()).toBe("u1");
    setPersonalScope(null);
    expect(personalScopeUid()).toBeNull();
  });
});
