import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { csDocToFormEntry, type CsFormType } from "@/data/cs/forms";
import { SUBMITTED, leadDoc } from "@/data/cs/fixtures";
import type { CsRecord } from "@/data/cs/types";
import { RebuiltPitAndStrategyView } from "@/components/analytics/pit-and-strategy-rebuilt";
import { RebuiltFormSummaryView } from "@/components/analytics/form-summaries-rebuilt-view";
import { FORM_ANALYTICS_PAGES, type FormAnalyticsSlug } from "@/lib/analytics/form-analytics";
import { teamRebuiltProfile } from "@/lib/analytics/form-summaries-rebuilt";
import type { FormEntry } from "@/lib/form-entries-model";
import { getBuiltinForm } from "@/lib/forms/builtin";

// The Analytics filter context is mounted by the Analytics layout; a view only needs its link builder.
vi.mock("@/lib/analytics/filter-context", () => ({
  useAnalyticsHref: () => (path: string, extra?: Record<string, string>) => (extra ? `${path}?${new URLSearchParams(extra).toString()}` : path),
  useAnalyticsFilters: () => ({ query: "" }),
}));

const text = (html: string) => html.replace(/<!-- -->/g, "");
let n = 0;
const read = (type: CsFormType, doc: CsRecord): FormEntry => csDocToFormEntry(type, `${type}-${++n}`, { teamId: "MAG2403", eventKey: "2026arli", game: "REBUILT", scoutName: "Ada Lovelace", scoutId: "uid-ada", createdAt: SUBMITTED + n, submittedAt: SUBMITTED + n, ...doc });
const robot = (team: string, over: CsRecord = {}) => ({ teamNumber: team, startingPosition: "middle", role: "Offense", autoClimb: false, endgameClimb: "", ...over });

const pages = FORM_ANALYTICS_PAGES;
const render = (slug: FormAnalyticsSlug, entries: FormEntry[], allEntries: FormEntry[] = entries, hideNames = false) => {
  const page = pages.find((p) => p.slug === slug)!;
  return text(renderToString(<RebuiltFormSummaryView page={page} form={getBuiltinForm(page.formId)!} entries={entries} allEntries={allEntries} teamNames={new Map([[254, "The Cheesy Poofs"]])} hideNames={hideNames} />));
};

const pit = (team: string, over: CsRecord = {}) =>
  read("pit-scout", { teamNumber: team, robotWeight: "118 lbs", rookieTeam: true, robotPictureUrl: "https://example.com/r.jpg", pitDisposition: true, driveDisposition: false, fuelPreloadCapacity: "8", fuelBallsPerSecond: "10-13", fuelCarryingCapacity: "x", climbLevel1: true, climbLevel2: true, climbLevel3: false, typicalFuelCycleTime: "6.5", typicalClimbTime: "4", autoCycleDescription: "Depot then shoot", notes: "Tidy wiring", ...over });

