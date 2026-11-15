import { describe, expect, it } from "vitest";
import { FTC_GAME_DEFINITIONS } from "@/config/games/ftc";
import { entriesToCsv, exportableColumns, parseCsv, parseImportCsv } from "@/lib/analytics/csv";
import { evaluateAutoFlagRuleIds, type FlagContext } from "@/lib/analytics/flags";
import type { AnalyticsEntry } from "@/lib/analytics/entries";
import { buildGameSchema, csvHeaderFor } from "@/lib/analytics/game-schema";
import { allianceObjectives } from "@/lib/analytics/match-breakdown";
import { buildKeyStats } from "@/lib/analytics/team-card";
import { buildTeamStats } from "@/lib/analytics/team-stats";
import { buildFtcGameForm } from "@/lib/ftc/games";
import { calculateScore } from "@/lib/forms/scoring";
import { defaultValues, normalizeValues } from "@/lib/forms/values";
import type { FormValues } from "@/lib/forms/types";
import type { ScoutEntry } from "@/lib/scout-entries";
import {
  ALLIANCE_ROLE_KEY,
  allianceRoleFor,
  allianceRoleIds,
  applyAllianceRole,
  assignAllianceRole,
  hashSeed,
  reconcileRoleAfterEdit,
  roleSeedText,
} from "@/lib/forms/alliance-role";

const form = buildFtcGameForm(FTC_GAME_DEFINITIONS.BIOBUZZ);
const ROLES = ["hive", "garden"];
const HIVE_KEYS = ["autoTipHive", "teleTipHive"];
const GARDEN_KEYS = ["flowerBottomNectar", "flowerPollenNectar", "gardenPollenNectar"];

/** Values of a BIOBUZZ entry as the scout form stores them: defaults, the scout's counts, then the role applied (the other role's fields absent). */
function scouted(role: string | null, counts: Record<string, number | boolean> = {}): FormValues {
  return applyAllianceRole(form, { ...defaultValues(form), ...counts } as FormValues, role);
}

let n = 0;
function entry(teamNumber: number, values: FormValues, over: Partial<ScoutEntry> = {}): AnalyticsEntry {
  n += 1;
  const base: ScoutEntry = {
    id: `e${n}`,
    teamId: "t",
    uid: "u",
    source: "event",
    mode: null,
    formId: form.id,
    formVersion: form.version,
    scoutName: "Scout",
    eventCode: "EVT1",
    matchType: "Qualification",
    matchNumber: n,
    teamNumber,
    values,
    score: (() => {
      const s = calculateScore(form, values);
      return { auto: s.auto, teleop: s.teleop, endgame: s.endgame, total: s.total };
    })(),
    comments: "",
    submittedAt: `2026-01-01T00:00:${String(n).padStart(2, "0")}.000Z`,
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    sessionId: null,
    libraryMatchId: null,
    ...over,
  };
  return { ...base, allianceAccuracy: null } as AnalyticsEntry;
}

