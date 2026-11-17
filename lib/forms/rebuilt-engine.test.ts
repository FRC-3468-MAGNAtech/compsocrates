import { describe, expect, it } from "vitest";
import { buildGameSchema } from "@/lib/analytics/game-schema";
import { entriesToCsv, parseImportCsv } from "@/lib/analytics/csv";
import { registerCustomScorer, resolveCustomScorer, unregisterCustomScorer } from "@/lib/forms/custom-scorers";
import { addField, cloneFields, defaultField, removeField, setFieldKey, updateField } from "@/lib/forms/edit";
import { diffForms } from "@/lib/forms/diff";
import { createBlankForm } from "@/lib/forms/new-form";
import { exportForm, importForm } from "@/lib/forms/portable";
import { calculateScore, maxScore, storableScore } from "@/lib/forms/scoring";
import { type Form, type FormField, type FormValues, type VisibleWhen } from "@/lib/forms/types";
import { blockingIssues, checkForm, parseForm } from "@/lib/forms/validate";
import { coerceFieldValue, coerceTimerList, defaultValues, isAnswered, normalizeValues, timerStats, validateValues } from "@/lib/forms/values";
import { conditionHolds, conditionKeys, remapConditionKeys, visibleFieldKeys } from "@/lib/forms/visibility";
import { valueSlots } from "@/lib/forms/repeat";
import { sameValue } from "@/lib/forms/compare";
import type { ScoutEntry } from "@/lib/scout-entries";

// The engine extensions the REBUILT form needs: `timerList`, labelled scales (slider `stepLabels`), the `notice` line with a two-field `xor` condition,
// and form-level custom scoring.

const blank = (): Form => ({ ...createBlankForm({ id: "t", name: "T", createdBy: "u" }), scoringEnabled: false });
const add = (f: Form, type: Parameters<typeof defaultField>[1], label: string, patch: Partial<FormField> = {}, section = "misc"): Form => addField(f, section, { ...defaultField(f, type, label), ...patch });
const errors = (f: Form) => blockingIssues(checkForm(f)).map((i) => i.code);
const field = (f: Form, key: string): FormField => f.sections.flatMap((s) => s.fields).find((x) => x.key === key)!;

describe("timerList", () => {
  const f = { ...defaultField(blank(), "timerList", "Cycles") };

  it("starts empty and a form with one is valid", () => {
    expect(f.type).toBe("timerList");
    expect(defaultValues(add(blank(), "timerList", "Cycles"))).toMatchObject({ cycles: [] });
    expect(parseForm(add(blank(), "timerList", "Cycles")).ok).toBe(true);
    expect(errors(add(blank(), "timerList", "Cycles"))).toEqual([]);
  });

  it("coerces to positive durations to 0.01 s, capped per cycle, dropping junk and keeping the first maxCycles", () => {
    expect(coerceTimerList({}, [3.456, "4.2", 0, -1, NaN, "x", null, 7])).toEqual([3.46, 4.2, 7]);
    expect(coerceTimerList({ max: 5 }, [2, 99])).toEqual([2, 5]);
    expect(coerceTimerList({ maxCycles: 2 }, [1, 2, 3])).toEqual([1, 2]);
    expect(coerceTimerList({}, "nope")).toEqual([]);
    expect(coerceTimerList({}, [9999])).toEqual([3600]); // a forgotten watch is capped
    expect(coerceFieldValue({ ...f, max: 10 }, [1, 20])).toEqual([1, 10]);
  });

  it("normalizeValues fills a missing list with [] and cleans a stored one", () => {
    const form = add(blank(), "timerList", "Cycles");
    expect(normalizeValues(form, {}).cycles).toEqual([]);
    expect(normalizeValues(form, { cycles: [1.234, "2", -3] }).cycles).toEqual([1.23, 2]);
  });

  it("is answered once it has a cycle (so a required list needs one)", () => {
    expect(isAnswered(f, [])).toBe(false);
    expect(isAnswered(f, [1.5])).toBe(true);
    const form = add(blank(), "timerList", "Cycles", { required: true });
    expect(validateValues(form, { cycles: [] })).toEqual({ cycles: "Cycles is required." });
    expect(validateValues(form, { cycles: [2] })).toEqual({});
  });

  it("compares by content", () => {
    expect(sameValue([1, 2], [1, 2])).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue([], undefined)).toBe(true);
  });

  it("totals and averages (0 when empty)", () => {
    expect(timerStats([])).toEqual({ count: 0, total: 0, avg: 0 });
    expect(timerStats([1.5, 2.25, 3])).toEqual({ count: 3, total: 6.75, avg: 2.25 });
  });

  it("can't score by itself, and a bad range is an error", () => {
    expect(errors(add(blank(), "timerList", "C", { scoring: { mode: "perTally", value: 1 } }))).toContain("scoring-mode");
    expect(errors(add(blank(), "timerList", "C", { max: 0 }))).toContain("timer-max");
    expect(parseForm(add(blank(), "timerList", "C", { maxCycles: 500 })).ok).toBe(false);
  });

  it("is a column with the cycle list plus count, total and average seconds, and the list survives CSV", () => {
    const form = add(blank(), "timerList", "Cycles", { analytics: { include: true, category: "Fuel" } });
    const schema = buildGameSchema(form);
    const keys = schema.columns.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(["cycles", "cycles__count", "cycles__total", "cycles__avg"]));
    const entry = (values: FormValues): ScoutEntry =>
      ({ id: "e", scoutName: "Ada", matchType: "Qualification", matchNumber: 4, teamNumber: 254, values, score: { auto: 0, teleop: 0, endgame: 0, total: 0 }, scored: false }) as unknown as ScoutEntry;
    const col = (k: string) => schema.columns.find((c) => c.key === k)!;
    const e = entry({ cycles: [12.5, 8.25, 3] });
    expect(col("cycles").getValue(e)).toBe("12.5 | 8.25 | 3");
    expect(col("cycles__count").getValue(e)).toBe(3);
    expect(col("cycles__total").getValue(e)).toBe(23.75);
    expect(col("cycles__avg").getValue(e)).toBe(7.92);
    expect(col("cycles__count").getValue(entry({}))).toBeNull();
    const csv = entriesToCsv(schema, [e, entry({ cycles: [] })], (s) => s);
    const parsed = parseImportCsv(schema, csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.map((r) => normalizeValues(form, r.values).cycles)).toEqual([[12.5, 8.25, 3], []]);
  });

  it("round-trips through export and import", () => {
    const form = add(blank(), "timerList", "Cycles", { max: 90, maxCycles: 30 });
    const out = importForm(JSON.stringify(exportForm(form)));
    expect(out.ok).toBe(true);
    if (out.ok) expect(field(out.form, "cycles")).toMatchObject({ type: "timerList", max: 90, maxCycles: 30 });
  });
});

