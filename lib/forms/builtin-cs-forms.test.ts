import { describe, expect, it } from "vitest";
import { CS_FORM_FIELD_SPECS, CS_FORM_TYPES, csFormValueKeys, csFormValueKeyNames, type CsFormType } from "@/data/cs/form-field-keys";
import { CS_FORM_SPECS } from "@/data/cs/forms";
import { csDocToScoutEntry } from "@/data/cs/scouting";
import { buildGameSchema, DEFAULT_GAME_ID, GAMES } from "@/lib/analytics/game-schema";
import { parseFilters } from "@/lib/analytics/filters";
import { BUILTIN_FORMS, DEFAULT_FORM_ID, isReadOnlyForm, nonMatchTypeOfFormId, seasonFormId, SEASON_NON_MATCH_FORM_IDS } from "@/lib/forms/builtin";
import { CHARGED_UP_FORM, REEFSCAPE_FORM } from "@/lib/forms/builtin-legacy-games";
import { DRIVE_REFLECTION_REBUILT_FORM, HELPER_REBUILT_FORM, LEAD_SCOUT_REBUILT_FORM, MATCH_STRATEGY_REBUILT_FORM, PIT_SCOUT_REBUILT_FORM, REBUILT_NON_MATCH_FORMS, REFLECTION_ROLES, TEAM_STRATEGY_REBUILT_FORM } from "@/lib/forms/builtin-rebuilt-forms";
import { canBeActive, emptyCatalog, listFormSummaries, resolveForm, resolveFormForEntry } from "@/lib/forms/resolve";
import { calculateScore } from "@/lib/forms/scoring";
import { REQUIRED_SYSTEM_FIELDS, isSystemField, type Form } from "@/lib/forms/types";
import { blockingIssues, checkForm, parseForm } from "@/lib/forms/validate";
import { valueFields } from "@/lib/forms/values";
import { chargedUpPlugin } from "@/lib/games/charged-up";
import { reefscapePlugin } from "@/lib/games/reefscape";
import { getAnalyticsSeasons, getEnabledSeasons, getSeason, isReadOnlySeason, seasonIdForProgram, SEASONS } from "@/lib/seasons";

// The REBUILT versions of the pit / lead / team strategy / match strategy / drive reflection / helper forms must be exactly what the CS adapter
// (data/cs/forms.ts) reads and writes, and the two retired games' read-only forms must score and read like their game plugins.

const FORM_BY_TYPE: Record<CsFormType, Form> = {
  "pit-scout": PIT_SCOUT_REBUILT_FORM,
  "lead-scout": LEAD_SCOUT_REBUILT_FORM,
  "team-strategy": TEAM_STRATEGY_REBUILT_FORM,
  "match-strategy": MATCH_STRATEGY_REBUILT_FORM,
  "drive-reflection": DRIVE_REFLECTION_REBUILT_FORM,
  helper: HELPER_REBUILT_FORM,
};

const formKeys = (form: Form): string[] => valueFields(form).map((f) => f.key);

