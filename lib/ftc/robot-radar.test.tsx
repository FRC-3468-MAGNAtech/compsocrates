import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RobotRadarChart } from "@/components/analytics/robot-radar-chart";
import { FTC_GAME_DEFINITIONS } from "@/config/games/ftc";
import { resolveRadarSource } from "@/config/games/radar";
import { FRC_PROGRAM } from "@/config/programs/frc";
import { FTC_PROGRAM } from "@/config/programs/ftc";
import { axesRows, buildAxesStats } from "@/lib/analytics/radar-axes";
import { buildRadarModel } from "@/lib/analytics/radar-view-model";
import type { FormValues } from "@/lib/forms/types";
import type { ScoutEntry } from "@/lib/scout-entries";

// Robot Radar on FTC data: axes read from the game's own config, alliance objectives averaged over what was recorded, two-team alliances, no EPA.

const profile = FTC_PROGRAM.radar.biobuzz;
if (profile.kind !== "axes") throw new Error("expected an axes profile");

const e = (team: number, values: FormValues): ScoutEntry => ({ teamNumber: team, values }) as unknown as ScoutEntry;

// A Hive scout records the Tip Hive fields and leaves the Garden fields ABSENT; a Garden scout is the reverse.
const hive = (team: number, over: FormValues = {}) => e(team, { allianceRole: "hive", autoLeave: true, autoPark: true, autoTipHive: 1, teleTipHive: 2, endgamePark: true, ...over });
const garden = (team: number, over: FormValues = {}) =>
  e(team, { allianceRole: "garden", autoLeave: true, autoPark: false, flowerBottomNectar: true, flowerPollenNectar: 3, gardenPollenNectar: 10, endgamePark: false, ...over });

describe("the radar profile comes from the game's own config", () => {
  it("has the five axes in order, from fields that exist, and no Agility", () => {
    expect(profile.axes.map((a) => a.key)).toEqual(["auto", "hive", "garden", "reliability", "endgame"]);
    expect(profile.axes.some((a) => /agility/i.test(a.label + a.full))).toBe(false);
  });
  it("marks exactly Hive and Garden as alliance stats", () => {
    expect(profile.axes.filter((a) => a.alliance).map((a) => a.key)).toEqual(["hive", "garden"]);
  });
  it("takes the reliability incidents from the fields' stat roles", () => {
    const rel = profile.axes.find((a) => a.key === "reliability")!;
    expect(rel.metric.kind === "clean" && rel.metric.incidentKeys).toEqual(["diedDuringMatch", "neverStartedMatch", "disabledByFtc", "recoveredFromFreeze", "tippedOver"]);
  });
  it("a typo in a field key fails loudly", () => {
    const bad = { axes: [{ key: "a", label: "A", full: "A", help: "", metric: { kind: "points" as const, fieldKeys: ["nope"], scale: "best" as const } }] };
    expect(() => resolveRadarSource("X", bad, FTC_GAME_DEFINITIONS.BIOBUZZ.fields)).toThrow(/unknown field/);
  });
});

describe("recorded-only means and the alliance label", () => {
  it("averages Hive over the entries that recorded it, not over every entry", () => {
    // Team 10: two Hive entries (Tip Hive 1 + 2 = 3 x 20 = 60 points each) and two Garden entries (Hive fields absent).
    const { stats } = buildAxesStats([hive(10), hive(10), garden(10), garden(10)], profile.axes);
    const s = stats.get(10)!;
    expect(s.entryCount).toBe(4);
    expect(s.recorded.hive).toBe(2);
    expect(s.mean.hive).toBe(60); // 60, not 120 / 4
    expect(s.recorded.garden).toBe(2);
    expect(s.mean.garden).toBe(5 + 3 * 2 + 10 * 1);
  });

  it("a present zero counts as recorded; absent does not", () => {
    const { stats } = buildAxesStats([hive(10, { autoTipHive: 0, teleTipHive: 0 }), garden(10)], profile.axes);
    expect(stats.get(10)!.recorded.hive).toBe(1);
    expect(stats.get(10)!.mean.hive).toBe(0);
  });

  it("a team no entry recorded an alliance objective for reads 0 and says so", () => {
    const model = buildRadarModel(profile, [garden(10), garden(10)], []);
    expect(model.rows(10, undefined).find((r) => r.key === "hive")!.a).toBe(0);
    expect(model.notes(10, undefined).join(" ")).toContain("no match recorded Hive points, so it reads 0");
  });

  it("table headers carry the alliance label; the others do not", () => {
    const full = Object.fromEntries(axesRows(profile.axes, undefined, undefined, {}).map((r) => [r.key, r.full]));
    expect(full.hive).toBe("Hive points (alliance)");
    expect(full.garden).toBe("Garden and Flower points (alliance)");
    expect(full.auto).not.toContain("alliance");
    expect(full.reliability).not.toContain("alliance");
  });

  it("the note says how many matches an alliance number rests on", () => {
    const text = buildRadarModel(profile, [hive(10), hive(10), garden(10)], []).notes(10, undefined).join("\n");
    expect(text).toContain("rest on 3 matches scouted");
    expect(text).toContain("averaged over the 2 matches where it was recorded (of 3)");
  });
});

