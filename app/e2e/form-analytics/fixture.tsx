"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FormAnalyticsView } from "@/components/analytics/form-analytics-page";
import { FORM_ANALYTICS_PAGES, formAnalyticsPage, selectFormEntries, type FormAnalyticsSlug } from "@/lib/analytics/form-analytics";
import { AnalyticsFilterProvider } from "@/lib/analytics/filter-context";
import type { FormEntry, NewFormEntry } from "@/lib/form-entries-model";
import { RebuiltPitAndStrategyView } from "@/components/analytics/pit-and-strategy-rebuilt";
import { teamRebuiltProfile } from "@/lib/analytics/form-summaries-rebuilt";
import { BUILTIN_FORMS } from "@/lib/forms/builtin";

declare global {
  interface Window {
    __entries?: FormEntry[];
    __saved?: NewFormEntry[];
  }
}

let n = 0;
const base = (formId: string, formType: FormEntry["formType"], over: Partial<FormEntry>): FormEntry => ({
  id: `seed-${++n}`,
  teamId: "t",
  uid: "u1",
  scoutName: "Ada Lovelace",
  formId,
  formVersion: 1,
  formType,
  eventCode: "EVT1",
  teamNumber: null,
  values: {},
  stickyNotes: [],
  flags: [],
  excluded: false,
  createdAtMs: 1000 + n,
  updatedAtMs: 1000 + n,
  ...over,
});

/** An alliance form's per-robot values (`robot1_teamNumber` ...): the keys of data/cs/form-field-keys.ts. */
type Robot = { team: number; start?: string; role?: string; auto?: boolean; climb?: string };
const robotValues = (rows: Robot[]) =>
  Object.fromEntries(
    rows.flatMap((r, i) => [
      [`robot${i + 1}_teamNumber`, String(r.team)],
      [`robot${i + 1}_startingPosition`, r.start ?? "middle"],
      [`robot${i + 1}_role`, r.role ?? "Offense"],
      [`robot${i + 1}_autoClimb`, r.auto ?? false],
      [`robot${i + 1}_endgameClimb`, r.climb ?? ""],
    ])
  );
const leadRobots = (rows: [number, number, string?][]) => Object.fromEntries(rows.flatMap(([team, skill, notes], i) => [[`robot${i + 1}_teamNumber`, String(team)], [`robot${i + 1}_skillLevel`, skill], [`robot${i + 1}_notes`, notes ?? ""]]));

function seed(): FormEntry[] {
  n = 0;
  return [
    // Pit Scout: team 111 (a picture, climbs, an auto cycle), team 222 twice (the later one wins), team 333 on a second event
    base("pit-scout-v1", "pit-scout", { teamNumber: 111, createdAtMs: 5000, values: { robotWeight: "118 lbs", rookieTeam: true, robotPictureUrl: "https://example.com/robot-111.jpg", pitDisposition: true, driveDisposition: false, fuelPreloadCapacity: "8", fuelBallsPerSecond: "10-13", fuelCarryingCapacity: "x", climbLevel1: true, climbLevel2: true, climbLevel3: false, typicalFuelCycleTime: "12.5", typicalClimbTime: "4", autoCycleDescription: "Depot then shoot" }, stickyNotes: [{ id: "a", text: "tall robot", color: "yellow", createdAt: 1 }] }),
    base("pit-scout-v1", "pit-scout", { teamNumber: 222, scoutName: "Ben Franklin", createdAtMs: 1000, values: { robotWeight: "60 lbs", typicalFuelCycleTime: "30" } }),
    base("pit-scout-v1", "pit-scout", { teamNumber: 222, scoutName: "Ben Franklin", createdAtMs: 2000, values: { robotWeight: "55 lbs", typicalFuelCycleTime: "18", climbLevel3: true } }),
    base("pit-scout-v1", "pit-scout", { teamNumber: 333, eventCode: "EVT2", createdAtMs: 3000, values: { robotWeight: "70 lbs" } }),
    // Lead Scout
    base("lead-scout-v1", "lead-scout", { matchKey: "Q1", alliance: "red", values: { overallAlliance_notes: "solid alliance", overallAlliance_skillLevel: 4, ...leadRobots([[111, 5, "fast cycles"], [222, 3]]) } }),
    base("lead-scout-v1", "lead-scout", { matchKey: "Q2", alliance: "blue", scoutName: "Ben Franklin", values: { overallAlliance_skillLevel: 2, ...leadRobots([[111, 3], [444, 1]]) } }),
    // Team Strategy
    base("team-strategy-v1", "team-strategy", { teamNumber: 111, values: { preferredStartingPosition: "outpost-trench", bestAt: "shooting", clearsBump: true, canMoveAndShootSimultaneously: true } }),
    base("team-strategy-v1", "team-strategy", { teamNumber: 222, values: { preferredStartingPosition: "middle", bestAt: "cycling", canShootWhileIntaking: true } }),
    base("team-strategy-v1", "team-strategy", { teamNumber: 444, values: { preferredStartingPosition: "middle", bestAt: "cycling" } }),
    // Match Strategy and Drive Reflection (Q1 red: team 222's endgame climb differed from the plan; Q2 blue went to plan)
    base("match-strategy-v1", "match-strategy", { matchKey: "Q1", alliance: "red", values: robotValues([{ team: 111, auto: true, climb: "level-3" }, { team: 222, role: "Defense", climb: "level-3" }]) }),
    base("match-strategy-v1", "match-strategy", { matchKey: "Q2", alliance: "blue", values: robotValues([{ team: 111 }, { team: 444, role: "Feeder" }]) }),
    base("drive-reflection-v1", "drive-reflection", { matchKey: "Q1", alliance: "red", planDifferences: 1, values: robotValues([{ team: 111, auto: true, climb: "level-3" }, { team: 222, role: "cycler", climb: "level-2" }]) }),
    base("drive-reflection-v1", "drive-reflection", { matchKey: "Q2", alliance: "blue", planDifferences: 0, values: robotValues([{ team: 111 }, { team: 444, role: "cycler" }]) }),
    // Helper
    base("helper-v1", "helper", { teamNumber: 111, values: { wasSuccessful: true, issueSolved: "Loose intake belt" } }),
    base("helper-v1", "helper", { teamNumber: 222, values: { wasSuccessful: false, issueSolved: "Bad servo" } }),
    base("helper-v1", "helper", { teamNumber: 333, scoutName: "Ben Franklin", values: { wasSuccessful: true, issueSolved: "Battery connector" } }),
  ];
}

