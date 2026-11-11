import { systemFieldsFor } from "@/lib/forms/new-form";
import type { Form, FormField, FormGroup, FormSection } from "@/lib/forms/types";

// NEUTRAL sample versions of the team's non-match forms for the Playwright fixtures (/e2e/form-page, /e2e/team-forms, /e2e/form-analytics): the SHAPES the form
// page engine supports (a per-team repeating group on the lead scout / match strategy / drive reflection forms, a matrix, a step sequence and photos on the
// pit form), with generic content that names no game. The real forms are the REBUILT ones (lib/forms/builtin-rebuilt-forms.ts); these exist so the specs can
// exercise the repeating-group layout (`t1_*`, `t2_*` keys) that the engine still supports for custom forms. Test-only: nothing in the app imports this file.

const base = { tags: [] as string[], version: 1, status: "published" as const, scoringEnabled: false, origin: "built-in" as const, createdBy: "system" };

/** The auto cycle's steps. Leave is always first and Park always last (pinned, once); the others repeat and can be rearranged. */
export const SAMPLE_AUTO_STEPS = [
  { id: "leave", label: "Leave", maxCount: 1, pin: "first" },
  { id: "score", label: "Score A Piece", shortLabel: "Score", maxCount: 0, pin: null },
  { id: "collect", label: "Collect From The Station", shortLabel: "Collect", maxCount: 0, pin: null },
  { id: "assist", label: "Assist A Partner", shortLabel: "Assist", maxCount: 0, pin: null },
  { id: "park", label: "Park", maxCount: 1, pin: "last" },
] as const;

export const SAMPLE_ROLES = [
  { value: "scoring", label: "Scoring" },
  { value: "collecting", label: "Collecting" },
  { value: "assisting", label: "Assisting" },
  { value: "defense", label: "Defense" },
] as const;

const plain = (extra: Partial<FormField> & Pick<FormField, "id" | "key" | "type" | "label">): FormField => ({ scoring: { mode: "none" }, analytics: { include: true }, ...extra });
const checkbox = (id: string, key: string, label: string): FormField => plain({ id, key, type: "checkbox", label, analytics: { include: true, aggregate: "rate" } });
const numberField = (id: string, key: string, label: string, extra: Partial<FormField> = {}): FormField => plain({ id, key, type: "number", label, min: 0, decimals: 0, analytics: { include: true, aggregate: "avg" }, ...extra });

const teamPickers = (...types: ("eventPicker" | "teamPicker" | "scoutName")[]): FormField[] => {
  const all = systemFieldsFor("pit-scout");
  return types.map((t) => all.find((f) => f.type === t)!);
};

// --- team-based forms -----------------------------------------------------------------------------------------------

export const SAMPLE_PIT_FORM: Form = {
  ...base,
  id: "sample-pit-scout",
  name: "Pit Scout",
  description: "A team's robot as seen in the pit: weight, photos, capabilities, capacity, cycle time and the planned auto cycle.",
  formType: "pit-scout",
  tags: ["pit-scout"],
  stickyNotes: { enabled: true, defaultOpen: false },
  sections: [
    { id: "pre-match", title: "Pre-Match", phase: "prematch", visible: true, fields: teamPickers("eventPicker", "teamPicker", "scoutName") },
    {
      id: "robot",
      title: "Robot",
      phase: "misc",
      visible: true,
      fields: [
        numberField("f-weight", "weight", "Robot weight", { decimals: 1, placeholder: "e.g. 24.5", analytics: { include: true, aggregate: "avg", category: "Robot" } }),
        plain({
          id: "f-weight-unit",
          key: "weightUnit",
          type: "radio",
          label: "Weight unit",
          default: "lb",
          options: [
            { value: "lb", label: "lb" },
            { value: "kg", label: "kg" },
          ],
          analytics: { include: true, aggregate: "last", category: "Robot" },
        }),
        checkbox("f-rookie", "rookie", "Rookie team"),
        plain({ id: "f-photos", key: "photos", type: "image", label: "Photo of the robot", maxCount: 3, capture: true, analytics: { include: true, aggregate: "list", category: "Robot" } }),
        checkbox("f-friendly-pit", "friendlyPit", "Friendly and easy to work with in the pit"),
        checkbox("f-friendly-drive", "friendlyDrive", "Friendly and easy to work with in drive"),
      ],
    },
    {
      id: "capabilities",
      title: "Capabilities",
      phase: "misc",
      visible: true,
      fields: [
        plain({
          id: "f-capabilities",
          key: "capabilities",
          type: "matrix",
          label: "What the robot can do",
          rows: [
            { key: "leave", label: "Leave" },
            { key: "park", label: "Park" },
            { key: "score", label: "Score A Piece" },
            { key: "collect", label: "Collect From The Station" },
            { key: "assist", label: "Assist A Partner" },
          ],
          cols: [
            { key: "auto", label: "Autonomous" },
            { key: "teleop", label: "Teleop/Endgame" },
          ],
          disabledCells: ["leave_teleop"], // Leave is an Autonomous-only action
          analytics: { include: true, aggregate: "rate", category: "Capabilities" },
        }),
        numberField("f-capacity", "capacity", "Approximately how many game pieces can the robot hold in total?", { analytics: { include: true, aggregate: "avg", category: "Capacity" } }),
        numberField("f-preloaded", "preloaded", "Approximately how many are preloaded?", { analytics: { include: true, aggregate: "avg", category: "Capacity" } }),
        numberField("f-cycle-time", "cycleTime", "Approximate cycle time (seconds)", { decimals: 1, placeholder: "seconds", analytics: { include: true, aggregate: "avg", category: "Capacity" } }),
      ],
    },
    {
      id: "auto-cycle",
      title: "Auto cycle",
      phase: "auto",
      visible: true,
      fields: [plain({ id: "f-auto-cycle", key: "autoCycle", type: "sequence", label: "Auto cycle outliner", helpText: "Tap the steps in the order the robot does them. Leave is always first and Park always last.", steps: SAMPLE_AUTO_STEPS.map((s) => ({ ...s })), analytics: { include: true, aggregate: "last", category: "Auto cycle" } })],
    },
  ],
};

