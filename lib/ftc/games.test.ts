import { describe, expect, it } from "vitest";
import { BIOBUZZ_CONFIG, BIOBUZZ_UNREALISTIC, CURRENT_FTC_GAME_ID, FTC_GAME_DEFINITIONS, FTC_GAME_ID_LIST } from "@/config/games/ftc";
import { GAME_ID_LIST } from "@/config/games";
import { ftcDocToScoutEntry } from "@/data/ftc/scouting";
import { BIOBUZZ_ENTRY_DOCS } from "@/data/ftc/fixtures";
import { BUILTIN_FORMS } from "@/lib/forms/builtin";
import { calculateScore } from "@/lib/forms/scoring";
import { checkForm } from "@/lib/forms/validate";
import { defaultValues, valueFields } from "@/lib/forms/values";
import type { FormValues } from "@/lib/forms/types";
import { DEFAULT_FTC_FORM_ID, FTC_GAME_FORMS, getFtcGamePlugin, isFtcGameId, listFtcGamePlugins } from "@/lib/ftc/games";
import * as oracle from "@/lib/ftc/oracle/biobuzz-v1";
import { getGamePlugin, isGameId } from "@/lib/games/registry";

const plugin = getFtcGamePlugin("BIOBUZZ");
const form = FTC_GAME_FORMS[DEFAULT_FTC_FORM_ID];
const oracleFields = oracle.allFields(oracle.BIOBUZZ_FORM_SCHEMA);

const phases = (s: { auto: number; teleop: number; endgame: number; total: number }) => ({ auto: s.auto, teleop: s.teleop, endgame: s.endgame, total: s.total });
const oracleScore = (values: oracle.FormValues) => oracle.calculateScore(oracle.BIOBUZZ_FORM_SCHEMA, values);

