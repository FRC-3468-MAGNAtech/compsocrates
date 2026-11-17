import { describe, expect, it } from "vitest";
import { csDocToScoutEntry } from "@/data/cs/scouting";
import { buildClimbBoxes } from "@/lib/analytics/climb-box";
import { rebuiltDoc, type RebuiltDocOptions } from "@/lib/analytics/cs-test-fixtures";
import { buildRadarStats, leadSkillByTeam, radarRows, radarSamples } from "@/lib/analytics/robot-radar";
import type { FormValues } from "@/lib/forms/types";
import type { ScoutEntry } from "@/lib/scout-entries";

// GOLDEN: pins today's REBUILT Robot Radar output end to end (samples, per-team stats, axis rows for one and two teams, the climb
// box plot), so the per-game radar profile refactor can be proven not to change a single FRC number. Do not edit the expected
// values to make a refactor pass; a change here is a change to what FRC shows.

type Climb = { attempted?: boolean; level?: string };

function entry(id: string, o: RebuiltDocOptions, climb: Climb = {}): ScoutEntry {
  const doc = rebuiltDoc(o);
  const endgame = { ...(doc.endgame as Record<string, unknown>), ...(climb.attempted !== undefined ? { attemptedClimb: climb.attempted } : {}), ...(climb.level ? { level: climb.level } : {}) };
  const built = csDocToScoutEntry(id, { ...doc, endgame });
  if (!built) throw new Error("fixture did not become an entry");
  return built;
}

const ENTRIES: ScoutEntry[] = [
  entry("a1", { team: "254", match: "q1", autoFuel: 12, teleFuel: 30, endFuel: 4, autoClimb: true, status: "level-3" }, { attempted: true, level: "Level 3" }),
  entry("a2", { team: "254", match: "q2", autoFuel: 8, teleFuel: 22, endFuel: 2, status: "level-2" }, { attempted: true, level: "Level 2" }),
  entry("a3", { team: "254", match: "q3", autoFuel: 0, teleFuel: 18, endFuel: 0, status: "" }, { attempted: true }),
  entry("a4", { team: "254", match: "q4", autoFuel: 10, teleFuel: 26, endFuel: 6, status: "level-1" }, { attempted: false }),
  entry("b1", { team: "1678", match: "q1", autoFuel: 5, teleFuel: 40, endFuel: 10, status: "level-1" }, { attempted: true, level: "Level 1" }),
  entry("b2", { team: "1678", match: "q2", autoFuel: 6, teleFuel: 36, endFuel: 8, autoClimb: true, status: "level-3" }, { attempted: true, level: "Level 3" }),
  entry("c1", { team: "118", match: "q1", autoFuel: 3, teleFuel: 4, endFuel: 1, status: "parked" }),
];

const LEAD: { values: FormValues }[] = [
  { values: { robot1_teamNumber: "254", robot1_skillLevel: 4, robot2_teamNumber: "1678", overallAlliance_skillLevel: 3 } },
  { values: { t1_team: "254", t1_skill: 5, allianceSkill: 1 } },
];

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const roundDeep = (v: unknown): unknown => {
  if (typeof v === "number") return round(v);
  if (Array.isArray(v)) return v.map(roundDeep);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x)]));
  return v;
};

