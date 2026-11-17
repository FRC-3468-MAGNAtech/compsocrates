import { BEST_AT_OPTIONS, ENDGAME_CLIMB_OPTIONS, ROBOT_ROLE_OPTIONS, STARTING_POSITIONS } from "@/data/cs/form-field-keys";
import { systemFieldsFor } from "@/lib/forms/new-form";
import type { Form, FormField, FormGroup, FormSection } from "@/lib/forms/types";

// CS rebuild: the REBUILT versions of the team's non-match built-in forms, field for field what CS's pages ask (pit-scout-form, scout-form `?lead=1`,
// strategy-scout-form, match-strategy-form, drive-scout-form, helper-form). Value keys are EXACTLY `csFormValueKeys(formType)` (data/cs/form-field-keys.ts):
// that table is what the adapter in data/cs/forms.ts reads and writes, so a key renamed here silently loses its answer. An alliance form has explicit
// `robot1_*` .. `robot3_*` fields (not a repeating group: the adapter does not read `tN_` keys). Form ids and versions are the ones the adapter
// attributes entries to (`CS_FORM_SPECS[type].formId`), so a CS document read through it resolves to one of these forms.
//
// Differences from CS on purpose (each is the app engine's way of doing the same job): CS's side "Notes" panel is a `notes` textarea in its own section
// (and the app's sticky notes panel stays on, which is additive); a CS checkbox is an app `checkbox`; the three pit scales stay free text ("10-13", "x") because
// CS stores them as strings.

const base = { tags: [] as string[], version: 1, status: "published" as const, scoringEnabled: false, origin: "built-in" as const, createdBy: "system" };
const none = { mode: "none" } as const;

type Opt = { value: string; label: string };
const opts = (list: readonly Opt[]): Opt[] => list.map((o) => ({ value: o.value, label: o.label }));

export const REBUILT_STARTING_POSITIONS = opts(STARTING_POSITIONS);
export const REBUILT_BEST_AT = opts(BEST_AT_OPTIONS);
/** CS's match strategy offers Offense / Defense / Feeder. */
export const PLAN_ROLES = opts(ROBOT_ROLE_OPTIONS);
/** CS's drive reflection offers its own, different, role list (app/drive-scout-form/page.tsx): the values are lower case. */
export const REFLECTION_ROLES: Opt[] = [
  { value: "cycler", label: "Cycler" },
  { value: "passer", label: "Passer" },
  { value: "shooter", label: "Shooter" },
  { value: "stealer", label: "Stealer" },
];
/** "None" is the empty answer in CS, so it is the select's placeholder here rather than an option with an empty value. */
export const CLIMB_LEVELS = opts(ENDGAME_CLIMB_OPTIONS.filter((o) => o.value !== ""));

const pickers = (formType: Form["formType"]): FormField[] => systemFieldsFor(formType);

const field = (key: string, type: FormField["type"], label: string, category: string, extra: Partial<FormField> = {}): FormField => ({
  id: `f-${key}`,
  key,
  type,
  label,
  scoring: none,
  analytics: { include: true, category, aggregate: type === "checkbox" || type === "toggle" ? "rate" : type === "textarea" ? "list" : type === "slider" || type === "number" ? "avg" : "last" },
  ...extra,
});

const text = (key: string, label: string, category: string, extra: Partial<FormField> = {}): FormField => field(key, "text", label, category, extra);
const area = (key: string, label: string, category: string, extra: Partial<FormField> = {}): FormField => field(key, "textarea", label, category, extra);
const check = (key: string, label: string, category: string, extra: Partial<FormField> = {}): FormField => field(key, "checkbox", label, category, extra);
const select = (key: string, label: string, category: string, options: Opt[], placeholder: string, extra: Partial<FormField> = {}): FormField => field(key, "select", label, category, { options, placeholder, ...extra });
const skill = (key: string, label: string, category: string): FormField =>
  field(key, "slider", label, category, { min: 1, max: 5, step: 1, ticks: true, default: 1, endLabels: { min: "1", max: "5" } });

const notesField = (placeholder: string): FormField => area("notes", "Notes", "Comments", { placeholder, statRoles: ["comments"] });
const notesSection = (placeholder: string): FormSection => ({ id: "notes", title: "Notes", phase: "misc", visible: true, fields: [notesField(placeholder)] });

