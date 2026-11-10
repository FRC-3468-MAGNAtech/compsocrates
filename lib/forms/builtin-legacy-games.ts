import { CHARGED_UP_CONFIG as CU } from "@/config/games/charged-up";
import { REEFSCAPE_CONFIG as RE } from "@/config/games/reefscape";
import { systemFields } from "@/lib/forms/new-form";
import type { Form, FormField, FormGroup, FormSection } from "@/lib/forms/types";

// CS rebuild: READ-ONLY forms for the two retired games (docs/ROUTES.md D3), so their old CS entries show up in analytics like any other form's. CS disabled
// both submit paths ("CHARGED UP match form submissions are disabled"; the REEFSCAPE pages were retired for REBUILT), so neither form is ever offered for a
// new entry: they are registered in BUILTIN_FORMS (resolvable by `formId`, which is how an entry finds its columns) but listed in READ_ONLY_FORM_IDS
// (lib/forms/builtin.ts), which keeps them out of the forms panel, the "active form" choice and every picker. Their season entries (lib/seasons.ts) are
// `readOnly` for the same reason.
//
// FORM IDS are what the CS adapter attributes an entry to: `data/cs/scouting.ts` uses `plugin.formId ?? plugin.id.toLowerCase()`, and both legacy plugins
// have `formId: null`, so a REEFSCAPE row is `reefscape` and a CHARGED UP row is `charged_up` (with an underscore, the plugin id lower-cased).
//
// KEYS are exactly what each plugin's `docToValues` emits (lib/games/reefscape.ts, lib/games/charged-up.ts): REEFSCAPE is flat, CHARGED UP is
// `phase_field` (`auto_gridBottom`) plus the top-level `startingPosition`, `mobility`, `penaltyPoints`, `incidents`, `notes`. `incidents` is CS's `string[]`, kept as it is
// (the form is read-only, so it is never edited). SCORING is the plugin's own (`scoring: custom`,
// `game:<ID>`): the per-field rules below only put points on the tiles and are ignored by `calculateScore`.

const none = { mode: "none" } as const;
const pointsOf = (n: number) => ({ mode: "perTally" as const, value: n });

type Opt = { value: string; label: string };

const f = (key: string, type: FormField["type"], label: string, category: string, extra: Partial<FormField> = {}): FormField => ({
  id: `f-${key}`,
  key,
  type,
  label,
  scoring: none,
  analytics: { include: true, category, aggregate: type === "toggle" || type === "checkbox" ? "rate" : type === "counter" || type === "number" ? "avg" : type === "textarea" || type === "sequence" ? "list" : "last" },
  ...extra,
});

const counter = (key: string, label: string, category: string, groupId: string, points?: number): FormField =>
  f(key, "counter", label, category, { min: 0, step: 1, groupId, ...(points !== undefined ? { scoring: pointsOf(points) } : {}) });
const toggle = (key: string, label: string, category: string, groupId?: string, points?: number): FormField =>
  f(key, "toggle", label, category, { ...(groupId ? { groupId } : {}), ...(points !== undefined ? { scoring: { mode: "whenOn" as const, value: points } } : {}) });
const picker = (key: string, label: string, category: string, options: (Opt & { points?: number })[], placeholder: string, groupId?: string): FormField =>
  f(key, "select", label, category, {
    options: options.map((o) => ({ value: o.value, label: o.label, ...(o.points !== undefined ? { points: o.points } : {}) })),
    placeholder,
    ...(groupId ? { groupId } : {}),
    ...(options.some((o) => o.points !== undefined) ? { scoring: { mode: "byOption" as const } } : {}),
  });

/**
 * CS's `incidents: string[]` ("died", "never-started", "yellow-card"...). A `sequence` field would store the same list, but its step ids can't hold a hyphen, so this is a
 * plain text field: the list is kept untouched in the entry's values (this form is never submitted) and the column reads it as text ("tipped,yellow-card").
 */
const incidents = (): FormField => f("incidents", "text", "Things That Occurred", "Incidents", { helpText: "Incident codes: " + RE.incidents.map((i) => i.value).join(", ") + "." });
const notes = (): FormField => f("notes", "textarea", "Notes", "Comments", { statRoles: ["comments"] });

const g = (id: string, title: string): FormGroup => ({ id, title });
const section = (id: string, title: string, phase: FormSection["phase"], fields: FormField[], groups?: FormGroup[]): FormSection => ({ id, title, phase, visible: true, fields, ...(groups ? { groups } : {}) });

const preMatch = (extra: FormField[]): FormSection => section("pre-match", "Pre-Match Info", "prematch", [...systemFields(), ...extra]);