describe("Robot Radar REBUILT golden", () => {
  const { samples, skipped } = radarSamples(ENTRIES);
  const skill = leadSkillByTeam(LEAD);
  const { stats, maxAuto, maxActiveFuel } = buildRadarStats(samples, skill);

  it("samples", () => {
    expect(skipped).toBe(0);
    expect(roundDeep(samples)).toMatchInlineSnapshot(`
      [
        {
          "activeFuel": 30,
          "autoPoints": 27,
          "climbAttempt": {
            "attempted": false,
            "points": 30,
          },
          "teamNumber": 254,
          "totalFuel": 46,
          "tower": 10,
        },
        {
          "activeFuel": 22,
          "autoPoints": 8,
          "climbAttempt": {
            "attempted": false,
            "points": 20,
          },
          "teamNumber": 254,
          "totalFuel": 32,
          "tower": 6,
        },
        {
          "activeFuel": 18,
          "autoPoints": 0,
          "climbAttempt": {
            "attempted": false,
            "points": 0,
          },
          "teamNumber": 254,
          "totalFuel": 18,
          "tower": 0,
        },
        {
          "activeFuel": 26,
          "autoPoints": 10,
          "climbAttempt": {
            "attempted": false,
            "points": 10,
          },
          "teamNumber": 254,
          "totalFuel": 42,
          "tower": 3,
        },
        {
          "activeFuel": 40,
          "autoPoints": 5,
          "climbAttempt": {
            "attempted": false,
            "points": 10,
          },
          "teamNumber": 1678,
          "totalFuel": 55,
          "tower": 3,
        },
        {
          "activeFuel": 36,
          "autoPoints": 21,
          "climbAttempt": {
            "attempted": false,
            "points": 30,
          },
          "teamNumber": 1678,
          "totalFuel": 50,
          "tower": 10,
        },
        {
          "activeFuel": 4,
          "autoPoints": 3,
          "climbAttempt": {
            "attempted": false,
            "points": 0,
          },
          "teamNumber": 118,
          "totalFuel": 8,
          "tower": 0,
        },
      ]
    `);
  });

  it("per-team stats and the scale maxima", () => {
    expect(roundDeep({ stats: [...stats.values()].sort((a, b) => a.teamNumber - b.teamNumber), maxAuto, maxActiveFuel })).toMatchInlineSnapshot(`
      {
        "maxActiveFuel": 38,
        "maxAuto": 13,
        "stats": [
          {
            "activeFuelAvg": 4,
            "agilityAvg": 0,
            "autoAvg": 3,
            "entryCount": 1,
            "hubIq": 5,
            "ratings": 0,
            "teamNumber": 118,
            "totalFuelAvg": 8,
            "towerAvg": 0,
          },
          {
            "activeFuelAvg": 24,
            "agilityAvg": 9,
            "autoAvg": 11.25,
            "entryCount": 4,
            "hubIq": 6.956522,
            "ratings": 2,
            "teamNumber": 254,
            "totalFuelAvg": 34.5,
            "towerAvg": 4.75,
          },
          {
            "activeFuelAvg": 38,
            "agilityAvg": 6,
            "autoAvg": 13,
            "entryCount": 2,
            "hubIq": 7.238095,
            "ratings": 1,
            "teamNumber": 1678,
            "totalFuelAvg": 52.5,
            "towerAvg": 6.5,
          },
        ],
      }
    `);
  });

  it("axis rows for one team, two teams, and a team with no data", () => {
    expect(
      roundDeep({
        single: radarRows(stats.get(254), undefined, maxAuto, maxActiveFuel),
        pair: radarRows(stats.get(254), stats.get(1678), maxAuto, maxActiveFuel),
        missingSecond: radarRows(stats.get(118), stats.get(999), maxAuto, maxActiveFuel),
      })
    ).toMatchInlineSnapshot(`
      {
        "missingSecond": [
          {
            "a": 2.307692,
            "b": null,
            "full": "Auto Prowess",
            "highlight": false,
            "key": "auto",
            "label": "Auto Prowess",
            "overlap": null,
          },
          {
            "a": 1.052632,
            "b": null,
            "full": "Hub Volume",
            "highlight": false,
            "key": "volume",
            "label": "Hub Volume",
            "overlap": null,
          },
          {
            "a": 5,
            "b": null,
            "full": "Hub IQ (Efficiency)",
            "highlight": false,
            "key": "iq",
            "label": "Hub IQ",
            "overlap": null,
          },
          {
            "a": 0,
            "b": null,
            "full": "Tower Power",
            "highlight": false,
            "key": "tower",
            "label": "Tower Power",
            "overlap": null,
          },
          {
            "a": 0,
            "b": null,
            "full": "Agility / Defense",
            "highlight": false,
            "key": "agility",
            "label": "Agility",
            "overlap": null,
          },
        ],
        "pair": [
          {
            "a": 8.653846,
            "b": 10,
            "full": "Auto Prowess",
            "highlight": false,
            "key": "auto",
            "label": "Auto Prowess",
            "overlap": 8.653846,
          },
          {
            "a": 6.315789,
            "b": 10,
            "full": "Hub Volume",
            "highlight": true,
            "key": "volume",
            "label": "Hub Volume",
            "overlap": 6.315789,
          },
          {
            "a": 6.956522,
            "b": 7.238095,
            "full": "Hub IQ (Efficiency)",
            "highlight": false,
            "key": "iq",
            "label": "Hub IQ",
            "overlap": 6.956522,
          },
          {
            "a": 4.75,
            "b": 6.5,
            "full": "Tower Power",
            "highlight": false,
            "key": "tower",
            "label": "Tower Power",
            "overlap": 4.75,
          },
          {
            "a": 9,
            "b": 6,
            "full": "Agility / Defense",
            "highlight": true,
            "key": "agility",
            "label": "Agility",
            "overlap": 6,
          },
        ],
        "single": [
          {
            "a": 8.653846,
            "b": null,
            "full": "Auto Prowess",
            "highlight": false,
            "key": "auto",
            "label": "Auto Prowess",
            "overlap": null,
          },
          {
            "a": 6.315789,
            "b": null,
            "full": "Hub Volume",
            "highlight": false,
            "key": "volume",
            "label": "Hub Volume",
            "overlap": null,
          },
          {
            "a": 6.956522,
            "b": null,
            "full": "Hub IQ (Efficiency)",
            "highlight": false,
            "key": "iq",
            "label": "Hub IQ",
            "overlap": null,
          },
          {
            "a": 4.75,
            "b": null,
            "full": "Tower Power",
            "highlight": false,
            "key": "tower",
            "label": "Tower Power",
            "overlap": null,
          },
          {
            "a": 9,
            "b": null,
            "full": "Agility / Defense",
            "highlight": false,
            "key": "agility",
            "label": "Agility",
            "overlap": null,
          },
        ],
      }
    `);
  });

  // NOTE: nothing in the rebuild stores `endgame.attemptedClimb` (the entry round trip drops it), so through the real pipeline every sample reads
  // attempted=false and the plot is empty. That is today's FRC behavior and is pinned as is (reported in docs/BATCH7_RESULTS.md, not fixed).
  it("climb box plot through the real pipeline (empty boxes today)", () => {
    expect(roundDeep(buildClimbBoxes(samples, [254, 1678, 118, 999]))).toMatchInlineSnapshot(`
      [
        {
          "attemptCount": 0,
          "median": 0,
          "outliers": [],
          "q1": 0,
          "q3": 0,
          "successCount": 0,
          "teamNumber": 254,
          "values": [],
          "whiskerHigh": 0,
          "whiskerLow": 0,
        },
        {
          "attemptCount": 0,
          "median": 0,
          "outliers": [],
          "q1": 0,
          "q3": 0,
          "successCount": 0,
          "teamNumber": 1678,
          "values": [],
          "whiskerHigh": 0,
          "whiskerLow": 0,
        },
        {
          "attemptCount": 0,
          "median": 0,
          "outliers": [],
          "q1": 0,
          "q3": 0,
          "successCount": 0,
          "teamNumber": 118,
          "values": [],
          "whiskerHigh": 0,
          "whiskerLow": 0,
        },
        {
          "attemptCount": 0,
          "median": 0,
          "outliers": [],
          "q1": 0,
          "q3": 0,
          "successCount": 0,
          "teamNumber": 999,
          "values": [],
          "whiskerHigh": 0,
          "whiskerLow": 0,
        },
      ]
    `);
  });

  it("climb box model on attempted climbs", () => {
    const hand = [
      { teamNumber: 254, climbAttempt: { attempted: true, points: 30 } },
      { teamNumber: 254, climbAttempt: { attempted: true, points: 20 } },
      { teamNumber: 254, climbAttempt: { attempted: true, points: 0 } },
      { teamNumber: 254, climbAttempt: { attempted: true, points: 10 } },
      { teamNumber: 254, climbAttempt: { attempted: false, points: 30 } },
      { teamNumber: 1678, climbAttempt: { attempted: true, points: 10 } },
    ].map((s) => ({ ...s, autoPoints: 0, activeFuel: 0, totalFuel: 0, tower: 0 }));
    expect(roundDeep(buildClimbBoxes(hand, [254, 1678, 999]))).toMatchInlineSnapshot(`
      [
        {
          "attemptCount": 4,
          "median": 15,
          "outliers": [],
          "q1": 7.5,
          "q3": 22.5,
          "successCount": 3,
          "teamNumber": 254,
          "values": [
            0,
            10,
            20,
            30,
          ],
          "whiskerHigh": 30,
          "whiskerLow": 0,
        },
        {
          "attemptCount": 1,
          "median": 10,
          "outliers": [],
          "q1": 10,
          "q3": 10,
          "successCount": 1,
          "teamNumber": 1678,
          "values": [
            10,
          ],
          "whiskerHigh": 10,
          "whiskerLow": 10,
        },
        {
          "attemptCount": 0,
          "median": 0,
          "outliers": [],
          "q1": 0,
          "q3": 0,
          "successCount": 0,
          "teamNumber": 999,
          "values": [],
          "whiskerHigh": 0,
          "whiskerLow": 0,
        },
      ]
    `);
  });
});
