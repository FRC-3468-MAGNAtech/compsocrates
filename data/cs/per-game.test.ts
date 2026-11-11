import { describe, expect, it } from "vitest";
import { GAME_DEFINITIONS, GAME_ID_LIST } from "@/config/games";
import { csDocToScoutEntry } from "@/data/cs/scouting";
import { buildGameSchema } from "@/lib/analytics/game-schema";
import { BUILTIN_FORMS } from "@/lib/forms/builtin";
import { calculateScore } from "@/lib/forms/scoring";
import { defaultValues } from "@/lib/forms/values";
import { evaluateScoutingFlags } from "@/lib/games/cs-oracle/scoutingFlags";
import { scoreEntryForGame, type ScoringEntry } from "@/lib/games/cs-oracle/analyticsScoring";
import { getGamePlugin } from "@/lib/games/registry";
import type { GameId } from "@/lib/games/types";
import { entryDocForSave, entryPayloadFor } from "@/lib/scout-entries";
import { blockingIssues, checkForm, parseForm } from "@/lib/forms/validate";

// One pure end-to-end check per game, on TEST DATA only (no Firestore): a scout's submission for the game's form goes through the SAME conversion saveEntry
// uses (`entryDocForSave`), and the raw CS document, its score against CS's own functions (cs-oracle), the read-back entry, the analytics columns and the
// form are all checked. The emulator version of the same flow is in data/cs/adapter.emulator.test.ts.

const NOW = 1_777_000_000_000;

type Case = {
  /** What the scout enters, on top of the form's defaults. */
  entered: Record<string, string | number | boolean | number[]>;
  /** The raw CS document keys the submission must produce (a subset match). */
  rawDoc: Record<string, unknown>;
  /** The total CS's own scoring gives that document (-1: not hand-computed, the REBUILT fuel formulas have their own golden tests). */
  total: number;
};

const CASES: Record<GameId, Case> = {
  REEFSCAPE: {
    entered: {
      startingPosition: "middle",
      leftStartingZone: true, // 3
      autoCoralL4: 2, // 14
      teleopCoralL2: 3, // 9
      teleopNetHumanScored: 1, // 4
      stageStatus: "deep", // 12
      penaltyPoints: 5,
      incidents_tipped: true,
      incidents_yellowCard: true,
      notes: "fast cycles",
    },
    rawDoc: { game: "REEFSCAPE", startingPosition: "middle", leftStartingZone: true, autoCoralL4: 2, teleopCoralL2: 3, teleopNetHumanScored: 1, stageStatus: "deep", penaltyPoints: 5, incidents: ["tipped", "yellow-card"], notes: "fast cycles" },
    total: 47,
  },
  CHARGED_UP: {
    entered: {
      startingPosition: "Middle",
      mobility: true, // 3
      auto_gridTop: 2, // 12
      auto_chargeStation: "engaged", // 12
      teleop_gridMiddle: 3, // 9
      teleop_links: 1, // 5
      endgame_chargeStation: "docked", // 6
      penaltyPoints: 4,
      incidents_died: true,
      notes: "tipped late",
    },
    rawDoc: {
      game: "CHARGED_UP",
      startingPosition: "Middle",
      mobility: true,
      auto: { mobility: true, gridTop: 2, chargeStation: "engaged" },
      teleop: { gridMiddle: 3, links: 1 },
      endgame: { chargeStation: "docked" },
      penaltyPoints: 4,
      incidents: ["died"],
      notes: "tipped late",
    },
    total: 51,
  },
  REBUILT: {
    entered: {
      startingPosition: "middle",
      auto_preloadScale: 2,
      auto_bpsScale: 3,
      auto_carryingScale: 4,
      auto_cycleTimes: [3, 4],
      auto_successfulClimb: true, // 15
      auto_wonAuto: true,
      teleop_bpsScale: 3,
      teleop_carryingScale: 4,
      teleop_transitionCycles: [5],
      teleop_shift2Cycles: [4],
      teleop_humanPlayerFuel_transition: 2,
      endgame_status: "level-2", // 20
      incidents_recovered: true,
      notes: "climbed",
    },
    rawDoc: { game: "REBUILT", startingPosition: "middle", incidents: ["recovered"], notes: "climbed", endgame: { status: "level-2" } },
    total: -1,
  },
};