const group = (id: string, title: string): FormGroup => ({ id, title });

// --- Pit Scout ----------------------------------------------------------------------------------------------------

const SCALE_HELP = "A number or x. A range such as 10-13 is fine.";
const scale = (key: string, label: string, groupId: string): FormField => text(key, label, "Fuel", { groupId, placeholder: "Number or x", helpText: SCALE_HELP });

export const PIT_SCOUT_REBUILT_FORM: Form = {
  ...base,
  id: "pit-scout-v1",
  name: "Pit Scout",
  description: "A team's REBUILT robot as seen in the pit: weight, picture, disposition, fuel scales, tower climbs, cycle times and the auto cycle.",
  formType: "pit-scout",
  tags: ["pit-scout", "rebuilt", "2026"],
  stickyNotes: { enabled: true, defaultOpen: false },
  sections: [
    {
      id: "pre-match",
      title: "Information",
      phase: "prematch",
      visible: true,
      fields: [
        ...pickers("pit-scout"),
        text("robotWeight", "Robot Weight", "Robot", { placeholder: "Robot Weight" }),
        check("rookieTeam", "Rookie Team", "Robot"),
        text("robotPictureUrl", "Picture of Robot", "Robot", { placeholder: "https://example.com/robot.jpg", helpText: "A link to a photo of the robot (http or https)." }),
      ],
    },
    {
      id: "disposition",
      title: "Disposition",
      phase: "misc",
      visible: true,
      fields: [check("pitDisposition", "Friendly and easy to work with (Pit)", "Disposition"), check("driveDisposition", "Friendly and easy to work with (Drive)", "Disposition")],
    },
    {
      id: "routine",
      title: "Routine",
      phase: "misc",
      visible: true,
      groups: [group("fuel", "Fuel"), group("tower", "Tower"), group("cycles", "Cycles")],
      fields: [
        scale("fuelPreloadCapacity", "Preload Capacity", "fuel"),
        scale("fuelBallsPerSecond", "Balls Per Second", "fuel"),
        scale("fuelCarryingCapacity", "Carrying Capacity", "fuel"),
        check("climbLevel1", "Level 1 Climb", "Tower", { groupId: "tower" }),
        check("climbLevel2", "Level 2 Climb", "Tower", { groupId: "tower" }),
        check("climbLevel3", "Level 3 Climb", "Tower", { groupId: "tower" }),
        text("typicalFuelCycleTime", "Typical Fuel Cycle Time", "Cycles", { groupId: "cycles", placeholder: "Seconds", helpText: "In seconds." }),
        text("typicalClimbTime", "Typical Climb Time", "Cycles", { groupId: "cycles", placeholder: "Seconds", helpText: "In seconds." }),
      ],
    },
    { id: "autonomous", title: "Autonomous", phase: "auto", visible: true, fields: [area("autoCycleDescription", "Description of Auto Cycle", "Autonomous")] },
    notesSection("Optional notes..."),
  ],
};

// --- Team Strategy ------------------------------------------------------------------------------------------------

export const TEAM_STRATEGY_REBUILT_FORM: Form = {
  ...base,
  id: "team-strategy-v1",
  name: "Team Strategy",
  description: "What a team is best at and what it can do, from a strategist's point of view (REBUILT).",
  formType: "team-strategy",
  tags: ["strategy", "rebuilt", "2026"],
  stickyNotes: { enabled: true, defaultOpen: false },
  sections: [
    { id: "pre-match", title: "Information", phase: "prematch", visible: true, fields: pickers("team-strategy") },
    {
      id: "strategy",
      title: "Strategy",
      phase: "misc",
      visible: true,
      fields: [
        select("preferredStartingPosition", "Preferred Starting Position", "Strategy", REBUILT_STARTING_POSITIONS, "Select Position", { required: true }),
        select("bestAt", "Best At", "Strategy", REBUILT_BEST_AT, "Select Best Role", { required: true }),
        check("clearsBump", "Clears Bump", "Strategy"),
        check("clearsTrench", "Clears Trench", "Strategy"),
        check("canShootWhileIntaking", "Can Shoot while Intaking", "Strategy"),
        check("canMoveAndShootSimultaneously", "Can Move and Shoot Simultaneously", "Strategy"),
      ],
    },
    notesSection("Optional notes..."),
  ],
};

