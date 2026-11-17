import type { GameField, GameFieldPoints, PointTableGameDefinition } from "@/config/games/definition";
import {
  DEFAULT_DIFFICULTY_THRESHOLDS,
  rescoutArray,
  rescoutBoolean,
  rescoutNumber,
  rescoutString,
  STANDARD_INCIDENTS,
  type RescoutFieldSpec,
} from "@/config/games/shared";

/**
 * REEFSCAPE (FRC 2025), a pure point table: the plugin (`lib/games/point-table.ts`) and the form (`lib/forms/game-form.ts`) are generated from
 * this entry. A CS doc with no `game` field is REEFSCAPE, and its fields are flat (no nested phases), so a form value key equals the CS field name.
 *
 * Sources in CS: app/scout-form-reefscape/page.tsx (fields, labels, options), app/utils/analyticsScoring.ts (`PTS`), scoutingFlags.ts
 * (`evaluateReefscapeFlags`), rescoutComparison.ts, practice-scouting/page.tsx (the live writer: it spreads the flat fields into the doc).
 * Known CS quirk kept on purpose: climb text is matched with `includes`, so the page's own "not-parked" option contains "park" and scores 2.
 */

const perTally = (value: number): GameFieldPoints => ({ mode: "perTally", value });

const PRE = "pre-match";

const field = (f: Omit<GameField, "path"> & { path?: string }): GameField => ({ path: f.key, ...f });

/** A CS counter (a tally the scout taps). `points` makes it score `points` per tally. */
const counter = (key: string, label: string, section: string, group: string, category: string, extra: Partial<GameField> = {}): GameField =>
  field({ key, kind: "counter", label, section, group, category, ...extra });

