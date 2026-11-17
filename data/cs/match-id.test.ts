import { describe, expect, it } from "vitest";
import { appMatchToCs, csDocMatchRef, normalizeCsMatchId } from "@/data/cs/match-id";

describe("normalizeCsMatchId (CS normalizeScoutedMatchId)", () => {
  it.each([
    ["q12", "q12"],
    ["Q012", "q12"],
    ["p3", "p3"],
    ["qf2", "qf2"],
    ["sf5", "sf5"],
    ["f1", "f1"],
    ["sf5m1", "sf5"],
    ["f1m2", "f1"],
    ["2026arli_qm12", "q12"],
    ["2026arli_pr3", "p3"],
    ["2026arli_sf5m1", "sf5"],
    ["2026arli_qf3m1", "qf3"],
    ["2026arli_f1m2", "f2"],
    ["2026arli_f14m1", "f1"],
    ["Qualification 7", "q7"],
    ["Practice Match 2", "p2"],
    ["Finals 15", "f2"],
    ["Match 9", "sf9"],
    ["", ""],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeCsMatchId(input)).toBe(expected);
  });
});

describe("csDocMatchRef (D11)", () => {
  it.each([
    [{ matchId: "p3" }, "Practice", 3],
    [{ matchId: "q12" }, "Qualification", 12],
    [{ matchId: "qf2" }, "Playoff", 2],
    [{ matchId: "sf5" }, "Playoff", 5],
    [{ matchId: "f1" }, "Playoff", 14],
    [{ matchId: "f3" }, "Playoff", 16],
    [{ matchId: "f9" }, "Playoff", 9],
    [{ matchKey: "2026arli_qm40" }, "Qualification", 40],
    [{ matchLabel: "Semifinal 4-1" }, "Playoff", 4],
    [{ matchType: "practice", matchNumber: "6" }, "Practice", 6],
    [{ matchType: "qualification", matchNumber: 8 }, "Qualification", 8],
    [{ matchType: "finals", matchNumber: "2" }, "Playoff", 15],
    [{}, "Qualification", 0],
  ] as const)("%j -> %s %i", (doc, type, number) => {
    expect(csDocMatchRef(doc)).toEqual({ matchType: type, matchNumber: number });
  });

  it("matchId wins over matchKey and matchLabel", () => {
    expect(csDocMatchRef({ matchId: "q1", matchKey: "q2", matchLabel: "Qualification 3" }).matchNumber).toBe(1);
  });
});

describe("appMatchToCs", () => {
  it("round trips every D11 number through csDocMatchRef", () => {
    for (const [type, n] of [["Practice", 1], ["Qualification", 99], ["Playoff", 1], ["Playoff", 13], ["Playoff", 14], ["Playoff", 15], ["Playoff", 16]] as const) {
      const cs = appMatchToCs(type, n);
      expect(csDocMatchRef(cs)).toEqual({ matchType: type, matchNumber: n });
    }
  });
});
