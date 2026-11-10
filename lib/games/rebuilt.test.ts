import { describe, expect, it } from "vitest";
import { REBUILT_CONFIG } from "@/config/games/rebuilt";
import { convertPitScale, rebuiltPlugin as plugin } from "@/lib/games/rebuilt";
import type { CsDoc } from "@/lib/games/types";
import { scoreEntryForGame, getRebuiltFuelBreakdown as csFuel, type ScoringEntry } from "@/lib/games/cs-oracle/analyticsScoring";
import { evaluateScoutingFlags } from "@/lib/games/cs-oracle/scoutingFlags";
import { compareScoutToLead } from "@/lib/games/cs-oracle/scoutVerification";
import { computeRescoutDiff } from "@/lib/games/cs-oracle/rescoutComparison";
import { buildTacticalPrediction } from "@/lib/games/cs-oracle/predictionEngine";

const csScore = (doc: CsDoc) => scoreEntryForGame(doc as ScoringEntry, "REBUILT");

/** Hand-computed golden doc (numbers worked out by hand from CS's formulas, see comments in the test). */
function goldenDoc(parity: boolean): CsDoc {
  return {
    game: "REBUILT",
    teamNumber: "1234",
    startingPosition: "middle",
    auto: {
      preloadScale: 2, // preload capacity 4
      bpsScale: 4, // 12 balls per second
      carryingScale: 5, // carry capacity 53
      cycleTimes: [0.5, 3, 5], // first cycle: min(4, 6) = 4; then min(53, 36) = 36; then min(53, 60) = 53 -> 93
      counterOverride: 0,
      counterOverrideMissedFuel: 5, // 93 - 5 = 88
      humanPlayerFuel: 3, // auto fuel = 91
      successfulClimb: true, // +15
      wonAuto: parity,
      hubActivationOverride: false,
      estimatedFuel: 91,
    },
    teleop: {
      shiftParityFromWonAuto: parity,
      bpsScale: 3, // 8 balls per second
      carryingScale: 3, // carry capacity 32
      transitionCycles: [2], // min(32, 16) = 16
      shift1Cycles: [1, 10], // 8 + 32 = 40
      shift2Cycles: [3], // min(32, 24) = 24
      shift3Cycles: [1], // 8, but scored override 10 wins -> 10
      shift4Cycles: [5], // 32, missed 2 -> 30
      shift3Override: 10,
      shift4MissedFuel: 2,
      humanPlayerFuel: 7,
    },
    endgame: {
      cycleTimes: [1, 1], // 8 + 8 = 16
      humanPlayerFuel: 2, // endgame fuel = 18
      status: "level-2", // +20
    },
    incidents: [],
    notes: "",
  };
}

