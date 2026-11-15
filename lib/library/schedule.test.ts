import { describe, expect, it } from "vitest";
import { emptyRawMatch, matchToRaw, validateRawMatch } from "@/lib/library/manual-match";
import { validateBulk, summarizeBulk, bulkTemplateCsv } from "@/lib/library/bulk";
import { buildManualMatchDoc, importMessage, scheduleInputFromValid } from "@/lib/library/schedule";

const EVENT = { eventCode: "MAN-X-AAAA", eventName: "X", seasonId: "s" };
const m = { matchType: "Qualification" as const, matchNumber: 3, red: [1, 2], blue: [3, 4], scheduledTime: null };
const raw = { ...emptyRawMatch(), matchNumber: "3", red1: "1", red2: "2", blue1: "3", blue2: "4" };
const opts = { allianceSize: 2, scoresRequired: false };

describe("scheduled match docs", () => {
  it("typed entry publishes at once; an import starts unpublished and needs review; an edit keeps both", () => {
    expect(buildManualMatchDoc(m, EVENT, null, "T", "u", "now", { newPublished: true, newNeedsReview: false })).toMatchObject({ published: true });
    expect(buildManualMatchDoc(m, EVENT, null, "T", "u", "now", { newPublished: true, newNeedsReview: false })).not.toHaveProperty("needsReview");
    expect(buildManualMatchDoc(m, EVENT, null, "T", "u", "now", { newPublished: false, newNeedsReview: true })).toMatchObject({ published: false, needsReview: true });
    const edit = buildManualMatchDoc(m, EVENT, { published: false, needsReview: true, createdBy: "a", createdAt: "c" }, "T", "u", "now", { newPublished: true, newNeedsReview: false });
    expect(edit).toMatchObject({ published: false, needsReview: true, createdBy: "a" });
  });
});

describe("the shared dialog's match becomes a schedule doc", () => {
  const valid = (over = {}) => validateRawMatch({ ...raw, ...over }, opts).match!;
  const existing = { alliances: { red: { teams: [9, 9], score: 50, penaltyPoints: 2 }, blue: { teams: [8, 8], score: 40, penaltyPoints: 0 } }, scoresUpdatedAt: "then", scheduledTime: "2026-01-01T00:00:00.000Z", video: { youtubeUrl: "keep" } };

  it("typed scores are stored with the teams; a blank score leaves the score fields out (never 0)", () => {
    const doc = buildManualMatchDoc(scheduleInputFromValid(valid({ redScore: "70", redPenalty: "5" })), EVENT, null, "T", "u", "now");
    expect(doc.alliances).toEqual({ red: { teams: [1, 2], score: 70, penaltyPoints: 5 }, blue: { teams: [3, 4] } });
    expect(doc.scoresUpdatedAt).toBe("now");
  });

  it("editing with blank scores clears them; fast entry and bulk import (keepScores) keep the stored official score, video and time", () => {
    const cleared = buildManualMatchDoc(scheduleInputFromValid(valid()), EVENT, existing, "T", "u", "now");
    expect(cleared.alliances).toEqual({ red: { teams: [1, 2] }, blue: { teams: [3, 4] } });
    expect(cleared).not.toHaveProperty("scoresUpdatedAt");
    const kept = buildManualMatchDoc(scheduleInputFromValid({ ...valid(), video: null }, { keepScores: true }), EVENT, existing, "T", "u", "now");
    expect(kept.alliances).toEqual({ red: { teams: [1, 2], score: 50, penaltyPoints: 2 }, blue: { teams: [3, 4], score: 40, penaltyPoints: 0 } });
    expect(kept.scoresUpdatedAt).toBe("then");
    expect(kept.scheduledTime).toBe("2026-01-01T00:00:00.000Z");
  });

  it("a time typed in the dialog is stored; a video and notes ride along", () => {
    const doc = buildManualMatchDoc(scheduleInputFromValid(valid({ scheduledTime: "2026-11-15T09:30", youtubeUrl: "https://youtu.be/dQw4w9WgXcQ", notes: "n" })), EVENT, existing, "T", "u", "now");
    expect(doc.scheduledTime).toMatch(/^2026-11-15T/);
    expect(doc.video).toMatchObject({ youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    expect(doc.notes).toBe("n");
  });

  it("an unscored stored match edits back to blank score boxes, never 0", () => {
    const back = matchToRaw({ matchType: "Qualification", matchNumber: 3, alliances: { red: { teams: [1, 2], score: 0, penaltyPoints: 0, scoreKnown: false }, blue: { teams: [3, 4], score: 0, penaltyPoints: 0, scoreKnown: false } }, video: null }, true);
    expect([back.redScore, back.blueScore, back.redPenalty]).toEqual(["", "", ""]);
    expect(back.scheduledTime).toBe("");
  });
});

describe("bulk paste with two robots and optional scores", () => {
  const base = { event: { eventCode: "EV" }, defaults: { matchType: "Qualification" as const, youtubeUrl: "" }, existing: new Map<string, { origin?: unknown }>(), allianceSize: 2, scoresRequired: false };
  it("the template has red1, red2, blue1, blue2 and no red3 / blue3", () => {
    const header = bulkTemplateCsv(2, false).split("\n")[0];
    expect(header).toContain("red2");
    expect(header).not.toContain("red3");
    expect(header).not.toContain("blue3");
  });
  it("rows with no scores are valid; ids are the stable ${event}_${type}${n}; the same text twice gives the same ids", () => {
    const text = "matchType,matchNumber,red1,red2,blue1,blue2\nQ,1,1,2,3,4\nQ,2,5,6,7,8";
    const a = summarizeBulk(validateBulk({ ...base, text }));
    const b = summarizeBulk(validateBulk({ ...base, text }));
    expect(a.errors).toBe(0);
    expect(a.importable.map((r) => r.id)).toEqual(["EV_Q1", "EV_Q2"]);
    expect(b.importable.map((r) => r.id)).toEqual(a.importable.map((r) => r.id));
  });
  it("names a missing team column, and a program that requires scores still wants the score columns", () => {
    expect(validateBulk({ ...base, text: "matchType,matchNumber,red1,blue1\nQ,1,1,3" }).columnErrors.join(" ")).toMatch(/red2/);
    expect(validateBulk({ ...base, scoresRequired: true, text: "matchType,matchNumber,red1,red2,blue1,blue2\nQ,1,1,2,3,4" }).columnErrors.join(" ")).toMatch(/redScore/);
  });
});

describe("the import sentence", () => {
  const s = { eventCode: "EV", eventName: "Event", written: 2, skipped: 1, skippedReason: "without posted scores", skippedManual: [] as string[] };
  it("is the default program's sentence, with the program's reason and extra line", () => {
    expect(importMessage(s)).toBe("Event: imported 2 matches, skipped 1 without posted scores.");
    expect(importMessage({ ...s, written: 1, skippedManual: ["EV_Q1"], detail: "1 new." })).toBe("Event: imported 1 match, skipped 1 without posted scores. Left 1 manual match untouched (EV_Q1). 1 new.");
  });
});
