import type { GameField, GameFieldPoints, PointTableGameDefinition } from "@/config/games/definition";
import type { StatRole } from "@/lib/forms/types";

/**
 * BIOBUZZ (FTC 2026), a pure point table: the plugin (`lib/games/point-table.ts`) and the match form (`lib/forms/game-form.ts`) are generated from this
 * entry by `lib/ftc/games.ts`. Scoring has no cross-field logic (toggles and tallies per phase), so no hand-written plugin is needed.
 *
 * Ported from the sister app's built-in form (its `lib/forms/builtin.ts`, with the frozen pre-form-builder original `lib/forms/fixtures/biobuzz-v1.ts` as
 * the scoring oracle). Everything an existing entry depends on is kept exactly:
 *  - the form id `biobuzz` and the value keys (`autoLeave`, `teleTipHive`, `diedDuringMatch` ...). Stored entries (`programs/ftc/scoutEntries`) are
 *    flat: the incident checkboxes are plain boolean keys, not an `incidents` list, so they are toggle fields here with no `incidents` entry;
 *  - the points per field and the phase each scores in (a counter is `value x tally`, a toggle is `value` when on);
 *  - the "unrealistic above" limits the auto-flag rules read, the reliability stat roles and the `primaryScoring` fields.
 * The sister app had no rescout comparison and no penalty points on an entry (accuracy takes penalties from the library match), so neither is configured.
 *
 * Not carried: the sister app's checkbox field type for incidents (a toggle tile here; the stored value is the same boolean).
 */

const perTally = (value: number): GameFieldPoints => ({ mode: "perTally", value });
const whenOn = (value: number): GameFieldPoints => ({ mode: "whenOn", value });

/** Flat keys: a field's doc path is its own key. */
const field = (f: Omit<GameField, "path">): GameField => ({ path: f.key, ...f });

const toggle = (key: string, label: string, points: number, section: string, category: string, group?: string): GameField =>
  field({ key, kind: "toggle", label, section, category, points: whenOn(points), ...(group ? { group } : {}) });

const counter = (key: string, label: string, points: number, section: string, category: string, extra: { group?: string; unrealisticAbove: number; statRoles?: readonly StatRole[] }): GameField =>
  field({ key, kind: "counter", label, section, category, points: perTally(points), ...extra });

const incident = (key: string, label: string, statRoles: readonly StatRole[] = []): GameField =>
  field({ key, kind: "toggle", label, section: "general", category: "Incidents", ...(statRoles.length > 0 ? { statRoles } : {}) });

/** The values an auto-flag raises "unrealistic scoring" above (the sister app's `BIOBUZZ_UNREALISTIC`). */
export const BIOBUZZ_UNREALISTIC = { autoTipHive: 3, teleTipHive: 6, flowerPollenNectar: 20, gardenPollenNectar: 40 } as const;