describe("labelled scale (slider stepLabels)", () => {
  const LABELS = ["0", "1-3", "4-6", "7-9"];
  const scale = (extra: Partial<FormField> = {}): FormField => ({ ...defaultField(blank(), "slider", "BPS"), key: "bps", min: 0, max: 3, step: 1, stepLabels: LABELS, ...extra });

  it("stores the step INDEX and clamps like any slider", () => {
    expect(coerceFieldValue(scale(), 2)).toBe(2);
    expect(coerceFieldValue(scale(), "3")).toBe(3);
    expect(coerceFieldValue(scale(), 9)).toBe(3);
    expect(coerceFieldValue(scale(), -4)).toBe(0);
    expect(defaultValues({ sections: [{ id: "s", title: "S", phase: "misc", visible: true, fields: [scale()] }] })).toMatchObject({ bps: 0 });
  });

  it("needs exactly one label per step", () => {
    expect(errors(add(blank(), "slider", "BPS", { min: 0, max: 3, step: 1, stepLabels: LABELS }))).not.toContain("slider-labels");
    expect(errors(add(blank(), "slider", "BPS", { min: 0, max: 3, step: 1, stepLabels: ["a", "b"] }))).toContain("slider-labels");
    expect(parseForm(add(blank(), "slider", "BPS", { min: 0, max: 3, step: 1, stepLabels: LABELS })).ok).toBe(true);
    expect(parseForm(add(blank(), "slider", "BPS", { stepLabels: ["x".repeat(30)] })).ok).toBe(false);
  });

  it("the label text is sanitized like other form text, and a label change shows in the diff", () => {
    const a = add(blank(), "slider", "BPS", { key: "bps", min: 0, max: 1, step: 1, stepLabels: ["<b>low</b>", "high"] });
    const out = importForm(JSON.stringify(exportForm(a)));
    expect(out.ok).toBe(true);
    if (out.ok) expect(field(out.form, "bps").stepLabels).toEqual(["low", "high"]);
    const b = updateField(a, field(a, "bps").id, (f) => ({ ...f, stepLabels: ["low", "higher"] }));
    expect(diffForms(a, b).fields[0].details).toContain("Step labels changed");
  });
});

