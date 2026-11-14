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
  pagesConnected: false,
  // The scout page is the first connected slice. Every other path shows the gate inside the shell until its data layer is program-aware.
  connection: {
    paths: ["/scout"],
    features: { assignments: false, subIns: false, practice: false, live: false, library: false, changelog: false, applications: false, eventLookup: false },
  },
  multiTeam: true,
};
