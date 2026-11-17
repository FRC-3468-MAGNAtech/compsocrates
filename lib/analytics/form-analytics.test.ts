import { describe, expect, it } from "vitest";
import { FORM_ANALYTICS_PAGES, buildFormSchema, entriesOfUnit, eventCodesForScope, formAnalyticsPage, formAnalyticsPageForPath, isFormAnalyticsRoute, latestPerUnit, selectFormEntries } from "@/lib/analytics/form-analytics";
import { formEntryToRow, type FormEntry } from "@/lib/form-entries-model";
import { entriesToCsv } from "@/lib/analytics/csv";
import { DRIVE_REFLECTION_REBUILT_FORM, HELPER_REBUILT_FORM, LEAD_SCOUT_REBUILT_FORM, MATCH_STRATEGY_REBUILT_FORM, PIT_SCOUT_REBUILT_FORM, TEAM_STRATEGY_REBUILT_FORM } from "@/lib/forms/builtin-rebuilt-forms";
import { BUILTIN_FORMS } from "@/lib/forms/builtin";

let n = 0;
const entry = (over: Partial<FormEntry>): FormEntry => ({
  id: `e${++n}`,
  teamId: "t",
  uid: "u1",
  scoutName: "Ada",
  formId: "pit-scout-v1",
  formVersion: 1,
  formType: "pit-scout",
  eventCode: "EVT1",
  teamNumber: 111,
  values: {},
  stickyNotes: [],
  flags: [],
  excluded: false,
  createdAtMs: n,
  updatedAtMs: n,
  ...over,
});
const PIT = FORM_ANALYTICS_PAGES.find((p) => p.slug === "pit-scout")!;
const LEAD = FORM_ANALYTICS_PAGES.find((p) => p.slug === "lead-scout")!;

describe("the six pages", () => {
  it("are registered in the order the brief gives, each with a built-in form that exists", () => {
    expect(FORM_ANALYTICS_PAGES.map((p) => p.slug)).toEqual(["lead-scout", "pit-scout", "team-strategy", "match-strategy", "drive-reflection", "helper"]);
    for (const p of FORM_ANALYTICS_PAGES) {
      expect(BUILTIN_FORMS[p.formId]?.formType, p.slug).toBe(p.formType);
      expect(p.href).toBe(`/analytics/${p.slug}`);
    }
  });

  it("are found from a path, and the filter bar treats exactly them as form routes", () => {
    expect(formAnalyticsPageForPath("/analytics/pit-scout")?.slug).toBe("pit-scout");
    expect(formAnalyticsPageForPath("/analytics/pit-scout/")?.slug).toBe("pit-scout");
    expect(formAnalyticsPage("helper")?.title).toBe("Helper Analytics");
    expect(isFormAnalyticsRoute("/analytics/match-scout")).toBe(false);
    expect(isFormAnalyticsRoute("/analytics/team-averages")).toBe(false);
    expect(isFormAnalyticsRoute("/analytics/lead-scout")).toBe(true);
  });
});

describe("selecting entries", () => {
  const all = [entry({ eventCode: "A" }), entry({ eventCode: "B" }), entry({ eventCode: "A", excluded: true }), entry({ formType: "helper", eventCode: "A" })];

  it("filters by form type and by the event filter; excluded only when asked", () => {
    expect(selectFormEntries(all, "pit-scout", ["A"])).toHaveLength(1);
    expect(selectFormEntries(all, "pit-scout", ["A"], { includeExcluded: true })).toHaveLength(2);
    expect(selectFormEntries(all, "pit-scout", null)).toHaveLength(2);
    expect(selectFormEntries(all, "pit-scout", [])).toHaveLength(0);
  });

  it("turns the event scope into codes", () => {
    expect(eventCodesForScope({ kind: "all" }, ["A"])).toBeNull();
    expect(eventCodesForScope({ kind: "active" }, ["A", "B"])).toEqual(["A", "B"]);
    expect(eventCodesForScope({ kind: "custom", codes: ["C"] }, ["A"])).toEqual(["C"]);
  });
});