export const REEFSCAPE_CONFIG = {
  id: "REEFSCAPE",
  label: "REEFSCAPE",
  year: 2025,
  submittable: true,
  formId: "reefscape",
  docsWithoutGame: true,

  sections: [
    { id: PRE, title: "Pre-Match Info", phase: "prematch" },
    {
      id: "autonomous",
      title: "Autonomous",
      phase: "auto",
      groups: [
        { id: "auto-leave", title: "Leave" },
        { id: "auto-coral", title: "Auto Coral" },
        { id: "auto-processor", title: "Auto Algae Processor" },
        { id: "auto-net", title: "Auto Algae Net" },
      ],
    },
    {
      id: "teleop",
      title: "Teleop",
      phase: "teleop",
      groups: [
        { id: "teleop-coral", title: "Teleop Coral" },
        { id: "teleop-algae", title: "Teleop Algae" },
        { id: "teleop-processor", title: "Teleop Processor" },
        { id: "teleop-net-robot", title: "Teleop Algae Net - Robot" },
        { id: "teleop-net-human", title: "Teleop Algae Net - Human Player" },
      ],
    },
    { id: "endgame", title: "Endgame", phase: "endgame" },
    { id: "general", title: "General", phase: "misc" },
  ],

  fields: [
    field({
      key: "startingPosition",
      kind: "select",
      label: "Starting Position",
      section: PRE,
      category: "Pre-Match",
      placeholder: "Select Position",
      options: [
        { value: "not-there", label: "Not There" },
        { value: "outpost-trench", label: "Outpost Trench" },
        { value: "outpost-side", label: "Outpost Side" },
        { value: "outpost-bump", label: "Outpost Bump" },
        { value: "middle", label: "Middle" },
        { value: "depot-bump", label: "Depot Bump" },
        { value: "depot-side", label: "Depot Side" },
        { value: "depot-trench", label: "Depot Trench" },
      ],
    }),

    // --- autonomous ---
    field({ key: "leftStartingZone", kind: "toggle", label: "Left Starting Zone", section: "autonomous", group: "auto-leave", category: "Leave", points: { mode: "whenOn", value: 3 } }),
    counter("autoCoralMissed", "Missed Attempts", "autonomous", "auto-coral", "Auto Coral"),
    counter("autoCoralL1", "Level 1", "autonomous", "auto-coral", "Auto Coral", { points: perTally(3), flagGroup: "autoRobot" }),
    counter("autoCoralL2", "Level 2", "autonomous", "auto-coral", "Auto Coral", { points: perTally(4), flagGroup: "autoRobot" }),
    counter("autoCoralL3", "Level 3", "autonomous", "auto-coral", "Auto Coral", { points: perTally(6), flagGroup: "autoRobot" }),
    counter("autoCoralL4", "Level 4", "autonomous", "auto-coral", "Auto Coral", { points: perTally(7), flagGroup: "autoRobot" }),
    counter("autoAlgaeProcessorMissed", "Missed Attempts", "autonomous", "auto-processor", "Auto Algae Processor"),
    counter("autoAlgaeProcessorScored", "Scored", "autonomous", "auto-processor", "Auto Algae Processor", { points: perTally(6), flagGroup: "autoRobot" }),
    counter("autoAlgaeNetMissed", "Missed Attempts", "autonomous", "auto-net", "Auto Algae Net"),
    counter("autoAlgaeNetScored", "Scored", "autonomous", "auto-net", "Auto Algae Net", { points: perTally(4), flagGroup: "autoRobot" }),

    // --- teleop ---
    counter("teleopCoralMissed", "Missed Attempts", "teleop", "teleop-coral", "Teleop Coral"),
    counter("teleopCoralL1", "Level 1", "teleop", "teleop-coral", "Teleop Coral", { points: perTally(2), flagGroup: "teleopRobot" }),
    counter("teleopCoralL2", "Level 2", "teleop", "teleop-coral", "Teleop Coral", { points: perTally(3), flagGroup: "teleopRobot" }),
    counter("teleopCoralL3", "Level 3", "teleop", "teleop-coral", "Teleop Coral", { points: perTally(4), flagGroup: "teleopRobot" }),
    counter("teleopCoralL4", "Level 4", "teleop", "teleop-coral", "Teleop Coral", { points: perTally(5), flagGroup: "teleopRobot" }),
    field({ key: "teleopAlgaeRemoved", kind: "toggle", label: "Removed Algae from Reef", section: "teleop", group: "teleop-algae", category: "Teleop Algae" }),
    counter("teleopProcessorMissed", "Missed Attempts", "teleop", "teleop-processor", "Teleop Processor"),
    counter("teleopProcessorScored", "Scored", "teleop", "teleop-processor", "Teleop Processor", { points: perTally(6), flagGroup: "teleopRobot" }),
    counter("teleopNetRobotMissed", "Missed Attempts", "teleop", "teleop-net-robot", "Teleop Algae Net - Robot"),
    counter("teleopNetRobotScored", "Scored", "teleop", "teleop-net-robot", "Teleop Algae Net - Robot", { points: perTally(4), flagGroup: "teleopRobot" }),
    counter("teleopNetHumanMissed", "Missed Attempts", "teleop", "teleop-net-human", "Teleop Algae Net - Human Player"),
    counter("teleopNetHumanScored", "Scored", "teleop", "teleop-net-human", "Teleop Algae Net - Human Player", { points: perTally(4), flagGroup: "teleopHuman" }),

    // --- endgame ---
    field({ key: "failedClimb", kind: "counter", label: "Failed Climb", section: "endgame", category: "Climb" }),
    field({
      key: "stageStatus",
      kind: "select",
      label: "Stage Status",
      section: "endgame",
      category: "Climb",
      placeholder: "Select Status",
      options: [
        { value: "not-parked", label: "Not Parked" },
        { value: "barge", label: "Parked in Barge Zone" },
        { value: "shallow", label: "Shallow Cage" },
        { value: "deep", label: "Deep Cage" },
      ],
      // first matching rule wins, in this order ("includes" semantics, exactly as CS)
      points: {
        mode: "optionIncludes",
        rules: [
          { includes: ["deep"], points: 12 },
          { includes: ["shallow"], points: 6 },
          { includes: ["park", "barge"], points: 2 },
        ],
      },
    }),

    // --- general ---
    field({ key: "penaltyPoints", kind: "number", label: "Penalty Points", section: "general", category: "Penalties" }),
    field({ key: "notes", kind: "textarea", label: "Notes", section: "general", category: "Comments", statRoles: ["comments"] }),
  ],

  incidents: STANDARD_INCIDENTS,
  /** The official penalty points added to an alliance's score; CS adds them to each REEFSCAPE and CHARGED UP total. */
  penaltyPath: "penaltyPoints",

  /** Auto-flag thresholds (scoutingFlags.ts `evaluateReefscapeFlags`), in points. */
  flags: {
    humanPlayerHeavy: {
      label: "High Human Player Share",
      detail: "Human net points are {human}, unusually high vs robot teleop points.",
      minHumanPoints: 20,
      shareOfRobotPoints: 0.6,
    },
    autoOnlyNoTeleop: { label: "Auto Without Teleop Points", detail: "Auto points {auto} but teleop points are 0.", minAutoPoints: 20 },
    zeroMainScoring: { label: "Zero Main Scoring", detail: "No scored autonomous/teleop points recorded." },
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

  thresholds: { difficulty: DEFAULT_DIFFICULTY_THRESHOLDS },
  strings: {
    formDescription: "The 2025 REEFSCAPE match scouting form: coral levels, algae processor and net, cage climb, penalties and incident flags.",
    startingPositionPlaceholder: "Select Position",
    notesPlaceholder: "Anything notable: robot issues, standout driving, penalties...",
    penaltyHelp: "The alliance's official penalty points, added to the total.",
  },
} as const satisfies PointTableGameDefinition;

export type ReefscapeConfig = typeof REEFSCAPE_CONFIG;