describe("the REBUILT non-match forms against the CS adapter", () => {
  it("covers every CS form type, under the ids and versions the adapter attributes entries to", () => {
    for (const type of CS_FORM_TYPES) {
      const form = FORM_BY_TYPE[type];
      expect(form.formType).toBe(type);
      expect(form.id).toBe(CS_FORM_SPECS[type].formId);
      expect(form.version).toBe(CS_FORM_SPECS[type].formVersion);
      expect(BUILTIN_FORMS[form.id]).toBe(form);
      expect(form.origin).toBe("built-in");
    }
    expect(Object.keys(REBUILT_NON_MATCH_FORMS).sort()).toEqual(CS_FORM_TYPES.map((t) => CS_FORM_SPECS[t].formId).sort());
  });

  it.each(CS_FORM_TYPES)("%s: value keys are csFormValueKeys, no more and no fewer", (type) => {
    const keys = formKeys(FORM_BY_TYPE[type]);
    expect(new Set(keys).size).toBe(keys.length);
    const table = csFormValueKeyNames(type);
    // the only table key a form may leave out: the lead pick number, which CS reads but its form never asks for
    const skipped = table.filter((k) => !keys.includes(k));
    expect(skipped.every((k) => /^robot\d_pickNumber$/.test(k)), `missing ${skipped.join(", ")}`).toBe(true);
    expect(keys.filter((k) => !table.includes(k))).toEqual([]);
  });

  it.each(CS_FORM_TYPES)("%s: a field's type stores the primitive CS stores, and required follows CS", (type) => {
    const form = FORM_BY_TYPE[type];
    const byKey = new Map(valueFields(form).map((f) => [f.key, f]));
    for (const k of csFormValueKeys(type, 3)) {
      const f = byKey.get(k.key);
      if (!f) continue;
      const stores = { string: ["text", "textarea", "select", "radio"], boolean: ["toggle", "checkbox"], number: ["number", "slider"] }[k.kind];
      expect(stores, `${k.key} is a ${f.type}`).toContain(f.type);
      if (k.min !== undefined && (f.type === "slider" || f.type === "number")) expect(f.min, k.key).toBe(k.min);
      if (k.max !== undefined && (f.type === "slider" || f.type === "number")) expect(f.max, k.key).toBe(k.max);
      // CS's match strategy and drive reflection only need the match: their team numbers are optional on the page, whatever the key table says
      const planTeam = (type === "match-strategy" || type === "drive-reflection") && /^robot\d_teamNumber$/.test(k.key);
      if (!planTeam) expect(!!f.required, `${k.key} required`).toBe(!!k.required);
      if (f.type === "select" && k.options && !(type === "drive-reflection" && k.key.endsWith("_role"))) {
        const expected = k.options.filter((o) => o.value !== "").map((o) => o.value);
        expect(f.options?.map((o) => o.value), k.key).toEqual(expected);
      }
    }
  });

  it("keeps CS's own option lists: the drive reflection's role list is not the match strategy's", () => {
    const role = (form: Form) => valueFields(form).find((f) => f.key === "robot1_role")!.options!.map((o) => o.value);
    expect(role(MATCH_STRATEGY_REBUILT_FORM)).toEqual(["Offense", "Defense", "Feeder"]);
    expect(role(DRIVE_REFLECTION_REBUILT_FORM)).toEqual(REFLECTION_ROLES.map((r) => r.value));
    expect(role(DRIVE_REFLECTION_REBUILT_FORM)).toEqual(["cycler", "passer", "shooter", "stealer"]);
  });

  it.each(CS_FORM_TYPES)("%s: is a valid form with its required system fields and no blocking issue", (type) => {
    const form = FORM_BY_TYPE[type];
    expect(parseForm(form).ok).toBe(true);
    expect(blockingIssues(checkForm(form)), form.id).toEqual([]);
    const systemTypes = form.sections.flatMap((s) => s.fields).filter(isSystemField).map((f) => f.type).sort();
    expect(systemTypes).toEqual([...REQUIRED_SYSTEM_FIELDS[type]].sort());
    expect(form.scoringEnabled).toBe(false);
  });

  it("has explicit robot1_ .. robot3_ fields for an alliance of three, never per-team repeat groups", () => {
    for (const type of ["lead-scout", "match-strategy", "drive-reflection"] as const) {
      const form = FORM_BY_TYPE[type];
      expect(form.sections.flatMap((s) => s.groups ?? []).filter((g) => g.repeat)).toEqual([]);
      for (const n of [1, 2, 3]) expect(formKeys(form)).toContain(`robot${n}_teamNumber`);
      expect(formKeys(form).some((k) => /^t\d_/.test(k))).toBe(false);
    }
  });

  it("lead scout: the skill levels are 1-5 sliders starting at 1, all three team numbers are required, there is an overall alliance block", () => {
    const fields = new Map(valueFields(LEAD_SCOUT_REBUILT_FORM).map((f) => [f.key, f]));
    for (const k of ["overallAlliance_skillLevel", "robot1_skillLevel", "robot2_skillLevel", "robot3_skillLevel"]) {
      expect(fields.get(k)).toMatchObject({ type: "slider", min: 1, max: 5, step: 1, default: 1 });
    }
    for (const n of [1, 2, 3]) expect(fields.get(`robot${n}_teamNumber`)?.required).toBe(true);
    expect(fields.get("overallAlliance_teams")?.placeholder).toBe("RED / 1111, 2222, 3333");
  });

  it("pit scout: the three fuel scales are free text (CS stores strings such as 10-13 or x)", () => {
    for (const k of ["fuelPreloadCapacity", "fuelBallsPerSecond", "fuelCarryingCapacity"]) {
      const f = valueFields(PIT_SCOUT_REBUILT_FORM).find((x) => x.key === k)!;
      expect(f.type).toBe("text");
    }
  });

  it("drive reflection compares with the REBUILT match strategy on flat robot keys that exist on both forms", () => {
    const cmp = DRIVE_REFLECTION_REBUILT_FORM.compareWith!;
    expect(cmp.formId).toBe(MATCH_STRATEGY_REBUILT_FORM.id);
    const own = new Set(formKeys(DRIVE_REFLECTION_REBUILT_FORM));
    const plan = new Set(formKeys(MATCH_STRATEGY_REBUILT_FORM));
    for (const [k, planKey] of Object.entries(cmp.fieldMap)) {
      expect(own.has(k), k).toBe(true);
      expect(plan.has(planKey), planKey).toBe(true);
    }
  });
});