describe("role assignment", () => {
  const seed = (matchNumber: number, alliance: "red" | "blue" = "red") => roleSeedText({ eventKey: "2026evt", matchType: "Qualification", matchNumber, alliance });

  it("is deterministic and gives the two robots of an alliance opposite roles, whichever order the roster is in", () => {
    for (let m = 1; m <= 40; m++) {
      const a = assignAllianceRole({ seed: seed(m), teams: [4000, 1000], teamNumber: 1000, roles: ROLES });
      const b = assignAllianceRole({ seed: seed(m), teams: [1000, 4000], teamNumber: 4000, roles: ROLES });
      expect(a).toBe(assignAllianceRole({ seed: seed(m), teams: [1000, 4000], teamNumber: 1000, roles: ROLES }));
      expect(new Set([a, b])).toEqual(new Set(ROLES));
    }
  });

  it("is not tied to a slot: the same team gets both roles over a set of matches, and each role is used about half the time", () => {
    const roles = Array.from({ length: 200 }, (_, i) => assignAllianceRole({ seed: seed(i + 1), teams: [1000, 4000], teamNumber: 1000, roles: ROLES }));
    const hive = roles.filter((r) => r === "hive").length;
    expect(hive).toBeGreaterThan(60);
    expect(hive).toBeLessThan(140);
  });

  it("varies with the match, the alliance and the practice session", () => {
    expect(hashSeed(seed(1))).not.toBe(hashSeed(seed(2)));
    expect(roleSeedText({ eventKey: "e", matchType: "Practice", matchNumber: 3, alliance: "red", sessionId: "s1" })).not.toBe(roleSeedText({ eventKey: "e", matchType: "Practice", matchNumber: 3, alliance: "red", sessionId: "s2" }));
  });

  it("gives no role (every field shown) when the alliance is not exactly two known teams or the team is not on it", () => {
    expect(assignAllianceRole({ seed: "x", teams: [1000], teamNumber: 1000, roles: ROLES })).toBeNull();
    expect(assignAllianceRole({ seed: "x", teams: [1000, 2000, 3000], teamNumber: 1000, roles: ROLES })).toBeNull();
    expect(assignAllianceRole({ seed: "x", teams: [1000, 2000], teamNumber: 3000, roles: ROLES })).toBeNull();
    expect(allianceRoleFor(form, { eventKey: "e", matchType: "Practice", matchNumber: 1, alliance: null, teams: [1, 2], teamNumber: 1 })).toBeNull();
  });

  it("takes its roles and the fields they record from the BIOBUZZ config", () => {
    expect(allianceRoleIds(form)).toEqual(ROLES);
    const byRole = (role: string) => form.sections.flatMap((s) => s.fields).filter((f) => f.allianceRole === role).map((f) => f.key);
    expect(byRole("hive")).toEqual(HIVE_KEYS);
    expect(byRole("garden")).toEqual(GARDEN_KEYS);
  });
});

describe("storing absent, not zero", () => {
  it("removes the other role's fields and keeps the role, even through a draft restore (normalizeValues)", () => {
    const hive = scouted("hive", { teleTipHive: 2 });
    for (const k of GARDEN_KEYS) expect(k in hive).toBe(false);
    expect(hive[ALLIANCE_ROLE_KEY]).toBe("hive");
    expect(hive.teleTipHive).toBe(2);
    const restored = normalizeValues(form, JSON.parse(JSON.stringify(hive)));
    for (const k of GARDEN_KEYS) expect(k in restored).toBe(false);
    expect(restored.autoTipHive).toBe(0); // recorded zero stays zero
    expect(restored.teleTipHive).toBe(2);
  });

  it("with no role every role field starts at its default and the role key is cleared", () => {
    const all = applyAllianceRole(form, scouted("garden"), null);
    for (const k of [...HIVE_KEYS, ...GARDEN_KEYS]) expect(all[k]).toBeDefined();
    expect(ALLIANCE_ROLE_KEY in all).toBe(false);
  });

  it("an admin who corrects the other role's field turns the entry into one that records both (the role is dropped)", () => {
    const garden = scouted("garden", { gardenPollenNectar: 5 });
    expect(reconcileRoleAfterEdit(form, garden)[ALLIANCE_ROLE_KEY]).toBe("garden");
    expect(ALLIANCE_ROLE_KEY in reconcileRoleAfterEdit(form, { ...garden, teleTipHive: 1 })).toBe(false);
  });
});

