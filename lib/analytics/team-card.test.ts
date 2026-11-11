import { describe, expect, it } from "vitest";
import { calculateScore, type ScoutFormSchema } from "@/lib/scout-form/schema";
import { SAMPLE_FORM } from "@/lib/forms/test-fixtures";
import type { AnalyticsEntry } from "./entries";
import { buildKeyStats, reliabilityIncidents, reliabilityLevel, sortTeams, teamMatchesSearch } from "./team-card";
import { buildTeamStats } from "./team-stats";

let n = 0;
type Values = Record<string, boolean | number>;

function entry(teamNumber: number, values: Values): AnalyticsEntry {
  n += 1;
  const full = { ...values };
  return {
    id: `e${n}`,
    teamId: "t",
    uid: "u",
    source: "event",
    mode: null,
    formId: "sample",
    formVersion: 1,
    scoutName: "S",
    eventCode: "E",
    matchType: "Qualification",
    matchNumber: n,
    teamNumber,
    values: full,
    score: calculateScore(SAMPLE_FORM, full),
    comments: "",
    submittedAt: `2026-01-01T00:00:${String(n).padStart(2, "0")}.000Z`,
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    sessionId: null,
    libraryMatchId: null,
    allianceAccuracy: null,
    isExcluded: false,
  };
}

describe("buildKeyStats", () => {
  const stats = buildTeamStats(
    [
      entry(1, { autoScoreA: 1, teleScoreA: 2, teleScoreB: 4, teleScoreC: 2, autoLeave: true, endgamePark: true }),
      entry(1, { autoScoreA: 0, teleScoreA: 1, teleScoreB: 0, teleScoreC: 2, teleBonusB: true, autoPark: true }),
    ],
    SAMPLE_FORM
  );
  const key = buildKeyStats(stats, SAMPLE_FORM);

  it("sums counters by label across phases: Score A = auto + teleop", () => {
    expect(key.counters.map((c) => c.label)).toEqual(["Score A", "Score B", "Score C"]);
    // (1 + 0)/2 + (2 + 1)/2
    expect(key.counters[0].avg).toBeCloseTo(2);
    // (4 + 0)/2
    expect(key.counters[1].avg).toBeCloseTo(2);
    // (2 + 2)/2
    expect(key.counters[2].avg).toBeCloseTo(2);
  });

  it("lists each toggle's rate, adding the phase only where a label repeats", () => {
    expect(key.rates.map((r) => r.label)).toEqual(["Leave", "Park (auto)", "Bonus B", "Park (endgame)"]);
    expect(Object.fromEntries(key.rates.map((r) => [r.label, r.rate]))).toEqual({
      Leave: 50,
      "Park (auto)": 50,
      "Bonus B": 50,
      "Park (endgame)": 50,
    });
  });

  it("works for any schema", () => {
    const other: ScoutFormSchema = {
      ...SAMPLE_FORM,
      id: "o",
      name: "O",
      sections: [
        {
          id: "teleop",
          title: "Teleop",
          phase: "teleop",
          visible: true,
          fields: [
            { id: "f-gears", key: "gears", type: "counter", label: "Gears", min: 0, step: 1, scoring: { mode: "perTally", value: 3 }, analytics: { include: true, aggregate: "avg" } },
            { id: "f-spin", key: "spin", type: "toggle", label: "Spin", scoring: { mode: "whenOn", value: 1 }, analytics: { include: true, aggregate: "rate" } },
          ],
        },
      ],
    };
    const e = { ...entry(2, {}), values: { gears: 4, spin: true } };
    const k = buildKeyStats(buildTeamStats([e], other), other);
    expect(k).toEqual({ counters: [{ label: "Gears", avg: 4 }], rates: [{ label: "Spin", rate: 100 }] });
  });
});

describe("reliability", () => {
  it("maps the share of incident-free entries to a level", () => {
    expect(reliabilityLevel(null)).toBe("unknown");
    expect(reliabilityLevel(100)).toBe("reliable");
    expect(reliabilityLevel(90)).toBe("reliable");
    expect(reliabilityLevel(89.9)).toBe("some-issues");
    expect(reliabilityLevel(75)).toBe("some-issues");
    expect(reliabilityLevel(74.9)).toBe("unreliable");
    expect(reliabilityLevel(0)).toBe("unreliable");
  });

  it("lists only the reliability incidents the team had, worst first (cards are conduct, not reliability)", () => {
    const stats = buildTeamStats(
      [entry(1, { diedDuringMatch: true, yellowCard: true }), entry(1, { diedDuringMatch: true, tippedOver: true }), entry(1, { redCard: true }), entry(1, {})],
      SAMPLE_FORM
    );
    expect(reliabilityIncidents(stats, SAMPLE_FORM)).toEqual([
      { label: "Died During Match", rate: 50 },
      { label: "Tipped Over", rate: 25 },
    ]);
  });
});

describe("sortTeams / teamMatchesSearch", () => {
  const mk = (teamNumber: number, fields: Values[], name: string | null = null) =>
    buildTeamStats(fields.map((f) => entry(teamNumber, f)), SAMPLE_FORM, { teamNumber, teamName: name });
  const teams = [
    mk(300, [{ autoLeave: true }]), // avg 3, 1 entry, reliability 100
    mk(100, [{ autoLeave: true, autoPark: true }, { autoLeave: true, autoPark: true }], "Alpha"), // avg 8, 2 entries
    mk(200, [{ teleScoreA: 1, diedDuringMatch: true }, { teleScoreA: 1 }, { teleScoreA: 1 }], "Beta"), // avg 20, 3 entries, reliability 66.7
  ];
  const order = (key: Parameters<typeof sortTeams>[1]) => sortTeams(teams, key).map((t) => t.teamNumber);

  it("sorts best first by each key", () => {
    expect(order("avgTotal")).toEqual([200, 100, 300]);
    expect(order("entryCount")).toEqual([200, 100, 300]);
    expect(order("reliability")).toEqual([100, 300, 200]);
    expect(order("teamNumber")).toEqual([100, 200, 300]);
  });

  it("breaks ties by team number and never mutates its input", () => {
    const tied = [mk(9, [{ autoLeave: true }]), mk(2, [{ autoLeave: true }])];
    expect(sortTeams(tied, "avgTotal").map((t) => t.teamNumber)).toEqual([2, 9]);
    expect(tied.map((t) => t.teamNumber)).toEqual([9, 2]);
  });

  it("puts teams without a reliability value last", () => {
    const unknown = { ...mk(1, [{}]), reliability: null };
    expect(sortTeams([unknown, ...teams], "reliability").map((t) => t.teamNumber)).toEqual([100, 300, 200, 1]);
  });

  it("searches team number or name, case-insensitively", () => {
    expect(teamMatchesSearch({ teamNumber: 3468, teamName: "MAGNAtech" }, "")).toBe(true);
    expect(teamMatchesSearch({ teamNumber: 3468, teamName: "MAGNAtech" }, "346")).toBe(true);
    expect(teamMatchesSearch({ teamNumber: 3468, teamName: "MAGNAtech" }, "magna")).toBe(true);
    expect(teamMatchesSearch({ teamNumber: 3468, teamName: null }, "magna")).toBe(false);
  });
});
