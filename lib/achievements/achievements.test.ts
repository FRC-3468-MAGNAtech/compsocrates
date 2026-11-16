import { describe, expect, it } from "vitest";
import type { EventAttendance } from "@/lib/event-attendance";
import type { PracticeSession } from "@/lib/practice-sessions";
import { computeProfileStats } from "@/lib/profile/stats";
import type { ScoutEntry } from "@/lib/scout-entries";
import type { TeamMember } from "@/lib/team-members";
import { BUILTIN_ACHIEVEMENTS } from "./builtins";
import { ACHIEVEMENT_LIMITS, EMPTY_ACHIEVEMENT_CONFIG, achievementName, applyOverride, cleanText, effectiveAchievements, parseAchievementConfig, validateConfigInput } from "./config";
import { evaluate, type AchievementDefinition } from "./engine";
import { METRICS, METRIC_IDS, metricsForProgram, type AchievementFacts } from "./metrics";
import { buildItems, earnedOnly, filterAndSort, groupByCategory, summarize } from "./view";

const def = (o: Partial<AchievementDefinition> = {}): AchievementDefinition => ({ id: "custom-a", name: "Practice Pro", description: "Five practice sessions.", icon: "Trophy", metric: "practice-sessions", threshold: 5, scope: "all", hidden: false, ...o });
const facts = (id: keyof typeof METRICS, value: number | null, samples = value === null ? 0 : 1, season: number | null = null): AchievementFacts => ({ [id]: { all: { value, samples }, season: season === null ? null : { value: season, samples: season } } });

describe("metrics registry", () => {
  it("every metric declares a label, a unit, a category and whether it has a season scope", () => {
    for (const id of METRIC_IDS) {
      const m = METRICS[id];
      expect(m.id).toBe(id);
      expect(m.label && m.unit && m.category && m.help).toBeTruthy();
      expect(typeof m.seasonScope).toBe("boolean");
    }
  });
  it("only events and matches scouted have a season scope; only average accuracy uses samples", () => {
    expect(METRIC_IDS.filter((id) => METRICS[id].seasonScope)).toEqual(["events-attended", "scout-entries"]);
    expect(METRIC_IDS.filter((id) => METRICS[id].usesSamples)).toEqual(["average-accuracy"]);
  });
  it("a program offers all metrics, or the listed ones (unknown ids ignored)", () => {
    expect(metricsForProgram("all")).toEqual([...METRIC_IDS]);
    expect(metricsForProgram(undefined)).toEqual([...METRIC_IDS]);
    expect(metricsForProgram(["practice-sessions", "nope"])).toEqual(["practice-sessions"]);
  });
});

describe("engine", () => {
  it("target minus one, exactly the target, and above it", () => {
    expect(evaluate(def(), facts("practice-sessions", 4))).toMatchObject({ current: 4, target: 5, ratio: 0.8, earned: false, noData: false });
    expect(evaluate(def(), facts("practice-sessions", 5))).toMatchObject({ ratio: 1, earned: true });
    expect(evaluate(def(), facts("practice-sessions", 50))).toMatchObject({ current: 50, ratio: 1, earned: true });
  });
  it("a person with 3 sessions has 60% of a 5-session achievement", () => {
    const p = evaluate(def(), facts("practice-sessions", 3))!;
    expect(p.ratio).toBeCloseTo(0.6);
    expect(p.earned).toBe(false);
  });
  it("zero is a real measurement (not missing data)", () => {
    expect(evaluate(def(), facts("practice-sessions", 0, 0))).toMatchObject({ current: 0, ratio: 0, earned: false, noData: false });
  });
  it("no facts for the metric means no data, never earned", () => {
    expect(evaluate(def(), {})).toMatchObject({ current: 0, ratio: 0, earned: false, noData: true });
    expect(evaluate(def({ metric: "best-accuracy", threshold: 100 }), facts("best-accuracy", null))).toMatchObject({ earned: false, noData: true });
  });
  it("season scope reads the season value; without one, no data; a metric with no season scope cannot be evaluated", () => {
    const d = def({ metric: "events-attended", threshold: 2, scope: "season" });
    expect(evaluate(d, facts("events-attended", 9, 9, 1))).toMatchObject({ current: 1, earned: false });
    expect(evaluate(d, facts("events-attended", 9, 9, 2))).toMatchObject({ current: 2, earned: true });
    expect(evaluate(d, facts("events-attended", 9, 9))).toMatchObject({ noData: true, earned: false });
    expect(evaluate(def({ scope: "season" }), facts("practice-sessions", 9))).toBeNull();
  });
  it("average accuracy needs its minimum samples, and is never a 0 for missing accuracy", () => {
    const d = def({ metric: "average-accuracy", threshold: 90, minSamples: 5 });
    expect(evaluate(d, facts("average-accuracy", 95, 4))).toMatchObject({ earned: false, noData: true, current: 0 });
    expect(evaluate(d, facts("average-accuracy", 95, 5))).toMatchObject({ earned: true, current: 95 });
    expect(evaluate(d, facts("average-accuracy", 89, 5))).toMatchObject({ earned: false, noData: false });
    expect(evaluate(d, facts("average-accuracy", null, 0))).toMatchObject({ noData: true });
  });
  it("an unknown metric is skipped (null), not thrown on", () => {
    expect(evaluate(def({ metric: "gone" as never }), facts("practice-sessions", 5))).toBeNull();
  });
});

