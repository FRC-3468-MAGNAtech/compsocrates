import { describe, expect, it } from "vitest";
import { buildBox, buildClimbBoxes, percentile } from "@/lib/analytics/climb-box";
import { buildRadarStats, climbPointsFromEndgame, leadSkillByTeam, normalizeSelectedTeams, radarRows, radarSamples, sampleFromDoc, type RadarSample } from "@/lib/analytics/robot-radar";
import { entryToDoc } from "@/lib/analytics/cs-docs";
import { rebuiltEntry } from "@/lib/analytics/cs-test-fixtures";

const sample = (teamNumber: number, o: Partial<RadarSample> = {}): RadarSample => ({
  teamNumber,
  autoPoints: 0,
  activeFuel: 0,
  totalFuel: 0,
  tower: 0,
  climbAttempt: { attempted: false, points: 0 },
  ...o,
});

describe("sampleFromDoc", () => {
  it("splits a REBUILT document into auto points, active fuel, total fuel and tower weight", () => {
    const entry = rebuiltEntry("a", { autoFuel: 12, teleFuel: 30, endFuel: 4, autoClimb: true, status: "level-3" });
    const s = sampleFromDoc(254, entryToDoc(entry)!);
    expect(s.autoPoints).toBe(12 + 15); // auto fuel + auto climb
    expect(s.activeFuel).toBe(30); // teleop fuel
    expect(s.totalFuel).toBe(12 + 30 + 4); // fuel only, no climb points
    expect(s.tower).toBe(10);
  });

  it("scores unknown or empty endgame status as no tower power", () => {
    expect(sampleFromDoc(1, entryToDoc(rebuiltEntry("a", { status: "parked" }))!).tower).toBe(0);
    expect(sampleFromDoc(1, entryToDoc(rebuiltEntry("a", { status: "level-1" }))!).tower).toBe(3);
  });
});

describe("radarSamples", () => {
  it("skips entries of other games", () => {
    const other = { ...rebuiltEntry("b"), formId: "reefscape", game: "REEFSCAPE" as const };
    const { samples, skipped } = radarSamples([rebuiltEntry("a"), other]);
    expect(samples).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});

describe("buildRadarStats and radarRows", () => {
  const samples = [
    sample(1, { autoPoints: 20, activeFuel: 40, totalFuel: 60, tower: 10 }),
    sample(1, { autoPoints: 10, activeFuel: 20, totalFuel: 40, tower: 6 }),
    sample(2, { autoPoints: 10, activeFuel: 10, totalFuel: 10, tower: 0 }),
  ];
  const { stats, maxAuto, maxActiveFuel } = buildRadarStats(samples, new Map([[1, [8, 6]]]));

  it("averages per team and scales against the best team", () => {
    const t1 = stats.get(1)!;
    expect(t1.autoAvg).toBe(15);
    expect(t1.activeFuelAvg).toBe(30);
    expect(t1.hubIq).toBeCloseTo((30 / 50) * 10, 10);
    expect(t1.agilityAvg).toBe(7);
    expect(maxAuto).toBe(15);
    expect(maxActiveFuel).toBe(30);
  });

  it("builds axes on 0-10, with overlap and highlights for a comparison", () => {
    const rows = radarRows(stats.get(1), stats.get(2), maxAuto, maxActiveFuel);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.auto.a).toBe(10);
    expect(byKey.auto.b).toBeCloseTo((10 / 15) * 10, 10);
    expect(byKey.auto.overlap).toBeCloseTo((10 / 15) * 10, 10);
    expect(byKey.auto.highlight).toBe(true);
    expect(byKey.tower.a).toBe(8);
    expect(byKey.tower.b).toBe(0);
    expect(byKey.agility.b).toBe(0);
  });

  it("has no B column or highlights for a single team", () => {
    const rows = radarRows(stats.get(1), undefined, maxAuto, maxActiveFuel);
    expect(rows.every((r) => r.b === null && r.overlap === null && !r.highlight)).toBe(true);
  });

  it("never divides by zero when nothing scored", () => {
    const empty = buildRadarStats([sample(5)]);
    expect(empty.maxAuto).toBe(1);
    expect(radarRows(empty.stats.get(5), undefined, empty.maxAuto, empty.maxActiveFuel).every((r) => r.a === 0)).toBe(true);
  });
});

describe("leadSkillByTeam", () => {
  it("doubles a robot's own skill, falling back to the alliance's", () => {
    const skill = leadSkillByTeam([
      { values: { robot1_teamNumber: "254", robot1_skillLevel: 4, robot2_teamNumber: "1678", overallAlliance_skillLevel: 3, robot3_teamNumber: "118" } },
      { values: { t1_team: "254B", t1_skill: 5, allianceSkill: 1 } },
    ]);
    expect(skill.get(254)).toEqual([8, 10]);
    expect(skill.get(1678)).toEqual([6]);
    expect(skill.get(118)).toEqual([6]);
  });
  it("gives no rating when neither level exists", () => {
    expect(leadSkillByTeam([{ values: { robot1_teamNumber: "254" } }]).size).toBe(0);
  });
});

describe("normalizeSelectedTeams", () => {
  it("keeps digits, drops blanks and caps at two", () => {
    expect(normalizeSelectedTeams(["254", "x", " 1678 ", "118"])).toEqual([254, 1678]);
  });
});

describe("climb box plot", () => {
  it("interpolates percentiles", () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([], 0.5)).toBe(0);
  });
  it("finds quartiles, whiskers and outliers", () => {
    const box = buildBox(1, [10, 10, 10, 10, 30], 5, 5);
    expect(box.median).toBe(10);
    expect(box.outliers).toEqual([30]);
    expect(box.whiskerHigh).toBe(10);
  });
  it("only counts attempted climbs, and a success is any that scored", () => {
    const boxes = buildClimbBoxes(
      [
        sample(1, { climbAttempt: { attempted: true, points: 20 } }),
        sample(1, { climbAttempt: { attempted: true, points: 0 } }),
        sample(1, { climbAttempt: { attempted: false, points: 30 } }),
      ],
      [1, 2]
    );
    expect(boxes[0].attemptCount).toBe(2);
    expect(boxes[0].successCount).toBe(1);
    expect(boxes[1].attemptCount).toBe(0);
  });
  it("reads climb points from level text", () => {
    expect(climbPointsFromEndgame({ status: "level-2" })).toBe(20);
    expect(climbPointsFromEndgame({ level: "L3" })).toBe(30);
    expect(climbPointsFromEndgame({ status: "failed" })).toBe(0);
  });
});