describe("season resolution of the non-match forms", () => {
  it("REBUILT is the default season; the program picks BIOBUZZ for FTC", () => {
    expect(seasonIdForProgram("frc")).toBe("rebuilt");
    expect(seasonIdForProgram("ftc")).toBe("biobuzz");
    expect(DEFAULT_FORM_ID).toBe("rebuilt");
    expect(DEFAULT_GAME_ID).toBe("rebuilt");
  });

  it("maps every non-match form to the season's own id, from either season's id or the type", () => {
    for (const type of CS_FORM_TYPES) {
      const rebuilt = SEASON_NON_MATCH_FORM_IDS.rebuilt[type];
      const biobuzz = SEASON_NON_MATCH_FORM_IDS.biobuzz[type];
      expect(rebuilt).toBe(CS_FORM_SPECS[type].formId);
      expect(biobuzz).not.toBe(rebuilt);
      expect(BUILTIN_FORMS[rebuilt]).toBe(FORM_BY_TYPE[type]);
      expect(BUILTIN_FORMS[biobuzz]?.formType).toBe(type);
      expect(BUILTIN_FORMS[biobuzz]?.id).toBe(biobuzz);
      for (const given of [rebuilt, biobuzz, type]) {
        expect(seasonFormId(given, "rebuilt")).toBe(rebuilt);
        expect(seasonFormId(given, "biobuzz")).toBe(biobuzz);
        expect(seasonFormId(given)).toBe(rebuilt); // the default season
      }
      expect(nonMatchTypeOfFormId(rebuilt)).toBe(type);
      expect(nonMatchTypeOfFormId(biobuzz)).toBe(type);
    }
  });

  it("leaves any other id (a custom form, a match form) alone", () => {
    expect(seasonFormId("my-custom-form", "biobuzz")).toBe("my-custom-form");
    expect(seasonFormId("rebuilt", "biobuzz")).toBe("rebuilt");
    expect(seasonFormId("toString", "biobuzz")).toBe("toString");
  });

  it("keeps the BIOBUZZ set intact: Hive, Flower and Garden still describe it", () => {
    const pit = BUILTIN_FORMS["biobuzz-pit-scout-v1"];
    expect(pit.sections.flatMap((s) => s.fields).some((f) => f.key === "capabilities")).toBe(true);
    for (const type of CS_FORM_TYPES) {
      const form = BUILTIN_FORMS[SEASON_NON_MATCH_FORM_IDS.biobuzz[type]];
      expect(blockingIssues(checkForm(form)), form.id).toEqual([]);
    }
    expect(BUILTIN_FORMS["biobuzz-drive-reflection-v1"].compareWith?.formId).toBe("biobuzz-match-strategy-v1");
  });

  it("resolves both sets by id from an empty catalog, and lists both", () => {
    const catalog = emptyCatalog();
    for (const ids of Object.values(SEASON_NON_MATCH_FORM_IDS)) for (const id of Object.values(ids)) expect(resolveForm(catalog, id)?.id).toBe(id);
    const listed = listFormSummaries(catalog).map((s) => s.id);
    for (const ids of Object.values(SEASON_NON_MATCH_FORM_IDS)) for (const id of Object.values(ids)) expect(listed).toContain(id);
  });
});