describe("built-ins", () => {
  it("are eight, all-time, with thresholds that are whole numbers of at least 1", () => {
    expect(BUILTIN_ACHIEVEMENTS).toHaveLength(8);
    for (const d of BUILTIN_ACHIEVEMENTS) {
      expect(d.scope).toBe("all");
      expect(Number.isInteger(d.threshold) && d.threshold >= 1).toBe(true);
      expect(Object.hasOwn(METRICS, d.metric)).toBe(true);
    }
  });
});

describe("config validation", () => {
  const ok = (o: unknown) => validateConfigInput(o, "all");
  const code = (o: unknown, program: "all" | readonly string[] = "all") => {
    const r = validateConfigInput(o, program);
    return r.ok ? "ok" : r.code;
  };
  const custom = (o: Record<string, unknown> = {}) => ({ id: "practice-pro", name: "Practice Pro", description: "Five sessions.", icon: "Trophy", metric: "practice-sessions", threshold: 5, scope: "all", hidden: false, ...o });

  it("accepts a good custom achievement and a built-in rename and hide", () => {
    const r = ok({ overrides: { "first-session": { name: "Rookie", hidden: true } }, custom: [custom()] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.overrides["first-session"]).toEqual({ name: "Rookie", hidden: true });
      expect(r.custom[0].name).toBe("Practice Pro");
    }
  });
  it("refuses long names and descriptions, at the boundary", () => {
    expect(code({ custom: [custom({ name: "x".repeat(ACHIEVEMENT_LIMITS.nameMax) })] })).toBe("ok");
    expect(code({ custom: [custom({ name: "x".repeat(ACHIEVEMENT_LIMITS.nameMax + 1) })] })).toBe("invalid_name");
    expect(code({ custom: [custom({ description: "x".repeat(ACHIEVEMENT_LIMITS.descriptionMax + 1) })] })).toBe("invalid_description");
    expect(code({ custom: [custom({ name: "   " })] })).toBe("invalid_name");
  });
  it("refuses HTML in names and descriptions, for customs and for built-in overrides", () => {
    expect(code({ custom: [custom({ name: "<b>Pro</b>" })] })).toBe("invalid_name");
    expect(code({ custom: [custom({ description: "<script>alert(1)</script>" })] })).toBe("invalid_description");
    expect(code({ overrides: { streak: { name: "<img src=x>" } } })).toBe("invalid_name");
  });
  it("refuses a bad metric, a metric the program lacks, a bad icon and a bad scope", () => {
    expect(code({ custom: [custom({ metric: "eval(1)" })] })).toBe("invalid_metric");
    expect(code({ custom: [custom()] }, ["scout-entries"])).toBe("metric_not_available");
    expect(code({ custom: [custom({ icon: "<svg>" })] })).toBe("invalid_icon");
    expect(code({ custom: [custom({ scope: "forever" })] })).toBe("invalid_scope");
    expect(code({ custom: [custom({ scope: "season" })] })).toBe("invalid_scope"); // practice sessions have no season scope
    expect(code({ custom: [custom({ metric: "events-attended", scope: "season" })] })).toBe("ok");
  });
  it("thresholds are whole numbers from 1 to 100000", () => {
    for (const bad of [0, -1, 1.5, 100001, "5", null, Number.NaN]) expect(code({ custom: [custom({ threshold: bad })] })).toBe("invalid_threshold");
    expect(code({ custom: [custom({ threshold: 1 })] })).toBe("ok");
    expect(code({ custom: [custom({ threshold: 100000 })] })).toBe("ok");
  });
  it("at most 40 custom achievements, with unique ids that never clash with a built-in", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => custom({ id: `c-${i + 10}` }));
    expect(code({ custom: many(40) })).toBe("ok");
    expect(code({ custom: many(41) })).toBe("too_many");
    expect(code({ custom: [custom(), custom()] })).toBe("duplicate_id");
    expect(code({ custom: [custom({ id: "first-session" })] })).toBe("invalid_id");
  });
  it("built-ins cannot change their threshold, metric or icon, and an unknown built-in id is refused", () => {
    expect(code({ overrides: { streak: { threshold: 1 } } })).toBe("invalid_override");
    expect(code({ overrides: { nope: { name: "x" } } })).toBe("invalid_override_id");
  });
  it("min samples only matter for averaged metrics and must be a whole number", () => {
    const avg = custom({ metric: "average-accuracy", threshold: 90, minSamples: 5 });
    const r = ok({ custom: [avg] });
    expect(r.ok && r.custom[0].minSamples).toBe(5);
    const other = ok({ custom: [custom({ minSamples: 5 })] });
    expect(other.ok && other.custom[0].minSamples).toBeUndefined();
    expect(code({ custom: [custom({ minSamples: 0 })] })).toBe("invalid_min_samples");
  });
  it("order may only name existing achievements", () => {
    expect(code({ custom: [custom()], order: ["practice-pro", "streak"] })).toBe("ok");
    expect(code({ order: ["ghost"] })).toBe("invalid_order");
  });
  it("cleanText is plain text only", () => {
    expect(cleanText("  Hello   world ", 40)).toBe("Hello world");
    expect(cleanText("a<b", 40)).toBeNull();
    expect(cleanText("a\u0000b", 40)).toBeNull();
    expect(cleanText(5, 40)).toBeNull();
  });
});

