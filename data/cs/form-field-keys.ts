/**
 * The value keys each CS form needs (docs/ROUTES.md D1). Pure typed data: no imports, no React, no Firebase.
 *
 * WHY THIS FILE EXISTS. The built-in pit / team / lead / helper forms (`lib/forms/builtin-rebuilt-forms.ts`) are REBUILT's. For those forms to persist into CS's six collections through `data/cs/forms.ts`, their field `key`s
 * must be exactly the keys listed here. This table is also what the converters in `data/cs/forms.ts` run on, so a key listed
 * here is stored, and a key that is not listed is NOT stored (the converter drops it and the form silently loses the answer).
 *
 * KEY CONVENTION (the same one `lib/games/types.ts` documents for match scouting):
 *   - A top-level CS field keeps its name: `robotWeight`, `bestAt`, `wasSuccessful`, `notes`.
 *   - A nested CS field at `a.b` becomes `a_b`: `overallAlliance.skillLevel` -> `overallAlliance_skillLevel`.
 *   - Element `i` (0-based) of the `robots` array becomes `robot{i+1}`: `robots[0].teamNumber` -> `robot1_teamNumber`,
 *     `robots[2].endgameClimb` -> `robot3_endgameClimb`. The array length follows the alliance size (3 for FRC).
 *
 * NOT VALUES. These live on the CE entry itself (the form's system pickers), never in `values`:
 *   event (`eventCode` <-> `eventKey`), team (`teamNumber` <-> `teamNumber`, helper: `assistedTeamNumber`), scout
 *   (`scoutName` <-> `scoutName`, helper: `helperName`), match (`matchKey` <-> `matchKey` / `matchId` / `matchLabel`),
 *   alliance (`alliance`). Which pickers each form type carries is `systemPickers` below; it matches `REQUIRED_SYSTEM_FIELDS`
 *   in `lib/forms/types.ts` except where CS has no such column (see `note`).
 *
 * VALUE TYPES AS CS STORES THEM (the form field type should store the same primitive, or the converter coerces):
 *   - `string`  -> text, textarea, select, radio. Team numbers and fuel capacities are strings in CS ("254", "10-13", "x").
 *   - `boolean` -> toggle / checkbox.
 *   - `number`  -> slider / number (lead `skillLevel`, the match-strategy prediction fields).
 *
 * ADDITIVE FIELDS CE MAY WRITE (absent from CS-origin docs, ignored by CS, written only when the entry has them):
 *   `stickyNotes`, `linkedEntryId`, `planDifferences`, `alliance` (match strategy / drive reflection only: CS has no alliance
 *   column there), helper `eventKey` (CS's own CSV import writes it too, but its form does not).
 */

export const CS_FORM_TYPES = ["pit-scout", "lead-scout", "team-strategy", "match-strategy", "drive-reflection", "helper"] as const;
export type CsFormType = (typeof CS_FORM_TYPES)[number];

export const CS_FORM_COLLECTIONS = ["pitScouting", "leadScouting", "strategyScouting", "matchStrategyPlans", "driveScouting", "helperReports"] as const;
export type CsFormCollection = (typeof CS_FORM_COLLECTIONS)[number];

/** Where CS wrote lead-scout rows when `leadScouting` refused the write (a permission fallback, app/scout-form/page.tsx submitLead). */
export const CS_LEAD_FALLBACK_COLLECTION = "scouting" as const;

/** `scoutingFlagStates` entity types for the six forms (+ `scoutingEntry`, which a lead row in `scouting` uses). */
export type CsFlagEntityType = "pitScouting" | "leadScouting" | "strategyScouting" | "matchStrategyPlan" | "driveScouting" | "helperReport" | "scoutingEntry";

export type CsValueKind = "string" | "boolean" | "number";
export type CsFieldUi = "text" | "textarea" | "toggle" | "number" | "select" | "slider" | "url";

export type CsFieldOption = { value: string; label: string };