describe("the retired games stay readable and never become a new entry", () => {
  it("are resolvable by id (so old entries get their columns) but hidden from lists, pickers and the active-form choice", () => {
    const catalog = emptyCatalog();
    for (const form of [REEFSCAPE_FORM, CHARGED_UP_FORM]) {
      expect(BUILTIN_FORMS[form.id]).toBe(form);
      expect(isReadOnlyForm(form.id)).toBe(true);
      expect(resolveForm(catalog, form.id)).toBe(form);
      expect(resolveFormForEntry(catalog, form.id, 1)).toBe(form);
      expect(listFormSummaries(catalog).some((s) => s.id === form.id)).toBe(false);
      expect(canBeActive(catalog, form.id)).toBe(false);
    }
    expect(isReadOnlyForm("rebuilt")).toBe(false);
    expect(isReadOnlyForm("biobuzz")).toBe(false);
  });

  it("are read-only seasons: in the analytics Game filter, not in any new-entry picker", () => {
    expect(isReadOnlySeason("reefscape")).toBe(true);
    expect(isReadOnlySeason("charged_up")).toBe(true);
    expect(getEnabledSeasons().map((s) => s.id)).toEqual(["rebuilt", "biobuzz"]);
    expect(getAnalyticsSeasons().map((s) => s.id)).toEqual(["rebuilt", "reefscape", "charged_up", "biobuzz"]);
    expect(getAnalyticsSeasons()[0].id).toBe("rebuilt"); // REBUILT first, and the default
    expect(getSeason("charged_up")).toMatchObject({ formId: "charged_up", apiSeason: 2023 });
    expect(getSeason("reefscape")).toMatchObject({ formId: "reefscape", apiSeason: 2025 });
    expect(SEASONS.every((s) => !s.readOnly || BUILTIN_FORMS[s.formId])).toBe(true);
  });

  it("have analytics tables registered under the filter's game ids, which the URL filter accepts", () => {
    for (const form of [REEFSCAPE_FORM, CHARGED_UP_FORM]) {
      expect(GAMES[form.id].id).toBe(form.id);
      expect(GAMES[form.id].columns.map((c) => c.key)).toEqual(buildGameSchema(form).columns.map((c) => c.key));
      expect(parseFilters({ get: (n: string) => (n === "game" ? form.id : null) }).gameId).toBe(form.id);
    }
    expect(parseFilters({ get: () => null }).gameId).toBe("rebuilt");
  });
});

// --- legacy form parity ------------------------------------------------------------------------------------------

const REEF_DOC = {
  game: "REEFSCAPE",
  teamNumber: "254",
  eventKey: "2025cave",
  matchId: "q5",
  startingPosition: "middle",
  leftStartingZone: true,
  autoCoralMissed: 1,
  autoCoralL1: 1,
  autoCoralL2: 2,
  autoCoralL3: 1,
  autoCoralL4: 1,
  autoAlgaeProcessorMissed: 0,
  autoAlgaeProcessorScored: 1,
  autoAlgaeNetMissed: 1,
  autoAlgaeNetScored: 2,
  teleopCoralMissed: 2,
  teleopCoralL1: 3,
  teleopCoralL2: 2,
  teleopCoralL3: 4,
  teleopCoralL4: 5,
  teleopAlgaeRemoved: true,
  teleopProcessorMissed: 1,
  teleopProcessorScored: 3,
  teleopNetRobotMissed: 0,
  teleopNetRobotScored: 2,
  teleopNetHumanMissed: 1,
  teleopNetHumanScored: 4,
  failedClimb: 1,
  stageStatus: "deep",
  penaltyPoints: -3,
  incidents: ["tipped", "yellow-card"],
  notes: "Fast cycles, tipped once.",
};

