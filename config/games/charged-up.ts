import { rescoutArray, rescoutBoolean, rescoutNumber, rescoutString, type RescoutFieldSpec } from "@/config/games/shared";

/**
 * CHARGED UP (FRC 2023). READ-ONLY legacy game (docs/ROUTES.md D3). Nested `auto` / `teleop` / `endgame` phases.
 * Sources: app/utils/analyticsScoring.ts (`scoreChargedUpEntry`), app/scout-form/page.tsx (ChargedUpFormState).
 */
export const CHARGED_UP_CONFIG = {
  id: "CHARGED_UP",
  label: "CHARGED UP",
  season: 2023,
  formId: null,

  points: {
    autoMobility: 3,
    autoGrid: { bottom: 3, middle: 4, top: 6 },
    /** Keys are the lower-cased `chargeStation` text. */
    autoStation: { docked: 8, engaged: 12 },
    teleopGrid: { bottom: 2, middle: 3, top: 5 },
    teleopLink: 5,
    endgameStation: { parked: 2, docked: 6, engaged: 10 },
  },

  autoStations: [
    { value: "", label: "Auto Charge Station" },
    { value: "Docked", label: "Docked" },
    { value: "Engaged", label: "Engaged" },
  ],
  endgameStations: [
    { value: "", label: "Not Parked" },
    { value: "Parked", label: "Parked" },
    { value: "Docked", label: "Docked" },
    { value: "Engaged", label: "Engaged" },
  ],

  startingPositions: [
    { value: "Barrier Side", label: "Barrier Side" },
    { value: "Middle", label: "Middle" },
    { value: "Corner Side", label: "Corner Side" },
  ],

  incidents: [
    { value: "died", label: "Died During Match" },
    { value: "never-started", label: "Never Started Match" },
    { value: "disabled", label: "Disabled by FRC" },
    { value: "recovered", label: "Recovered from Freeze" },
    { value: "tipped", label: "Tipped Over" },
    { value: "yellow-card", label: "Yellow Card" },
    { value: "red-card", label: "Red Card" },
  ],

  /** CS raises no CHARGED UP flags that make sense (its flag code only knows REBUILT and REEFSCAPE): none are configured. */
  flags: {},

  /** CS has no CHARGED UP rescout comparison; this list is the sensible equivalent. */
  rescoutFields: [
    rescoutString("startingPosition", "Starting Position", 0.5),
    rescoutBoolean("auto.mobility", "Auto Mobility", 0.5),
    rescoutNumber("auto.gridBottom", "Auto Grid Bottom"),
    rescoutNumber("auto.gridMiddle", "Auto Grid Middle"),
    rescoutNumber("auto.gridTop", "Auto Grid Top"),
    rescoutString("auto.chargeStation", "Auto Charge Station", 0.5),
    rescoutNumber("teleop.gridBottom", "Teleop Grid Bottom"),
    rescoutNumber("teleop.gridMiddle", "Teleop Grid Middle"),
    rescoutNumber("teleop.gridTop", "Teleop Grid Top"),
    rescoutNumber("teleop.links", "Teleop Links"),
    rescoutString("endgame.chargeStation", "Endgame Charge Station", 0.5),
    rescoutNumber("penaltyPoints", "Penalty Points"),
    rescoutArray("incidents", "Incidents", 0.5),
  ] satisfies RescoutFieldSpec[],
} as const;

export type ChargedUpConfig = typeof CHARGED_UP_CONFIG;