export type CsFieldKey = {
  /** The CE value key (before any `robot{n}_` prefix). */
  key: string;
  /** The CS document path of the field, relative to the document (top-level), to a robot object, or to `overallAlliance`. */
  path: string;
  kind: CsValueKind;
  ui: CsFieldUi;
  label: string;
  options?: readonly CsFieldOption[];
  /** Other CS paths read when `path` is absent (old docs); a write goes back to the path that was read. */
  aliases?: readonly string[];
  /** Inclusive bounds for `slider` / `number`. */
  min?: number;
  max?: number;
  /** CS requires this to submit (the form should mark it required). */
  required?: boolean;
  /** Only written when present in the values (CS stores it only when set). */
  optional?: boolean;
  note?: string;
};

export const STARTING_POSITIONS: readonly CsFieldOption[] = [
  { value: "not-there", label: "Not There" },
  { value: "outpost-trench", label: "Outpost Trench" },
  { value: "outpost-side", label: "Outpost Side" },
  { value: "outpost-bump", label: "Outpost Bump" },
  { value: "middle", label: "Middle" },
  { value: "depot-bump", label: "Depot Bump" },
  { value: "depot-side", label: "Depot Side" },
  { value: "depot-trench", label: "Depot Trench" },
];

export const BEST_AT_OPTIONS: readonly CsFieldOption[] = [
  { value: "cycling", label: "Cycling" },
  { value: "passing", label: "Passing" },
  { value: "shooting", label: "Shooting" },
  { value: "stealing", label: "Stealing" },
];

export const ROBOT_ROLE_OPTIONS: readonly CsFieldOption[] = [
  { value: "Offense", label: "Offense" },
  { value: "Defense", label: "Defense" },
  { value: "Feeder", label: "Feeder" },
];

export const ENDGAME_CLIMB_OPTIONS: readonly CsFieldOption[] = [
  { value: "", label: "None" },
  { value: "level-1", label: "Level 1" },
  { value: "level-2", label: "Level 2" },
  { value: "level-3", label: "Level 3" },
];

const text = (key: string, label: string, extra: Partial<CsFieldKey> = {}): CsFieldKey => ({ key, path: key, kind: "string", ui: "text", label, ...extra });
const area = (key: string, label: string, extra: Partial<CsFieldKey> = {}): CsFieldKey => ({ key, path: key, kind: "string", ui: "textarea", label, ...extra });
const flag = (key: string, label: string, extra: Partial<CsFieldKey> = {}): CsFieldKey => ({ key, path: key, kind: "boolean", ui: "toggle", label, ...extra });
const choice = (key: string, label: string, options: readonly CsFieldOption[], extra: Partial<CsFieldKey> = {}): CsFieldKey => ({ key, path: key, kind: "string", ui: "select", label, options, ...extra });
const num = (key: string, label: string, extra: Partial<CsFieldKey> = {}): CsFieldKey => ({ key, path: key, kind: "number", ui: "number", label, ...extra });

/** The per-robot fields of the three alliance forms (lead scout: team, notes, skill; match strategy / drive reflection: plan). */
export const LEAD_ROBOT_FIELDS: readonly CsFieldKey[] = [
  text("teamNumber", "Team number", { required: true }),
  area("notes", "Notes"),
  { key: "skillLevel", path: "skillLevel", kind: "number", ui: "slider", label: "Skill level", min: 1, max: 5, note: "CS stores 0 when unset, otherwise 1 to 5." },
  text("pickNumber", "Pick number", { optional: true, note: "Read by CS analytics, never written by the CS form. Kept only so old docs pass through." }),
];

const PLAN_ROBOT_FIELDS: readonly CsFieldKey[] = [
  text("teamNumber", "Team number", { required: true }),
  choice("startingPosition", "Starting position", STARTING_POSITIONS),
  choice("role", "Role", ROBOT_ROLE_OPTIONS),
  flag("autoClimb", "Auto climb"),
  choice("endgameClimb", "Endgame climb", ENDGAME_CLIMB_OPTIONS),
];