describe("stored config and the name resolver", () => {
  it("a stored document with junk parses to what is valid (never throws)", () => {
    const parsed = parseAchievementConfig({ version: 3, overrides: { streak: { name: "Hot streak", threshold: 1 }, ghost: { name: "x" } }, custom: [{ id: "ok-one", name: "A", description: "B", icon: "Trophy", metric: "practice-sessions", threshold: 2, scope: "all" }, { id: "bad", name: "<b>" }, 7, null], order: ["x", 5] });
    expect(parsed.version).toBe(3);
    expect(parsed.overrides).toEqual({ streak: { name: "Hot streak" } });
    expect(parsed.custom.map((c) => c.id)).toEqual(["ok-one"]);
    expect(parseAchievementConfig(null)).toEqual(EMPTY_ACHIEVEMENT_CONFIG);
    expect(parseAchievementConfig("junk")).toEqual(EMPTY_ACHIEVEMENT_CONFIG);
  });
  it("name resolver: override > built-in default; a custom keeps its own", () => {
    const config = parseAchievementConfig({ overrides: { "first-session": { name: "Rookie" } }, custom: [{ id: "pro-one", name: "Pro", description: "d", icon: "Trophy", metric: "practice-sessions", threshold: 5, scope: "all" }] });
    expect(achievementName(config, "first-session")).toBe("Rookie");
    expect(achievementName(config, "ten-sessions")).toBe("10 Sessions");
    expect(achievementName(config, "pro-one")).toBe("Pro");
    expect(achievementName(config, "ghost")).toBeNull();
    expect(applyOverride(BUILTIN_ACHIEVEMENTS[0], { description: "Hello" }).description).toBe("Hello");
  });
  it("a custom whose metric no longer exists is flagged unavailable and skipped by the pages", () => {
    const config = parseAchievementConfig({ custom: [{ id: "old-one", name: "Old", description: "d", icon: "Trophy", metric: "retired-metric", threshold: 5, scope: "all" }] });
    expect(effectiveAchievements(config, "all").find((a) => a.def.id === "old-one")?.unavailable).toBe(true);
    expect(buildItems(config, {}, "all").map((i) => i.id)).not.toContain("old-one");
  });
  it("order moves things; ids missing from it follow in the default order", () => {
    const config = parseAchievementConfig({ order: ["perfect-alliance", "streak"] });
    expect(effectiveAchievements(config, "all").map((a) => a.def.id).slice(0, 3)).toEqual(["perfect-alliance", "streak", "first-session"]);
  });
});