describe("latest entry per unit", () => {
  it("keeps the newest entry per team per event, and lists all of a unit's entries on request", () => {
    const a = entry({ teamNumber: 1, createdAtMs: 10 });
    const b = entry({ teamNumber: 1, createdAtMs: 20 });
    const c = entry({ teamNumber: 2, createdAtMs: 5 });
    const d = entry({ teamNumber: 1, eventCode: "EVT2", createdAtMs: 1 });
    expect(latestPerUnit(PIT, [a, b, c, d]).map((e) => e.id)).toEqual([b.id, c.id, d.id]);
    expect(entriesOfUnit(PIT, [a, b, c, d], b).map((e) => e.id)).toEqual([b.id, a.id]);
  });

  it("a match unit is event + match + alliance", () => {
    const x = entry({ formType: "lead-scout", matchKey: "Q1", alliance: "red", createdAtMs: 1 });
    const y = entry({ formType: "lead-scout", matchKey: "Q1", alliance: "blue", createdAtMs: 2 });
    const z = entry({ formType: "lead-scout", matchKey: "Q1", alliance: "red", createdAtMs: 3 });
    expect(latestPerUnit(LEAD, [x, y, z]).map((e) => e.id)).toEqual([z.id, y.id]);
  });
});

describe("the raw table's columns", () => {
  const keys = (form: Parameters<typeof buildFormSchema>[0], multi = false) => buildFormSchema(form, { multiEvent: multi }).columns.map((c) => c.key);

  it("Pit Scout has Team and Scout but no Match column; Lead Scout has Match and Alliance but no Team column", () => {
    expect(keys(PIT_SCOUT_REBUILT_FORM).slice(0, 2)).toEqual(["team", "scout"]);
    expect(keys(PIT_SCOUT_REBUILT_FORM)).not.toContain("match");
    expect(keys(LEAD_SCOUT_REBUILT_FORM).slice(0, 3)).toEqual(["match", "alliance", "scout"]);
    expect(keys(LEAD_SCOUT_REBUILT_FORM)).not.toContain("team");
    expect(keys(DRIVE_REFLECTION_REBUILT_FORM)).toContain("planDifferences");
  });

  it("adds an Event column only when several events are shown; the sticky columns come first", () => {
    expect(keys(HELPER_REBUILT_FORM)).not.toContain("event");
    expect(keys(HELPER_REBUILT_FORM, true)).toContain("event");
    const cols = buildFormSchema(MATCH_STRATEGY_REBUILT_FORM, { multiEvent: true }).columns;
    expect(cols.filter((c) => c.sticky).map((c) => c.key)).toEqual(["match", "alliance", "scout"]);
    expect(cols.findIndex((c) => c.key === "event")).toBeGreaterThan(cols.findIndex((c) => c.key === "scout"));
  });

  it("has no score or accuracy columns (these forms don't score), and the pit form has a Notes column", () => {
    for (const f of [PIT_SCOUT_REBUILT_FORM, TEAM_STRATEGY_REBUILT_FORM, HELPER_REBUILT_FORM]) expect(keys(f).some((k) => k === "scoreTotal" || k === "accuracy"), f.id).toBe(false);
    expect(keys(PIT_SCOUT_REBUILT_FORM)).toContain("stickyNotes");
  });

  it("exports a CSV with the pit form's checkboxes as Y/N cells and its text as typed", () => {
    const schema = buildFormSchema(PIT_SCOUT_REBUILT_FORM, { multiEvent: false });
    const row = formEntryToRow(entry({ values: { robotWeight: "24.5 lbs", climbLevel1: true, climbLevel3: false, autoCycleDescription: "leave then shoot" } }), PIT_SCOUT_REBUILT_FORM);
    const csv = entriesToCsv(schema, [row], (s) => s);
    expect(csv).toContain("24.5 lbs");
    expect(csv).toContain("leave then shoot");
    const header = csv.split("\r\n")[0].split(",");
    const rowCells = csv.split("\r\n")[1].split(",");
    const at = header.findIndex((h) => h.includes("Level 1 Climb"));
    expect(at).toBeGreaterThan(-1);
    expect(rowCells[at]).toBe("Y");
    expect(rowCells[header.findIndex((h) => h.includes("Level 3 Climb"))]).toBe("N");
  });
});

describe("the Analytics tabs", () => {
  it("put the six form pages right after Match Scout Analytics, all under 'Raw data', before the other tabs", async () => {
    const { analyticsNav } = await import("@/lib/nav");
    const hrefs = analyticsNav.map((i) => i.href);
    expect(hrefs.slice(0, 7)).toEqual(["/analytics/match-scout", ...FORM_ANALYTICS_PAGES.map((p) => p.href)]);
    expect(analyticsNav.slice(0, 7).every((i) => i.group === "Raw data")).toBe(true);
    expect(analyticsNav.slice(7).every((i) => !i.group)).toBe(true);
    expect(hrefs).toContain("/analytics/scout-status");
  });
});
