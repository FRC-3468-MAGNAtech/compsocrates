import { BRAND } from "@/config/brand";
import type { ProgramConfig } from "./types";

/** Pages only the other program has so far. They stay in this program's navigation as greyed-out entries; each one is planned. */
export const FTC_UNAVAILABLE_PATHS = [
  "/analytics/accuracy-compare",
  "/analytics/accuracy-verification",
  "/analytics/match-prediction",
  "/analytics/performance-reliability",
  "/analytics/robot-radar",
  "/judge-book",
] as const;

export const FTC_PROGRAM: ProgramConfig = {
  id: "ftc",
  brand: {
    label: "FTC",
    fullName: "FIRST Tech Challenge",
    tagline: "Strategic Scouting for FTC Teams",
    description:
      "CompSocrates is the modern scouting platform that helps FIRST Tech Challenge teams make data-driven decisions. Track performance, analyze trends, and dominate the competition.",
    themeColor: BRAND.themeColor,
  },
  event: { allianceSize: 2, seasonKind: "start-year", hasEpa: false },
  firestorePrefix: "programs/ftc/",
  unavailablePaths: FTC_UNAVAILABLE_PATHS,
  pagesConnected: true,
  // The shell is mounted, but only the pages listed here have a program-aware data layer: the scout page, Active Events, the Match List, the six other forms and
  // the analytics pages over scout and form entries. Every other path shows "not available yet" inside the shell, so no shared page reads the other program's
  // collections. Add a path here when it is connected.
  connection: {
    paths: [
      "/scout",
      "/event",
      "/match-list",
      "/lead-scout-form",
      "/pit-scout-form",
      "/team-strategy-form",
      "/match-strategy-form",
      "/drive-reflection-form",
      "/helper-form",
      "/dashboard",
      "/my-scouting",
      "/people",
      "/team-management",
      "/analytics/match-scout",
      "/analytics/lead-scout",
      "/analytics/pit-scout",
      "/analytics/team-strategy",
      "/analytics/match-strategy",
      "/analytics/drive-reflection",
      "/analytics/helper",
      "/analytics/pick-list",
      "/analytics/team-averages",
      "/analytics/team-breakdown",
      "/analytics/rankings",
    ],
    features: { assignments: false, subIns: false, practice: false, live: false, library: false, pickList: true, accuracy: false, csvImport: false, changelog: false, applications: false, joinRequests: false, announcements: false, eventLookup: false },
  },
  multiTeam: true,
};