const STRATEGY_ROBOT_FIELDS: readonly CsFieldKey[] = [
  ...PLAN_ROBOT_FIELDS,
  num("climbProbability", "Climb probability (%)", { optional: true, min: 0, max: 100, note: "Filled by CS's prediction engine, not typed by the scout." }),
  num("estimatedPoints", "Point projection", { optional: true, min: 0, note: "Filled by CS's prediction engine." }),
  num("predictionSampleSize", "Prediction sample size", { optional: true, min: 0, note: "Filled by CS's prediction engine." }),
];

const LEAD_OVERALL_FIELDS: readonly CsFieldKey[] = [
  { key: "teams", path: "teams", kind: "string", ui: "text", label: "Alliance teams", aliases: ["/overallAllianceTeams"], note: "CS text such as `RED / 254, 1678, 118`. The legacy alias (a leading `/` means document root) is the top-level `overallAllianceTeams`." },
  area("notes", "Alliance notes"),
  { key: "skillLevel", path: "skillLevel", kind: "number", ui: "slider", label: "Alliance skill level", min: 1, max: 5 },
];

const PIT_FIELDS: readonly CsFieldKey[] = [
  text("robotWeight", "Robot weight", { note: "Free text (CS has no unit field)." }),
  flag("rookieTeam", "Rookie team"),
  { key: "robotPictureUrl", path: "robotPictureUrl", kind: "string", ui: "url", label: "Picture of robot (http(s) URL)", note: "A URL, not a Storage upload." },
  flag("pitDisposition", "Friendly and easy to work with (pit)", { note: "Old CSV imports stored a string; it passes through unchanged." }),
  flag("driveDisposition", "Friendly and easy to work with (drive)"),
  text("fuelPreloadCapacity", "Fuel preload capacity", { note: "Digits or `x`; may be a range such as `10-13`." }),
  text("fuelBallsPerSecond", "Fuel balls per second", { note: "Digits or `x`; may be a range." }),
  text("fuelCarryingCapacity", "Fuel carrying capacity", { note: "Digits or `x`; may be a range." }),
  flag("climbLevel1", "Level 1 climb"),
  flag("climbLevel2", "Level 2 climb"),
  flag("climbLevel3", "Level 3 climb"),
  text("typicalFuelCycleTime", "Typical fuel cycle time (s)", { note: "Digits and a dot." }),
  text("typicalClimbTime", "Typical climb time (s)", { note: "Digits and a dot." }),
  area("autoCycleDescription", "Description of auto cycle"),
  area("notes", "Notes"),
];

const TEAM_STRATEGY_FIELDS: readonly CsFieldKey[] = [
  choice("preferredStartingPosition", "Preferred starting position", STARTING_POSITIONS, { required: true, aliases: ["startingPosition"] }),
  choice("bestAt", "Best at", BEST_AT_OPTIONS, { required: true }),
  flag("clearsBump", "Clears bump"),
  flag("clearsTrench", "Clears trench"),
  flag("canShootWhileIntaking", "Can shoot while intaking"),
  flag("canMoveAndShootSimultaneously", "Can move and shoot simultaneously"),
  area("notes", "Notes"),
];

const HELPER_FIELDS: readonly CsFieldKey[] = [flag("wasSuccessful", "Were you successful?"), area("issueSolved", "Describe the issue(s) you solved"), area("notes", "Notes")];

export type CsSystemPicker = "eventPicker" | "matchPicker" | "alliancePicker" | "teamPicker" | "scoutName";

export type CsFormFieldSpec = {
  formType: CsFormType;
  collection: CsFormCollection;
  /** Pickers the CS form asks for (these map onto entry columns, not values). */
  systemPickers: readonly CsSystemPicker[];
  /** Top-level value fields. */
  fields: readonly CsFieldKey[];
  /** `robots[]` fields; expanded to `robot{n}_{key}` for n = 1..alliance size. */
  robotFields?: readonly CsFieldKey[];
  /** `overallAlliance` fields; expanded to `overallAlliance_{key}`. */
  overallFields?: readonly CsFieldKey[];
  note?: string;
};

