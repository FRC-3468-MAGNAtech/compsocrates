import type { GameField, GameFieldPoints, PointTableGameDefinition } from "@/config/games/definition";
import { rescoutArray, rescoutBoolean, rescoutNumber, rescoutString, STANDARD_INCIDENTS, type RescoutFieldSpec } from "@/config/games/shared";

/**
 * CHARGED UP (FRC 2023), a pure point table: the plugin (`lib/games/point-table.ts`) and the form (`lib/forms/game-form.ts`) are generated from
 * this entry. Docs have nested `auto` / `teleop` / `endgame` phases, so a form value key is `phase_field` (`auto_gridBottom`); `startingPosition`,
 * `mobility`, `penaltyPoints`, `incidents` and `notes` stay top-level.
 *
 * Sources in CS: app/scout-form/page.tsx (the CHARGED UP form: fields, labels, options; its submit is disabled there), practice-scouting/page.tsx
 * (the live writer: charge-station values are lower case, mobility is written at BOTH `mobility` and `auto.mobility`),
 * app/utils/analyticsScoring.ts (`scoreChargedUpEntry`, plus `penaltyPoints` added by `scoreEntryForGame`).
 * CS raises no CHARGED UP flags (its flag code only knows REBUILT and REEFSCAPE), so none are configured.
 */

const perTally = (value: number): GameFieldPoints => ({ mode: "perTally", value });

const PRE = "pre-match";

const field = (f: Omit<GameField, "path"> & { path?: string }): GameField => ({ path: f.key.replace("_", "."), ...f });

const counter = (key: string, label: string, section: string, group: string, category: string, value: number): GameField =>
  field({ key, kind: "counter", label, section, group, category, points: perTally(value) });

export const CHARGED_UP_CONFIG = {
  id: "CHARGED_UP",
  label: "CHARGED UP",
  year: 2023,
  submittable: true,
  formId: "charged_up",

  sections: [
    { id: PRE, title: "Pre-Match Info", phase: "prematch" },
    {
      id: "autonomous",
      title: "Autonomous",
      phase: "auto",
      groups: [
        { id: "auto-mobility", title: "Mobility" },
        { id: "auto-grids", title: "Auto Grids" },
        { id: "auto-station", title: "Charge Station" },
      ],
    },
    {
      id: "teleop",
      title: "Teleop",
      phase: "teleop",
      groups: [
        { id: "teleop-grids", title: "Teleop Grids" },
        { id: "teleop-links", title: "Links" },
      ],
    },
    { id: "endgame", title: "Endgame", phase: "endgame" },
    { id: "general", title: "General", phase: "misc" },
  ],

  fields: [
    field({
      key: "startingPosition",
      path: "startingPosition",
      kind: "select",
      label: "Starting Position",
      section: PRE,
      category: "Pre-Match",
      placeholder: "Select Position",
      options: [
        { value: "Barrier Side", label: "Barrier Side" },
        { value: "Middle", label: "Middle" },
        { value: "Corner Side", label: "Corner Side" },
      ],
    }),

    // --- autonomous ---
    // CS scores `auto.mobility ?? mobility` and its practice flow writes both, so the one toggle is written to both and read from either.
    field({
      key: "mobility",
      path: "auto.mobility",
      mirrors: ["mobility"],
      kind: "toggle",
      label: "Mobility",
      section: "autonomous",
      group: "auto-mobility",
      category: "Mobility",
      points: { mode: "whenOn", value: 3 },
    }),
    counter("auto_gridBottom", "Bottom Row", "autonomous", "auto-grids", "Auto Grids", 3),
    counter("auto_gridMiddle", "Middle Row", "autonomous", "auto-grids", "Auto Grids", 4),
    counter("auto_gridTop", "Top Row", "autonomous", "auto-grids", "Auto Grids", 6),
    field({ key: "auto_missed", kind: "toggle", label: "Missed", section: "autonomous", group: "auto-grids", category: "Auto Grids" }),
    field({
      key: "auto_chargeStation",
      kind: "select",
      label: "Auto Charge Station",
      section: "autonomous",
      group: "auto-station",
      category: "Charge Station",
      placeholder: "Auto Charge Station",
      options: [
        { value: "docked", label: "Docked" },
        { value: "engaged", label: "Engaged" },
      ],
      points: { mode: "optionExact", points: { docked: 8, engaged: 12 } },
    }),

    // --- teleop ---
    counter("teleop_gridBottom", "Bottom Row", "teleop", "teleop-grids", "Teleop Grids", 2),
    counter("teleop_gridMiddle", "Middle Row", "teleop", "teleop-grids", "Teleop Grids", 3),
    counter("teleop_gridTop", "Top Row", "teleop", "teleop-grids", "Teleop Grids", 5),
    field({ key: "teleop_missed", kind: "toggle", label: "Missed", section: "teleop", group: "teleop-grids", category: "Teleop Grids" }),
    counter("teleop_links", "Link", "teleop", "teleop-links", "Links", 5),

    // --- endgame ---
    field({
      key: "endgame_chargeStation",
      kind: "select",
      label: "Endgame Charge Station",
      section: "endgame",
      category: "Charge Station",
      placeholder: "Not Parked",
      options: [
        { value: "parked", label: "Parked" },
        { value: "docked", label: "Docked" },
        { value: "engaged", label: "Engaged" },
      ],
      points: { mode: "optionExact", points: { parked: 2, docked: 6, engaged: 10 } },
    }),

    // --- general ---
    field({ key: "penaltyPoints", kind: "number", label: "Penalty Points", section: "general", category: "Penalties" }),
    field({ key: "notes", kind: "textarea", label: "Notes", section: "general", category: "Comments", statRoles: ["comments"] }),
  ],

  incidents: STANDARD_INCIDENTS,
  penaltyPath: "penaltyPoints",

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

  /** practice-scouting `scoreToDifficulty`: CHARGED UP alliance scores are far lower than the other games'. */
  thresholds: { difficulty: { easyMax: 80, mediumMax: 120 } },
  strings: {
    formDescription: "The 2023 CHARGED UP match scouting form: grid rows, links, mobility, charge station, penalties and incident flags.",
    startingPositionPlaceholder: "Select Position",
    notesPlaceholder: "Anything notable: robot issues, standout driving, penalties...",
    penaltyHelp: "The alliance's official penalty points, added to the total.",
  },
} as const satisfies PointTableGameDefinition;

export type ChargedUpConfig = typeof CHARGED_UP_CONFIG;
