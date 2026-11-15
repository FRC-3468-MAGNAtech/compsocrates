import { describe, expect, it } from "vitest";
import { buildManualMatchDoc, bulkScheduleColumns, bulkScheduleTemplate, nextScheduleMatchNumber, scheduleMatchWarnings, summarizeBulkSchedule, validateBulkSchedule } from "@/lib/library/schedule";

const EVENT = { eventCode: "MAN-X-AAAA", eventName: "X", seasonId: "s" };
const m = { matchType: "Qualification" as const, matchNumber: 3, red: [1, 2], blue: [3, 4], scheduledTime: null };

describe("scheduled match entry, as CE did it", () => {
  it("the next number is one past the highest of the same type", () => {
    const list = [{ matchType: "Qualification" as const, matchNumber: 4 }, { matchType: "Qualification" as const, matchNumber: 2 }, { matchType: "Playoff" as const, matchNumber: 9 }];
    expect(nextScheduleMatchNumber(list, "Qualification")).toBe(5);
    expect(nextScheduleMatchNumber(list, "Practice")).toBe(1);
  });

  it("typed entry publishes at once; an import starts unpublished and needs review; an edit keeps both", () => {
    expect(buildManualMatchDoc(m, EVENT, null, "T", "u", "now", { newPublished: true, newNeedsReview: false })).toMatchObject({ published: true });
    expect(buildManualMatchDoc(m, EVENT, null, "T", "u", "now", { newPublished: true, newNeedsReview: false })).not.toHaveProperty("needsReview");
    expect(buildManualMatchDoc(m, EVENT, null, "T", "u", "now", { newPublished: false, newNeedsReview: true })).toMatchObject({ published: false, needsReview: true });
    const edit = buildManualMatchDoc(m, EVENT, { published: false, needsReview: true, createdBy: "a", createdAt: "c" }, "T", "u", "now", { newPublished: true, newNeedsReview: false });
    expect(edit).toMatchObject({ published: false, needsReview: true, createdBy: "a" });
  });

  it("warns when a match replaces one that exists", () => {
    expect(scheduleMatchWarnings(m, { eventCode: "MAN-X-AAAA", existing: [{ id: "MAN-X-AAAA_Q3" }] })[0]).toMatch(/Q3 already exists/);
    expect(scheduleMatchWarnings(m, { eventCode: "MAN-X-AAAA", existing: [] })).toEqual([]);
  });
});

describe("bulk paste", () => {
  const base = { eventCode: "EV", size: 2, defaultType: "Qualification" as const, existingIds: new Set<string>() };
  it("the template has a header and one example row for the alliance size", () => {
    expect(bulkScheduleColumns(2)).toEqual(["matchType", "matchNumber", "red1", "red2", "blue1", "blue2", "scheduledTime"]);
    expect(bulkScheduleTemplate(2).split("\n")[0]).toBe("matchType,matchNumber,red1,red2,blue1,blue2,scheduledTime");
  });
  it("reads a spreadsheet paste with a header in any order", () => {
    const r = validateBulkSchedule({ ...base, text: "number\tblue1\tblue2\tred1\tred2\ttype\n1\t3\t4\t1\t2\tQ\n2\t7\t8\t5\t6\tF" });
    expect(r.columnErrors).toEqual([]);
    expect(r.rows.map((x) => x.id)).toEqual(["EV_Q1", "EV_F2"]);
    expect(r.rows[0].match).toMatchObject({ red: [1, 2], blue: [3, 4] });
  });
  it("reads rows with no header, with or without the type column", () => {
    expect(validateBulkSchedule({ ...base, text: "Q,1,1,2,3,4\nQ,2,5,6,7,8" }).rows.map((x) => x.id)).toEqual(["EV_Q1", "EV_Q2"]);
    expect(validateBulkSchedule({ ...base, defaultType: "Practice", text: "1,1,2,3,4" }).rows.map((x) => x.id)).toEqual(["EV_P1"]);
    expect(validateBulkSchedule({ ...base, defaultType: null, text: "1,1,2,3,4" }).columnErrors[0]).toMatch(/default match type/);
  });
  it("reports bad rows without stopping the good ones, marks updates, and keeps the last of a repeated match", () => {
    const r = validateBulkSchedule({ ...base, existingIds: new Set(["EV_Q2"]), text: "matchType,matchNumber,red1,red2,blue1,blue2\nQ,1,1,2,3\nQ,2,1,2,3,4\nQ,3,1,2,3,4\nQ,3,5,6,7,8" });
    const s = summarizeBulkSchedule(r);
    expect(r.rows[0].errors.length).toBeGreaterThan(0);
    expect(r.rows[1].action).toBe("update");
    expect(r.rows[2].superseded).toBe(true);
    expect(s).toMatchObject({ total: 4, errors: 1, creates: 1, updates: 1, superseded: 1 });
    expect(s.importable.map((x) => `${x.matchNumber}:${x.red[0]}`)).toEqual(["2:1", "3:5"]);
  });
  it("names missing columns and empty input", () => {
    expect(validateBulkSchedule({ ...base, text: "matchType,matchNumber,red1,blue1\nQ,1,1,3" }).columnErrors[0]).toMatch(/Missing columns: red2, blue2/);
    expect(validateBulkSchedule({ ...base, text: "  " }).columnErrors[0]).toMatch(/Paste or choose/);
  });
});
