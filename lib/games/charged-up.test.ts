import { describe, expect, it } from "vitest";
import { getGamePlugin } from "@/lib/games/registry";
import type { CsDoc } from "@/lib/games/types";
import { scoreEntryForGame, type ScoringEntry } from "@/lib/games/cs-oracle/analyticsScoring";
import { buildTacticalPrediction } from "@/lib/games/cs-oracle/predictionEngine";

const plugin = getGamePlugin("CHARGED_UP");
const csScore = (doc: CsDoc) => scoreEntryForGame(doc as ScoringEntry, "CHARGED_UP");

const golden: CsDoc = {
  game: "CHARGED_UP",
  teamNumber: "2468",
  startingPosition: "Middle",
  auto: {
    mobility: true, // 3
    gridBottom: 2, // 6
    gridMiddle: 1, // 4
    gridTop: 1, // 6
    missed: false,
    chargeStation: "Engaged", // 12 -> auto 31
  },
  teleop: {
    gridBottom: 3, // 6
    gridMiddle: 2, // 6
    gridTop: 2, // 10
    links: 1, // 5 -> teleop 27
  },
  endgame: { chargeStation: "Docked" }, // 6
  penaltyPoints: 4,
  incidents: ["tipped"],
  notes: "",
};

describe("CHARGED_UP scoring (equals CS)", () => {
  it("hand-computed golden doc", () => {
    expect(csScore(golden)).toBe(68);
    expect(plugin.scoreDoc(golden)).toEqual({ auto: 31, teleop: 27, endgame: 6, total: 68, penalty: 4 });
  });

  it("charge station points", () => {
    const auto = (s: string) => plugin.scoreDoc({ auto: { chargeStation: s } }).auto;
    const end = (s: string) => plugin.scoreDoc({ endgame: { chargeStation: s } }).endgame;
    expect([auto("Engaged"), auto("docked"), auto("Parked"), auto("")]).toEqual([12, 8, 0, 0]);
    expect([end("Engaged"), end("Docked"), end("Parked"), end("")]).toEqual([10, 6, 2, 0]);
  });

  it("legacy top-level mobility is used when auto.mobility is absent (CS `??`)", () => {
    expect(plugin.scoreDoc({ mobility: true }).total).toBe(3);
    expect(csScore({ mobility: true })).toBe(3);
    expect(plugin.scoreDoc({ mobility: true, auto: { mobility: false } }).total).toBe(0);
    expect(csScore({ mobility: true, auto: { mobility: false } })).toBe(0);
  });

  it("matches CS on empty and partial docs", () => {
    for (const doc of [{}, { game: "CHARGED_UP" }, { teleop: { links: 2 } }, { penaltyPoints: 9 }, { auto: { gridTop: 4 } }] as CsDoc[]) {
      expect(plugin.scoreDoc(doc).total).toBe(csScore(doc));
    }
  });

  it("is submittable; docToValues uses phase_field keys and scoreValues equals scoreDoc", () => {
    expect(plugin.formId).toBe("charged_up");
    expect(plugin.submittable).toBe(true);
    const values = plugin.docToValues(golden);
    expect(values.auto_gridBottom).toBe(2);
    expect(values.teleop_links).toBe(1);
    expect(values.endgame_chargeStation).toBe("Docked");
    expect(values.penaltyPoints).toBe(4);
    expect(values.mobility).toBe(true); // `auto.mobility ?? mobility`
    expect(plugin.scoreValues(values)).toEqual(plugin.scoreDoc(golden));
    const legacy: CsDoc = { mobility: true, auto: { gridTop: 1 } };
    expect(plugin.scoreValues(plugin.docToValues(legacy))).toEqual(plugin.scoreDoc(legacy));
  });

  it("valuesToDoc writes nested phases and mobility at both places, and round-trips", () => {
    const values = plugin.docToValues(golden);
    const written = plugin.valuesToDoc(values)!;
    expect(written).toMatchObject({
      game: "CHARGED_UP",
      startingPosition: "Middle",
      mobility: true,
      auto: { mobility: true, gridBottom: 2, gridMiddle: 1, gridTop: 1, missed: false, chargeStation: "Engaged" },
      teleop: { gridBottom: 3, gridMiddle: 2, gridTop: 2, links: 1 },
      endgame: { chargeStation: "Docked" },
      penaltyPoints: 4,
      incidents: ["tipped"],
    });
    expect(plugin.docToValues(written)).toEqual(values);
    expect(plugin.scoreDoc(written)).toEqual(plugin.scoreDoc(golden));
    expect(csScore(written)).toBe(csScore(golden));
    // a doc that only has the legacy top-level mobility reads the same and scores the same once written back
    const legacy: CsDoc = { game: "CHARGED_UP", mobility: true, auto: { gridTop: 1 } };
    expect(plugin.scoreDoc(plugin.valuesToDoc(plugin.docToValues(legacy))!).total).toBe(csScore(legacy));
  });
});

describe("CHARGED_UP matches / flags / predict / rescout", () => {
  it("matches CHARGED_UP only (tolerates spaced or dashed names)", () => {
    expect(plugin.matches({ game: "CHARGED_UP" })).toBe(true);
    expect(plugin.matches({ game: "charged up" })).toBe(true);
    expect(plugin.matches({ game: "Charged-Up" })).toBe(true);
    expect(plugin.matches({})).toBe(false);
  });

  it("raises no flags (CS would run REEFSCAPE rules and flag every row)", () => {
    expect(plugin.flags(golden)).toEqual([]);
    expect(plugin.flags({ game: "CHARGED_UP" })).toEqual([]);
  });

  it("predict equals CS with game CHARGED_UP", () => {
    const docs: CsDoc[] = [
      { ...golden, teamNumber: "7" },
      { teamNumber: "7", auto: { gridTop: 1 }, endgame: { status: "x" } },
    ];
    expect(plugin.predict("7", docs, "official", 90)).toEqual(buildTacticalPrediction("7", docs as never, "CHARGED_UP", "official", 90));
  });

  it("rescout diff is 0 for identical docs and positive otherwise", () => {
    expect(plugin.compareToExemplar(golden, golden).diffPercent).toBe(0);
    const other = { ...golden, teleop: { ...(golden.teleop as object), links: 4 } };
    expect(plugin.compareToExemplar(golden, other).diffPercent).toBeGreaterThan(0);
  });
});
