import { describe, expect, it } from "vitest";
import { csDocToScoutEntry } from "@/data/cs/scouting";
import { buildClimbBoxes, climbRecordedCount } from "@/lib/analytics/climb-box";
import { entriesToCsv, parseImportCsv } from "@/lib/analytics/csv";
import { rebuiltDoc } from "@/lib/analytics/cs-test-fixtures";
import { buildGameSchema } from "@/lib/analytics/game-schema";
import { radarSamples } from "@/lib/analytics/robot-radar";
import { GAME_FORMS, DEFAULT_FORM_ID } from "@/lib/forms/builtin";
import { calculateScore } from "@/lib/forms/scoring";
import { defaultValues, normalizeValues } from "@/lib/forms/values";
import { getGamePlugin } from "@/lib/games/registry";
import { CURRENT_GAME_ID } from "@/config/games";
import type { ScoutEntry } from "@/lib/scout-entries";

// The optional "Attempted climb" answer on the REBUILT match form (`endgame.attemptedClimb`): zero points, additive, absent = unknown.
const form = GAME_FORMS[DEFAULT_FORM_ID];
const plugin = getGamePlugin(CURRENT_GAME_ID);
const KEY = "endgame_attemptedClimb";

const omit = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

const field = form.sections.flatMap((s) => s.fields).find((f) => f.key === KEY);

/** An entry saved with the new form: the doc the form writes, read back through the adapter. */
function entryWith(id: string, team: string, status: string, attempted: boolean | undefined): ScoutEntry {
  const base = rebuiltDoc({ team, match: `q${id.replace(/\D/g, "") || "1"}`, status });
  const values = { ...plugin.docToValues(base), ...(attempted === undefined ? {} : { [KEY]: attempted }) };
  const written = plugin.valuesToDoc(values)!;
  const doc = { ...base, endgame: written.endgame as Record<string, unknown> };
  const entry = csDocToScoutEntry(id, doc);
  if (!entry) throw new Error("doc did not become an entry");
  return entry;
}

describe("the form field", () => {
  it("is an optional toggle in the Endgame climb group, worth zero points, placed before the level select", () => {
    expect(field).toBeDefined();
    expect(field!.type).toBe("toggle");
    expect(field!.optionalAnswer).toBe(true);
    expect(field!.label).toBe("Attempted climb");
    expect(field!.scoring).toEqual({ mode: "none" });
    const endgame = form.sections.find((s) => s.id === "endgame")!;
    const order = endgame.fields.map((f) => f.key);
    expect(order.indexOf(KEY)).toBeLessThan(order.indexOf("endgame_status"));
  });

  it("a new entry starts answered (off); an old entry's missing answer stays absent through normalize", () => {
    expect(defaultValues(form)[KEY]).toBe(false);
    const old = normalizeValues(form, { endgame_status: "level-1" });
    expect(KEY in old).toBe(false);
    expect(normalizeValues(form, { [KEY]: true })[KEY]).toBe(true);
  });
});

describe("stored shape: additive, absent stays absent", () => {
  const base = plugin.docToValues(rebuiltDoc({ status: "level-2" }));

  it("no answer writes nothing", () => {
    const endgame = plugin.valuesToDoc(base)!.endgame as Record<string, unknown>;
    expect("attemptedClimb" in endgame).toBe(false);
    expect("attemptedClimbRecorded" in endgame).toBe(false);
  });

  it("an answer (yes or no) is written, with the marker that says it was recorded", () => {
    for (const answer of [true, false]) {
      const endgame = plugin.valuesToDoc({ ...base, [KEY]: answer })!.endgame as Record<string, unknown>;
      expect(endgame.attemptedClimb).toBe(answer);
      expect(endgame.attemptedClimbRecorded).toBe(true);
    }
  });

  it("round-trips: doc -> values -> doc", () => {
    const doc = plugin.valuesToDoc({ ...base, [KEY]: true })!;
    expect(plugin.docToValues(doc)[KEY]).toBe(true);
    expect(KEY in plugin.docToValues(plugin.valuesToDoc(base)!)).toBe(false);
  });

  it("an older CS document that merely carries attemptedClimb still reads as unknown", () => {
    const legacy = rebuiltDoc({ status: "level-3" });
    (legacy.endgame as Record<string, unknown>).attemptedClimb = true;
    expect(KEY in plugin.docToValues(legacy)).toBe(false);
  });
});