export const BIOBUZZ_CONFIG = {
  id: "BIOBUZZ",
  label: "BIOBUZZ",
  year: 2026,
  submittable: true,
  formId: "biobuzz",

  sections: [
    { id: "pre-match", title: "Pre-Match", phase: "prematch" },
    { id: "autonomous", title: "Autonomous", phase: "auto" },
    {
      id: "teleop",
      title: "Teleoperated",
      phase: "teleop",
      groups: [
        { id: "hive", title: "Hive" },
        { id: "flower", title: "Flower" },
        { id: "garden", title: "Garden" },
      ],
    },
    { id: "endgame", title: "Endgame", phase: "endgame" },
    { id: "general", title: "General", phase: "misc" },
  ],

  fields: [
    // --- autonomous ---
    toggle("autoLeave", "Leave", 3, "autonomous", "Leave"),
    toggle("autoPark", "Park", 5, "autonomous", "Park"),
    counter("autoTipHive", "Tip Hive", 20, "autonomous", "Hive", { unrealisticAbove: BIOBUZZ_UNREALISTIC.autoTipHive, statRoles: ["primaryScoring"] }),

    // --- teleop ---
    counter("teleTipHive", "Tip Hive", 20, "teleop", "Hive", { group: "hive", unrealisticAbove: BIOBUZZ_UNREALISTIC.teleTipHive, statRoles: ["primaryScoring"] }),
    toggle("flowerBottomNectar", "Bottom Nectar", 5, "teleop", "Flower", "flower"),
    counter("flowerPollenNectar", "Pollen and Nectar", 2, "teleop", "Flower", { group: "flower", unrealisticAbove: BIOBUZZ_UNREALISTIC.flowerPollenNectar }),
    counter("gardenPollenNectar", "Pollen and Nectar", 1, "teleop", "Garden", { group: "garden", unrealisticAbove: BIOBUZZ_UNREALISTIC.gardenPollenNectar }),

    // --- endgame ---
    toggle("endgamePark", "Park", 5, "endgame", "Park"),

    // --- general: incidents (yes/no, no points), then the comments ---
    incident("diedDuringMatch", "Died During Match", ["reliability", "died"]),
    incident("neverStartedMatch", "Never Started Match", ["reliability", "neverStarted"]),
    incident("disabledByFtc", "Disabled by FTC", ["reliability", "disabled"]),
    incident("recoveredFromFreeze", "Recovered from Freeze", ["reliability", "recoveredFromFreeze"]),
    incident("tippedOver", "Tipped Over", ["reliability"]),
    incident("yellowCard", "Yellow Card"),
    incident("redCard", "Red Card"),
    field({
      key: "comments",
      kind: "textarea",
      label: "Comments",
      section: "general",
      category: "Comments",
      placeholder: "Anything notable — robot issues, standout driving, penalties...",
      statRoles: ["comments"],
    }),
  ],

  /**
   * Hive, Flower and Garden are scored by the alliance, so only one scout per alliance records each (see `lib/forms/alliance-role.ts`). Two scouts, two roles:
   * the Hive scout records Tip Hive (auto and teleop); the Garden scout records Garden and Flower. The other role's fields are stored absent.
   */
  allianceRoles: [
    { id: "hive", label: "Hive", fieldKeys: ["autoTipHive", "teleTipHive"] },
    { id: "garden", label: "Garden", fieldKeys: ["flowerBottomNectar", "flowerPollenNectar", "gardenPollenNectar"] },
  ],

  /**
   * The Robot Radar: five axes from the fields above. Auto and Endgame are the robot's own points (Leave and Park out of 8, Park out of 5). Hive and
   * Garden are ALLIANCE objectives (one scout per alliance records them): each is the mean over the entries that recorded it, relative to the best team,
   * and labelled as an alliance stat. Reliability is the share of matches with none of the reliability incidents (died, never started, disabled, ...).
   * There is no Agility axis (no lead-scout skill rating exists for this program) and no climb box plot (no climb).
   */
  radar: {
    axes: [
      { key: "auto", label: "Auto", full: "Auto (Leave and Park)", help: "Average autonomous Leave and Park points, out of 8.", metric: { kind: "points", fieldKeys: ["autoLeave", "autoPark"], scale: { max: 8 } } },
      { key: "hive", label: "Hive", full: "Hive points", help: "Average Tip Hive points of the alliance, over the matches where the Hive was recorded, relative to the best team.", alliance: true, metric: { kind: "points", fieldKeys: ["autoTipHive", "teleTipHive"], scale: "best" } },
      { key: "garden", label: "Garden", full: "Garden and Flower points", help: "Average Flower and Garden points of the alliance, over the matches where they were recorded, relative to the best team.", alliance: true, metric: { kind: "points", fieldKeys: ["flowerBottomNectar", "flowerPollenNectar", "gardenPollenNectar"], scale: "best" } },
      { key: "reliability", label: "Reliability", full: "Reliability", help: "Share of matches with no died, never started, disabled, recovered-from-freeze or tipped-over incident.", metric: { kind: "clean" } },
      { key: "endgame", label: "Endgame", full: "Endgame Park", help: "How often the robot parked in the endgame, scaled to 10.", metric: { kind: "points", fieldKeys: ["endgamePark"], scale: { max: 5 } } },
    ],
  },

  /** Stored entries carry their incidents as the flat boolean fields above. */
  incidents: [],
  rescoutFields: [],

  /** The sister app's practice difficulty cut-offs (`lib/difficulty.ts`): an alliance scoring up to 40 is easy, up to 79 medium. */
  thresholds: { difficulty: { easyMax: 40, mediumMax: 79 } },
  strings: {
    formDescription: "The 2026 BIOBUZZ season's match scouting form: Hive, Flower and Garden scoring, parking, and incident flags.",
    startingPositionPlaceholder: "",
    notesPlaceholder: "Anything notable — robot issues, standout driving, penalties...",
    penaltyHelp: "",
  },
} as const satisfies PointTableGameDefinition<"BIOBUZZ">;

export type BiobuzzConfig = typeof BIOBUZZ_CONFIG;
