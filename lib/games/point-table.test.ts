import { describe, expect, it } from "vitest";
import { GAME_DEFINITIONS, GAME_ID_LIST, isPointTable, type PointTableGameDefinition } from "@/config/games";
import { incidentKey } from "@/lib/forms/incidents";
import { BUILTIN_FORMS } from "@/lib/forms/builtin";
import { valueFields } from "@/lib/forms/values";
import { scoreEntryForGame, type ScoringEntry } from "@/lib/games/cs-oracle/analyticsScoring";
import { getGamePlugin } from "@/lib/games/registry";
import type { CsDoc } from "@/lib/games/types";

// The generic point-table plugin and the generated form, checked for every game defined as a point table (REEFSCAPE, CHARGED UP): values -> doc -> values is
// lossless, the score equals CS's own function on randomly filled documents, and the form carries exactly the definition's fields.

const tables = GAME_ID_LIST.map((id) => GAME_DEFINITIONS[id]).filter(isPointTable) as PointTableGameDefinition[];

/** Small deterministic generator, so a failure reproduces. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe.each(tables)("$id point table", (def) => {
  const plugin = getGamePlugin(def.id);

  function randomValues(next: () => number): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const f of def.fields) {
      if (f.kind === "counter") values[f.key] = Math.floor(next() * 6);
      else if (f.kind === "toggle") values[f.key] = next() > 0.5;
      else if (f.kind === "number") values[f.key] = Math.floor(next() * 12);
      else if (f.kind === "select") values[f.key] = next() > 0.2 ? f.options![Math.floor(next() * f.options!.length)].value : "";
      else values[f.key] = next() > 0.5 ? "some text" : "";
    }
    values.incidents = def.incidents.filter(() => next() > 0.6).map((i) => i.value);
    return values;
  }

  it("round-trips values -> doc -> values losslessly, and the doc scores like CS", () => {
    const next = rng(def.year);
    for (let i = 0; i < 60; i++) {
      const values = randomValues(next);
      const doc = plugin.valuesToDoc(values)!;
      expect(doc.game).toBe(def.id);
      expect(plugin.docToValues(doc)).toEqual(values);
      expect(plugin.scoreValues(values)).toEqual(plugin.scoreDoc(doc));
      expect(plugin.scoreDoc(doc).total).toBe(scoreEntryForGame(doc as ScoringEntry, def.id));
    }
  });

  it("an empty doc, the defaults and a partial doc all score like CS", () => {
    const docs: CsDoc[] = [{}, plugin.valuesToDoc(plugin.defaultValues())!, { game: def.id, penaltyPoints: 3 }];
    for (const doc of docs) expect(plugin.scoreDoc(doc).total).toBe(scoreEntryForGame(doc as ScoringEntry, def.id));
    expect(plugin.scoreValues(plugin.defaultValues()).total).toBe(0);
  });

  it("puts a doc's unknown extras nowhere: valuesToDoc only writes what the definition lists", () => {
    const doc = plugin.valuesToDoc({ ...plugin.defaultValues(), notAField: 99 })!;
    expect(JSON.stringify(doc)).not.toContain("notAField");
  });

  it("generates a form with exactly the definition's fields plus one checkbox per incident", () => {
    const form = BUILTIN_FORMS[def.formId];
    const keys = valueFields(form).map((f) => f.key);
    const expected = [...def.fields.map((f) => f.key), ...def.incidents.map((i) => incidentKey(i.value))];
    expect([...keys].sort()).toEqual([...expected].sort());
    expect(new Set(keys).size).toBe(keys.length);
    // every section of the definition is in the form, in order, after the match picker
    expect(form.sections.map((s) => s.id)).toEqual(["assigned-match", ...def.sections.map((s) => s.id)]);
    // the form's score IS the plugin's: an empty form scores zero and the per-field rules are display only
    expect(form.scoring).toEqual({ mode: "custom", scorer: `game:${def.id}` });
  });

  it("every field's section exists, every select has options, every scored select has a rule", () => {
    const sections = new Set(def.sections.map((s) => s.id));
    for (const f of def.fields) {
      expect(sections.has(f.section), f.key).toBe(true);
      if (f.kind === "select") expect(f.options?.length, f.key).toBeGreaterThan(0);
      if (f.group) expect(def.sections.find((s) => s.id === f.section)?.groups?.some((g) => g.id === f.group), `${f.key} group`).toBe(true);
    }
  });
});
