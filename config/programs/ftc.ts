import { BRAND } from "@/config/brand";
import { FTC_GAME_DEFINITIONS, FTC_GAME_ID_LIST } from "@/config/games/ftc";
import { FTC_STARTER_ENTRIES } from "@/lib/ftc/changelog-seed";
import type { ProgramConfig } from "./types";

/** Pages only the other program has so far. They stay in this program's navigation as greyed-out entries; each one is planned. */
export const FTC_UNAVAILABLE_PATHS = [
  "/analytics/accuracy-compare",
  "/analytics/accuracy-verification",
  "/analytics/match-prediction",
  "/analytics/performance-reliability",
  "/analytics/robot-radar",
  "/judge-book",
  "/events/[eventKey]",
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
      "/assignments",
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
      "/account",
      "/profile",
      "/credits",
      "/team-management",
      "/analytics",
      "/analytics/match-scout",
      "/analytics/lead-scout",
      "/analytics/pit-scout",
      "/analytics/team-strategy",
      "/analytics/match-strategy",
      "/analytics/drive-reflection",
      "/analytics/helper",
      "/analytics/pick-list",
      "/practice-scouting",
      "/scout-accuracy",
      "/analytics/match-breakdown",
      "/analytics/teams",
      "/analytics/scout-status",
      "/analytics/team-averages",
      "/analytics/team-breakdown",
      "/analytics/rankings",
      "/admin",
      "/team-settings",
      "/changelog",
    ],
    features: { assignments: true, subIns: false, practice: true, live: false, lobby: false, library: true, pickList: true, accuracy: true, csvImport: true, changelog: true, applications: false, joinRequests: true, announcements: false, eventLookup: true },
  },
  // Only the tabs whose data layer is ported, in the shared order. Not listed, so they do not exist here: Entries, the two ID tools, Setup Check and the platform-owner tabs
  // (Team Applications, Template Review, Recovery). The team's own templates live inside the Forms tab (as in the other program), without public sharing.
  admin: { tabs: ["match-library", "forms", "page-access", "sidebar", "submissions", "sessions", "rescore", "audit-log", "backups"], platformSettings: false, templateSharing: false },
  multiTeam: true,
  // Team Settings: the season's form is chosen in Admin Panel > Forms (as in the other program); ownership transfer is a root-only server route, so its card is not shown.
  teamSettings: { ownershipTransfer: false },
  // The changelog's starter drafts: only features this program has today (lib/ftc/changelog-seed.ts).
  changelogSeed: FTC_STARTER_ENTRIES,
  practice: { noScoreIsResult: true, liveTileText: "Scout a real, livestreamed FTC match." },
  // The practice difficulty cut-offs come from each game's own config (its alliance score thresholds), read by `lib/difficulty.ts` for this program.
  gameDifficulty: Object.fromEntries(FTC_GAME_ID_LIST.map((id) => [id, FTC_GAME_DEFINITIONS[id].thresholds.difficulty])),
};