export const SAMPLE_TEAM_STRATEGY_FORM: Form = {
  ...base,
  id: "sample-team-strategy",
  name: "Team Strategy",
  description: "What a team is best at and what it can do, from a strategist's point of view.",
  formType: "team-strategy",
  tags: ["strategy"],
  stickyNotes: { enabled: true, defaultOpen: false },
  sections: [
    { id: "pre-match", title: "Pre-Match", phase: "prematch", visible: true, fields: teamPickers("eventPicker", "teamPicker", "scoutName") },
    {
      id: "strategy",
      title: "Strategy",
      phase: "misc",
      visible: true,
      fields: [
        plain({
          id: "f-best-at",
          key: "bestAt",
          type: "select",
          label: "Best at",
          placeholder: "Choose one",
          options: SAMPLE_ROLES.map((o) => ({ value: o.value, label: o.label })),
          analytics: { include: true, aggregate: "last", category: "Strategy" },
        }),
        checkbox("f-can-score", "canScore", "Can score"),
        checkbox("f-can-collect", "canCollect", "Can collect"),
        checkbox("f-shoot-intaking", "shootWhileIntaking", "Shoot while intaking"),
        checkbox("f-shoot-moving", "shootWhileMoving", "Shoot while moving"),
      ],
    },
  ],
};

export const SAMPLE_HELPER_FORM: Form = {
  ...base,
  id: "sample-helper",
  name: "Helper",
  description: "For people who help other teams in the pit: which team, whether the help worked, and what the issue was.",
  formType: "helper",
  tags: ["helper"],
  stickyNotes: { enabled: true, defaultOpen: false },
  sections: [
    {
      id: "pre-match",
      title: "Pre-Match",
      phase: "prematch",
      visible: true,
      fields: teamPickers("eventPicker", "teamPicker", "scoutName").map((f) => (f.type === "teamPicker" ? { ...f, label: "Team helped" } : f)),
    },
    {
      id: "assist",
      title: "The assist",
      phase: "misc",
      visible: true,
      fields: [
        plain({
          id: "f-successful",
          key: "successful",
          type: "radio",
          label: "Was the scout successful with the pit assistance?",
          required: true,
          options: [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ],
          analytics: { include: true, aggregate: "last", category: "Assist" },
        }),
        plain({ id: "f-issues", key: "issues", type: "textarea", label: "Issue(s) they attempted to solve", required: true, placeholder: "What was wrong, and what did you try?", analytics: { include: true, aggregate: "list", category: "Assist" } }),
      ],
    },
  ],
};

// --- match-based forms (a repeating per-team group) ------------------------------------------------------------------

const REPEAT_GROUP: FormGroup = { id: "teams-group", title: "Teams", repeat: { source: "allianceTeams", maxSlots: 3 } };