describe("REBUILT golden scoring (equals CS analyticsScoring)", () => {
  it("parity true: counts transition + shift2 + shift4", () => {
    // auto 91 + 15, teleop 16 + (24 + 30) + 7 = 77, endgame 18 + 20 -> 221
    const doc = goldenDoc(true);
    expect(csScore(doc)).toBe(221);
    expect(plugin.scoreDoc(doc)).toEqual({ auto: 106, teleop: 77, endgame: 38, total: 221 });
  });

  it("parity false: counts transition + shift1 + shift3", () => {
    // teleop 16 + (40 + 10) + 7 = 73 -> 106 + 73 + 38 = 217
    const doc = goldenDoc(false);
    expect(csScore(doc)).toBe(217);
    expect(plugin.scoreDoc(doc)).toEqual({ auto: 106, teleop: 73, endgame: 38, total: 217 });
  });

  it("falls back to auto.wonAuto when shiftParityFromWonAuto is absent (CS behavior)", () => {
    const doc = goldenDoc(true);
    delete (doc.teleop as Record<string, unknown>).shiftParityFromWonAuto;
    expect(plugin.scoreDoc(doc).total).toBe(csScore(doc));
    expect(plugin.scoreDoc(doc).total).toBe(221);
    (doc.auto as Record<string, unknown>).wonAuto = false;
    expect(plugin.scoreDoc(doc).total).toBe(217);
  });

  it("matches CS on an empty doc and on partial docs", () => {
    for (const doc of [{}, { game: "REBUILT" }, { auto: {} }, { teleop: { humanPlayerFuel: 4 } }, { endgame: { status: "parked" } }] as CsDoc[]) {
      expect(plugin.scoreDoc(doc).total).toBe(csScore(doc));
    }
    expect(plugin.scoreDoc({ endgame: { status: "parked" } }).total).toBe(0);
    expect(plugin.scoreDoc({ endgame: { status: "LEVEL-3" } }).total).toBe(30);
  });

  it("scale tables equal CS", () => {
    expect(REBUILT_CONFIG.scales.bps.values).toEqual([0, 2, 5, 8, 12, 16, 20, 23, 25]);
    expect(REBUILT_CONFIG.scales.carry.values).toEqual([0, 12, 23, 32, 42, 53, 64, 74, 75]);
    expect(REBUILT_CONFIG.scales.preload.values).toEqual([0, 2, 4, 6, 8]);
    expect(REBUILT_CONFIG.points.autoClimb).toBe(15);
    expect(REBUILT_CONFIG.points.endgameClimb).toEqual({ "level-1": 10, "level-2": 20, "level-3": 30 });
  });

  it("fuzz: plugin total equals CS total for 400 random docs (including junk values)", () => {
    let seed = 20260101;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const int = (max: number) => Math.floor(rnd() * (max + 1));
    const maybe = <T,>(v: T): T | undefined => (rnd() < 0.8 ? v : undefined);
    const cycles = (): unknown => {
      const r = rnd();
      if (r < 0.1) return undefined;
      if (r < 0.15) return "oops";
      return Array.from({ length: int(5) }, () => {
        const k = rnd();
        if (k < 0.05) return -3;
        if (k < 0.1) return "4";
        if (k < 0.12) return null;
        return Math.round(rnd() * 120) / 10;
      });
    };
    const status = ["", "parked", "level-1", "level-2", "level-3", "Level-2", undefined];
    for (let i = 0; i < 400; i++) {
      const doc: CsDoc = {
        auto: {
          preloadScale: maybe(int(6) - 1),
          bpsScale: maybe(int(10) - 1),
          carryingScale: maybe(int(10) - 1),
          cycleTimes: cycles(),
          counterOverride: maybe(int(12)),
          counterOverrideMissedFuel: maybe(int(8)),
          humanPlayerFuel: maybe(int(10)),
          successfulClimb: maybe(rnd() < 0.5),
          wonAuto: maybe(rnd() < 0.5),
        },
        teleop: {
          shiftParityFromWonAuto: rnd() < 0.7 ? rnd() < 0.5 : undefined,
          bpsScale: maybe(int(9)),
          carryingScale: maybe(int(9)),
          transitionCycles: cycles(),
          shift1Cycles: cycles(),
          shift2Cycles: cycles(),
          shift3Cycles: cycles(),
          shift4Cycles: cycles(),
          transitionOverride: maybe(int(5)),
          transitionMissedFuel: maybe(int(5)),
          shift1Override: maybe(int(5)),
          shift1MissedFuel: maybe(int(5)),
          shift2Override: maybe(int(5)),
          shift2MissedFuel: maybe(int(5)),
          shift3Override: maybe(int(5)),
          shift3MissedFuel: maybe(int(5)),
          shift4Override: maybe(int(5)),
          shift4MissedFuel: maybe(int(5)),
          humanPlayerFuel: maybe(int(20)),
        },
        endgame: {
          cycleTimes: cycles(),
          counterOverride: maybe(int(5)),
          counterOverrideMissedFuel: maybe(int(5)),
          humanPlayerFuel: maybe(int(5)),
          status: status[int(status.length - 1)],
        },
      };
      const cs = csFuel(doc as ScoringEntry);
      const got = plugin.scoreDoc(doc);
      expect(got.total).toBe(csScore(doc));
      expect(got.teleop).toBe(cs.teleFuel);
    }
  });
});