describe("scoring is unchanged with and without the field", () => {
  it("score, flags and every other stored field are identical", () => {
    for (const status of ["", "parked", "level-1", "level-3"]) {
      const values = plugin.docToValues(rebuiltDoc({ status, autoFuel: 12, teleFuel: 30, endFuel: 4, autoClimb: status === "level-3" }));
      const without = plugin.valuesToDoc(values)!;
      for (const answer of [true, false]) {
        const withField = plugin.valuesToDoc({ ...values, [KEY]: answer })!;
        expect(plugin.scoreDoc(withField), status).toEqual(plugin.scoreDoc(without));
        expect(plugin.flags(withField), status).toEqual(plugin.flags(without));
        const strip = (d: Record<string, unknown>) => {
          const rest = omit(d.endgame as Record<string, unknown>, ["attemptedClimb", "attemptedClimbRecorded"]);
          return { ...d, endgame: rest };
        };
        expect(strip(withField as Record<string, unknown>)).toEqual(strip(without as Record<string, unknown>));
      }
    }
  });

  it("the form engine's score ignores it too", () => {
    const values = normalizeValues(form, { ...defaultValues(form), endgame_status: "level-2" });
    const a = calculateScore(form, { ...values, [KEY]: true });
    const b = calculateScore(form, { ...values, [KEY]: false });
    const c = calculateScore(form, omit(values, [KEY]) as typeof values);
    expect(a.total).toBe(b.total);
    expect(a.total).toBe(c.total);
  });
});

describe("CSV round trip", () => {
  const schema = buildGameSchema(form);
  const header = (csv: string) => csv.split("\n")[0].split(",");

  it("the column is generated from the game config", () => {
    const csv = entriesToCsv(schema, [], (n) => n);
    expect(header(csv).some((h) => h.includes("Attempted climb"))).toBe(true);
  });

  it("answered exports Y or N; absent exports an empty cell", () => {
    const entries = [entryWith("1", "254", "", true), entryWith("2", "254", "", false), entryWith("3", "254", "", undefined)];
    const csv = entriesToCsv(schema, entries, (n) => n);
    const rows = csv.trim().split("\n");
    const col = rows[0].split(",").findIndex((h) => h.includes("Attempted climb"));
    expect(rows[1].split(",")[col]).toBe("Y");
    expect(rows[2].split(",")[col]).toBe("N");
    expect(rows[3].split(",")[col]).toBe("");
  });

  it("imports back: Y and N are answers, an empty cell stays absent (not off)", () => {
    const entries = [entryWith("1", "254", "", true), entryWith("2", "254", "", false), entryWith("3", "254", "", undefined)];
    const parsed = parseImportCsv(schema, entriesToCsv(schema, entries, (n) => n));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.map((r) => r.values[KEY])).toEqual([true, false, undefined]);
    expect(KEY in parsed.rows[2].values).toBe(false);
  });
});

describe("Climb Reliability box plot", () => {
  it("gets data from entries that answered yes, and counts what it rests on", () => {
    const entries = [entryWith("1", "254", "level-3", true), entryWith("2", "254", "level-2", true), entryWith("3", "254", "", true)];
    const { samples } = radarSamples(entries);
    const [box] = buildClimbBoxes(samples, [254]);
    expect(box.attemptCount).toBe(3);
    expect(box.successCount).toBe(2);
    expect(box.values).toEqual([0, 20, 30]); // a failed attempt (tried, no level) is a 0, not missing
    expect(climbRecordedCount(samples, [254])).toBe(3);
  });

  it("mixed present and absent: only the entries that have it are used", () => {
    const entries = [
      entryWith("1", "254", "level-3", true),
      entryWith("2", "254", "level-3", false), // answered: did not try, so it adds nothing to the plot but is counted as recorded
      entryWith("3", "254", "level-1", undefined), // old entry: unknown, left out entirely even though it reached a level
      entryWith("4", "1678", "level-2", undefined),
    ];
    const { samples } = radarSamples(entries);
    const [a, b] = buildClimbBoxes(samples, [254, 1678]);
    expect(a.attemptCount).toBe(1);
    expect(a.values).toEqual([30]);
    expect(b.attemptCount).toBe(0); // nothing recorded for 1678: empty, not zero
    expect(climbRecordedCount(samples, [254])).toBe(2);
    expect(climbRecordedCount(samples, [1678])).toBe(0);
    expect(climbRecordedCount(samples, [254, 1678])).toBe(2);
  });

  it("every entry unknown: the plot is empty and the count is 0", () => {
    const { samples } = radarSamples([entryWith("1", "254", "level-3", undefined)]);
    expect(buildClimbBoxes(samples, [254])[0].attemptCount).toBe(0);
    expect(climbRecordedCount(samples, [254])).toBe(0);
  });
});
