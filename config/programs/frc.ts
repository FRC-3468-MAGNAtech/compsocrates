import { BRAND } from "@/config/brand";
import type { ProgramConfig } from "./types";

export const FRC_PROGRAM: ProgramConfig = {
  id: "frc",
  brand: {
    label: "FRC",
    fullName: "FIRST Robotics Competition",
    tagline: BRAND.tagline,
    description: BRAND.description,
    themeColor: BRAND.themeColor,
  },
  event: { allianceSize: 3, seasonKind: "calendar", hasEpa: true },
  firestorePrefix: "",
  unavailablePaths: [],
  pagesConnected: true,
};