describe("REBUILT docToValues / valuesToDoc", () => {
  it("uses the phase_field key convention", () => {
    const values = plugin.docToValues(goldenDoc(true));
    expect(values.auto_cycleTimes).toEqual([0.5, 3, 5]);
    expect(values.auto_preloadScale).toBe(2);
    expect(values.teleop_shift3Override).toBe(10);
    expect(values.teleop_shift4MissedFuel).toBe(2);
    expect(values.endgame_status).toBe("level-2");
    expect(values.startingPosition).toBe("middle");
    expect(values.auto_wonAuto).toBe(true);
  });

  it("writes the nested CS shape with parity, estimatedFuel and scoringWeights", () => {
    const values = {
      ...plugin.defaultValues(),
      startingPosition: "depot-side",
      auto_bpsScale: 4,
      auto_carryingScale: 5,
      auto_preloadScale: 2,
      auto_cycleTimes: [0.5, 3],
      auto_humanPlayerFuel: 3,
      auto_wonAuto: true,
      auto_hubActivationOverride: true, // XOR -> parity false
      auto_successfulClimb: true,
      teleop_bpsScale: 3,
      teleop_carryingScale: 3,
      teleop_shift1Cycles: [1],
      endgame_status: "level-1",
      incidents: ["died"],
      notes: "n",
    };
    const doc = plugin.valuesToDoc(values)!;
    expect(doc.game).toBe("REBUILT");
    expect(doc.startingPosition).toBe("depot-side");
    expect(doc.incidents).toEqual(["died"]);
    expect(doc.notes).toBe("n");
    expect(doc.scoringWeights).toEqual({ autoFuel: 1, autoClimbLevel1: 15, teleopFuel: 1, teleopClimbLevel1: 10, teleopClimbLevel2: 20, teleopClimbLevel3: 30 });
    const auto = doc.auto as Record<string, unknown>;
    expect(Object.keys(auto).sort()).toEqual(
      ["bpsScale", "carryingScale", "counterOverride", "counterOverrideMissedFuel", "cycleTimes", "estimatedFuel", "failedClimb", "hubActivationOverride", "humanPlayerFuel", "preloadScale", "successfulClimb", "wonAuto"].sort(),
    );
    // first cycle uses preload cap 4: min(4, 6) = 4; second min(53, 36) = 36 -> 40, + HP 3
    expect(auto.estimatedFuel).toBe(43);
    const teleop = doc.teleop as Record<string, unknown>;
    expect(teleop.shiftParityFromWonAuto).toBe(false);
    expect(teleop.shift1Cycles).toEqual([1]);
    expect(teleop.estimatedFuel).toBe(8); // shift1 counted under parity false: min(32, 8)
    const endgame = doc.endgame as Record<string, unknown>;
    expect(endgame.status).toBe("level-1");
    expect(endgame.failedClimb).toBe(0);
    // 43 + 15 + 8 + 0 + 10
    expect(plugin.scoreDoc(doc).total).toBe(76);
    expect(plugin.scoreValues(values)).toEqual(plugin.scoreDoc(doc));
  });

  it("round-trips a CS doc without changing its score, and the doc is a fixed point", () => {
    for (const parity of [true, false]) {
      const doc = goldenDoc(parity);
      const values = plugin.docToValues(doc);
      const back = plugin.valuesToDoc(values)!;
      expect(plugin.scoreDoc(back).total).toBe(csScore(doc));
      expect(plugin.scoreValues(values).total).toBe(csScore(doc));
      expect(plugin.valuesToDoc(plugin.docToValues(back))).toEqual(back);
    }
  });

  it("stored estimatedFuel from valuesToDoc equals CS's own per-section totals", () => {
    const doc = plugin.valuesToDoc(plugin.docToValues(goldenDoc(true)))!;
    const fuel = csFuel(doc as ScoringEntry);
    expect((doc.auto as Record<string, number>).estimatedFuel).toBe(fuel.autoFuel);
    expect((doc.teleop as Record<string, number>).estimatedFuel).toBe(fuel.teleFuel);
    expect((doc.endgame as Record<string, number>).estimatedFuel).toBe(fuel.endgameFuel);
  });
});