/** A small seeded PRNG so the fuzz cases are the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomValues(rand: () => number): oracle.FormValues {
  const v: oracle.FormValues = {};
  for (const f of oracleFields) {
    if (f.type === "counter") v[f.key] = Math.floor(rand() * 14);
    else if (f.type === "text") v[f.key] = rand() < 0.5 ? "" : "some note";
    else v[f.key] = rand() < 0.5;
  }
  return v;
}

describe("BIOBUZZ golden: stored entries score as they were stored", () => {
  for (const { name, doc } of BIOBUZZ_ENTRY_DOCS) {
    describe(name, () => {
      const stored = phases(doc.score as { auto: number; teleop: number; endgame: number; total: number });
      const entry = ftcDocToScoutEntry("e", doc);

      it("the fixture's stored score is what the frozen original scoring gives", () => {
        // an entry from before keyed values read as its typed fields, which is how the original scored it
        const raw = (doc.values ?? doc.fields) as oracle.FormValues;
        expect(oracleScore(raw)).toEqual(stored);
      });

      it("the converter exposes the values the scorers need", () => {
        expect(entry.values).toBeDefined();
        expect(entry.score).toEqual(stored);
      });

      it("the generated game plugin reproduces it", () => {
        expect(phases(plugin.scoreValues(entry.values ?? {}))).toEqual(stored);
      });

      it("the generated match form reproduces it (the fields' own rules)", () => {
        expect(phases(calculateScore(form, entry.values as FormValues))).toEqual(stored);
      });
    });
  }
});

describe("BIOBUZZ golden: the generated scoring equals the frozen original", () => {
  it("all off and all on", () => {
    const off = oracle.defaultValuesForSchema(oracle.BIOBUZZ_FORM_SCHEMA);
    const on = Object.fromEntries(oracleFields.map((f) => [f.key, f.type === "counter" ? 5 : f.type === "text" ? "" : true]));
    for (const values of [off, on]) {
      expect(phases(plugin.scoreValues(values))).toEqual(oracleScore(values));
      expect(phases(calculateScore(form, values as FormValues))).toEqual(oracleScore(values));
    }
    expect(oracleScore(on).total).toBe(3 + 5 + 5 * 20 + 5 * 20 + 5 + 5 * 2 + 5 * 1 + 5);
  });

  it("300 seeded random entries, by the plugin, by the form, and by scoring the flat doc", () => {
    const rand = rng(2026);
    for (let i = 0; i < 300; i++) {
      const values = randomValues(rand);
      const expected = oracleScore(values);
      expect(phases(plugin.scoreValues(values)), `plugin #${i}`).toEqual(expected);
      expect(phases(plugin.scoreDoc(values)), `scoreDoc #${i}`).toEqual(expected);
      expect(phases(calculateScore(form, values as FormValues)), `form #${i}`).toEqual(expected);
    }
  });

  it("has no penalty component (the sister app took penalties from the library match, not the entry)", () => {
    expect(plugin.scoreValues({ autoLeave: true, penaltyPoints: 50 })).toEqual({ auto: 3, teleop: 0, endgame: 0, total: 3 });
  });
});

describe("BIOBUZZ config matches the original form", () => {
  const def = FTC_GAME_DEFINITIONS.BIOBUZZ;
  const phaseOfSection = new Map<string, string>(def.sections.map((s) => [s.id, s.phase]));

  it("has exactly the original fields, in the original order", () => {
    expect(def.fields.map((f) => f.key)).toEqual(oracleFields.map((f) => f.key));
  });

  it("every scored field has the original points, rule and phase", () => {
    for (const f of oracleFields) {
      const mine = def.fields.find((x) => x.key === f.key);
      expect(mine, f.key).toBeDefined();
      if (f.points && f.phase) {
        expect(mine?.points, f.key).toEqual({ mode: f.type === "counter" ? "perTally" : "whenOn", value: f.points });
        expect(phaseOfSection.get(mine?.section ?? ""), f.key).toBe(f.phase);
      } else {
        expect(mine?.points, f.key).toBeUndefined();
      }
    }
  });

  it("value keys are flat (a field's doc path is its key) and there is no incidents list", () => {
    for (const f of def.fields) {
      expect(f.path, f.key).toBe(f.key);
      expect(f.mirrors, f.key).toBeUndefined();
    }
    expect(def.incidents).toEqual([]);
  });

  it("marks the same fields as reliability incidents", () => {
    const original = oracleFields.filter((f) => f.reliability).map((f) => f.key);
    expect(def.fields.filter((f) => f.statRoles?.includes("reliability")).map((f) => f.key)).toEqual(original);
    expect(original).toHaveLength(5);
  });

  it("carries the original unrealistic-scoring limits and primary scoring fields", () => {
    expect(BIOBUZZ_UNREALISTIC).toEqual({ autoTipHive: 3, teleTipHive: 6, flowerPollenNectar: 20, gardenPollenNectar: 40 });
    const limits = Object.fromEntries(def.fields.filter((f) => f.unrealisticAbove !== undefined).map((f) => [f.key, f.unrealisticAbove]));
    expect(limits).toEqual(BIOBUZZ_UNREALISTIC);
    expect(def.fields.filter((f) => f.statRoles?.includes("primaryScoring")).map((f) => f.key)).toEqual(["autoTipHive", "teleTipHive"]);
    expect(def.fields.find((f) => f.key === "comments")?.statRoles).toEqual(["comments"]);
  });

  it("identifies the game as the original did", () => {
    expect(BIOBUZZ_CONFIG).toMatchObject({ id: "BIOBUZZ", label: "BIOBUZZ", year: 2026, formId: oracle.DEFAULT_FORM_ID, submittable: true });
    expect(plugin).toMatchObject({ id: "BIOBUZZ", label: "BIOBUZZ", season: 2026, formId: "biobuzz", submittable: true });
    expect(def.thresholds.difficulty).toEqual({ easyMax: 40, mediumMax: 79 });
  });
});

describe("BIOBUZZ generated form", () => {
  it("is a valid published match-scout form with the original value fields in the original order", () => {
    expect(checkForm(form).filter((i) => i.severity === "error")).toEqual([]);
    expect(form).toMatchObject({ id: "biobuzz", name: "BIOBUZZ", formType: "match-scout", version: 1, status: "published", scoringEnabled: true, origin: "built-in" });
    expect(valueFields(form).map((f) => f.key)).toEqual(oracleFields.map((f) => f.key));
  });

  it("scores by its fields' own rules (no custom scorer) and has the sticky notes panel on", () => {
    expect(form.scoring).toBeUndefined();
    expect(form.stickyNotes).toEqual({ enabled: true, defaultOpen: false });
  });

  it("has the original defaults", () => {
    const now = defaultValues(form);
    for (const [key, value] of Object.entries(oracle.defaultValuesForSchema(oracle.BIOBUZZ_FORM_SCHEMA))) expect(now[key], key).toEqual(value);
  });

  it("carries the unrealistic limits and stat roles onto its fields", () => {
    const byKey = new Map(valueFields(form).map((f) => [f.key, f]));
    for (const [key, limit] of Object.entries(BIOBUZZ_UNREALISTIC)) expect(byKey.get(key)?.unrealisticAbove, key).toBe(limit);
    expect(byKey.get("diedDuringMatch")?.statRoles).toEqual(["reliability", "died"]);
    expect(byKey.get("teleTipHive")?.statRoles).toEqual(["primaryScoring"]);
  });

  it("puts teleop's fields in the Hive, Flower and Garden groups", () => {
    const teleop = form.sections.find((s) => s.id === "teleop");
    expect(teleop?.groups?.map((g) => g.id)).toEqual(["hive", "flower", "garden"]);
    expect(Object.fromEntries((teleop?.fields ?? []).map((f) => [f.key, f.groupId]))).toEqual({ teleTipHive: "hive", flowerBottomNectar: "flower", flowerPollenNectar: "flower", gardenPollenNectar: "garden" });
  });
});

describe("BIOBUZZ is scoped to the FTC program", () => {
  it("is in the FTC registry and only there", () => {
    expect(FTC_GAME_ID_LIST).toEqual(["BIOBUZZ"]);
    expect(CURRENT_FTC_GAME_ID).toBe("BIOBUZZ");
    expect(isFtcGameId("BIOBUZZ")).toBe(true);
    expect(isFtcGameId("REBUILT")).toBe(false);
    expect(listFtcGamePlugins().map((p) => p.id)).toEqual(["BIOBUZZ"]);
  });

  it("the default program's game lists, registry and built-in forms do not know it", () => {
    expect([...GAME_ID_LIST]).not.toContain("BIOBUZZ");
    expect(isGameId("BIOBUZZ")).toBe(false);
    expect(getGamePlugin("BIOBUZZ" as never)).toBeUndefined();
    expect(Object.keys(BUILTIN_FORMS)).not.toContain("biobuzz");
  });
});
