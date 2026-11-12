import { describe, expect, it } from "vitest";
import {
  applySessionExclusions,
  assignSessionOwners,
  csSessionToPractice,
  excludedSessionIds,
  mergeSessionsById,
  sessionBelongsToTeam,
} from "./practice";
import { computePracticeAverageAccuracy } from "@/lib/scout-stats/engine";

const base = { game: "REBUILT", mode: "trial", scoutId: "u1", scoutName: "Ada Lovelace", teamId: "TEAM1", accuracy: 80, completedAt: 1_700_000_000_000 };

describe("sessions saved without a team (old CS still counted them)", () => {
  it("belong to the team when the teamId is empty, missing or ours, and not when it names another team", () => {
    expect(sessionBelongsToTeam({ teamId: "" }, "TEAM1")).toBe(true);
    expect(sessionBelongsToTeam({}, "TEAM1")).toBe(true);
    expect(sessionBelongsToTeam({ teamId: "TEAM1" }, "TEAM1")).toBe(true);
    expect(sessionBelongsToTeam({ teamId: "OTHER" }, "TEAM1")).toBe(false);
  });

  it("are dropped without a fallback team and mapped with one", () => {
    const doc = { ...base, teamId: "" };
    expect(csSessionToPractice("s1", doc)).toBeNull();
    const s = csSessionToPractice("s1", doc, "TEAM1");
    expect(s?.teamId).toBe("TEAM1");
    expect(s?.accuracy).toBe(80);
  });
});

describe("sessions stored only by scout name", () => {
  it("go to the member with that name, case-insensitively, and never overwrite a stored uid", () => {
    const nameOnly = csSessionToPractice("a", { ...base, scoutId: "" }, "TEAM1")!;
    const withUid = csSessionToPractice("b", base, "TEAM1")!;
    const out = assignSessionOwners([nameOnly, withUid], [{ uid: "u9", name: "  ada lovelace " }]);
    expect(out[0].uid).toBe("u9");
    expect(out[1].uid).toBe("u1");
  });

  it("stay unowned when no member has that name", () => {
    const nameOnly = csSessionToPractice("a", { ...base, scoutId: "" }, "TEAM1")!;
    expect(assignSessionOwners([nameOnly], [{ uid: "u9", name: "Someone Else" }])[0].uid).toBe("");
  });
});

describe("exclusions and live sessions", () => {
  it("honors the session's own excludeFromAccuracy", () => {
    expect(csSessionToPractice("a", { ...base, excludeFromAccuracy: true })?.excluded).toBe(true);
    expect(csSessionToPractice("a", base)?.excluded).toBe(false);
  });

  it("reads exclusions from practiceSession flag states and applies them", () => {
    const ids = excludedSessionIds([
      { entityType: "practiceSession", entityId: "a", excludeFromAccuracy: true },
      { entityType: "practiceSession", entityId: "b", excludeFromAccuracy: false },
      { entityType: "scoutingEntry", entityId: "c", excludeFromAccuracy: true },
    ]);
    expect([...ids]).toEqual(["a"]);
    const sessions = ["a", "b"].map((id) => csSessionToPractice(id, base)!);
    expect(applySessionExclusions(sessions, ids).map((s) => s.excluded)).toEqual([true, false]);
  });

  it("marks CS live snapshots so accuracy can skip them", () => {
    expect(csSessionToPractice("a", { ...base, isLivePracticeScouting: true })?.csLive).toBe(true);
    expect(csSessionToPractice("a", base)?.csLive).toBe(false);
  });
});

describe("merging", () => {
  it("keeps the first copy of a session id", () => {
    const a = csSessionToPractice("same", base, "TEAM1")!;
    const b = { ...a, accuracy: 1 };
    const c = csSessionToPractice("other", base, "TEAM1")!;
    const merged = mergeSessionsById([a], [b, c]);
    expect(merged.map((s) => s.id)).toEqual(["same", "other"]);
    expect(merged[0].accuracy).toBe(80);
  });
});

describe("practice accuracy average (the engine side)", () => {
  const mk = (id: string, over: Record<string, unknown> = {}) => csSessionToPractice(id, { ...base, ...over }, "TEAM1")!;

  it("skips live sessions, excluded ones and sessions without a numeric accuracy; a missing accuracy is not a 0", () => {
    const sessions = [mk("a", { accuracy: 90 }), mk("b", { accuracy: 70 }), mk("c", { accuracy: undefined }), mk("d", { isLivePracticeScouting: true, accuracy: 10 }), mk("e", { excludeFromAccuracy: true, accuracy: 5 })];
    expect(computePracticeAverageAccuracy(sessions, "u1", "trial")).toBe(80);
  });

  it("is null when nothing qualifies", () => {
    expect(computePracticeAverageAccuracy([mk("a", { accuracy: undefined })], "u1", "trial")).toBeNull();
  });
});

describe("total entries (counted from the practice entries, not read off the sessions)", () => {
  const entry = (over: Record<string, unknown>) => ({ source: "practice", mode: "trial", uid: "u1", scoutName: "Ada Lovelace", game: "REBUILT", formId: "rebuilt", ...over }) as never;

  it("counts a scout's practice entries in the mode, by uid or by name, skipping live, other modes and other scouts", async () => {
    const { practiceEntryCount } = await import("@/lib/scout-stats/engine");
    const entries = [
      entry({}),
      entry({ uid: "", scoutName: "ada lovelace" }),
      entry({ source: "live" }),
      entry({ mode: "competitive" }),
      entry({ uid: "u2", scoutName: "Someone Else" }),
      entry({ source: "event" }),
    ];
    expect(practiceEntryCount(entries, "u1", "Ada Lovelace", "trial")).toBe(2);
  });

  it("filters by game when a game is chosen, and counts every game otherwise", async () => {
    const { practiceEntryCount } = await import("@/lib/scout-stats/engine");
    const entries = [entry({}), entry({ game: "REEFSCAPE", formId: "reefscape" })];
    expect(practiceEntryCount(entries, "u1", "Ada Lovelace", "trial", "rebuilt")).toBe(1);
    expect(practiceEntryCount(entries, "u1", "Ada Lovelace", "trial", null)).toBe(2);
  });

  it("is not zero for a session CS wrote (which carries no entry ids)", () => {
    expect(csSessionToPractice("s1", base, "TEAM1")?.entryIds).toEqual([]);
  });
});