const INPUT_BASE = { scoutName: "Ada Lovelace", eventCode: "2026arli", matchType: "Qualification" as const, matchNumber: 12, teamNumber: 254 };

describe.each(GAME_ID_LIST)("%s end to end (test data)", (gameId) => {
  const def = GAME_DEFINITIONS[gameId];
  const plugin = getGamePlugin(gameId);
  const form = BUILTIN_FORMS[def.formId];
  const c = CASES[gameId];
  const values = { ...defaultValues(form), ...c.entered };
  const score = calculateScore(form, values);
  const input = { ...INPUT_BASE, ...entryPayloadFor(form, values, score) };
  const doc = entryDocForSave("MAG2403", "uid-ada", input, { now: NOW });
  const csTotal = scoreEntryForGame(doc as ScoringEntry, gameId);

  it("has a valid built-in match form that scores with the game plugin", () => {
    expect(form.formType).toBe("match-scout");
    expect(form.scoring).toEqual({ mode: "custom", scorer: `game:${gameId}` });
    expect(parseForm(form).ok).toBe(true);
    expect(blockingIssues(checkForm(form))).toEqual([]);
    expect(def.submittable).toBe(true);
    expect(plugin.submittable).toBe(true);
  });

  it("writes the raw CS document shape", () => {
    expect(doc).toMatchObject({ teamId: "MAG2403", scoutId: "uid-ada", scoutName: "Ada Lovelace", eventKey: "2026arli", teamNumber: "254", matchNumber: "12", game: gameId });
    expect(doc).toMatchObject(c.rawDoc);
    expect(doc.submittedAt).toBe(NOW);
    // CS stores no score and no form bookkeeping on the doc
    for (const key of ["score", "formId", "formVersion", "values"]) expect(key in doc).toBe(false);
  });

  it("scores the same as CS's own scoring functions (cs-oracle)", () => {
    expect(score.total).toBe(csTotal);
    expect(plugin.scoreDoc(doc).total).toBe(csTotal);
    if (c.total >= 0) expect(csTotal).toBe(c.total);
    expect(csTotal).toBeGreaterThan(0);
  });

  it("reads back through csDocToScoutEntry with the same values, score, game and form", () => {
    const entry = csDocToScoutEntry("e1", doc)!;
    expect(entry).toMatchObject({ game: gameId, formId: def.formId, teamNumber: 254, matchNumber: 12, scoutName: "Ada Lovelace", comments: c.entered.notes });
    expect(entry.score.total).toBe(csTotal);
    for (const [key, entered] of Object.entries(c.entered)) expect(entry.values?.[key], key).toEqual(entered);
    // writing the read-back values again reproduces the same game values (lossless round trip)
    expect(plugin.docToValues(plugin.valuesToDoc(plugin.docToValues(doc))!)).toEqual(plugin.docToValues(doc));
  });

  it("raises the flags the game's rules give (CS's own for REEFSCAPE)", () => {
    const entry = csDocToScoutEntry("e1", doc)!;
    expect(entry.autoFlags.map((f) => f.ruleId)).toEqual(plugin.flags(doc).map((f) => f.code));
    if (gameId === "REEFSCAPE") expect(plugin.flags(doc)).toEqual(evaluateScoutingFlags(doc));
  });

  it("gives the Match Analytics table the score and a column for every scoring field", () => {
    const schema = buildGameSchema(form);
    const entry = csDocToScoutEntry("e1", doc)!;
    expect(schema.columns.find((col) => col.key === "scoreTotal")!.getValue(entry)).toBe(csTotal);
    expect(schema.columns.find((col) => col.key === "team")!.getValue(entry)).toBe(254);
    const scoring = def.formulas ? [] : (def.fields ?? []).filter((f) => f.points);
    for (const field of scoring) {
      expect(
        schema.columns.some((col) => col.label === field.label && col.category === field.category),
        `${field.key} column`
      ).toBe(true);
    }
    expect(schema.columns.filter((col) => col.label === "Died During Match")).toHaveLength(1);
  });
});
