import { describe, expect, it } from "vitest";
import { FRC_PROGRAM } from "@/config/programs/frc";
import { csDocToScoutEntry } from "@/data/cs/scouting";
import { buildClimbBoxes } from "@/lib/analytics/climb-box";
import { rebuiltDoc, type RebuiltDocOptions } from "@/lib/analytics/cs-test-fixtures";
import { buildRadarModel } from "@/lib/analytics/radar-view-model";
import { RADAR_AXES, buildRadarStats, leadSkillByTeam, radarRows, radarSamples } from "@/lib/analytics/robot-radar";
import type { FormValues } from "@/lib/forms/types";
import type { ScoutEntry } from "@/lib/scout-entries";

// The model the page uses, for the default program's radar, must give exactly what the pre-refactor chain gave (the golden test pins that chain's numbers).

const entry = (id: string, o: RebuiltDocOptions): ScoutEntry => {
  const built = csDocToScoutEntry(id, rebuiltDoc(o));
  if (!built) throw new Error("fixture");
  return built;
};
const ENTRIES = [
  entry("a1", { team: "254", match: "q1", autoFuel: 12, teleFuel: 30, endFuel: 4, autoClimb: true, status: "level-3" }),
  entry("a2", { team: "254", match: "q2", autoFuel: 8, teleFuel: 22, endFuel: 2, status: "level-2" }),
  entry("b1", { team: "1678", match: "q1", autoFuel: 5, teleFuel: 40, endFuel: 10, status: "level-1" }),
  entry("c1", { team: "118", match: "q1", autoFuel: 3, teleFuel: 4, endFuel: 1, status: "parked" }),
];
const LEAD: { values: FormValues }[] = [{ values: { robot1_teamNumber: "254", robot1_skillLevel: 4 } }];

describe("buildRadarModel for the default program's profile", () => {
  const profile = Object.values(FRC_PROGRAM.radar)[0];
  const model = buildRadarModel(profile, ENTRIES, LEAD);
  const { samples, skipped } = radarSamples(ENTRIES);
  const { stats, maxAuto, maxActiveFuel } = buildRadarStats(samples, leadSkillByTeam(LEAD));

  it("is the hand-built profile", () => {
    expect(profile.kind).toBe("rebuilt");
    expect(model.needsLeadEntries).toBe(true);
    expect(model.axes).toBe(RADAR_AXES);
    expect(model.skipped).toBe(skipped);
  });

  it("gives the same teams, rows (one team, two teams, a missing team) and box plot as the old chain", () => {
    expect(model.teams).toEqual([...stats.values()].sort((a, b) => a.teamNumber - b.teamNumber).map((t) => ({ teamNumber: t.teamNumber, entryCount: t.entryCount })));
    expect(model.rows(254, undefined)).toEqual(radarRows(stats.get(254), undefined, maxAuto, maxActiveFuel));
    expect(model.rows(254, 1678)).toEqual(radarRows(stats.get(254), stats.get(1678), maxAuto, maxActiveFuel));
    expect(model.rows(118, 999)).toEqual(radarRows(stats.get(118), undefined, maxAuto, maxActiveFuel));
    expect(model.climbBoxes!([254, 1678])).toEqual(buildClimbBoxes(samples, [254, 1678]));
  });

  it("keeps the Agility note for a team with no Lead Scout rating, and only then", () => {
    expect(model.notes(254, undefined)).toEqual([]);
    expect(model.notes(1678, undefined)).toEqual(["Agility reads 0 for a team with no Lead Scout rating in these events."]);
    expect(model.notes(254, 1678)).toHaveLength(1);
  });

  it("the default program's radar is keyed by its game's season id and names its game", () => {
    expect(Object.keys(FRC_PROGRAM.radar)).toEqual(["rebuilt"]);
    expect(profile.name).toBe("REBUILT");
  });
});