describe("scoring with absent values", () => {
  it("counts only the recorded role's points, and the two robots of an alliance add up to each objective once", () => {
    const hiveRobot = scouted("hive", { autoLeave: true, autoTipHive: 1, teleTipHive: 2 });
    const gardenRobot = scouted("garden", { autoLeave: true, gardenPollenNectar: 10, flowerPollenNectar: 3, flowerBottomNectar: true });
    const hive = calculateScore(form, hiveRobot);
    const garden = calculateScore(form, gardenRobot);
    expect(hive.total).toBe(3 + 20 + 40); // leave + auto hive + tele hive
    expect(garden.total).toBe(3 + 10 + 6 + 5);
    expect(hive.total + garden.total).toBe(87); // practice accuracy compares this sum with the official alliance score
  });

  it("does not score a value hidden by the entry's role, and an old entry with every value and no role still scores them all", () => {
    const withStray = { ...scouted("garden", { gardenPollenNectar: 4 }), teleTipHive: 5 } as FormValues;
    expect(calculateScore(form, withStray).total).toBe(4);
    const legacy = { ...defaultValues(form), teleTipHive: 2, gardenPollenNectar: 4 } as FormValues;
    expect(calculateScore(form, legacy).total).toBe(44);
  });
});

describe("team stats over recorded entries", () => {
  const entries = [
    entry(100, scouted("hive", { teleTipHive: 1 })),
    entry(100, scouted("hive", { teleTipHive: 3 })),
    entry(100, scouted("garden", { gardenPollenNectar: 10 })),
    entry(100, scouted("garden", { gardenPollenNectar: 20 })),
  ];
  const stats = buildTeamStats(entries, form);

  it("divides by the matches where the objective was recorded, not by every match", () => {
    const hive = stats.fieldStats.teleTipHive;
    expect(hive).toMatchObject({ avg: 2, high: 3, recorded: 2, allianceStat: true, avgPoints: 40 });
    const garden = stats.fieldStats.gardenPollenNectar;
    expect(garden).toMatchObject({ avg: 15, high: 20, recorded: 2, allianceStat: true, avgPoints: 15 });
    expect(stats.entryCount).toBe(4);
  });

  it("keeps ordinary fields over every entry and labels team-card alliance stats", () => {
    expect(stats.fieldStats.autoLeave.allianceStat).toBeUndefined();
    expect(stats.fieldStats.autoLeave.rate).toBe(0);
    const card = buildKeyStats(stats, form);
    expect(card.counters.map((c) => c.label)).toContain("Tip Hive (alliance)");
    expect(card.rates.map((r) => r.label).some((l) => l.endsWith("(alliance)"))).toBe(true);
    expect(card.rates.find((r) => r.label.startsWith("Leave"))?.label).not.toContain("alliance");
  });

  it("an old entry that recorded both counts as recorded for each; a team with no recorded entry reads recorded 0", () => {
    const mixed = buildTeamStats([...entries, entry(100, { ...defaultValues(form), teleTipHive: 6, gardenPollenNectar: 0 } as FormValues)], form);
    expect(mixed.fieldStats.teleTipHive).toMatchObject({ recorded: 3, avg: (1 + 3 + 6) / 3 });
    expect(mixed.fieldStats.gardenPollenNectar.recorded).toBe(3);
    const onlyHive = buildTeamStats([entries[0]], form);
    expect(onlyHive.fieldStats.gardenPollenNectar).toMatchObject({ recorded: 0, avg: 0 });
  });
});

describe("alliance-level objectives in the match breakdown", () => {
  it("sums both robots and counts each objective once", () => {
    const hiveRobot = entry(100, scouted("hive", { autoTipHive: 1, teleTipHive: 2 }));
    const gardenRobot = entry(200, scouted("garden", { gardenPollenNectar: 10, flowerPollenNectar: 3 }));
    expect(allianceObjectives([hiveRobot, gardenRobot], form)).toEqual([
      { role: "hive", label: "Hive", points: 60, recorded: true },
      { role: "garden", label: "Garden", points: 16, recorded: true },
    ]);
    expect(allianceObjectives([hiveRobot], form)[1]).toMatchObject({ points: 0, recorded: false });
  });

  it("does not double count an old alliance where both robots recorded the Hive", () => {
    const a = entry(100, { ...defaultValues(form), teleTipHive: 2 } as FormValues);
    const b = entry(200, { ...defaultValues(form), teleTipHive: 2 } as FormValues);
    expect(allianceObjectives([a, b], form)[0].points).toBe(40);
  });
});