// --- Helper -------------------------------------------------------------------------------------------------------

export const HELPER_REBUILT_FORM: Form = {
  ...base,
  id: "helper-v1",
  name: "Helper",
  description: "For people who help other teams in the pit: which team, whether the help worked, and what the issue was.",
  formType: "helper",
  tags: ["helper", "rebuilt", "2026"],
  stickyNotes: { enabled: true, defaultOpen: false },
  sections: [
    { id: "pre-match", title: "Information", phase: "prematch", visible: true, fields: pickers("helper") },
    {
      id: "issue",
      title: "Issue",
      phase: "misc",
      visible: true,
      fields: [check("wasSuccessful", "Were you successful?", "Issue"), area("issueSolved", "Describe the issue(s) you solved", "Issue", { placeholder: "What did you fix?" })],
    },
    notesSection("Optional notes..."),
  ],
};

// --- The alliance forms (explicit robot1_ .. robot3_ fields) -------------------------------------------------------

/** How many robots an alliance form draws. The CS pages are fixed at three, and so is the adapter's key table (`csFormValueKeys(type, 3)`). */
export const ALLIANCE_ROBOTS = 3;
const robots = Array.from({ length: ALLIANCE_ROBOTS }, (_, i) => i + 1);

const leadRobotSection = (n: number): FormSection => ({
  id: `robot${n}`,
  title: `Robot ${n}`,
  phase: "misc",
  visible: true,
  fields: [
    text(`robot${n}_teamNumber`, "Team Number", `Robot ${n}`, { required: true, placeholder: "Team #" }),
    area(`robot${n}_notes`, "Notes", `Robot ${n}`),
    skill(`robot${n}_skillLevel`, "Skill Level", `Robot ${n}`),
  ],
});

/** Lead Scout (`/scout-form?lead=1`): the alliance's overall read, then a team number, notes and a 1-5 skill for each robot. CS requires all three team numbers. */
export const LEAD_SCOUT_REBUILT_FORM: Form = {
  ...base,
  id: "lead-scout-v1",
  name: "Lead Scout",
  description: "A lead scout's read of an alliance in a match: notes and a 1-5 skill level for the alliance and for each of its robots.",
  formType: "lead-scout",
  tags: ["lead-scout", "rebuilt", "2026"],
  sections: [
    { id: "pre-match", title: "Pre-Match Info", phase: "prematch", visible: true, fields: pickers("lead-scout") },
    {
      id: "overall-alliance",
      title: "Overall Alliance",
      phase: "misc",
      visible: true,
      fields: [
        text("overallAlliance_teams", "Alliance Color / Team", "Overall Alliance", { placeholder: "RED / 1111, 2222, 3333" }),
        area("overallAlliance_notes", "Notes", "Overall Alliance"),
        skill("overallAlliance_skillLevel", "Skill Level", "Overall Alliance"),
      ],
    },
    ...robots.map(leadRobotSection),
  ],
};

const planRobotSection = (n: number, roles: Opt[], extra: FormField[] = []): FormSection => ({
  id: `robot${n}`,
  title: `Robot ${n}`,
  phase: "misc",
  visible: true,
  fields: [
    text(`robot${n}_teamNumber`, "Team Number", `Robot ${n}`),
    select(`robot${n}_startingPosition`, "Starting Position", `Robot ${n}`, REBUILT_STARTING_POSITIONS, "Select Position"),
    select(`robot${n}_role`, "Role", `Robot ${n}`, roles, "Select Role"),
    ...extra,
    check(`robot${n}_autoClimb`, "Auto Climb", `Robot ${n}`),
    select(`robot${n}_endgameClimb`, "Endgame Climb", `Robot ${n}`, CLIMB_LEVELS, "None"),
  ],
});