function matchPickers(order: ("eventPicker" | "matchPicker" | "alliancePicker" | "scoutName")[]): FormField[] {
  const all = systemFieldsFor("lead-scout");
  return order.map((t) => all.find((f) => f.type === t)!);
}

const skill = (id: string, key: string, label: string, groupId?: string): FormField => ({
  id,
  key,
  type: "slider",
  label,
  min: 1,
  max: 5,
  step: 1,
  ticks: true,
  endLabels: { min: "Low", max: "High" },
  scoring: { mode: "none" },
  analytics: { include: true, aggregate: "avg" },
  ...(groupId ? { groupId } : {}),
});

const notes = (id: string, key: string, label: string, groupId?: string): FormField => ({
  id,
  key,
  type: "textarea",
  label,
  placeholder: "What did you see?",
  scoring: { mode: "none" },
  analytics: { include: true, aggregate: "list" },
  ...(groupId ? { groupId } : {}),
});

const slotTeam = (id: string): FormField => ({ id, key: "team", type: "teamPicker", label: "Team", groupId: REPEAT_GROUP.id, scoring: { mode: "none" }, analytics: { include: true, aggregate: "last" } });

const roleField = (id: string, label: string): FormField => ({
  id,
  key: "role",
  type: "select",
  label,
  groupId: REPEAT_GROUP.id,
  options: SAMPLE_ROLES.map((o) => ({ value: o.value, label: o.label })),
  scoring: { mode: "none" },
  analytics: { include: true, aggregate: "last" },
});

const autoField = (id: string, label: string): FormField => ({ id, key: "auto", type: "checkbox", label, groupId: REPEAT_GROUP.id, scoring: { mode: "none" }, analytics: { include: true, aggregate: "rate" } });

export const SAMPLE_LEAD_FORM: Form = {
  ...base,
  id: "sample-lead-scout",
  name: "Lead Scout",
  description: "A lead scout's read of an alliance in a match: notes and a 1-5 skill level for the alliance and for each of its teams.",
  formType: "lead-scout",
  tags: ["lead-scout"],
  sections: [
    { id: "pre-match", title: "Pre-Match", phase: "prematch", visible: true, fields: matchPickers(["eventPicker", "matchPicker", "alliancePicker", "scoutName"]) },
    { id: "alliance", title: "Alliance", phase: "misc", visible: true, fields: [notes("f-alliance-notes", "allianceNotes", "Notes"), skill("f-alliance-skill", "allianceSkill", "Skill level")] },
    {
      id: "teams",
      title: "Teams",
      phase: "misc",
      visible: true,
      groups: [REPEAT_GROUP],
      fields: [slotTeam("f-team"), notes("f-team-notes", "notes", "Notes", REPEAT_GROUP.id), skill("f-team-skill", "skill", "Skill level", REPEAT_GROUP.id)],
    },
  ],
};

const strategySections = (roleLabel: string, autoLabel: string): FormSection[] => [
  { id: "pre-match", title: "Pre-Match", phase: "prematch", visible: true, fields: matchPickers(["eventPicker", "alliancePicker", "matchPicker", "scoutName"]) },
  { id: "teams", title: "Teams", phase: "misc", visible: true, groups: [REPEAT_GROUP], fields: [slotTeam("f-team"), roleField("f-role", roleLabel), autoField("f-auto", autoLabel)] },
];

export const SAMPLE_STRATEGY_FORM: Form = {
  ...base,
  id: "sample-match-strategy",
  name: "Match Strategy",
  description: "The plan for a match, made before it: each team's role and whether it will score in auto.",
  formType: "match-strategy",
  tags: ["strategy"],
  stickyNotes: { enabled: true, defaultOpen: false },
  sections: strategySections("Role", "Will score in auto"),
};

export const SAMPLE_REFLECTION_FORM: Form = {
  ...base,
  id: "sample-drive-reflection",
  name: "Drive Reflection",
  description: "What actually happened, recorded after the match. Prefilled from the Match Strategy for the same event, match and alliance, with differences marked.",
  formType: "drive-reflection",
  tags: ["reflection"],
  stickyNotes: { enabled: true, defaultOpen: false },
  compareWith: { formId: SAMPLE_STRATEGY_FORM.id, matchOn: ["eventCode", "matchKey", "alliance"], fieldMap: { role: "role", auto: "auto" } },
  sections: strategySections("Role", "Scored in auto"),
};