describe("view: items, filter, next up, hidden, others' view", () => {
  const f: AchievementFacts = { ...facts("practice-sessions", 3), ...facts("longest-streak", 4), ...facts("events-attended", 3), ...facts("best-accuracy", null), ...facts("excellent-categories", 0, 3), ...facts("perfect-entries", 0, 0) };
  const config = parseAchievementConfig({ custom: [{ id: "practice-pro", name: "Practice Pro", description: "Five sessions.", icon: "Trophy", metric: "practice-sessions", threshold: 5, scope: "all" }] });

  it("a custom 'Practice Pro' (5 sessions) shows 3 of 5 for a scout who has 3", () => {
    const item = buildItems(config, f, "all").find((i) => i.id === "practice-pro")!;
    expect(item.progress).toMatchObject({ current: 3, target: 5, earned: false });
    expect(item.progress.ratio).toBeCloseTo(0.6);
  });
  it("hidden built-ins and hidden customs do not appear and do not count", () => {
    const hidden = parseAchievementConfig({ overrides: { "first-session": { hidden: true } }, custom: [{ id: "practice-pro", name: "P", description: "d", icon: "Trophy", metric: "practice-sessions", threshold: 5, scope: "all", hidden: true }] });
    const items = buildItems(hidden, f, "all");
    expect(items.map((i) => i.id)).not.toContain("first-session");
    expect(items.map((i) => i.id)).not.toContain("practice-pro");
    expect(summarize(items).total).toBe(7);
  });
  it("filters, and 'Next up' puts the closest unearned first, earned last", () => {
    const items = buildItems(config, f, "all");
    const inProgress = filterAndSort(items, "in-progress");
    expect(inProgress.every((i) => !i.progress.earned)).toBe(true);
    const ratios = inProgress.map((i) => i.progress.ratio);
    expect([...ratios].sort((a, b) => b - a)).toEqual(ratios);
    expect(filterAndSort(items, "earned").every((i) => i.progress.earned)).toBe(true);
    const all = filterAndSort(items, "all");
    const firstEarned = all.findIndex((i) => i.progress.earned);
    expect(all.slice(firstEarned).every((i) => i.progress.earned)).toBe(true);
  });
  it("summary: earned count and the closest next", () => {
    const s = summarize(buildItems(config, f, "all"));
    expect(s.earned).toBe(2); // First Session (3 >= 1) and Event Veteran (3 >= 3)
    expect(s.next?.id).toBe("streak"); // 4 of 5 days is the closest unearned (ten-sessions is 3/10)
  });
  it("what another person sees is the earned ones only, with the rest not in the list at all", () => {
    const shown = earnedOnly(buildItems(config, f, "all"));
    expect(shown.map((i) => i.id).sort()).toEqual(["event-veteran", "first-session"]);
  });
  it("groups by category in a fixed order, dropping empty groups", () => {
    expect(groupByCategory(buildItems(config, f, "all")).map((g) => g.category)).toEqual(["Practice", "Accuracy", "Events and scouting"]);
    expect(groupByCategory([]).length).toBe(0);
  });
});

