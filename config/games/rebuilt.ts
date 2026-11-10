import { rescoutArray, rescoutBoolean, rescoutNumber, rescoutString, type RescoutFieldSpec } from "@/config/games/shared";

/**
 * REBUILT (FRC 2026). Declarative values only; the formulas live in `lib/games/rebuilt.ts`.
 * Every number below equals what CS uses today (app/utils/analyticsScoring.ts, app/scout-form/page.tsx,
 * app/utils/scoutingFlags.ts, rescoutComparison.ts).
 */

const SHIFTS = ["shift1", "shift2", "shift3", "shift4"] as const;

export const REBUILT_CONFIG = {
  id: "REBUILT",
  label: "REBUILT",
  season: 2026,
  /** `lib/forms` built-in form id. Match scouting is submittable for this game only (docs/ROUTES.md D3). */
  formId: "rebuilt",

  /**
   * Scale tables. A CS doc stores the INDEX (slider position); `values[index]` is the real number.
   * `pitUpperBounds[i]` is the largest raw pit-scout number that maps to index `i` (`convertPitScale`); anything above the
   * last bound maps to the last index.
   */
  scales: {
    bps: {
      values: [0, 2, 5, 8, 12, 16, 20, 23, 25],
      labels: ["0", "1-3", "4-6", "7-9", "10-13", "14-17", "18-21", "22-24", "25+"],
      pitUpperBounds: [0, 3, 6, 9, 13, 17, 21, 24],
    },
    carry: {
      values: [0, 12, 23, 32, 42, 53, 64, 74, 75],
      labels: ["0", "1-12", "13-23", "23-32", "33-42", "43-53", "54-64", "65-74", "75+"],
      pitUpperBounds: [0, 12, 23, 32, 42, 53, 64, 74],
    },
    preload: {
      values: [0, 2, 4, 6, 8],
      labels: ["0", "1-2", "3-4", "5-6", "7-8"],
      pitUpperBounds: [0, 2, 4, 6],
    },
  },

  points: {
    /** Points per fuel scored (robot or human player). */
    fuel: 1,
    autoClimb: 15,
    /** Endgame `status` -> climb points. Any other status ("", "parked") scores 0. */
    endgameClimb: { "level-1": 10, "level-2": 20, "level-3": 30 },
    /** The `scoringWeights` snapshot CS writes on every REBUILT doc. */
    scoringWeightsSnapshot: {
      autoFuel: 1,
      autoClimbLevel1: 15,
      teleopFuel: 1,
      teleopClimbLevel1: 10,
      teleopClimbLevel2: 20,
      teleopClimbLevel3: 30,
    },
  },

  /** Teleop segments. Transition always counts; of the four shifts only one parity counts. */
  shifts: {
    segments: ["transition", ...SHIFTS],
    shifts: SHIFTS,
    /** Counted shifts when `shiftParityFromWonAuto` is true / false. */
    countedWhenParity: { true: ["shift2", "shift4"], false: ["shift1", "shift3"] },
  },

  endgameStatuses: [
    { value: "", label: "Status At End of Match" },
    { value: "parked", label: "Parked" },
    { value: "level-1", label: "Level 1" },
    { value: "level-2", label: "Level 2" },
    { value: "level-3", label: "Level 3" },
  ],

  startingPositions: [
    { value: "not-there", label: "Not There" },
    { value: "outpost-trench", label: "Outpost Trench" },
    { value: "outpost-side", label: "Outpost Side" },
    { value: "outpost-bump", label: "Outpost Bump" },
    { value: "middle", label: "Middle" },
    { value: "depot-bump", label: "Depot Bump" },
    { value: "depot-side", label: "Depot Side" },
    { value: "depot-trench", label: "Depot Trench" },
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

  /** Auto-flag thresholds (scoutingFlags.ts `evaluateRebuiltFlags`). Fuel figures are the doc's stored `estimatedFuel` values. */
  flags: {
    humanPlayerHeavy: {
      label: "High Human Player Share",
      /** Total human-player fuel at or above this... */
      minHumanFuel: 15,
      /** ...and either no robot fuel or a human share at or above this fraction of robot fuel. */
      shareOfRobotFuel: 0.6,
    },
    autoOnlyNoTeleop: { label: "Auto Without Teleop Fuel", minAutoFuel: 20 },
    zeroMainScoring: { label: "Zero Main Scoring" },
  },

  /** Rescout (exemplar) comparison fields, in CS order. */
  rescoutFields: [
    rescoutString("startingPosition", "Starting Position", 0.5),
    rescoutArray("incidents", "Incidents", 0.5),
    rescoutNumber("auto.preloadScale", "Auto Preload Scale"),
    rescoutNumber("auto.bpsScale", "Auto BPS Scale"),
    rescoutNumber("auto.carryingScale", "Auto Carry Scale"),
    rescoutArray("auto.cycleTimes", "Auto Cycles"),
    rescoutNumber("auto.counterOverride", "Auto Counter Override"),
    rescoutNumber("auto.counterOverrideMissedFuel", "Auto Missed Fuel"),
    rescoutNumber("auto.humanPlayerFuel", "Auto Human Fuel"),
    rescoutNumber("auto.failedClimb", "Auto Failed Climb"),
    rescoutBoolean("auto.successfulClimb", "Auto Successful Climb"),
    rescoutBoolean("auto.wonAuto", "Won Auto"),
    rescoutBoolean("auto.hubActivationOverride", "Hub Activation Override"),
    rescoutNumber("teleop.bpsScale", "Teleop BPS Scale"),
    rescoutNumber("teleop.carryingScale", "Teleop Carry Scale"),
    rescoutArray("teleop.transitionCycles", "Transition Cycles"),
    rescoutArray("teleop.shift1Cycles", "Shift 1 Cycles"),
    rescoutArray("teleop.shift2Cycles", "Shift 2 Cycles"),
    rescoutArray("teleop.shift3Cycles", "Shift 3 Cycles"),
    rescoutArray("teleop.shift4Cycles", "Shift 4 Cycles"),
    rescoutNumber("teleop.transitionOverride", "Transition Override"),
    rescoutNumber("teleop.transitionMissedFuel", "Transition Missed Fuel"),
    rescoutNumber("teleop.shift1Override", "Shift 1 Override"),
    rescoutNumber("teleop.shift1MissedFuel", "Shift 1 Missed Fuel"),
    rescoutNumber("teleop.shift2Override", "Shift 2 Override"),
    rescoutNumber("teleop.shift2MissedFuel", "Shift 2 Missed Fuel"),
    rescoutNumber("teleop.shift3Override", "Shift 3 Override"),
    rescoutNumber("teleop.shift3MissedFuel", "Shift 3 Missed Fuel"),
    rescoutNumber("teleop.shift4Override", "Shift 4 Override"),
    rescoutNumber("teleop.shift4MissedFuel", "Shift 4 Missed Fuel"),
    rescoutNumber("teleop.humanPlayerFuel", "Teleop Human Fuel"),
    rescoutString("endgame.status", "Endgame Status", 0.5),
    rescoutNumber("endgame.failedClimb", "Endgame Failed Climb"),
    rescoutArray("endgame.cycleTimes", "Endgame Cycles"),
    rescoutNumber("endgame.counterOverride", "Endgame Override"),
    rescoutNumber("endgame.counterOverrideMissedFuel", "Endgame Missed Fuel"),
    rescoutNumber("endgame.humanPlayerFuel", "Endgame Human Fuel"),
  ] satisfies RescoutFieldSpec[],
} as const;

export type RebuiltConfig = typeof REBUILT_CONFIG;