describe("xor condition and the notice line", () => {
  const XOR = (value?: boolean): VisibleWhen => ({ fieldKey: "a", op: "xor", otherFieldKey: "b", ...(value === undefined ? {} : { value }) });

  it("holds when exactly one is checked (or, with value false, when both or neither)", () => {
    const cases: [boolean, boolean][] = [[false, false], [true, false], [false, true], [true, true]];
    expect(cases.map(([a, b]) => conditionHolds(XOR(), { a, b }))).toEqual([false, true, true, false]);
    expect(cases.map(([a, b]) => conditionHolds(XOR(false), { a, b }))).toEqual([true, false, false, true]);
    expect(conditionHolds(XOR(), {})).toBe(false); // missing reads as off
  });

  it("reads two keys and remaps both", () => {
    expect(conditionKeys(XOR())).toEqual(["a", "b"]);
    expect(conditionKeys({ fieldKey: "a", op: "checked" })).toEqual(["a"]);
    expect(remapConditionKeys(XOR(true), (k) => (k === "b" ? "z" : undefined))).toEqual({ fieldKey: "a", op: "xor", otherFieldKey: "z", value: true });
  });

  const form = (): Form => {
    let f = blank();
    f = add(f, "toggle", "A", { key: "a" });
    f = add(f, "toggle", "B", { key: "b" });
    f = add(f, "notice", "Counted", { key: "counted", visibleWhen: XOR() });
    f = add(f, "notice", "Not counted", { key: "notCounted", visibleWhen: XOR(false) });
    return f;
  };

  it("shows each notice for its parity, and hides one whose toggle is itself hidden", () => {
    const f = form();
    expect([...visibleFieldKeys(f, { a: true, b: false })].filter((k) => k.endsWith("ounted"))).toEqual(["counted"]);
    expect([...visibleFieldKeys(f, { a: true, b: true })].filter((k) => k.endsWith("ounted"))).toEqual(["notCounted"]);
    const hiddenB = updateField(f, field(f, "b").id, (x) => ({ ...x, visibleWhen: { fieldKey: "a", op: "checked" } }));
    expect(visibleFieldKeys(hiddenB, { a: false, b: true }).has("counted")).toBe(false); // b is hidden, so the pair can't be satisfied
  });

  it("is valid, holds no value and never an answer", () => {
    const f = form();
    expect(parseForm(f).ok).toBe(true);
    expect(errors(f)).toEqual([]);
    expect(valueSlots(f).map((s) => s.storageKey)).toEqual(expect.not.arrayContaining(["counted", "notCounted"]));
    expect(Object.keys(defaultValues(f))).toEqual(expect.arrayContaining(["a", "b"]));
    expect(Object.keys(defaultValues(f))).not.toContain("counted");
    expect(isAnswered(field(f, "counted"), "")).toBe(false);
    expect(errors(add(blank(), "notice", "N", { required: true }))).toContain("notice-required");
  });

  it("checkForm: a missing, self or non-boolean reference, and a cycle through the second field", () => {
    let f = form();
    f = updateField(f, field(f, "counted").id, (x) => ({ ...x, visibleWhen: { fieldKey: "a", op: "xor", otherFieldKey: "ghost" } }));
    expect(errors(f)).toContain("condition-missing");
    f = updateField(f, field(f, "counted").id, (x) => ({ ...x, visibleWhen: { fieldKey: "a", op: "xor", otherFieldKey: "counted" } }));
    expect(errors(f)).toContain("condition-self");
    let g = add(form(), "counter", "N", { key: "n" });
    g = updateField(g, field(g, "counted").id, (x) => ({ ...x, visibleWhen: { fieldKey: "a", op: "xor", otherFieldKey: "n" } }));
    expect(errors(g)).toContain("condition-unreachable");
    // a depends on (b xor counted), counted depends on a: a cycle only visible through the second key
    let c = form();
    c = updateField(c, field(c, "a").id, (x) => ({ ...x, visibleWhen: { fieldKey: "b", op: "xor", otherFieldKey: "counted" } }));
    expect(errors(c)).toContain("condition-cycle");
  });

  it("the builder keeps both keys right: rename remaps, deleting either drops the condition, duplicating the group remaps or drops", () => {
    const f = form();
    const renamed = setFieldKey(f, field(f, "b").id, "b2", new Set());
    expect(field(renamed, "counted").visibleWhen).toEqual({ fieldKey: "a", op: "xor", otherFieldKey: "b2" });
    expect(field(removeField(f, field(f, "b").id), "counted").visibleWhen).toBeUndefined();
    expect(field(removeField(f, field(f, "a").id), "notCounted").visibleWhen).toBeUndefined();
    const all = f.sections.flatMap((s) => s.fields).filter((x) => ["a", "b", "counted"].includes(x.key));
    const both = cloneFields(f, all);
    expect(both.fields.find((x) => x.key === both.keyMap.get("counted"))?.visibleWhen).toEqual({ fieldKey: both.keyMap.get("a"), op: "xor", otherFieldKey: both.keyMap.get("b") });
    const lone = cloneFields(f, all.filter((x) => x.key !== "b"));
    expect(lone.fields.find((x) => x.key === lone.keyMap.get("counted"))?.visibleWhen).toBeUndefined(); // one of its two fields wasn't copied: it would dangle
  });

  it("round-trips through export and import", () => {
    const out = importForm(JSON.stringify(exportForm(form())));
    expect(out.ok).toBe(true);
    if (out.ok) expect(field(out.form, "notCounted").visibleWhen).toEqual({ fieldKey: "a", op: "xor", otherFieldKey: "b", value: false });
  });
});