describe("axis values", () => {
  it("scales Hive and Garden to the best team, Auto and Endgame to their maximum, Reliability to a share", () => {
    const entries = [hive(1), hive(1), garden(1), hive(2, { autoTipHive: 0, teleTipHive: 1 }), garden(2, { gardenPollenNectar: 0, autoLeave: false }), hive(3, { diedDuringMatch: true }), hive(3)];
    const model = buildRadarModel(profile, entries, []);
    const byKey = (a: number) => Object.fromEntries(model.rows(a, undefined).map((r) => [r.key, r]));
    expect(byKey(1).hive.a).toBe(10); // team 1 has the best Hive mean (60)
    expect(byKey(2).hive.a).toBeCloseTo((20 / 60) * 10, 10);
    expect(byKey(1).auto.a).toBeCloseTo(((8 + 8 + 3) / 3 / 8) * 10, 10); // Leave + Park per entry (8, 8, 3), out of 8
    expect(byKey(1).endgame.a).toBeCloseTo((2 / 3) * 10, 10); // parked in 2 of 3
    expect(byKey(3).reliability.a).toBe(5); // an incident in 1 of 2 matches
    expect(byKey(1).reliability.a).toBe(10);
  });

  it("highlights axes that differ by 2 or more when two teams are compared", () => {
    const model = buildRadarModel(profile, [hive(1), garden(2, { autoPark: false, autoLeave: false })], []);
    const rows = model.rows(1, 2);
    expect(rows.find((r) => r.key === "auto")!.highlight).toBe(true);
    expect(rows.every((r) => r.overlap !== null)).toBe(true);
  });
});

describe("two-team alliances, few entries, no entries", () => {
  it("a match has two teams on each alliance and the radar is unaffected", () => {
    const model = buildRadarModel(profile, [hive(100), garden(200), hive(200), garden(100)], []);
    expect(model.teams).toEqual([
      { teamNumber: 100, entryCount: 2 },
      { teamNumber: 200, entryCount: 2 },
    ]);
    expect(model.rows(100, 200)).toHaveLength(5);
  });
  it("a team with one entry still has numbers, and the note says it rests on 1 match", () => {
    const model = buildRadarModel(profile, [hive(5)], []);
    expect(model.teams).toEqual([{ teamNumber: 5, entryCount: 1 }]);
    expect(model.notes(5, undefined)[0]).toBe("Team 5: the numbers rest on 1 match scouted.");
  });
  it("no entries means no teams and nothing crashes", () => {
    const model = buildRadarModel(profile, [], []);
    expect(model.teams).toEqual([]);
    expect(model.rows(undefined, undefined).every((r) => r.a === 0)).toBe(true);
    expect(model.notes(undefined, undefined)).toEqual([]);
  });
  it("ignores an entry with no usable team number, and tolerates one with no values", () => {
    const model = buildRadarModel(profile, [e(0, {}), { teamNumber: 7 } as unknown as ScoutEntry], []);
    expect(model.teams).toEqual([{ teamNumber: 7, entryCount: 1 }]);
  });
});

describe("elements with no FTC data source are hidden, not greyed", () => {
  it("no climb box plot and no Lead Scout read", () => {
    const model = buildRadarModel(profile, [hive(1)], []);
    expect(model.climbBoxes).toBeNull();
    expect(model.needsLeadEntries).toBe(false);
    expect(model.axes.map((a) => a.key)).not.toContain("agility");
  });
  it("the default program keeps both", () => {
    const frc = buildRadarModel(Object.values(FRC_PROGRAM.radar)[0], [], []);
    expect(frc.climbBoxes).not.toBeNull();
    expect(frc.needsLeadEntries).toBe(true);
    expect(frc.axes.map((a) => a.key)).toContain("agility");
  });
  it("no EPA anywhere in the radar profile", () => {
    expect(JSON.stringify(profile)).not.toMatch(/bepab|statbotics/i);
  });
});

describe("the shared chart takes 4 or 5 axes", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, label: `Axis ${i}`, full: `Axis number ${i}`, a: 2 + i, b: 9 - i, overlap: Math.min(2 + i, 9 - i), highlight: i === 0 }));
  const axes = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, full: `Axis number ${i}`, help: `Help ${i}` }));
  for (const n of [4, 5]) {
    it(`renders ${n} axes with two teams: a spoke, a table row and a help line each`, () => {
      const html = renderToString(<RobotRadarChart rows={rows(n)} axes={axes(n)} teamA={100} teamB={200} />);
      expect((html.match(/<line /g) ?? []).length).toBe(n);
      expect((html.match(/Help \d/g) ?? []).length).toBe(n);
      expect(html).not.toContain("NaN");
    });
  }
  it("renders one team with no overlap column", () => {
    const html = renderToString(<RobotRadarChart rows={rows(4).map((r) => ({ ...r, b: null, overlap: null }))} axes={axes(4)} teamA={100} teamB={null} />);
    expect(html).not.toContain("Overlap");
  });
});

describe("the page reads nothing itself", () => {
  it("it uses the shared hooks only (no collection), and reads Lead Scout entries only when the profile has an Agility axis", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("components/analytics/robot-radar-view.tsx", "utf8");
    expect(source).not.toMatch(/firebase/i);
    expect(source).toContain("useFormEntries(needsLead ?");
  });
});