const NAMES = new Map<number, string>([[111, "Rookies"], [222, "Veterans"], [333, "Third"], [444, "Fourth"]]);

function Fixture() {
  const q = useSearchParams();
  const slug = (q.get("page") ?? "pit-scout") as FormAnalyticsSlug;
  const page = formAnalyticsPage(slug) ?? FORM_ANALYTICS_PAGES[0];
  const admin = q.get("admin") === "1";
  const twoEvents = q.get("events") === "2";
  const events = useMemo(() => (twoEvents ? ["EVT1", "EVT2"] : ["EVT1"]), [twoEvents]);
  const [entries, setEntries] = useState<FormEntry[]>(() => (q.get("entries") === "none" ? [] : seed()));
  const form = BUILTIN_FORMS[page.formId];

  useEffect(() => {
    window.__entries = entries;
  }, [entries]);
  useEffect(() => {
    window.__saved = [];
  }, []);

  const profileTeam = q.get("profile") ? Number(q.get("profile")) : null;
  const scope = useMemo(() => selectFormEntries(entries, page.formType, events, { includeExcluded: true }), [entries, page.formType, events]);

  if (profileTeam !== null) {
    const info = teamRebuiltProfile(profileTeam, entries.filter((e) => !e.excluded));
    return (
      <div className="mx-auto w-full min-w-0 max-w-[1100px] p-3">
        <AnalyticsFilterProvider>
          {info.any ? <RebuiltPitAndStrategyView teamNumber={profileTeam} info={info} /> : <p data-testid="profile-hidden">hidden</p>}
        </AnalyticsFilterProvider>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1100px] p-3">
      <AnalyticsFilterProvider>
        <FormAnalyticsView
          key={`${slug}-${q.get("events") ?? "1"}`}
          page={page}
          entries={scope}
          allEntries={entries}
          form={form}
          importForm={form}
          loaded={q.get("loaded") !== "0"}
          eventCodes={events}
          isAdmin={admin}
          teamNames={NAMES}
          importEvent="EVT1"
          initialView={q.get("view") === "summary" ? "summary" : "table"}
          onUpdate={(id, patch) => setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, ...patch } : e)))}
          onDelete={(id) => setEntries((cur) => cur.filter((e) => e.id !== id))}
          onImportSave={async (input) => {
            (window.__saved ??= []).push(input);
            setEntries((cur) => [...cur, { ...base(input.formId, input.formType, {}), ...input, id: `imp-${cur.length}`, teamId: "t", uid: "admin", teamNumber: input.teamNumber ?? null, stickyNotes: input.stickyNotes ?? [], flags: [], excluded: false }]);
          }}
        />
      </AnalyticsFilterProvider>
    </div>
  );
}

export function FormAnalyticsFixture() {
  return (
    <Suspense fallback={null}>
      <Fixture />
    </Suspense>
  );
}