describe("custom scoring", () => {
  const withScorer = (key: string): Form => ({ ...add(blank(), "counter", "Fuel", { key: "fuel" }), scoringEnabled: true, scoring: { mode: "custom", scorer: key } });
  const key = "test-double";

  it("scores with the registered scorer, per phase, and ignores the fields' own rules", () => {
    registerCustomScorer(key, (v) => ({ auto: Number(v.fuel) * 2, teleop: 1, endgame: 0, total: Number(v.fuel) * 2 + 1 }));
    try {
      const f = withScorer(key);
      const scored = { ...f, sections: f.sections.map((s) => ({ ...s, fields: s.fields.map((x) => (x.key === "fuel" ? { ...x, scoring: { mode: "perTally" as const, value: 100 } } : x)) })) };
      const r = calculateScore(scored, { fuel: 3 });
      expect(r).toMatchObject({ auto: 6, teleop: 1, endgame: 0, total: 7, byPhase: { auto: 6, teleop: 1 } });
      expect(storableScore(r)).toEqual({ auto: 6, teleop: 1, endgame: 0, total: 7 }); // only the three standard phases, so no byPhase is stored
      expect(errors(f)).toEqual([]); // custom scoring needs no scoring field
    } finally {
      unregisterCustomScorer(key);
    }
  });

  it("is zero when scoring is off, when the scorer is unknown, throws or returns junk", () => {
    expect(calculateScore({ ...withScorer("nope"), scoringEnabled: false }, { fuel: 3 }).total).toBe(0);
    expect(calculateScore(withScorer("nope"), { fuel: 3 }).total).toBe(0);
    registerCustomScorer("boom", () => {
      throw new Error("x");
    });
    registerCustomScorer("junk", () => ({ auto: NaN, teleop: "5" as unknown as number, endgame: Infinity, total: 4 }));
    try {
      expect(calculateScore(withScorer("boom"), {}).total).toBe(0);
      expect(calculateScore(withScorer("junk"), {})).toMatchObject({ auto: 0, teleop: 0, endgame: 0, total: 4 });
    } finally {
      unregisterCustomScorer("boom");
      unregisterCustomScorer("junk");
    }
  });

  it("an unknown scorer is a blocking error, a game scorer resolves, and `game:` keys can't be registered", () => {
    expect(errors(withScorer("nope"))).toContain("scorer-unknown");
    expect(resolveCustomScorer("game:REBUILT")).toBeTypeOf("function");
    expect(resolveCustomScorer("game:NOT_A_GAME")).toBeNull();
    expect(() => registerCustomScorer("game:REBUILT", () => ({ auto: 0, teleop: 0, endgame: 0, total: 0 }))).toThrow();
    expect(errors(withScorer("game:REBUILT"))).toEqual([]);
  });

  it("has no declared maximum and shows up in the diff and the analytics score columns", () => {
    expect(maxScore(withScorer("game:REBUILT")).total).toBeNull();
    const plain = add(blank(), "counter", "Fuel", { key: "fuel" });
    expect(diffForms(plain, withScorer("game:REBUILT")).form.join(" ")).toContain("Custom scoring");
    const cols = buildGameSchema(withScorer("game:REBUILT")).columns.map((c) => c.key);
    expect(cols).toEqual(expect.arrayContaining(["scoreAuto", "scoreTeleop", "scoreEndgame", "scoreTotal"]));
  });

  it("round-trips through export and import, and an invalid scorer key is refused", () => {
    const out = importForm(JSON.stringify(exportForm(withScorer("game:REBUILT"))));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.form.scoring).toEqual({ mode: "custom", scorer: "game:REBUILT" });
    expect(parseForm({ ...withScorer("game:REBUILT"), scoring: { mode: "custom", scorer: "bad key!" } }).ok).toBe(false);
  });
});