export const CS_FORM_FIELD_SPECS: Readonly<Record<CsFormType, CsFormFieldSpec>> = {
  "pit-scout": {
    formType: "pit-scout",
    collection: "pitScouting",
    systemPickers: ["eventPicker", "teamPicker", "scoutName"],
    fields: PIT_FIELDS,
    note: "REBUILT pit form. Old REEFSCAPE docs carry many more fields (coralL4, ...); they are never shown or dropped.",
  },
  "lead-scout": {
    formType: "lead-scout",
    collection: "leadScouting",
    systemPickers: ["eventPicker", "matchPicker", "alliancePicker", "scoutName"],
    fields: [],
    robotFields: LEAD_ROBOT_FIELDS,
    overallFields: LEAD_OVERALL_FIELDS,
    note: "All three team numbers are required by the CS form. There is no top-level `notes`.",
  },
  "team-strategy": {
    formType: "team-strategy",
    collection: "strategyScouting",
    systemPickers: ["eventPicker", "teamPicker", "scoutName"],
    fields: TEAM_STRATEGY_FIELDS,
  },
  "match-strategy": {
    formType: "match-strategy",
    collection: "matchStrategyPlans",
    systemPickers: ["eventPicker", "matchPicker", "scoutName"],
    fields: [area("notes", "Notes")],
    robotFields: STRATEGY_ROBOT_FIELDS,
    note: "CS has no alliance column: the alliance picker is stored as an additive `alliance` field.",
  },
  "drive-reflection": {
    formType: "drive-reflection",
    collection: "driveScouting",
    systemPickers: ["eventPicker", "matchPicker", "scoutName"],
    fields: [area("notes", "Notes")],
    robotFields: PLAN_ROBOT_FIELDS,
    note: "CS has no alliance column: the alliance picker is stored as an additive `alliance` field.",
  },
  helper: {
    formType: "helper",
    collection: "helperReports",
    systemPickers: ["teamPicker", "scoutName"],
    fields: HELPER_FIELDS,
    note: "CS's helper form has no event picker, so CS docs carry no `eventKey`; CE writes one when the form has an event.",
  },
};

/** One concrete value key a rebuilt form must define. */
export type CsExpandedKey = Omit<CsFieldKey, "key" | "path" | "aliases"> & {
  /** The CE value key (what the form field's `key` must be). */
  key: string;
  /** The CS document path, with the real array index (`robots[0].teamNumber`). */
  path: string;
  aliases?: readonly string[];
};

/** The prefix of robot element `index` (0-based): `robot1`. */
export const robotPrefix = (index: number): string => `robot${index + 1}`;

/**
 * Every value key of a form type for an alliance of `robotCount` robots (3 for FRC), with the CS path of each. This is the list
 * the REBUILT form authoring task builds fields from.
 */
export function csFormValueKeys(formType: CsFormType, robotCount = 3): CsExpandedKey[] {
  const spec = CS_FORM_FIELD_SPECS[formType];
  const out: CsExpandedKey[] = spec.fields.map((f) => ({ ...f }));
  for (const f of spec.overallFields ?? []) {
    out.push({ ...f, key: `overallAlliance_${f.key}`, path: `overallAlliance.${f.path}`, aliases: f.aliases?.map((a) => (a.startsWith("/") ? a.slice(1) : `overallAlliance.${a}`)) });
  }
  if (spec.robotFields) {
    for (let i = 0; i < robotCount; i += 1) {
      for (const f of spec.robotFields) {
        out.push({ ...f, key: `${robotPrefix(i)}_${f.key}`, path: `robots[${i}].${f.path}`, aliases: f.aliases?.map((a) => `robots[${i}].${a}`) });
      }
    }
  }
  return out;
}

/** The keys only, in table order (handy in tests and when checking a form against the table). */
export const csFormValueKeyNames = (formType: CsFormType, robotCount = 3): string[] => csFormValueKeys(formType, robotCount).map((k) => k.key);