describe("D8: per-shift human-player fuel", () => {
  const base = () => ({
    ...plugin.defaultValues(),
    teleop_humanPlayerFuel_transition: 1,
    teleop_humanPlayerFuel_shift1: 2,
    teleop_humanPlayerFuel_shift2: 3,
    teleop_humanPlayerFuel_shift3: 4,
    teleop_humanPlayerFuel_shift4: 5,
  });

  it("parity true counts transition + shift2 + shift4", () => {
    const doc = plugin.valuesToDoc({ ...base(), auto_wonAuto: true })!;
    const teleop = doc.teleop as Record<string, unknown>;
    expect(teleop.humanPlayerFuel).toBe(1 + 3 + 5);
    expect(teleop.humanPlayerFuelByShift).toEqual({ transition: 1, shift1: 2, shift2: 3, shift3: 4, shift4: 5 });
    expect(plugin.scoreDoc(doc).teleop).toBe(9);
  });

  it("parity false counts transition + shift1 + shift3 (wonAuto XOR hubActivationOverride)", () => {
    const doc = plugin.valuesToDoc({ ...base(), auto_wonAuto: true, auto_hubActivationOverride: true })!;
    expect((doc.teleop as Record<string, unknown>).humanPlayerFuel).toBe(1 + 2 + 4);
    const doc2 = plugin.valuesToDoc({ ...base(), auto_wonAuto: false, auto_hubActivationOverride: false })!;
    expect((doc2.teleop as Record<string, unknown>).humanPlayerFuel).toBe(7);
    const doc3 = plugin.valuesToDoc({ ...base(), auto_wonAuto: false, auto_hubActivationOverride: true })!;
    expect((doc3.teleop as Record<string, unknown>).shiftParityFromWonAuto).toBe(true);
    expect((doc3.teleop as Record<string, unknown>).humanPlayerFuel).toBe(9);
  });

  it("a new doc scores through CS's own function using the summed teleop.humanPlayerFuel", () => {
    const values = { ...base(), auto_wonAuto: true };
    const doc = plugin.valuesToDoc(values)!;
    expect(csScore(doc)).toBe(9);
    expect(plugin.scoreValues(values).total).toBe(9);
  });

  it("OLD docs (only teleop.humanPlayerFuel) score exactly as CS and survive an edit round trip", () => {
    for (const parity of [true, false]) {
      const doc = goldenDoc(parity); // humanPlayerFuel: 7, no humanPlayerFuelByShift
      expect(plugin.scoreDoc(doc).total).toBe(csScore(doc));
      const values = plugin.docToValues(doc);
      expect(values.teleop_humanPlayerFuel_transition).toBe(7);
      expect(values.teleop_humanPlayerFuel_shift1).toBe(0);
      const saved = plugin.valuesToDoc(values)!;
      expect((saved.teleop as Record<string, unknown>).humanPlayerFuel).toBe(7);
      expect(plugin.scoreDoc(saved).total).toBe(csScore(doc));
      // flipping parity in the editor does not drop the old total
      const flipped = plugin.valuesToDoc({ ...values, auto_hubActivationOverride: true })!;
      expect((flipped.teleop as Record<string, unknown>).humanPlayerFuel).toBe(7);
    }
  });

  it("reads humanPlayerFuelByShift back into the per-shift values", () => {
    const doc = plugin.valuesToDoc({ ...base(), auto_wonAuto: true })!;
    const values = plugin.docToValues(doc);
    expect(values.teleop_humanPlayerFuel_shift1).toBe(2);
    expect(values.teleop_humanPlayerFuel_shift4).toBe(5);
  });
});

