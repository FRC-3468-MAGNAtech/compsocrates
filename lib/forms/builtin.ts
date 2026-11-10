import type { Form, FormField, FormSection } from "@/lib/forms/types";
import { formContentHash } from "@/lib/forms/hash";
import { TEAM_BUILTIN_FORMS } from "@/lib/forms/builtin-team-forms";
import { PIT_BUILTIN_FORMS } from "@/lib/forms/builtin-pit-forms";
import { REBUILT_FORM } from "@/lib/forms/builtin-rebuilt";
import { REBUILT_NON_MATCH_FORMS } from "@/lib/forms/builtin-rebuilt-forms";
import { LEGACY_FORM_IDS, LEGACY_GAME_FORMS } from "@/lib/forms/builtin-legacy-games";
import { DEFAULT_SEASON_ID, getSeason } from "@/lib/seasons";
import type { CsFormType } from "@/data/cs/form-field-keys";

// P21: the forms that live in code. BIOBUZZ is just the first one: this file is the ONLY place in the app that names a
// game element. It must behave exactly like the pre-v2 hard-coded form (lib/forms/fixtures/biobuzz-v1.ts is the frozen
// original the regression tests compare against: scores, columns, stats, flags).

/** The auto-flag thresholds BIOBUZZ's counters carry (`unrealisticAbove`): the values that used to be hard-coded in lib/analytics/flags.ts. */
const T = { AUTO_TIP_HIVE: 3, TELEOP_TIP_HIVE: 6, FLOWER_POLLEN: 20, GARDEN_POLLEN: 40 } as const;
export const BIOBUZZ_UNREALISTIC = T;

const toggle = (key: string, label: string, points: number, category: string, element: string, extra: Partial<FormField> = {}): FormField => ({
  id: `f-${key}`,
  key,
  type: "toggle",
  label,
  scoring: { mode: "whenOn", value: points },
  analytics: { include: true, category, element, aggregate: "rate" },
  ...extra,
});

const counter = (key: string, label: string, points: number, category: string, element: string, extra: Partial<FormField> = {}): FormField => ({
  id: `f-${key}`,
  key,
  type: "counter",
  label,
  min: 0,
  step: 1,
  scoring: { mode: "perTally", value: points },
  analytics: { include: true, category, element, aggregate: "avg" },
  ...extra,
});

const incident = (key: string, label: string, roles: NonNullable<FormField["statRoles"]> = []): FormField => ({
  id: `f-${key}`,
  key,
  type: "checkbox",
  label,
  scoring: { mode: "none" },
  analytics: { include: true, category: "Incidents", aggregate: "rate" },
  ...(roles.length > 0 ? { statRoles: roles } : {}),
});

const sections: FormSection[] = [
  {
    id: "assigned-match",
    title: "Assigned Match",
    phase: "prematch",
    visible: true,
    fields: [{ id: "sys-match", key: "match", type: "matchPicker", label: "Assigned match", required: true, analytics: { include: true, category: "Information", label: "Match" } }],
  },
  {
    id: "pre-match",
    title: "Pre-Match",
    phase: "prematch",
    visible: true,
    fields: [
      { id: "sys-scout", key: "scoutName", type: "scoutName", label: "Scout name", required: true, analytics: { include: true, category: "Pre-Match", label: "Scout" } },
      { id: "sys-team", key: "teamNumber", type: "teamPicker", label: "Team number", required: true, analytics: { include: true, category: "Information", label: "Team" } },
    ],
  },
  {
    id: "autonomous",
    title: "Autonomous",
    phase: "auto",
    visible: true,
    fields: [
      toggle("autoLeave", "Leave", 3, "Leave", "Leave"),
      toggle("autoPark", "Park", 5, "Park", "Park"),
      counter("autoTipHive", "Tip Hive", 20, "Hive", "Hive", { statRoles: ["primaryScoring"], unrealisticAbove: T.AUTO_TIP_HIVE }),
    ],
  },
  {
    id: "teleop",
    title: "Teleoperated",
    phase: "teleop",
    visible: true,
    groups: [
      { id: "hive", title: "Hive" },
      { id: "flower", title: "Flower" },
      { id: "garden", title: "Garden" },
    ],
    fields: [
      counter("teleTipHive", "Tip Hive", 20, "Hive", "Hive", { groupId: "hive", statRoles: ["primaryScoring"], unrealisticAbove: T.TELEOP_TIP_HIVE }),
      toggle("flowerBottomNectar", "Bottom Nectar", 5, "Flower", "Flower", { groupId: "flower" }),
      counter("flowerPollenNectar", "Pollen and Nectar", 2, "Flower", "Flower", { groupId: "flower", unrealisticAbove: T.FLOWER_POLLEN }),
      counter("gardenPollenNectar", "Pollen and Nectar", 1, "Garden", "Garden", { groupId: "garden", unrealisticAbove: T.GARDEN_POLLEN }),
    ],
  },
  {
    id: "endgame",
    title: "Endgame",
    phase: "endgame",
    visible: true,
    fields: [toggle("endgamePark", "Park", 5, "Park", "Park")],
  },
  {
    id: "general",
    title: "General",
    phase: "misc",
    visible: true,
    fields: [
      incident("diedDuringMatch", "Died During Match", ["reliability", "died"]),
      incident("neverStartedMatch", "Never Started Match", ["reliability", "neverStarted"]),
      incident("disabledByFtc", "Disabled by FTC", ["reliability", "disabled"]),
      incident("recoveredFromFreeze", "Recovered from Freeze", ["reliability", "recoveredFromFreeze"]),
      incident("tippedOver", "Tipped Over", ["reliability"]),
      incident("yellowCard", "Yellow Card"),
      incident("redCard", "Red Card"),
      {
        id: "f-comments",
        key: "comments",
        type: "textarea",
        label: "Comments",
        placeholder: "Anything notable — robot issues, standout driving, penalties...",
        statRoles: ["comments"],
        scoring: { mode: "none" },
        analytics: { include: true, category: "Comments", aggregate: "list" },
      },
    ],
  },
];

