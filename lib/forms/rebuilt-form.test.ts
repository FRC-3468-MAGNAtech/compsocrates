import { describe, expect, it } from "vitest";
import { buildGameSchema, GAMES } from "@/lib/analytics/game-schema";
import { BUILTIN_FORMS, builtinHash, DEFAULT_FORM_ID, getBuiltinForm } from "@/lib/forms/builtin";
import { incidentsFromValues, incidentValuesFromList, REBUILT_FORM, REBUILT_INCIDENTS } from "@/lib/forms/builtin-rebuilt";
import { exportForm, importForm } from "@/lib/forms/portable";
import { valueSlots } from "@/lib/forms/repeat";
import { calculateScore, storableScore } from "@/lib/forms/scoring";
import { DEFAULT_SEASON_ID, getSeason, SEASONS } from "@/lib/seasons";
import { isSystemField, REQUIRED_SYSTEM_FIELDS, STANDARD_PHASES, type FormField, type FormValues } from "@/lib/forms/types";
import { blockingIssues, checkForm, parseForm } from "@/lib/forms/validate";
import { defaultValues, normalizeValues, validateValues } from "@/lib/forms/values";
import { visibleFieldKeys } from "@/lib/forms/visibility";
import { rebuiltPlugin } from "@/lib/games/rebuilt";
import type { CsDoc } from "@/lib/games/types";

const fields = (): FormField[] => REBUILT_FORM.sections.flatMap((s) => s.fields);
const byKey = (key: string): FormField => fields().find((f) => f.key === key)!;
const shiftNotices = (values: FormValues): string[] => [...visibleFieldKeys(REBUILT_FORM, values)].filter((k) => /_(counted|notCounted)$/.test(k) || /^teleop_counted\d+$/.test(k)).sort();

/** The hand-computed golden doc from lib/games/rebuilt.test.ts (parity true counts shifts 2 and 4). */
function goldenDoc(parity: boolean): CsDoc {
  return {
    game: "REBUILT",
    startingPosition: "middle",
    auto: { preloadScale: 2, bpsScale: 4, carryingScale: 5, cycleTimes: [0.5, 3, 5], counterOverrideMissedFuel: 5, humanPlayerFuel: 3, successfulClimb: true, wonAuto: parity, hubActivationOverride: false },
    teleop: {
      shiftParityFromWonAuto: parity,
      bpsScale: 3,
      carryingScale: 3,
      transitionCycles: [2],
      shift1Cycles: [1, 10],
      shift2Cycles: [3],
      shift3Cycles: [1],
      shift4Cycles: [5],
      shift3Override: 10,
      shift4MissedFuel: 2,
      humanPlayerFuel: 7,
    },
    endgame: { cycleTimes: [1, 1], humanPlayerFuel: 2, status: "level-2" },
    incidents: ["died", "red-card"],
    notes: "fast",
  };
}