describe("facts from profile data (both programs' shapes)", () => {
  const me: TeamMember = { uid: "me", name: "me", email: "me@x.com", primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false };
  const entry = (id: string, o: Partial<ScoutEntry> = {}): ScoutEntry => ({
    id, teamId: "t", uid: "me", source: "event", mode: null, formId: "f", formVersion: 1, scoutName: "me", eventCode: "2026lake", matchType: "Qualification", matchNumber: 1, teamNumber: 1,
    values: {}, score: { auto: 0, teleop: 0, endgame: 0, total: 0 }, comments: "", submittedAt: "2026-03-02T10:00:00.000Z", excluded: false, autoFlags: [], manualFlags: [], accuracy: null, sessionId: null, libraryMatchId: null, ...o,
  });
  const session = (id: string, accuracy: number | null, o: Partial<PracticeSession> = {}): PracticeSession => ({
    id, teamId: "t", uid: "me", scoutName: "me", kind: "solo", seasonId: "s", mode: "trial", difficulty: "medium", libraryMatchId: null, eventCode: null, alliance: "red", robots: [1, 2], status: "completed",
    completedRobots: [1, 2], entryIds: [], accuracy, scoutedTotal: 0, penaltyPoints: 0, officialScore: 0, platform: "pc", flags: [], excluded: false, lobbyId: null, pairId: null,
    startedAt: "2026-03-01T10:00:00.000Z", finishedAt: "2026-03-01T10:10:00.000Z", matchType: null, matchNumber: null, allianceTeams: null, streamUrl: null, streamStartSec: null, streamEndSec: null, ...o,
  });
  const run = (o: Parameters<typeof computeProfileStats>[0] extends infer T ? Partial<T> : never) => computeProfileStats({ uid: "me", members: [me], sessions: [], entries: [], libraryMatchesById: new Map(), attendance: [], now: new Date(2026, 5, 1), ...o }).achievementFacts;
  const att = (code: string): EventAttendance => ({ id: code, teamId: "t", eventCode: code, uids: ["me"], updatedAt: null });

  it("matches scouted counts event and live entries only, never practice or excluded; season scope follows the event key", () => {
    const f = run({
      entries: [entry("a"), entry("b", { source: "live" }), entry("c", { source: "practice" }), entry("d", { excluded: true }), entry("e", { eventCode: "2025lake" })],
      eventScope: { season: 2026, keyShape: "tba" } as never,
    });
    expect(f["scout-entries"]?.all.value).toBe(3);
    expect(f["scout-entries"]?.season?.value).toBe(2);
  });
  it("FTC event keys (season start year): events attended and entries in the current season", () => {
    const f = run({
      entries: [entry("a", { eventCode: "2025-USCALAB" }), entry("b", { eventCode: "2024-USCALAB" })],
      attendance: [att("2025-USCALAB"), att("2024-USCALAB")],
      eventScope: { season: 2025, keyShape: "season-code" } as never,
    });
    expect(f["events-attended"]?.all.value).toBe(2);
    expect(f["events-attended"]?.season?.value).toBe(1);
    expect(f["scout-entries"]?.season?.value).toBe(1);
  });
  it("without an event scope there is no season value (never a guessed 0)", () => {
    expect(run({ entries: [entry("a")] })["scout-entries"]?.season).toBeNull();
  });
  it("average accuracy skips a session with no accuracy and an excluded one (never counts them as 0)", () => {
    const f = run({ sessions: [session("1", 100), session("2", 80), session("3", null), session("4", 0, { excluded: true })] });
    expect(f["average-accuracy"]?.all).toEqual({ value: 90, samples: 2 });
    expect(f["best-accuracy"]?.all.value).toBe(100);
    const none = run({ sessions: [session("1", null)] });
    expect(none["average-accuracy"]?.all).toEqual({ value: null, samples: 0 });
    expect(none["best-accuracy"]?.all.value).toBeNull();
  });
  it("mixed alliance-role entries (some objective values recorded, some absent) count as scouted, and an absent accuracy is not a perfect one", () => {
    const f = run({
      entries: [
        entry("hive", { values: { allianceRole: "hive", tipHive: 2 } }),
        entry("garden", { values: { allianceRole: "garden", garden: 1, flower: 1 } }),
        entry("no-role", { values: {} }),
        entry("perfect", { accuracy: { status: "complete", value: 1, scoutedTotal: 50, penaltyPoints: 0, officialScore: 50 } }),
      ],
    });
    expect(f["scout-entries"]?.all.value).toBe(4);
    expect(f["perfect-entries"]?.all.value).toBe(1);
  });
});