/**
 * The prediction readouts CS shows under each robot's role (climb probability, point projection, historical sample). CS computes them from past scouting
 * (`app/utils/predictionEngine.ts`, here `lib/analytics/match-prediction.ts`) and stores them with the plan. Here they are plain optional number fields
 * the page can prefill; nothing in the form computes them. HOOK POINT: a page that wants CS's behaviour sets `robot{n}_climbProbability`,
 * `robot{n}_estimatedPoints`, `robot{n}_predictionSampleSize` (and the untouched starting position, role, auto climb and level-1 endgame climb defaults) from
 * `buildTacticalPrediction` once the robots' team numbers are known. That wiring is not done (see the task report).
 */
const predictionFields = (n: number): FormField[] => [
  field(`robot${n}_climbProbability`, "number", "Climb Probability (%)", `Robot ${n}`, { min: 0, max: 100, decimals: 0, helpText: "Filled in from past scouting data.", analytics: { include: false } }),
  field(`robot${n}_estimatedPoints`, "number", "Point Projection", `Robot ${n}`, { min: 0, decimals: 0, helpText: "Filled in from past scouting data.", analytics: { include: false } }),
  field(`robot${n}_predictionSampleSize`, "number", "Historical Sample", `Robot ${n}`, { min: 0, decimals: 0, helpText: "Rows of past data behind the projection.", analytics: { include: false } }),
];

/** Match Strategy: the plan, made before the match. CS needs only the match; every robot answer is optional. */
export const MATCH_STRATEGY_REBUILT_FORM: Form = {
  ...base,
  id: "match-strategy-v1",
  name: "Match Strategy",
  description: "The plan for a match, made before it: each robot's starting position, role and climbs.",
  formType: "match-strategy",
  tags: ["strategy", "rebuilt", "2026"],
  stickyNotes: { enabled: true, defaultOpen: false },
  sections: [
    { id: "pre-match", title: "Information", phase: "prematch", visible: true, fields: pickers("match-strategy") },
    ...robots.map((n) => planRobotSection(n, PLAN_ROLES, predictionFields(n))),
    notesSection("Strategy notes..."),
  ],
};

/** The answers a Drive Reflection can be prefilled from (and compared with) the plan. Role is left out: CS's two forms offer different role lists. */
const REFLECTION_COMPARED = ["teamNumber", "startingPosition", "autoClimb", "endgameClimb"] as const;
const REFLECTION_FIELD_MAP: Record<string, string> = Object.fromEntries(robots.flatMap((n) => REFLECTION_COMPARED.map((k) => [`robot${n}_${k}`, `robot${n}_${k}`])));

/** Drive Reflection: the same robots after the match, prefilled from the plan for the same event, match and alliance. */
export const DRIVE_REFLECTION_REBUILT_FORM: Form = {
  ...base,
  id: "drive-reflection-v1",
  name: "Drive Reflection",
  description: "What actually happened, recorded after the match. Prefilled from the Match Strategy for the same event, match and alliance, with differences marked.",
  formType: "drive-reflection",
  tags: ["reflection", "rebuilt", "2026"],
  stickyNotes: { enabled: true, defaultOpen: false },
  compareWith: { formId: "match-strategy-v1", matchOn: ["eventCode", "matchKey", "alliance"], fieldMap: REFLECTION_FIELD_MAP },
  sections: [
    { id: "pre-match", title: "Information", phase: "prematch", visible: true, fields: pickers("drive-reflection") },
    ...robots.map((n) => planRobotSection(n, REFLECTION_ROLES)),
    notesSection("Drive reflection notes..."),
  ],
};

export const REBUILT_NON_MATCH_FORMS: Readonly<Record<string, Form>> = {
  [PIT_SCOUT_REBUILT_FORM.id]: PIT_SCOUT_REBUILT_FORM,
  [LEAD_SCOUT_REBUILT_FORM.id]: LEAD_SCOUT_REBUILT_FORM,
  [TEAM_STRATEGY_REBUILT_FORM.id]: TEAM_STRATEGY_REBUILT_FORM,
  [MATCH_STRATEGY_REBUILT_FORM.id]: MATCH_STRATEGY_REBUILT_FORM,
  [DRIVE_REFLECTION_REBUILT_FORM.id]: DRIVE_REFLECTION_REBUILT_FORM,
  [HELPER_REBUILT_FORM.id]: HELPER_REBUILT_FORM,
};