const base = { tags: [] as string[], version: 1, status: "published" as const, scoringEnabled: true, origin: "built-in" as const, createdBy: "system" };

// --- REEFSCAPE (FRC 2025) ---------------------------------------------------------------------------------------

/** Points for a `stageStatus` option as CS scores it: the first rule whose text the status includes (so "not-parked" also contains "park"). */
const climbPoints = (status: string): number => RE.points.climb.find((r) => r.includes.some((part) => status.toLowerCase().includes(part)))?.points ?? 0;

const reef = (key: string, label: string, groupId: string, category: string, pts?: number): FormField => counter(key, label, category, groupId, pts);

export const REEFSCAPE_FORM: Form = {
  ...base,
  id: "reefscape",
  name: "REEFSCAPE",
  description: "The 2025 REEFSCAPE match form, read-only: kept so old entries show in analytics. New entries are not accepted.",
  formType: "match-scout",
  tags: ["reefscape", "2025", "read-only"],
  scoring: { mode: "custom", scorer: "game:REEFSCAPE" },
  sections: [
    preMatch([picker("startingPosition", "Starting Position", "Pre-Match", RE.startingPositions.map((o) => ({ ...o })), "Select Position")]),
    section(
      "autonomous",
      "Autonomous",
      "auto",
      [
        toggle("leftStartingZone", "Left Starting Zone", "Leave", "auto-leave", RE.points.leave),
        reef("autoCoralMissed", "Missed Attempts", "auto-coral", "Auto Coral"),
        reef("autoCoralL1", "Level 1", "auto-coral", "Auto Coral", RE.points.autoCoral.L1),
        reef("autoCoralL2", "Level 2", "auto-coral", "Auto Coral", RE.points.autoCoral.L2),
        reef("autoCoralL3", "Level 3", "auto-coral", "Auto Coral", RE.points.autoCoral.L3),
        reef("autoCoralL4", "Level 4", "auto-coral", "Auto Coral", RE.points.autoCoral.L4),
        reef("autoAlgaeProcessorMissed", "Missed Attempts", "auto-processor", "Auto Algae Processor"),
        reef("autoAlgaeProcessorScored", "Scored", "auto-processor", "Auto Algae Processor", RE.points.autoProcessor),
        reef("autoAlgaeNetMissed", "Missed Attempts", "auto-net", "Auto Algae Net"),
        reef("autoAlgaeNetScored", "Scored", "auto-net", "Auto Algae Net", RE.points.autoNet),
      ],
      [g("auto-leave", "Leave"), g("auto-coral", "Auto Coral"), g("auto-processor", "Auto Algae Processor"), g("auto-net", "Auto Algae Net")]
    ),
    section(
      "teleop",
      "Teleop",
      "teleop",
      [
        reef("teleopCoralMissed", "Missed Attempts", "teleop-coral", "Teleop Coral"),
        reef("teleopCoralL1", "Level 1", "teleop-coral", "Teleop Coral", RE.points.teleopCoral.L1),
        reef("teleopCoralL2", "Level 2", "teleop-coral", "Teleop Coral", RE.points.teleopCoral.L2),
        reef("teleopCoralL3", "Level 3", "teleop-coral", "Teleop Coral", RE.points.teleopCoral.L3),
        reef("teleopCoralL4", "Level 4", "teleop-coral", "Teleop Coral", RE.points.teleopCoral.L4),
        toggle("teleopAlgaeRemoved", "Algae Removed", "Teleop Algae", "teleop-algae"),
        reef("teleopProcessorMissed", "Missed Attempts", "teleop-processor", "Teleop Processor"),
        reef("teleopProcessorScored", "Scored", "teleop-processor", "Teleop Processor", RE.points.teleopProcessor),
        reef("teleopNetRobotMissed", "Missed Attempts", "teleop-net-robot", "Teleop Algae Net - Robot"),
        reef("teleopNetRobotScored", "Scored", "teleop-net-robot", "Teleop Algae Net - Robot", RE.points.teleopNetRobot),
        reef("teleopNetHumanMissed", "Missed Attempts", "teleop-net-human", "Teleop Algae Net - Human Player"),
        reef("teleopNetHumanScored", "Scored", "teleop-net-human", "Teleop Algae Net - Human Player", RE.points.teleopNetHuman),
      ],
      [g("teleop-coral", "Teleop Coral"), g("teleop-algae", "Teleop Algae"), g("teleop-processor", "Teleop Processor"), g("teleop-net-robot", "Teleop Algae Net - Robot"), g("teleop-net-human", "Teleop Algae Net - Human Player")]
    ),
    section("endgame", "Endgame", "endgame", [
      f("failedClimb", "counter", "Failed Climb", "Climb", { min: 0, step: 1 }),
      picker(
        "stageStatus",
        "Stage Status",
        "Climb",
        RE.stageStatuses.filter((o) => o.value !== "").map((o) => ({ value: o.value, label: o.label, points: climbPoints(o.value) })),
        "Select Status"
      ),
    ]),
    section("general", "General", "misc", [incidents(), f("penaltyPoints", "number", "Penalty Points", "Penalties", { decimals: 0 }), notes()]),
  ],
};

