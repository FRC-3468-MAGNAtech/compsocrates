import { BRAND } from "@/config/brand";
import { CURRENT_GAME_ID } from "@/config/games";
import { DEFAULT_ROLE_ID } from "@/lib/roles";
import { ADMIN_TAB_IDS, type ProgramConfig } from "./types";

export const FRC_PROGRAM: ProgramConfig = {
  id: "frc",
  brand: {
    label: "FRC",
    fullName: "FIRST Robotics Competition",
    tagline: BRAND.tagline,
    description: BRAND.description,
    themeColor: BRAND.themeColor,
  },
  event: { allianceSize: 3, seasonKind: "calendar", unspecifiedGameId: "reefscape",
    hasEpa: true,
    keyShape: "tba",
    // games with events but no scouting config: the coming game (its 2027 events are registered) and a past one that is not scouted
    otherGames: [
      { apiSeason: 2027, name: "BIOCORE", upcoming: true },
      { apiSeason: 2024, name: "CRESCENDO" },
    ],
    codeLabel: "Event Key",
    eventCopy: {
      invalidKeyReason: "That isn't an event key from The Blue Alliance (it should start with the year, like 2026arli).",
      seasonName: "FIRST Robotics",
      teamListSource: "the official FIRST API",
      credits: [
        { before: "", name: "The Blue Alliance", href: "https://www.thebluealliance.com/" },
        { before: "the official ", name: "FIRST API", href: "https://frc-events.firstinspires.org/services/API" },
      ],
    },
  },
  firestorePrefix: "",
  unavailablePaths: [],
  pagesConnected: true,
  connection: {
    paths: "all",
    features: { assignments: true, subIns: true, practice: true, live: true, lobby: true, library: true, pickList: true, accuracy: true, csvImport: true, changelog: true, applications: true, joinRequests: true, announcements: true, eventLookup: true },
  },
  // Today's Admin Panel, unchanged: every tab, in this order (the platform-owner tabs and Forms are still gated by who is looking).
  admin: { tabs: ADMIN_TAB_IDS, platformSettings: true, templateSharing: true },
  achievementMetrics: "all",
  multiTeam: false,
  // Memberships: CS's own user-document field names (`role`, `roles`, `isTeamAdmin`).
  membership: {
    defaultJoinRole: DEFAULT_ROLE_ID,
    userFields: { role: "role", roles: "roles", secondaryRoles: "secondaryRoles", isAdmin: "isTeamAdmin", isOwner: "isOwner" },
    nameFields: ["displayName", "name"],
  },
  // Team Settings: FRC's page is unchanged (its form choice lives in Admin Panel > Forms, its ownership transfer is the root route's).
  teamSettings: { ownershipTransfer: true },
  // FRC keeps the skeleton until accuracy exists (CS behavior, unchanged); see the note in components/practice/results-screen.tsx.
  library: { scoresRequired: true, importKind: "played", scheduledTime: false, editImportedScores: false, backfill: true, placeholderVideoSwitch: true, videoCsv: true },
  practice: { noScoreIsResult: false, liveTileText: "Scout a real, livestreamed FRC match." },
  // The radar is the hand-built profile of the default game (its numbers are pinned by lib/analytics/robot-radar.golden.test.ts).
  radar: { [CURRENT_GAME_ID.toLowerCase()]: { kind: "rebuilt", name: CURRENT_GAME_ID } },
};
