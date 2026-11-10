import { rescoutArray, rescoutBoolean, rescoutNumber, rescoutString, type RescoutFieldSpec } from "@/config/games/shared";

/**
 * REEFSCAPE (FRC 2025). READ-ONLY legacy game (docs/ROUTES.md D3): analytics and history only.
 * A CS doc with no `game` field is REEFSCAPE. Fields are flat (no nested phases).
 * Sources: app/utils/analyticsScoring.ts (`PTS`), scoutingFlags.ts, rescoutComparison.ts.
 */
export const REEFSCAPE_CONFIG = {
  id: "REEFSCAPE",
  label: "REEFSCAPE",
  season: 2025,
  formId: null,

  points: {
    leave: 3,
    autoCoral: { L1: 3, L2: 4, L3: 6, L4: 7 },
    autoProcessor: 6,
    autoNet: 4,
    teleopCoral: { L1: 2, L2: 3, L3: 4, L4: 5 },
    teleopProcessor: 6,
    teleopNetRobot: 4,
    teleopNetHuman: 4,
    /**
     * Climb points are matched against the lower-cased `stageStatus` text, first match wins, in this order
     * ("includes" semantics, exactly as CS: so "not-parked" also contains "park" and scores 2).
     */
    climb: [
      { includes: ["deep"], points: 12 },
      { includes: ["shallow"], points: 6 },
      { includes: ["park", "barge"], points: 2 },
    ],
  },

  /** `stageStatus` values the old form offered. */
  stageStatuses: [
    { value: "", label: "Select Status" },
    { value: "not-parked", label: "Not Parked" },
    { value: "barge", label: "Parked in Barge Zone" },
    { value: "shallow", label: "Shallow Cage" },
    { value: "deep", label: "Deep Cage" },
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

  /** Auto-flag thresholds (scoutingFlags.ts `evaluateReefscapeFlags`), in points. */
  flags: {
    humanPlayerHeavy: { label: "High Human Player Share", minHumanPoints: 20, shareOfRobotPoints: 0.6 },
    autoOnlyNoTeleop: { label: "Auto Without Teleop Points", minAutoPoints: 20 },
    zeroMainScoring: { label: "Zero Main Scoring" },
  },

  rescoutFields: [
    rescoutString("startingPosition", "Starting Position", 0.5),
    rescoutBoolean("leftStartingZone", "Left Starting Zone", 0.5),
    rescoutNumber("autoCoralMissed", "Auto Coral Missed"),
    rescoutNumber("autoCoralL1", "Auto Coral L1"),
    rescoutNumber("autoCoralL2", "Auto Coral L2"),
    rescoutNumber("autoCoralL3", "Auto Coral L3"),
    rescoutNumber("autoCoralL4", "Auto Coral L4"),
    rescoutNumber("autoAlgaeProcessorMissed", "Auto Processor Missed"),
    rescoutNumber("autoAlgaeProcessorScored", "Auto Processor Scored"),
    rescoutNumber("autoAlgaeNetMissed", "Auto Net Missed"),
    rescoutNumber("autoAlgaeNetScored", "Auto Net Scored"),
    rescoutNumber("teleopCoralMissed", "Teleop Coral Missed"),
    rescoutNumber("teleopCoralL1", "Teleop Coral L1"),
    rescoutNumber("teleopCoralL2", "Teleop Coral L2"),
    rescoutNumber("teleopCoralL3", "Teleop Coral L3"),
    rescoutNumber("teleopCoralL4", "Teleop Coral L4"),
    rescoutBoolean("teleopAlgaeRemoved", "Teleop Algae Removed", 0.5),
    rescoutNumber("teleopProcessorMissed", "Teleop Processor Missed"),
    rescoutNumber("teleopProcessorScored", "Teleop Processor Scored"),
    rescoutNumber("teleopNetRobotMissed", "Teleop Net Robot Missed"),
    rescoutNumber("teleopNetRobotScored", "Teleop Net Robot Scored"),
    rescoutNumber("teleopNetHumanMissed", "Teleop Net Human Missed"),
    rescoutNumber("teleopNetHumanScored", "Teleop Net Human Scored"),
    rescoutNumber("failedClimb", "Failed Climb"),
    rescoutString("stageStatus", "Stage Status", 0.5),
    rescoutArray("incidents", "Incidents", 0.5),
  ] satisfies RescoutFieldSpec[],
} as const;

export type ReefscapeConfig = typeof REEFSCAPE_CONFIG;
