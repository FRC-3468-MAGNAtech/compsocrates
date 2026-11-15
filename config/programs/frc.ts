import { BRAND } from "@/config/brand";
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
  event: { allianceSize: 3, seasonKind: "calendar", unspecifiedGameId: "reefscape", hasEpa: true },
  firestorePrefix: "",
  unavailablePaths: [],
  pagesConnected: true,
  connection: {
    paths: "all",
    features: { assignments: true, subIns: true, practice: true, live: true, lobby: true, library: true, pickList: true, accuracy: true, csvImport: true, changelog: true, applications: true, joinRequests: true, announcements: true, eventLookup: true },
  },
  // Today's Admin Panel, unchanged: every tab, in this order (the platform-owner tabs and Forms are still gated by who is looking).
  admin: { tabs: ADMIN_TAB_IDS, platformSettings: true },
  multiTeam: false,
};