const CU_DOC = {
  game: "CHARGED_UP",
  teamNumber: "1678",
  eventKey: "2023cmp",
  matchId: "q9",
  startingPosition: "Middle",
  mobility: true,
  penaltyPoints: 4,
  incidents: ["disabled"],
  notes: "Docked in auto.",
  auto: { gridBottom: 1, gridMiddle: 2, gridTop: 1, missed: true, chargeStation: "Docked" },
  teleop: { gridBottom: 3, gridMiddle: 2, gridTop: 2, missed: false, links: 2 },
  endgame: { chargeStation: "Engaged" },
};

const NESTED_MOBILITY_DOC = { ...CU_DOC, mobility: undefined, auto: { ...CU_DOC.auto, mobility: true }, endgame: { chargeStation: "Parked" } };
const EMPTY_DOC = { game: "CHARGED_UP", teamNumber: "1", eventKey: "2023cmp", matchId: "q1" };
const REEF_SPARSE = { teamNumber: "9", eventKey: "2025cave", matchId: "q2", stageStatus: "not-parked", autoCoralL4: 2, leftStartingZone: false }; // no `game`: REEFSCAPE, and "not-parked" scores 2 (CS quirk)

describe("REEFSCAPE and CHARGED UP forms against their plugins", () => {
  it("define a value field for every key the plugin's docToValues emits, and nothing the plugin does not know", () => {
    const reefKeys = new Set(Object.keys(reefscapePlugin.docToValues(REEF_DOC)));
    const reefForm = new Set(formKeys(REEFSCAPE_FORM));
    for (const k of reefKeys) expect(reefForm.has(k), k).toBe(true);
    for (const k of reefForm) expect(reefKeys.has(k), k).toBe(true);

    const cuKeys = new Set([...Object.keys(chargedUpPlugin.docToValues(CU_DOC)), ...Object.keys(chargedUpPlugin.docToValues(NESTED_MOBILITY_DOC))]);
    const cuForm = new Set(formKeys(CHARGED_UP_FORM));
    for (const k of cuKeys) expect(cuForm.has(k), k).toBe(true);
    for (const k of cuForm) expect(cuKeys.has(k), k).toBe(true);
  });

  it("are valid forms (match scouting, custom scoring by the game plugin) with no blocking issue", () => {
    for (const [form, scorer] of [[REEFSCAPE_FORM, "game:REEFSCAPE"], [CHARGED_UP_FORM, "game:CHARGED_UP"]] as const) {
      expect(parseForm(form).ok, form.id).toBe(true);
      expect(blockingIssues(checkForm(form)), form.id).toEqual([]);
      expect(form.formType).toBe("match-scout");
      expect(form.scoringEnabled).toBe(true);
      expect(form.scoring).toEqual({ mode: "custom", scorer });
    }
  });

  it("score a form built from docToValues(doc) exactly as the plugin scores the doc", () => {
    const cases = [
      [REEFSCAPE_FORM, reefscapePlugin, REEF_DOC],
      [REEFSCAPE_FORM, reefscapePlugin, REEF_SPARSE],
      [REEFSCAPE_FORM, reefscapePlugin, { ...REEF_DOC, stageStatus: "shallow" }],
      [REEFSCAPE_FORM, reefscapePlugin, { ...REEF_DOC, stageStatus: "barge", penaltyPoints: 5 }],
      [CHARGED_UP_FORM, chargedUpPlugin, CU_DOC],
      [CHARGED_UP_FORM, chargedUpPlugin, NESTED_MOBILITY_DOC],
      [CHARGED_UP_FORM, chargedUpPlugin, EMPTY_DOC],
    ] as const;
    for (const [form, plugin, doc] of cases) {
      const values = plugin.docToValues(doc as Record<string, unknown>) as Parameters<typeof calculateScore>[1];
      const got = calculateScore(form, values);
      const want = plugin.scoreDoc(doc as Record<string, unknown>);
      expect({ auto: got.auto, teleop: got.teleop, endgame: got.endgame, total: got.total }, JSON.stringify(doc)).toEqual({ auto: want.auto, teleop: want.teleop, endgame: want.endgame, total: want.total });
    }
    // sanity: these are not all zero
    expect(reefscapePlugin.scoreDoc(REEF_DOC).total).toBeGreaterThan(50);
    expect(chargedUpPlugin.scoreDoc(CU_DOC).total).toBeGreaterThan(30);
  });

  it("attribute adapter-read entries to the form with the same id, which then resolves and scores to the entry's stored score", () => {
    for (const [form, doc] of [[REEFSCAPE_FORM, REEF_DOC], [REEFSCAPE_FORM, REEF_SPARSE], [CHARGED_UP_FORM, CU_DOC]] as const) {
      const entry = csDocToScoutEntry("e1", { ...doc, teamId: "t1", scoutId: "u1", scoutName: "Ada", createdAt: 1, submittedAt: 2 });
      expect(entry, form.id).not.toBeNull();
      expect(entry!.formId).toBe(form.id);
      const resolved = resolveFormForEntry(emptyCatalog(), entry!.formId, entry!.formVersion);
      expect(resolved).toBe(form);
      const score = calculateScore(resolved!, entry!.values ?? {});
      expect(score.total).toBe(entry!.score.total);
      expect(score.auto).toBe(entry!.score.auto);
      expect(score.teleop).toBe(entry!.score.teleop);
      expect(score.endgame).toBe(entry!.score.endgame);
    }
  });

  it("show an old entry's values in the analytics columns (counts, select labels, incident codes as text)", () => {
    const entry = csDocToScoutEntry("e1", { ...REEF_DOC, teamId: "t1", scoutId: "u1", scoutName: "Ada", createdAt: 1, submittedAt: 2 })!;
    const col = (key: string) => GAMES.reefscape.columns.find((c) => c.key === key);
    expect(col("autoCoralL4")?.getValue(entry)).toBe(1);
    expect(col("teleopNetHumanScored")?.getValue(entry)).toBe(4);
    expect(col("leftStartingZone")?.getValue(entry)).toBe(true);
    expect(col("stageStatus")?.getValue(entry)).toBe("Deep Cage");
    expect(String(col("incidents")?.getValue(entry))).toContain("tipped");
    expect(col("scoreTotal")?.getValue(entry)).toBe(entry.score.total);

    const cu = csDocToScoutEntry("e2", { ...CU_DOC, teamId: "t1", scoutId: "u1", scoutName: "Ada", createdAt: 1, submittedAt: 2 })!;
    const cuCol = (key: string) => GAMES.charged_up.columns.find((c) => c.key === key);
    expect(cuCol("auto_gridMiddle")?.getValue(cu)).toBe(2);
    expect(cuCol("endgame_chargeStation")?.getValue(cu)).toBe("Engaged");
    expect(cuCol("teleop_links")?.getValue(cu)).toBe(2);
    expect(cuCol("scoreTotal")?.getValue(cu)).toBe(cu.score.total);
  });

  it("reuse the config's labels, points and options", () => {
    const stage = valueFields(REEFSCAPE_FORM).find((f) => f.key === "stageStatus")!;
    expect(stage.options?.map((o) => [o.value, o.points])).toEqual([["not-parked", 2], ["barge", 2], ["shallow", 6], ["deep", 12]]);
    const engaged = valueFields(CHARGED_UP_FORM).find((f) => f.key === "endgame_chargeStation")!;
    expect(engaged.options?.map((o) => [o.value, o.points])).toEqual([["Parked", 2], ["Docked", 6], ["Engaged", 10]]);
  });
});

describe("the key table itself", () => {
  it("is what these forms were built from", () => {
    for (const type of CS_FORM_TYPES) expect(CS_FORM_FIELD_SPECS[type].formType).toBe(type);
  });
});
