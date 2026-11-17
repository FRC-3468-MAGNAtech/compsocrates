import { describe, expect, it } from "vitest";
import { buildSubmission, validateSubmission } from "@/lib/forms/form-page-logic";
import { getBuiltinForm, BUILTIN_FORMS, NON_MATCH_FORM_IDS } from "@/lib/forms/builtin";
import { HELPER_REBUILT_FORM, PIT_SCOUT_REBUILT_FORM, TEAM_STRATEGY_REBUILT_FORM } from "@/lib/forms/builtin-rebuilt-forms";
import { addField, defaultField, updateField } from "@/lib/forms/edit";
import { createBlankForm } from "@/lib/forms/new-form";
import { isRookieIn, rookieSuggestion, weightInPounds } from "@/lib/forms/pit-suggest";
import { addStep, canAddStep, moveStep, normalizeSequence, parseSequenceSummary, summarizeSequence } from "@/lib/forms/sequence";
import { defaultValues, normalizeValues } from "@/lib/forms/values";
import { blockingIssues, checkForm, parseForm } from "@/lib/forms/validate";
import { diffEntryValues } from "@/lib/form-entries-model";
import { officialTemplates } from "@/lib/templates/official";
import type { Form, FormField, SequenceStep } from "@/lib/forms/types";

// P29: the Pit Scout, Team Strategy and Helper forms (the REBUILT set the CS adapter persists), the generic auto-cycle and capability-grid rules, and the rookie suggestion.

const fieldsOf = (f: Form): FormField[] => f.sections.flatMap((s) => s.fields);
const keys = (f: Form) => fieldsOf(f).map((x) => x.key);
const answers = (teamNumber: number | null = 111) => ({ eventCode: "EVT1", matchKey: null, alliance: null, teamNumber, scoutName: "Ada" });

/** A small ordered-steps fixture: one pinned first, one pinned last, two that repeat. */
const STEPS: SequenceStep[] = [
  { id: "first", label: "First", maxCount: 1, pin: "first" },
  { id: "step-a", label: "Do Step A", shortLabel: "A", maxCount: 0, pin: null },
  { id: "step-b", label: "Do Step B", shortLabel: "B", maxCount: 0, pin: null },
  { id: "last", label: "Last", maxCount: 1, pin: "last" },
];

describe("the three built-in forms", () => {
  it("are registered, valid and parse", () => {
    for (const id of [NON_MATCH_FORM_IDS["pit-scout"], NON_MATCH_FORM_IDS["team-strategy"], NON_MATCH_FORM_IDS.helper]) {
      const form = getBuiltinForm(id)!;
      expect(form, id).toBeTruthy();
      expect(BUILTIN_FORMS[id]).toBe(form);
      expect(blockingIssues(checkForm(form)).map((i) => i.message), id).toEqual([]);
      expect(parseForm(JSON.parse(JSON.stringify(form))).ok, id).toBe(true);
      expect(form.scoringEnabled, id).toBe(false); // no scoring
      expect(form.stickyNotes?.enabled, id).toBe(true);
    }
  });

  it("are seeded as official templates too", () => {
    const ids = officialTemplates().map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["official-pit-scout", "official-team-strategy", "official-helper"]));
  });

  it("the Pit Scout form has the CS fields, with the event and team pickers first", () => {
    expect(keys(PIT_SCOUT_REBUILT_FORM).slice(0, 2)).toEqual(["eventCode", "teamNumber"]);
    expect(keys(PIT_SCOUT_REBUILT_FORM)).toEqual(expect.arrayContaining(["robotWeight", "rookieTeam", "robotPictureUrl", "pitDisposition", "driveDisposition", "fuelPreloadCapacity", "climbLevel3", "autoCycleDescription", "notes"]));
    // the three fuel scales are free text (CS stores strings such as 10-13 or x)
    for (const k of ["fuelPreloadCapacity", "fuelBallsPerSecond", "fuelCarryingCapacity"]) expect(fieldsOf(PIT_SCOUT_REBUILT_FORM).find((f) => f.key === k)?.type).toBe("text");
    // the notes are the last field on the form
    expect(keys(PIT_SCOUT_REBUILT_FORM).at(-1)).toBe("notes");
  });

  it("the Team Strategy form: a required best-at role and starting position, then the ability checkboxes", () => {
    expect(keys(TEAM_STRATEGY_REBUILT_FORM)).toEqual(expect.arrayContaining(["preferredStartingPosition", "bestAt", "clearsBump", "clearsTrench", "canShootWhileIntaking", "canMoveAndShootSimultaneously"]));
    const best = fieldsOf(TEAM_STRATEGY_REBUILT_FORM).find((f) => f.key === "bestAt")!;
    expect(best.required).toBe(true);
    expect(best.options?.length).toBeGreaterThan(1);
  });

  it("the Helper form: event and scout, a yes/no and what was solved", () => {
    expect(keys(HELPER_REBUILT_FORM).slice(0, 2)).toEqual(["eventCode", "scoutName"]);
    expect(keys(HELPER_REBUILT_FORM)).toEqual(expect.arrayContaining(["wasSuccessful", "issueSolved"]));
    expect(validateSubmission(HELPER_REBUILT_FORM, { ...answers(null), eventCode: "" }, defaultValues(HELPER_REBUILT_FORM), undefined)).toMatchObject({ eventCode: expect.any(String) });
    const ok = { ...defaultValues(HELPER_REBUILT_FORM), wasSuccessful: true, issueSolved: "Loose belt" };
    expect(validateSubmission(HELPER_REBUILT_FORM, answers(111), ok, undefined)).toEqual({});
  });
});

