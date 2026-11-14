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
  // The shell is mounted, but only the scout page and the analytics pages that read the team's scout entries are connected so far. Every other path shows "not available yet" inside the
  // shell until its data layer is program-aware, so no shared page reads the other program's collections. Add a path here when it is connected.
  connection: {
    paths: ["/scout", "/analytics/match-scout", "/analytics/team-averages", "/analytics/team-breakdown", "/analytics/rankings"],
    features: { assignments: false, subIns: false, practice: false, live: false, library: false, accuracy: false, csvImport: false, changelog: false, applications: false, eventLookup: false },
  },
  multiTeam: true,
};
