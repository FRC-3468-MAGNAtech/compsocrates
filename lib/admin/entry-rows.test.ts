import { describe, expect, it } from "vitest";
import { buildEntryRows, entryEvents, entryFormKeys, filterEntryRows, MATCH_SCOUT_KEY } from "@/lib/admin/entry-rows";
import { FORM_TYPES } from "@/lib/forms/types";
import type { FormEntry } from "@/lib/form-entries-model";
import type { ScoutEntry } from "@/lib/scout-entries";

const scout = (id: string, over: Partial<ScoutEntry> = {}) =>
  ({ id, teamId: "t", uid: "u", source: "event", mode: null, formId: "rebuilt", formVersion: 1, scoutName: "Ada", eventCode: "2026a", matchType: "Qualification", matchNumber: 5, teamNumber: 254, score: { auto: 0, teleop: 0, endgame: 0, total: 0 }, comments: "", submittedAt: "2026-03-01T10:00:00.000Z", excluded: false, autoFlags: [], manualFlags: [], accuracy: null, sessionId: null, libraryMatchId: null, ...over }) as ScoutEntry;
const form = (id: string, over: Partial<FormEntry> = {}) =>
  ({ id, teamId: "t", uid: "u", scoutName: "Bo", formId: "pit-scout-v1", formVersion: 1, formType: "pit-scout", eventCode: "2026b", teamNumber: 111, values: {}, stickyNotes: [], flags: [], excluded: false, createdAtMs: Date.parse("2026-03-02T10:00:00.000Z"), updatedAtMs: 0, ...over }) as FormEntry;

describe("admin entry rows", () => {
  const rows = buildEntryRows([scout("s1"), scout("s2", { source: "practice", sessionId: "x" }), scout("s3", { source: "live" })], [form("f1"), form("f2", { formType: "lead-scout", matchKey: "Q3", teamNumber: null, createdAtMs: 1 })]);

  it("lists match scout and every other form together, newest first, and leaves practice to Sessions", () => {
    expect(rows.map((r) => r.key)).toEqual(["form:f1", "scout:s1", "form:f2"]);
    expect(rows[1]).toMatchObject({ kind: "scout", match: "Q5", teamNumber: 254, formKey: MATCH_SCOUT_KEY });
    expect(rows[2]).toMatchObject({ kind: "form", match: "Q3", teamNumber: null, formKey: "lead-scout" });
  });

  it("can include practice entries", () => {
    expect(buildEntryRows([scout("s1"), scout("s2", { source: "practice" })], [], { includePractice: true })).toHaveLength(2);
  });

  it("offers the forms that have entries, match scout first, in listing order", () => {
    expect(entryFormKeys(rows, FORM_TYPES)).toEqual(["match-scout", "lead-scout", "pit-scout"]);
    expect(entryFormKeys([], FORM_TYPES)).toEqual([]);
  });

  it("lists the events once, sorted", () => {
    expect(entryEvents(rows)).toEqual(["2026a", "2026b"]);
  });

  it("filters by form, event and a team number or scout name", () => {
    expect(filterEntryRows(rows, { formKey: "pit-scout", eventCode: null, query: "" }).map((r) => r.id)).toEqual(["f1"]);
    expect(filterEntryRows(rows, { formKey: null, eventCode: "2026a", query: "" }).map((r) => r.id)).toEqual(["s1"]);
    expect(filterEntryRows(rows, { formKey: null, eventCode: null, query: "254" }).map((r) => r.id)).toEqual(["s1"]);
    expect(filterEntryRows(rows, { formKey: null, eventCode: null, query: " bo " }).map((r) => r.id)).toEqual(["f1", "f2"]);
    expect(filterEntryRows(rows, { formKey: "match-scout", eventCode: "2026b", query: "" })).toEqual([]);
    expect(filterEntryRows(rows, { formKey: null, eventCode: null, query: "" })).toHaveLength(3);
  });
});