describe("a capabilities grid (matrix field)", () => {
  const form = (): Form => {
    let f = createBlankForm({ id: "grid", name: "Grid", createdBy: "u", formType: "pit-scout" });
    f = addField(f, "misc", { ...defaultField(f, "matrix", "Can do"), key: "capabilities" });
    const id = fieldsOf(f).find((x) => x.key === "capabilities")!.id;
    return updateField(f, id, {
      rows: [{ key: "leave", label: "Leave" }, { key: "park", label: "Park" }, { key: "score", label: "Score" }],
      cols: [{ key: "auto", label: "Autonomous" }, { key: "teleop", label: "Teleop/Endgame" }],
      disabledCells: ["leave_teleop"], // Leave is an Autonomous-only action
    });
  };
  const matrix = () => fieldsOf(form()).find((f) => f.key === "capabilities")!;

  it("has its rows by its columns, with a switched-off cell", () => {
    expect(matrix().rows?.map((r) => r.key)).toEqual(["leave", "park", "score"]);
    expect(matrix().cols?.map((c) => c.key)).toEqual(["auto", "teleop"]);
    expect(matrix().disabledCells).toEqual(["leave_teleop"]);
  });

  it("a disabled cell can't be stored, even if one sneaks in", () => {
    const stored = normalizeValues(form(), { capabilities: { leave_auto: true, leave_teleop: true, score_teleop: true } });
    expect(stored.capabilities).toMatchObject({ leave_auto: true, score_teleop: true, score_auto: false });
    expect(Object.keys(stored.capabilities as object)).not.toContain("leave_teleop");
  });
});

describe("an auto cycle (sequence field)", () => {
  const ids = (xs: string[]) => normalizeSequence(STEPS, xs);

  it("the first and last steps are once-only and pinned", () => {
    let seq: string[] = [];
    seq = addStep(STEPS, seq, "step-a");
    seq = addStep(STEPS, seq, "last");
    seq = addStep(STEPS, seq, "first");
    seq = addStep(STEPS, seq, "step-b");
    expect(seq).toEqual(["first", "step-a", "step-b", "last"]);
    expect(canAddStep(STEPS, seq, "first")).toBe(false);
    expect(canAddStep(STEPS, seq, "last")).toBe(false);
    expect(canAddStep(STEPS, seq, "step-a")).toBe(true); // repeating steps repeat
  });

  it("the middle steps move but can't pass the pinned ends", () => {
    const seq = ["first", "step-a", "step-b", "last"];
    expect(moveStep(STEPS, seq, 2, 1)).toEqual(["first", "step-b", "step-a", "last"]);
    expect(moveStep(STEPS, seq, 1, 0)).toEqual(seq);
    expect(moveStep(STEPS, seq, 2, 3)).toEqual(seq);
  });

  it("a stored sequence is cleaned back into the rules", () => {
    expect(ids(["step-a", "first", "first", "last", "step-b"])).toEqual(["first", "step-a", "step-b", "last"]);
  });

  it("the text summary is the short flow and round-trips", () => {
    const seq = ["first", "step-a", "step-b", "step-a", "last"];
    expect(summarizeSequence(STEPS, seq, " > ")).toBe("First > A > B > A > Last");
    expect(parseSequenceSummary(STEPS, "First → A → B → A → Last")).toEqual(seq);
    expect(parseSequenceSummary(STEPS, "First → Do Step A → Last")).toEqual(["first", "step-a", "last"]);
  });
});

describe("Pit Scout submissions and weight", () => {
  it("builds a pit-scout submission for the team", () => {
    const values = { ...defaultValues(PIT_SCOUT_REBUILT_FORM), robotWeight: "115", rookieTeam: true };
    const sub = buildSubmission(PIT_SCOUT_REBUILT_FORM, answers(222), values, [], 0, null);
    expect(sub.values).toMatchObject({ robotWeight: "115", rookieTeam: true });
    expect(sub.formType).toBe("pit-scout");
    expect(sub.teamNumber).toBe(222);
  });

  it("converts kg to pounds for comparison", () => {
    expect(weightInPounds(10, "kg")).toBe(22);
    expect(weightInPounds(24.5, "lb")).toBe(24.5);
    expect(weightInPounds("", "lb")).toBeNull();
    expect(weightInPounds(undefined, "kg")).toBeNull();
  });
});

describe("rookie suggestion", () => {
  it("is a rookie in the season of its rookie year, not otherwise, unknown without data", () => {
    expect(isRookieIn({ rookieYear: 2025 }, 2025)).toBe(true);
    expect(isRookieIn({ rookieYear: 2019 }, 2025)).toBe(false);
    expect(isRookieIn({ rookieYear: null }, 2025)).toBeNull();
    expect(isRookieIn(undefined, 2025)).toBeNull();
  });

  it("gives a value and a hint to show, and nothing when unknown", () => {
    const r = rookieSuggestion({ rookieYear: 2025 }, 2025)!;
    expect(r.values).toEqual({ rookie: true });
    expect(r.hints.rookie).toContain("rookie year 2025");
    expect(rookieSuggestion({ rookieYear: 2015 }, 2025)!.values).toEqual({ rookie: false });
    expect(rookieSuggestion({ rookieYear: null }, 2025)).toBeNull();
  });
});

describe("editing an earlier entry", () => {
  it("lists only the keys that changed, sorted", () => {
    expect(diffEntryValues({ a: 1, b: "x", c: ["p"] }, { a: 1, b: "y", c: ["p"], d: true })).toEqual(["b", "d"]);
    expect(diffEntryValues({ a: 1 }, { a: 1 })).toEqual([]);
    expect(diffEntryValues({ a: 1 }, {})).toEqual(["a"]);
  });
});