// --- CHARGED UP (FRC 2023) --------------------------------------------------------------------------------------

const stationPoints = (table: Record<string, number>, value: string): number => table[value.toLowerCase()] ?? 0;
const stationOptions = (list: readonly Opt[], table: Record<string, number>): (Opt & { points: number })[] =>
  list.filter((o) => o.value !== "").map((o) => ({ value: o.value, label: o.label, points: stationPoints(table, o.value) }));

const cu = (key: string, label: string, groupId: string, category: string, pts?: number): FormField => counter(key, label, category, groupId, pts);

export const CHARGED_UP_FORM: Form = {
  ...base,
  id: "charged_up",
  name: "CHARGED UP",
  description: "The 2023 CHARGED UP match form, read-only: kept so old entries show in analytics. New entries are not accepted.",
  formType: "match-scout",
  tags: ["charged-up", "2023", "read-only"],
  scoring: { mode: "custom", scorer: "game:CHARGED_UP" },
  sections: [
    preMatch([picker("startingPosition", "Starting Position", "Pre-Match", CU.startingPositions.map((o) => ({ ...o })), "Select Position")]),
    section(
      "autonomous",
      "Autonomous",
      "auto",
      [
        toggle("mobility", "Mobility", "Mobility", "auto-mobility", CU.points.autoMobility),
        // the nested `auto.mobility` CS may also carry (the plugin reads `auto.mobility ?? mobility`); kept so the key round-trips, not shown as a column
        f("auto_mobility", "toggle", "Mobility (auto)", "Mobility", { groupId: "auto-mobility", analytics: { include: false } }),
        cu("auto_gridBottom", "Bottom Row", "auto-grids", "Auto Grids", CU.points.autoGrid.bottom),
        cu("auto_gridMiddle", "Middle Row", "auto-grids", "Auto Grids", CU.points.autoGrid.middle),
        cu("auto_gridTop", "Top Row", "auto-grids", "Auto Grids", CU.points.autoGrid.top),
        toggle("auto_missed", "Missed", "Auto Grids", "auto-grids"),
        picker("auto_chargeStation", "Auto Charge Station", "Charge Station", stationOptions(CU.autoStations, CU.points.autoStation), "Auto Charge Station", "auto-station"),
      ],
      [g("auto-mobility", "Mobility"), g("auto-grids", "Auto Grids"), g("auto-station", "Charge Station")]
    ),
    section(
      "teleop",
      "Teleop",
      "teleop",
      [
        cu("teleop_gridBottom", "Bottom Row", "teleop-grids", "Teleop Grids", CU.points.teleopGrid.bottom),
        cu("teleop_gridMiddle", "Middle Row", "teleop-grids", "Teleop Grids", CU.points.teleopGrid.middle),
        cu("teleop_gridTop", "Top Row", "teleop-grids", "Teleop Grids", CU.points.teleopGrid.top),
        toggle("teleop_missed", "Missed", "Teleop Grids", "teleop-grids"),
        cu("teleop_links", "Link", "teleop-links", "Links", CU.points.teleopLink),
      ],
      [g("teleop-grids", "Teleop Grids"), g("teleop-links", "Links")]
    ),
    section("endgame", "Endgame", "endgame", [picker("endgame_chargeStation", "Endgame Charge Station", "Charge Station", stationOptions(CU.endgameStations, CU.points.endgameStation), "Not Parked")]),
    section("general", "General", "misc", [
      incidents(),
      f("penaltyPoints", "number", "Penalty Points", "Penalties", { decimals: 0 }),
      notes(),
    ]),
  ],
};

export const LEGACY_GAME_FORMS: Readonly<Record<string, Form>> = {
  [REEFSCAPE_FORM.id]: REEFSCAPE_FORM,
  [CHARGED_UP_FORM.id]: CHARGED_UP_FORM,
};

/** The ids of the read-only legacy forms: resolvable for analytics, never offered for a new entry. */
export const LEGACY_FORM_IDS: readonly string[] = Object.keys(LEGACY_GAME_FORMS);
