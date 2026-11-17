import { describe, expect, it } from "vitest";
import { GAME_IDS, gameForDoc, gameIdForDoc, getGamePlugin, isGameId, listGamePlugins } from "@/lib/games/registry";
import { calculateMatchAccuracyFromTotals, calculateScoutAccuracy, buildVerificationAccuracy, scoreStdDev } from "@/lib/games/accuracy";
import { calculateScoutAccuracy as csCalc, calculateMatchAccuracyFromTotals as csMatch } from "@/lib/games/cs-oracle/scoutAccuracy";
import { buildVerificationAccuracy as csBuild } from "@/lib/games/cs-oracle/scoutVerification";
import { DEFAULT_GAME_ID, GAME_CONFIGS, GAME_DEFINITIONS, GAME_ID_LIST } from "@/config/games";

describe("registry", () => {
  it("lists the three games, each retrievable by id", () => {
    expect([...GAME_IDS]).toEqual(["REBUILT", "REEFSCAPE", "CHARGED_UP"]);
    expect(listGamePlugins().map((p) => p.id)).toEqual(["REBUILT", "REEFSCAPE", "CHARGED_UP"]);
    for (const id of GAME_IDS) {
      expect(getGamePlugin(id).id).toBe(id);
      expect(GAME_CONFIGS[id].id).toBe(id);
    }
    expect(isGameId("REBUILT")).toBe(true);
    expect(isGameId("FOO")).toBe(false);
  });

  it("every game is submittable, with a form id and a writable valuesToDoc (D3, superseded)", () => {
    expect(getGamePlugin("REBUILT").formId).toBe("rebuilt");
    expect(getGamePlugin("REEFSCAPE").formId).toBe("reefscape");
    expect(getGamePlugin("CHARGED_UP").formId).toBe("charged_up");
    for (const plugin of listGamePlugins()) {
      expect(plugin.submittable).toBe(true);
      expect(GAME_DEFINITIONS[plugin.id].submittable).toBe(true);
      expect(plugin.valuesToDoc({})).not.toBeNull();
      expect(plugin.valuesToDoc({})).toMatchObject({ game: plugin.id });
    }
  });

  it("a game without formulas is generated from its point table; REBUILT keeps its custom plugin", () => {
    expect(GAME_DEFINITIONS.REBUILT.formulas).toBe("rebuilt");
    expect(GAME_DEFINITIONS.REEFSCAPE.formulas).toBeUndefined();
    expect(GAME_DEFINITIONS.CHARGED_UP.formulas).toBeUndefined();
    expect(Object.keys(GAME_DEFINITIONS).sort()).toEqual([...GAME_IDS].sort());
    // the only definition whose docs may have no `game` field is the default game
    expect(GAME_ID_LIST.filter((id) => GAME_DEFINITIONS[id].docsWithoutGame)).toEqual([DEFAULT_GAME_ID]);
  });

  it("gameForDoc: no game field is REEFSCAPE", () => {
    expect(gameForDoc({})?.id).toBe("REEFSCAPE");
    expect(gameForDoc({ game: undefined, autoCoralL1: 2 })?.id).toBe("REEFSCAPE");
    expect(gameForDoc({ game: "REBUILT" })?.id).toBe("REBUILT");
    expect(gameForDoc({ game: "CHARGED_UP" })?.id).toBe("CHARGED_UP");
    expect(gameForDoc({ game: "REEFSCAPE" })?.id).toBe("REEFSCAPE");
    expect(gameForDoc({ game: "SOMETHING_ELSE" })).toBeNull();
    expect(gameIdForDoc({ game: "SOMETHING_ELSE" })).toBe("REEFSCAPE");
  });

  it("every doc matches at most one plugin", () => {
    for (const doc of [{}, { game: "REBUILT" }, { game: "REEFSCAPE" }, { game: "CHARGED_UP" }, { game: "x" }]) {
      expect(listGamePlugins().filter((p) => p.matches(doc)).length).toBeLessThanOrEqual(1);
    }
  });
});

describe("scout accuracy (equals CS scoutAccuracy.ts)", () => {
  const inputs = [
    { accuracy: 0.95, environment: "real" as const },
    { accuracy: 0.6, environment: "trial" as const },
    { accuracy: 0.8, environment: "competitive" as const },
    { accuracy: 0.92, environment: "real" as const },
    { accuracy: Number.NaN, environment: "real" as const },
  ];

  it("matches CS for every mode and option set", () => {
    for (const mode of ["trial", "competitive", "real"] as const) {
      expect(calculateScoutAccuracy(inputs, { mode })).toEqual(csCalc(inputs, { mode }));
    }
    expect(calculateScoutAccuracy([])).toEqual(csCalc([]));
    expect(calculateScoutAccuracy(inputs, { minMatches: 3, highAccuracyThreshold: 0.9 })).toEqual(csCalc(inputs, { minMatches: 3, highAccuracyThreshold: 0.9 }));
  });

  it("match accuracy from totals", () => {
    for (const [a, b] of [[80, 100], [150, 100], [0, 100], [50, 0], [Number.NaN, 5]]) {
      expect(calculateMatchAccuracyFromTotals(a, b)).toEqual(csMatch(a, b));
    }
    expect(calculateMatchAccuracyFromTotals(90, 100)).toBeCloseTo(0.9);
  });

  it("verification accuracy equals CS", () => {
    expect(buildVerificationAccuracy([100, 80, 60], 90)).toEqual(csBuild([100, 80, 60], 90));
    expect(buildVerificationAccuracy([], 100)).toEqual(csBuild([], 100));
  });

  it("score standard deviation is the population deviation", () => {
    expect(scoreStdDev([])).toBe(0);
    expect(scoreStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
  });
});