describe("REBUILT built-in form", () => {
  it("is a valid match-scout form with no blocking issue, custom-scored by the REBUILT plugin", () => {
    expect(parseForm(REBUILT_FORM).ok).toBe(true);
    expect(blockingIssues(checkForm(REBUILT_FORM))).toEqual([]);
    expect(REBUILT_FORM).toMatchObject({ id: "rebuilt", formType: "match-scout", origin: "built-in", scoringEnabled: true, scoring: { mode: "custom", scorer: "game:REBUILT" } });
    // the form names the same id the game config does
    expect(rebuiltPlugin.formId).toBe(REBUILT_FORM.id);
  });

  it("carries the three required system fields and uses the standard phases", () => {
    const types = fields().filter(isSystemField).map((f) => f.type).sort();
    expect(types).toEqual([...REQUIRED_SYSTEM_FIELDS["match-scout"]].sort());
    for (const s of REBUILT_FORM.sections) expect(STANDARD_PHASES as readonly string[]).toContain(s.phase);
    expect(REBUILT_FORM.sections.map((s) => s.phase)).toEqual(["prematch", "prematch", "auto", "teleop", "endgame", "misc"]);
  });

  it("is registered, the default form, and the default season, with BIOBUZZ still registered", () => {
    expect(DEFAULT_FORM_ID).toBe("rebuilt");
    expect(getBuiltinForm("rebuilt")).toBe(REBUILT_FORM);
    expect(getBuiltinForm("biobuzz")?.id).toBe("biobuzz");
    expect(builtinHash("rebuilt")).toMatch(/./);
    expect(Object.keys(BUILTIN_FORMS)).toEqual(expect.arrayContaining(["rebuilt", "biobuzz", "lead-scout-v1", "pit-scout-v1"]));
    expect(DEFAULT_SEASON_ID).toBe("rebuilt");
    expect(SEASONS.map((s) => s.id)).toEqual(["rebuilt", "reefscape", "charged_up", "biobuzz"]); // the two retired games are read-only seasons
    expect(getSeason()).toMatchObject({ id: "rebuilt", name: "REBUILT", apiSeason: 2026, formId: "rebuilt" });
    expect(getSeason("biobuzz").formId).toBe("biobuzz");
    expect(GAMES.rebuilt.id).toBe("rebuilt");
  });

  it("has exactly the plugin's value keys (plus the seven incident fields in place of `incidents`)", () => {
    const formKeys = new Set(valueSlots(REBUILT_FORM).map((s) => s.storageKey));
    const pluginKeys = new Set(Object.keys(rebuiltPlugin.defaultValues()));
    pluginKeys.delete("incidents");
    for (const i of REBUILT_INCIDENTS) formKeys.delete(i.key);
    expect([...formKeys].sort()).toEqual([...pluginKeys].sort());
    // and the per-shift human player counters (D8)
    for (const seg of ["transition", "shift1", "shift2", "shift3", "shift4"]) expect(formKeys.has(`teleop_humanPlayerFuel_${seg}`)).toBe(true);
    expect(formKeys.has("teleop_humanPlayerFuel")).toBe(false);
  });

  it("has CS's controls: 8 start positions, the three scales with CS's labels, 7 cycle timers, 7 incidents", () => {
    expect(byKey("startingPosition").options?.map((o) => o.value)).toEqual(["not-there", "outpost-trench", "outpost-side", "outpost-bump", "middle", "depot-bump", "depot-side", "depot-trench"]);
    expect(byKey("auto_bpsScale")).toMatchObject({ type: "slider", min: 0, max: 8, step: 1, stepLabels: ["0", "1-3", "4-6", "7-9", "10-13", "14-17", "18-21", "22-24", "25+"] });
    expect(byKey("auto_carryingScale").stepLabels).toHaveLength(9);
    expect(byKey("teleop_carryingScale").stepLabels?.[8]).toBe("75+");
    expect(byKey("auto_preloadScale")).toMatchObject({ max: 4, stepLabels: ["0", "1-2", "3-4", "5-6", "7-8"] });
    expect(fields().filter((f) => f.type === "timerList").map((f) => f.key)).toEqual([
      "auto_cycleTimes",
      "teleop_transitionCycles",
      "teleop_shift1Cycles",
      "teleop_shift2Cycles",
      "teleop_shift3Cycles",
      "teleop_shift4Cycles",
      "endgame_cycleTimes",
    ]);
    expect(byKey("endgame_status").options?.map((o) => o.value)).toEqual(["parked", "level-1", "level-2", "level-3"]);
    expect(REBUILT_INCIDENTS.map((i) => i.label)).toContain("Disabled by FRC");
    expect(fields().filter((f) => f.key.startsWith("incidents_"))).toHaveLength(7);
    for (const key of ["auto_successfulClimb", "auto_wonAuto", "auto_hubActivationOverride"]) expect(byKey(key).type).toBe("toggle");
    expect(byKey("notes").statRoles).toEqual(["comments"]);
    expect(byKey("incidents_died").statRoles).toEqual(["reliability", "died"]);
  });

  it("every field has a unique id and key, and a key within the 40-character limit", () => {
    const ids = fields().map((f) => f.id);
    const keys = fields().map((f) => f.key);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k.length).toBeLessThanOrEqual(40);
  });

  it("starts empty: scales at 0, no cycles, no status, nothing on, and a score of 0", () => {
    const v = defaultValues(REBUILT_FORM);
    expect(v).toMatchObject({ auto_bpsScale: 0, auto_cycleTimes: [], teleop_shift1Cycles: [], endgame_status: "", auto_wonAuto: false, incidents_died: false, notes: "" });
    expect(calculateScore(REBUILT_FORM, v).total).toBe(0);
  });

  it("shows which shifts are counted: parity false counts 1 and 3, true counts 2 and 4, and flips with either toggle", () => {
    const both = (a: boolean, b: boolean) => ({ ...defaultValues(REBUILT_FORM), auto_wonAuto: a, auto_hubActivationOverride: b });
    const off = shiftNotices(both(false, false));
    expect(off).toEqual(["teleop_counted13", "teleop_shift1_counted", "teleop_shift2_notCounted", "teleop_shift3_counted", "teleop_shift4_notCounted"]);
    const on = shiftNotices(both(true, false));
    expect(on).toEqual(["teleop_counted24", "teleop_shift1_notCounted", "teleop_shift2_counted", "teleop_shift3_notCounted", "teleop_shift4_counted"]);
    expect(shiftNotices(both(false, true))).toEqual(on); // Hub Activation Override flips it too
    expect(shiftNotices(both(true, true))).toEqual(off); // XOR: both on is the same as both off
    expect(byKey("teleop_shift1_counted").label).toBe("Shift 1 (Counted)");
    expect(byKey("teleop_shift1_notCounted").label).toBe("Shift 1 (Not Counted)");
  });

  it("the notices are not data: no value, no CSV column", () => {
    const slots = valueSlots(REBUILT_FORM).map((s) => s.field.type);
    expect(slots).not.toContain("notice");
    const cols = buildGameSchema(REBUILT_FORM).columns.map((c) => c.key);
    expect(cols.some((k) => k.includes("counted") || k.includes("Counted"))).toBe(false);
  });

  it("requires only the match and team (system pickers), as CS does", () => {
    expect(validateValues(REBUILT_FORM, defaultValues(REBUILT_FORM))).toEqual({});
    expect(fields().filter((f) => f.required).map((f) => f.key).sort()).toEqual(["match", "scoutName", "teamNumber"]);
  });

  it("scores exactly like the REBUILT plugin (and so CS), for both parities, through the form's own values", () => {
    for (const parity of [true, false]) {
      const doc = goldenDoc(parity);
      const values = normalizeValues(REBUILT_FORM, { ...rebuiltPlugin.docToValues(doc), ...incidentValuesFromList(doc.incidents) });
      const score = calculateScore(REBUILT_FORM, values);
      const expected = rebuiltPlugin.scoreDoc(doc);
      expect(score).toMatchObject({ auto: expected.auto, teleop: expected.teleop, endgame: expected.endgame, total: expected.total });
      if (parity) expect(score.total).toBe(221); // the plugin's own golden figure for parity true
      expect(storableScore(score)).toEqual({ auto: expected.auto, teleop: expected.teleop, endgame: expected.endgame, total: expected.total });
    }
  });

  it("the form's values go back to the same CS doc the plugin would write, once incidents are mapped", () => {
    const doc = goldenDoc(true);
    const values = normalizeValues(REBUILT_FORM, { ...rebuiltPlugin.docToValues(doc), ...incidentValuesFromList(doc.incidents) });
    const back = rebuiltPlugin.valuesToDoc({ ...values, incidents: incidentsFromValues(values) });
    expect(back).toMatchObject({ startingPosition: "middle", incidents: ["died", "red-card"], notes: "fast" });
    expect((back?.auto as Record<string, unknown>).cycleTimes).toEqual([0.5, 3, 5]);
    expect((back?.teleop as Record<string, unknown>).humanPlayerFuel).toBe(7);
  });

  it("incident helpers convert both ways and ignore unknown entries", () => {
    expect(REBUILT_INCIDENTS.map((i) => i.key)).toEqual(["incidents_died", "incidents_neverStarted", "incidents_disabled", "incidents_recovered", "incidents_tipped", "incidents_yellowCard", "incidents_redCard"]);
    expect(incidentValuesFromList(["never-started", "yellow-card", "bogus"])).toMatchObject({ incidents_neverStarted: true, incidents_yellowCard: true, incidents_died: false });
    expect(incidentsFromValues({ incidents_died: true, incidents_redCard: true, incidents_tipped: "yes" })).toEqual(["died", "red-card"]);
    expect(incidentValuesFromList(undefined)).toMatchObject({ incidents_died: false });
    expect(incidentsFromValues(incidentValuesFromList(REBUILT_INCIDENTS.map((i) => i.value)))).toEqual(REBUILT_INCIDENTS.map((i) => i.value));
  });

  it("the per-field climb points are display only: they are not counted a second time", () => {
    const v = { ...defaultValues(REBUILT_FORM), auto_successfulClimb: true, endgame_status: "level-3" };
    expect(calculateScore(REBUILT_FORM, v)).toMatchObject({ auto: 15, endgame: 30, total: 45 });
    expect(byKey("endgame_status").options?.map((o) => o.points)).toEqual([0, 10, 20, 30]);
  });

  it("exports and imports as a custom copy, keeping the scorer and the conditions", () => {
    const out = importForm(JSON.stringify(exportForm(REBUILT_FORM)));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.form.scoring).toEqual(REBUILT_FORM.scoring);
      expect(out.form.sections.flatMap((s) => s.fields).find((f) => f.key === "teleop_shift2_counted")?.visibleWhen).toEqual({ op: "xor", fieldKey: "auto_wonAuto", otherFieldKey: "auto_hubActivationOverride", value: true });
    }
  });

  it("builds analytics columns: cycle lists with count/total/avg, the three scores and the total", () => {
    const keys = buildGameSchema(REBUILT_FORM).columns.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(["auto_cycleTimes", "auto_cycleTimes__count", "auto_cycleTimes__total", "auto_cycleTimes__avg", "endgame_cycleTimes__avg", "teleop_shift4Cycles__count", "scoreAuto", "scoreTeleop", "scoreEndgame", "scoreTotal", "incidents_died", "notes"]));
  });
});