describe("CSV round trip", () => {
  const schema = buildGameSchema(form);
  const hiveRobot = entry(100, scouted("hive", { autoLeave: true, teleTipHive: 2 }), { scoutName: "Ada" });

  it("exports the other role's fields as empty cells and imports them back as absent", () => {
    const csv = entriesToCsv(schema, [hiveRobot], (s) => s);
    const [header, row] = parseCsv(csv);
    const cell = (key: string) => row[header.indexOf(csvHeaderFor(exportableColumns(schema).find((c) => c.key === key)!))];
    expect(cell("teleTipHive")).toBe("2");
    expect(cell("autoTipHive")).toBe("0"); // recorded zero is not blank
    for (const k of GARDEN_KEYS) expect(cell(k)).toBe("");
    const parsed = parseImportCsv(schema, csv);
    expect(parsed.errors).toEqual([]);
    const values = parsed.rows[0].values;
    for (const k of GARDEN_KEYS) expect(k in values).toBe(false);
    expect(values.teleTipHive).toBe(2);
    expect(values[ALLIANCE_ROLE_KEY]).toBe("hive");
    // the form's normalizer (run before saving an import) keeps them absent too
    const saved = normalizeValues(form, values);
    for (const k of GARDEN_KEYS) expect(k in saved).toBe(false);
    expect(calculateScore(form, saved).total).toBe(calculateScore(form, hiveRobot.values as FormValues).total);
  });
});

describe("flags do not misfire on an objective the robot was not assigned", () => {
  const ctx = (sameTeamEntries: ScoutEntry[] = []): FlagContext => ({ match: null, allianceTeams: [], officialAllianceScore: null, allianceAccuracy: null, sameMatchEntries: [], sameTeamEntries, form });

  it("Zero Main Scoring stands down for an entry that skipped an objective, but still fires for an old entry that recorded everything", () => {
    const quietGardenScout = entry(100, scouted("garden"));
    expect(quietGardenScout.score.total).toBe(0);
    expect(evaluateAutoFlagRuleIds(quietGardenScout, ctx())).not.toContain("zero-main-scoring");
    const quietLegacy = entry(100, defaultValues(form) as FormValues);
    expect(evaluateAutoFlagRuleIds(quietLegacy, ctx())).toContain("zero-main-scoring");
  });

  it("Statistical Outlier compares a robot with its own role's entries only", () => {
    const gardenPeers = [3, 4, 3, 4, 3].map((c) => entry(100, scouted("garden", { gardenPollenNectar: c })));
    const hiveScout = entry(100, scouted("hive", { teleTipHive: 3 })); // 60 points among 3-4 point Garden totals
    expect(evaluateAutoFlagRuleIds(hiveScout, ctx(gardenPeers))).not.toContain("statistical-outlier");
    const gardenSpike = entry(100, scouted("garden", { gardenPollenNectar: 30 }));
    expect(evaluateAutoFlagRuleIds(gardenSpike, ctx(gardenPeers))).toContain("statistical-outlier");
  });

  it("the unrealistic limits are unchanged and an absent counter never trips them", () => {
    const garden = entry(100, scouted("garden", { gardenPollenNectar: 41 }));
    expect(evaluateAutoFlagRuleIds(garden, ctx())).toContain("unrealistic-teleop-scoring");
    const hive = entry(100, scouted("hive", { teleTipHive: 6 }));
    expect(evaluateAutoFlagRuleIds(hive, ctx())).not.toContain("unrealistic-teleop-scoring");
  });

  it("Exceeds Alliance Score, Never Started But Scored and the 200-point cap still read the recorded total", () => {
    const over = entry(100, scouted("hive", { teleTipHive: 5 }));
    expect(evaluateAutoFlagRuleIds(over, { ...ctx(), officialAllianceScore: 60 })).toContain("exceeds-alliance-score");
    const ghost = entry(100, scouted("hive", { teleTipHive: 1, neverStartedMatch: true }));
    expect(evaluateAutoFlagRuleIds(ghost, ctx())).toContain("never-started-but-scored");
  });
});