export const BIOBUZZ_FORM: Form = {
  id: "biobuzz",
  name: "BIOBUZZ",
  description: "The 2026 BIOBUZZ season's match scouting form: Hive, Flower and Garden scoring, parking, and incident flags.",
  formType: "match-scout",
  tags: ["biobuzz", "2026"],
  version: 1,
  status: "published",
  scoringEnabled: true,
  sections,
  // P28: the sticky notes panel is on for the Match Scout Form by default (its notes are saved with the entry and fold into the old Comments column)
  stickyNotes: { enabled: true, defaultOpen: false },
  origin: "built-in",
  createdBy: "system",
};

/**
 * Every form defined in code, by id. An account's override (copy-on-write) of one of these lives in Firestore and wins when it exists.
 * The six non-match forms exist twice: the REBUILT set under the adapter's ids ("pit-scout-v1", ...) and the BIOBUZZ set under "biobuzz-pit-scout-v1", ...
 * (see `seasonFormId`). REEFSCAPE and CHARGED UP are read-only (`READ_ONLY_FORM_IDS`).
 */
export const BUILTIN_FORMS: Readonly<Record<string, Form>> = {
  rebuilt: REBUILT_FORM,
  biobuzz: BIOBUZZ_FORM,
  ...LEGACY_GAME_FORMS,
  ...REBUILT_NON_MATCH_FORMS,
  ...TEAM_BUILTIN_FORMS,
  ...PIT_BUILTIN_FORMS,
};

/** CS rebuild: the default match form follows the season of the running program (REBUILT for FRC; BIOBUZZ with EVENT_PROGRAM=ftc). */
export const DEFAULT_FORM_ID: string = getSeason(DEFAULT_SEASON_ID).formId;

/**
 * Forms that resolve by id (so old entries keep their columns) but are never offered for a new entry: not in the forms panel, not an "active form", not a
 * scouting page's form. The two retired games (docs/ROUTES.md D3).
 */
export const READ_ONLY_FORM_IDS: ReadonlySet<string> = new Set(LEGACY_FORM_IDS);
export const isReadOnlyForm = (id: string): boolean => READ_ONLY_FORM_IDS.has(id);

/** The six non-match form types CS persists, as the adapter names them (data/cs/form-field-keys.ts). */
export type NonMatchFormType = CsFormType;

/** Each season's id for each non-match form. REBUILT's are the ids the CS adapter attributes entries to; BIOBUZZ's keep their own. */
export const SEASON_NON_MATCH_FORM_IDS: Readonly<Record<string, Readonly<Record<NonMatchFormType, string>>>> = {
  rebuilt: {
    "pit-scout": "pit-scout-v1",
    "lead-scout": "lead-scout-v1",
    "team-strategy": "team-strategy-v1",
    "match-strategy": "match-strategy-v1",
    "drive-reflection": "drive-reflection-v1",
    helper: "helper-v1",
  },
  biobuzz: {
    "pit-scout": "biobuzz-pit-scout-v1",
    "lead-scout": "biobuzz-lead-scout-v1",
    "team-strategy": "biobuzz-team-strategy-v1",
    "match-strategy": "biobuzz-match-strategy-v1",
    "drive-reflection": "biobuzz-drive-reflection-v1",
    helper: "biobuzz-helper-v1",
  },
};

const NON_MATCH_TYPE_BY_ID = new Map<string, NonMatchFormType>(
  Object.values(SEASON_NON_MATCH_FORM_IDS).flatMap((ids) => (Object.entries(ids) as [NonMatchFormType, string][]).map(([type, id]) => [id, type] as const))
);

/** The non-match form type of a built-in id of either season ("pit-scout-v1", "biobuzz-pit-scout-v1"), or null for any other id. */
export const nonMatchTypeOfFormId = (id: string): NonMatchFormType | null => NON_MATCH_TYPE_BY_ID.get(id) ?? null;

/**
 * The form id a page should use for a non-match form in a season (default: the running program's season). Pass either season's id for the form
 * ("pit-scout-v1" or "biobuzz-pit-scout-v1") or a form type; an id that is not one of the six (a custom form) comes back unchanged.
 */
export function seasonFormId(idOrType: string, seasonId: string = DEFAULT_SEASON_ID): string {
  const type = (Object.hasOwn(SEASON_NON_MATCH_FORM_IDS.rebuilt, idOrType) ? idOrType : nonMatchTypeOfFormId(idOrType)) as NonMatchFormType | null;
  if (!type) return idOrType;
  const season = SEASON_NON_MATCH_FORM_IDS[seasonId] ?? SEASON_NON_MATCH_FORM_IDS[DEFAULT_SEASON_ID] ?? SEASON_NON_MATCH_FORM_IDS.rebuilt;
  return season[type];
}

export { REBUILT_FORM };

export function getBuiltinForm(id: string): Form | null {
  return BUILTIN_FORMS[id] ?? null;
}

/** Content hash of a built-in, stored on an override so a later change to the code-defined original can be detected. */
export function builtinHash(id: string): string | null {
  const form = BUILTIN_FORMS[id];
  return form ? formContentHash(form) : null;
}
