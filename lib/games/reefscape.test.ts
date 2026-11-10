import { describe, expect, it } from "vitest";
import { reefscapePlugin as plugin } from "@/lib/games/reefscape";
import type { CsDoc } from "@/lib/games/types";
import { scoreEntryForGame, type ScoringEntry } from "@/lib/games/cs-oracle/analyticsScoring";
import { evaluateScoutingFlags } from "@/lib/games/cs-oracle/scoutingFlags";
import { computeRescoutDiff } from "@/lib/games/cs-oracle/rescoutComparison";
import { buildTacticalPrediction } from "@/lib/games/cs-oracle/predictionEngine";
import { compareScoutToLead } from "@/lib/games/cs-oracle/scoutVerification";

const csScore = (doc: CsDoc) => scoreEntryForGame(doc as ScoringEntry, "REEFSCAPE");

const golden: CsDoc = {
  teamNumber: "5678",
  startingPosition: "middle",
  leftStartingZone: true, // 3
  autoCoralL1: 2, // 6
  autoCoralL2: 1, // 4
  autoCoralL3: 1, // 6
  autoCoralL4: 1, // 7
  autoAlgaeProcessorScored: 1, // 6
  autoAlgaeNetScored: 1, // 4 -> auto 36
  teleopCoralL1: 3, // 6
  teleopCoralL2: 2, // 6
  teleopCoralL3: 2, // 8
  teleopCoralL4: 1, // 5
  teleopProcessorScored: 1, // 6
  teleopNetRobotScored: 2, // 8
  teleopNetHumanScored: 1, // 4 -> teleop 43
  stageStatus: "deep", // 12
  penaltyPoints: 5,
  incidents: [],
  notes: "",
};

describe("REEFSCAPE scoring (equals CS)", () => {
  it("hand-computed golden doc", () => {
    expect(csScore(golden)).toBe(96);
    expect(plugin.scoreDoc(golden)).toEqual({ auto: 36, teleop: 43, endgame: 12, total: 96, penalty: 5 });
  });

  it("climb text matching uses includes, like CS (not-parked contains park)", () => {
    const score = (stageStatus: string) => plugin.scoreDoc({ stageStatus }).total;
    expect(score("deep")).toBe(12);
    expect(score("Deep Cage")).toBe(12);
    expect(score("shallow")).toBe(6);
    expect(score("barge")).toBe(2);
    expect(score("parked")).toBe(2);
    expect(score("not-parked")).toBe(2); // CS quirk preserved
    expect(score("")).toBe(0);
    for (const s of ["deep", "Deep Cage", "shallow", "barge", "parked", "not-parked", "", "unknown"]) {
      expect(score(s)).toBe(csScore({ stageStatus: s }));
    }
  });

  it("matches CS for empty, partial and junk docs", () => {
    for (const doc of [{}, { game: "REEFSCAPE" }, { autoCoralL4: "3" }, { penaltyPoints: 7 }, { leftStartingZone: true }, { teleopNetHumanScored: 2 }] as CsDoc[]) {
      expect(plugin.scoreDoc(doc).total).toBe(csScore(doc));
    }
  });

  it("scoreValues on docToValues equals scoreDoc; valuesToDoc is null (read-only)", () => {
    expect(plugin.formId).toBeNull();
    expect(plugin.valuesToDoc(plugin.docToValues(golden))).toBeNull();
    expect(plugin.scoreValues(plugin.docToValues(golden))).toEqual(plugin.scoreDoc(golden));
    expect(plugin.docToValues(golden).autoCoralL3).toBe(1);
  });
});

describe("REEFSCAPE matches / flags / verify / predict / rescout", () => {
  it("a doc with no game field is REEFSCAPE", () => {
    expect(plugin.matches({})).toBe(true);
    expect(plugin.matches({ game: "" })).toBe(true);
    expect(plugin.matches({ game: "REEFSCAPE" })).toBe(true);
    expect(plugin.matches({ game: "REBUILT" })).toBe(false);
    expect(plugin.matches({ game: "CHARGED_UP" })).toBe(false);
  });

  it("flags equal CS evaluateScoutingFlags", () => {
    const docs: CsDoc[] = [
      golden,
      {},
      { autoCoralL4: 3 },
      { teleopNetHumanScored: 6 },
      { teleopNetHumanScored: 5, teleopCoralL4: 4 },
      { teleopNetHumanScored: 5, teleopCoralL4: 10 },
      { autoCoralL1: 1 },
    ];
    for (const doc of docs) expect(plugin.flags(doc)).toEqual(evaluateScoutingFlags(doc));
    expect(plugin.flags({}).map((f) => f.code)).toEqual(["zero-main-scoring"]);
    expect(plugin.flags({ autoCoralL4: 3 }).map((f) => f.code)).toEqual(["auto-only-no-teleop"]);
  });

  it("predict, rescout and verify equal CS", () => {
    const docs: CsDoc[] = [
      { ...golden, teamNumber: "1" },
      { ...golden, teamNumber: "1", stageStatus: "shallow", isPracticeScouting: true },
      { teamNumber: "1", autoCoralL1: 1 },
    ];
    for (const source of ["official", "practice", "combined"] as const) {
      expect(plugin.predict("1", docs, source, 75)).toEqual(buildTacticalPrediction("1", docs as never, "REEFSCAPE", source, 75));
    }
    const other = { ...golden, autoCoralL1: 0, stageStatus: "barge", leftStartingZone: false };
    expect(plugin.compareToExemplar(golden, other)).toEqual(computeRescoutDiff(golden, other));
    expect(plugin.verify(golden, other)).toEqual(compareScoutToLead(golden, other));
  });
});