describe("REBUILT summary views", () => {
  it("shows each empty state", () => {
    for (const [slug, words] of [["lead-scout", "No Lead Scout entries yet"], ["pit-scout", "No Pit Scout entries yet"], ["team-strategy", "No Team Strategy entries yet"], ["match-strategy", "No Match Strategy entries yet"], ["drive-reflection", "No Drive Reflection entries yet"], ["helper", "No pit assists logged yet"]] as const) {
      expect(render(slug, []), slug).toContain(words);
    }
  });

  it("pit: scales, climb levels, weight, dispositions and the picture", () => {
    const html = render("pit-scout", [pit("254"), pit("1678", { climbLevel3: true, fuelPreloadCapacity: "", rookieTeam: false })]);
    expect(html).toContain('data-testid="pit-card-254"');
    expect(html).toContain("The Cheesy Poofs");
    expect(html).toContain("118 lbs");
    expect(html).toContain("10-13");
    expect(html).toContain("Balls per second");
    expect(html).toContain("Depot then shoot");
    expect(html).toContain("Tidy wiring");
    expect(html).toContain('href="https://example.com/r.jpg"');
    expect(html).toContain("Rookie");
    expect(html).toMatch(/data-testid="pit-climb-count-3"[^>]*>1</);
    expect(html).toMatch(/data-testid="pit-climb-count-1"[^>]*>2</);
    expect(html).toMatch(/data-testid="climb-3" data-on="true"/);
  });

  it("team strategy: counts per best-at and start, and the abilities table", () => {
    const e = read("team-strategy", { teamNumber: "254", preferredStartingPosition: "outpost-trench", bestAt: "shooting", clearsBump: true, clearsTrench: false, canShootWhileIntaking: false, canMoveAndShootSimultaneously: true, notes: "Fast bumps" });
    const html = render("team-strategy", [e]);
    expect(html).toContain('data-testid="strategy-row-254"');
    expect(html).toMatch(/data-testid="best-count-shooting"[^>]*>Shooting <strong[^>]*>1</);
    expect(html).toMatch(/data-testid="best-count-cycling"[^>]*>Cycling <strong[^>]*>0</);
    expect(html).toMatch(/data-testid="start-count-outpost-trench"[^>]*>Outpost Trench <strong[^>]*>1</);
    expect(html).toContain("Outpost Trench");
    expect(html).toContain("Moves and shoots: yes");
    expect(html).toContain("Clears trench: no");
    expect(html).toContain("Fast bumps");
  });

  it("lead scout: per-team average and per-robot skill and notes, with scout names hidden on request", () => {
    const e = read("lead-scout", { ...leadDoc(), matchKey: "q12", matchId: "q12", robots: [{ teamNumber: "254", notes: "fast cycler", skillLevel: 5 }, { teamNumber: "1678", notes: "", skillLevel: 3 }, { teamNumber: "118", notes: "", skillLevel: 0 }], overallAlliance: { teams: "RED / 254, 1678, 118", notes: "strong alliance", skillLevel: 4 } });
    const html = render("lead-scout", [e]);
    expect(html).toContain('data-testid="lead-team-254"');
    expect(html).toContain("fast cycler");
    expect(html).toContain("strong alliance");
    expect(html).toContain("5.0");
    expect(html).toContain("— Ada Lovelace");
    expect(render("lead-scout", [e], [e], true)).not.toContain("Ada Lovelace");
  });

  it("match strategy and drive reflection: plan against actual with the differences", () => {
    const plan = read("match-strategy", { matchKey: "q12", matchId: "q12", robots: [robot("254", { startingPosition: "outpost-trench", autoClimb: true, endgameClimb: "level-3" }), robot("1678"), robot("118")], notes: "" });
    const refl = read("drive-reflection", { matchKey: "q12", matchId: "q12", robots: [robot("254", { startingPosition: "outpost-trench", role: "cycler", autoClimb: false, endgameClimb: "level-3" }), robot("1678"), robot("118")], notes: "Climb failed" });
    const planHtml = render("match-strategy", [plan]);
    expect(planHtml).toContain('data-testid="robot-254"');
    expect(planHtml).toContain("Outpost Trench");
    expect(planHtml).toContain("Auto climb");
    expect(planHtml).toContain("Level 3");
    const html = render("drive-reflection", [refl], [plan, refl]);
    expect(html).toMatch(/data-testid="went-to-plan"[^>]*>0%</);
    expect(html).toContain("1 difference from the plan");
    expect(html).toContain("254: auto climb planned Yes, actual No");
    expect(html).toContain("Climb failed");
    expect(render("drive-reflection", [refl], [refl])).toContain("No plan to compare with");
  });

  it("helper: success rate and the log", () => {
    const a = read("helper", { helperName: "Ada", assistedTeamNumber: "254", wasSuccessful: true, issueSolved: "Swapped a motor" });
    const b = read("helper", { helperName: "Ben", assistedTeamNumber: "118", wasSuccessful: false, issueSolved: "Bad wiring" });
    const html = render("helper", [a, b]);
    expect(html).toContain("50%");
    expect(html).toContain("Swapped a motor");
    expect(html).toContain("Solved");
    expect(html).toContain("Not solved");
    expect(html).toContain('data-testid="helper-scout-0"');
  });
});

describe("Team Profile section on REBUILT data", () => {
  const entries = [
    pit("254"),
    read("team-strategy", { teamNumber: "254", preferredStartingPosition: "middle", bestAt: "cycling", clearsBump: true, clearsTrench: false, canShootWhileIntaking: true, canMoveAndShootSimultaneously: false }),
    read("lead-scout", { ...leadDoc(), matchKey: "q4", matchId: "q4", robots: [{ teamNumber: "254", notes: "reliable", skillLevel: 4 }], overallAlliance: { skillLevel: 3 } }),
    read("match-strategy", { matchKey: "q4", matchId: "q4", robots: [robot("254", { startingPosition: "outpost-trench", role: "Offense", autoClimb: true, endgameClimb: "level-3" })] }),
    read("drive-reflection", { matchKey: "q4", matchId: "q4", robots: [robot("254", { startingPosition: "outpost-trench", role: "cycler", autoClimb: true, endgameClimb: "level-2" })] }),
  ];

  it("shows the pit scales, climb levels, strategy, lead skill and the plan against reflection comparison", () => {
    const html = text(renderToString(<RebuiltPitAndStrategyView teamNumber={254} info={teamRebuiltProfile(254, entries)} />));
    expect(html).toContain("Pit and strategy");
    expect(html).toContain("118 lbs");
    expect(html).toContain("Preload");
    expect(html).toContain("10-13");
    expect(html).toContain("Cycling");
    expect(html).toContain("Preferred start");
    expect(html).toContain("4.0 / 5");
    expect(html).toContain("Clears bump");
    expect(html).toContain("Shoots while intaking");
    expect(html).not.toContain("Clears trench");
    expect(html).toContain("reliable");
    expect(html).toContain("Friendly in the pit");
    expect(html).toMatch(/data-testid="capability-endgame-climb"[\s\S]*?Level 2[\s\S]*?Level 3/); // pit scout says level 2, the plan says level 3
    expect(html).toContain('href="/frc/analytics/pit-scout?view=summary"');
    expect(html).toContain('href="/frc/analytics/drive-reflection?view=summary"');
  });

  it("leaves out sections it has no data for", () => {
    const html = text(renderToString(<RebuiltPitAndStrategyView teamNumber={254} info={teamRebuiltProfile(254, [entries[1]])} />));
    expect(html).toContain("Best at");
    expect(html).not.toContain("capability-comparison");
    expect(html).not.toContain("Preload");
    expect(html).not.toContain("Lead scout skill");
  });
});
