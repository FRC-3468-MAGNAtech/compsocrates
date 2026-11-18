import { BRAND } from "@/config/brand";
import { FTC_GAME_DEFINITIONS, FTC_GAME_ID_LIST } from "@/config/games/ftc";
import { resolveRadarSource, type RadarProfile } from "@/config/games/radar";
import { FTC_DELETION_ENTRIES } from "@/lib/ftc/deletion-entries";
import { DEFAULT_ROLE_ID } from "@/lib/roles";
import type { ProgramConfig } from "./types";

/** Pages only the other program has so far. They stay in this program's navigation as greyed-out entries; each one is planned. */
export const FTC_UNAVAILABLE_PATHS = [
  "/analytics/accuracy-compare",
  "/analytics/accuracy-verification",
  "/analytics/match-prediction",
  "/judge-book",
] as const;

/** Each FTC game's radar profile (the axes it declares, with its fields' points filled in), by season id. */
const FTC_RADAR: Record<string, RadarProfile> = {};
for (const id of FTC_GAME_ID_LIST) {
  const def = FTC_GAME_DEFINITIONS[id];
  if (def.radar) FTC_RADAR[id.toLowerCase()] = resolveRadarSource(def.label, def.radar, def.fields);
}

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
  event: {
    allianceSize: 2,
    seasonKind: "start-year",
    hasEpa: false,
    keyShape: "season-code",
    codeLabel: "Event Code",
    eventCopy: {
      invalidKeyReason: "That isn't an FTC event key (it should be the season, a hyphen and the event code, like 2025-USCALAB).",
      seasonName: "FIRST Tech Challenge",
      teamListSource: "the official FIRST Tech Challenge Events API",
      credits: [{ before: "the official ", name: "FIRST Tech Challenge Events API", href: "https://ftc-events.firstinspires.org/services/API" }],
    },
  },
  firestorePrefix: "programs/ftc/",
  readEstimate: { entries: "scoutEntries", sessions: "practiceSessions", library: "libraryMatches", auditLog: "auditLog", members: "users" },
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
      "/achievements",
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
      "/events/[eventKey]",
      "/analytics/performance-reliability",
      "/analytics/robot-radar",
    ],
    features: { assignments: true, subIns: false, practice: true, live: true, lobby: true, library: true, pickList: true, accuracy: true, csvImport: true, changelog: true, applications: false, joinRequests: true, announcements: false, eventLookup: true },
  },
  // Only the tabs whose data layer is ported, in the shared order. Not listed, so they do not exist here: Entries, the two ID tools, Setup Check and the platform-owner tabs
  // (Team Applications, Template Review, Recovery). The team's own templates live inside the Forms tab (as in the other program), without public sharing.
  admin: { tabs: ["match-library", "forms", "page-access", "sidebar", "achievements", "submissions", "sessions", "rescore", "audit-log", "backups", "applications", "platform-changelog", "platform-credits", "verify-admins", "account-deletions", "read-usage"], platformSettings: false, templateSharing: false },
  achievementMetrics: "all",
  multiTeam: true,
  // Memberships: the program's own user-document field names (`primaryRole`, `isAdmin`, `fieldTeamIds`; no `roles` array).
  deletion: { entries: FTC_DELETION_ENTRIES },
  membership: {
    defaultJoinRole: DEFAULT_ROLE_ID,
    userFields: { role: "primaryRole", roles: null, secondaryRoles: "secondaryRoles", isAdmin: "isAdmin", isOwner: "isOwner", fieldTeamIds: "fieldTeamIds" },
    nameFields: ["name"],
    flows: {
      ownerFields: ["ownerUid"],
      assignableListField: "fieldTeamIdList",
      legacyAdminRole: null,
      leaveExtras: {},
      teamLookup: "idOrJoinCode",
      newTeam: { joinCodeLength: 8, numberField: "number", numberKind: "number" },
      legacyJoinPath: "/api/ftc/team/request-join",
      newUser: { storeUid: false, emailField: null, extras: {}, createOnRequest: false },
      adminFlagLocked: true,
      requests: { layout: "perTeam", collection: "joinRequests", userId: "uid", name: "name", email: null, teamId: null, role: "requestedRole", alsoRole: null, timeKind: "timestamp", approvedExtras: {}, outcomeFields: null },
    },
  },
  // Team Settings: the season's form is chosen in Admin Panel > Forms (as in the other program); ownership transfer is a root-only server route, so its card is not shown.
  teamSettings: { ownershipTransfer: false },
  library: { scoresRequired: false, importKind: "schedule", scheduledTime: true, editImportedScores: true, backfill: false, placeholderVideoSwitch: false, videoCsv: false },
  practice: { noScoreIsResult: true, liveTileText: "Scout a real, livestreamed FTC match." },
  // The practice difficulty cut-offs come from each game's own config (its alliance score thresholds), read by `lib/difficulty.ts` for this program.
  gameDifficulty: Object.fromEntries(FTC_GAME_ID_LIST.map((id) => [id, FTC_GAME_DEFINITIONS[id].thresholds.difficulty])),
  radar: FTC_RADAR,
};