describe("REBUILT matches / flags / verify / predict / rescout", () => {
  it("matches only REBUILT docs", () => {
    expect(plugin.matches({ game: "REBUILT" })).toBe(true);
    expect(plugin.matches({ game: " rebuilt " })).toBe(true);
    expect(plugin.matches({})).toBe(false);
    expect(plugin.matches({ game: "REEFSCAPE" })).toBe(false);
  });

  it("flags equal CS evaluateScoutingFlags", () => {
    const docs: CsDoc[] = [
      goldenDoc(true),
      { game: "REBUILT" },
      { game: "REBUILT", auto: { estimatedFuel: 25 }, teleop: { estimatedFuel: 0 } },
      { game: "REBUILT", auto: { estimatedFuel: 5, humanPlayerFuel: 16 }, teleop: { estimatedFuel: 5 } },
      { game: "REBUILT", auto: { humanPlayerFuel: 15 } },
      { game: "REBUILT", auto: { estimatedFuel: 10 }, teleop: { estimatedFuel: 40, humanPlayerFuel: 15 } },
      plugin.valuesToDoc(plugin.docToValues(goldenDoc(false)))!,
    ];
    for (const doc of docs) {
      expect(plugin.flags(doc)).toEqual(evaluateScoutingFlags(doc));
    }
    expect(plugin.flags({ game: "REBUILT" }).map((f) => f.code)).toEqual(["zero-main-scoring"]);
    expect(plugin.flags({ game: "REBUILT", auto: { estimatedFuel: 25 } }).map((f) => f.code)).toEqual(["auto-only-no-teleop"]);
  });

  it("verify equals CS compareScoutToLead", () => {
    const lead = plugin.valuesToDoc(plugin.docToValues(goldenDoc(true)))!;
    const closeJunior = { ...lead, auto: { ...(lead.auto as object), estimatedFuel: 92 } };
    const farJunior = { ...lead, teleop: { ...(lead.teleop as object), estimatedFuel: 0 }, endgame: { ...(lead.endgame as object), status: "level-1" } };
    for (const junior of [lead, closeJunior, farJunior, {}]) {
      expect(plugin.verify(junior, lead)).toEqual(compareScoutToLead(junior, lead));
    }
    expect(plugin.verify(lead, lead)).toMatchObject({ verified: true, accuracy: 100, matchedMetrics: 5, totalMetrics: 5 });
    expect(plugin.verify(farJunior, lead).accuracy).toBe(60);
    expect(plugin.verify(farJunior, lead).verified).toBe(false);
  });

  it("predict equals CS buildTacticalPrediction", () => {
    const mk = (team: string, fuel: number, extra: CsDoc = {}): CsDoc => ({
      game: "REBUILT",
      teamNumber: team,
      startingPosition: "middle",
      auto: { humanPlayerFuel: fuel },
      teleop: {},
      endgame: {},
      ...extra,
    });
    const docs: CsDoc[] = [
      mk("10", 40),
      mk("10", 5),
      mk("10", 12, { isPracticeScouting: true }),
      mk("10", 8, { endgame: { status: "level-2" } }),
      mk("11", 0, { endgame: { status: "level-1" }, startingPosition: "" }),
      mk("11", 2, { auto: { successfulClimb: true } }),
      mk("12", 3, { matchType: "practice" }),
    ];
    for (const team of ["10", "11", "12", "99"]) {
      for (const source of ["official", "practice", "combined"] as const) {
        for (const tier of [75, 85, 90] as const) {
          expect(plugin.predict(team, docs, source, tier)).toEqual(buildTacticalPrediction(team, docs as never, "REBUILT", source, tier));
        }
      }
    }
    expect(plugin.predict("10", docs, "official", 85)).toMatchObject({ teamNumber: "10", sampleSize: 3, role: "Offense" });
    expect(plugin.predict("99", docs, "combined", 90)).toEqual({
      teamNumber: "99",
      startingPosition: "middle",
      role: "Defense",
      climbProbability: 0,
      estimatedPoints: 0,
      sampleSize: 0,
      confidenceTier: 90,
    });
  });

  it("compareToExemplar equals CS computeRescoutDiff", () => {
    const a = goldenDoc(true);
    const b = goldenDoc(false);
    (b.auto as Record<string, unknown>).cycleTimes = [1, 2];
    (b.endgame as Record<string, unknown>).status = "level-3";
    b.startingPosition = "Middle ";
    for (const [x, y] of [[a, a], [a, b], [b, a], [{ game: "REBUILT" }, a]] as Array<[CsDoc, CsDoc]>) {
      expect(plugin.compareToExemplar(x, y)).toEqual(computeRescoutDiff(x, y));
    }
    expect(plugin.compareToExemplar(a, a).diffPercent).toBe(0);
  });
});

describe("convertPitScale", () => {
  it("maps raw pit numbers to scale indices like CS", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 100].map((n) => convertPitScale(n, "preload"))).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 4]);
    expect([0, 1, 3, 4, 6, 7, 9, 10, 13, 14, 17, 18, 21, 22, 24, 25, 99].map((n) => convertPitScale(n, "bps"))).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8,
    ]);
    expect([0, 1, 12, 13, 23, 24, 32, 33, 42, 43, 53, 54, 64, 65, 74, 75, 200].map((n) => convertPitScale(n, "carry"))).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8,
    ]);
  });
});
