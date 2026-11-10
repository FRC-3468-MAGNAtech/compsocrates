import { REBUILT_CONFIG as C } from "@/config/games/rebuilt";
import type { Form, FormField, FormGroup, FormSection, StatRole, VisibleWhen } from "@/lib/forms/types";

// CS rebuild: the REBUILT (FRC 2026) match scout form, as a built-in `Form`. Every field of CS's `/scout-form` (app/scout-form/page.tsx, REBUILT branch),
// in CS's order, with CS's labels, units and helper text. Keys follow the KEY CONVENTION in lib/games/types.ts: a CS document field `phase.field`
// is the form key `phase_field` (`auto.cycleTimes` -> `auto_cycleTimes`). Scores come from the REBUILT game plugin (`scoring: custom`, `game:REBUILT`):
// fuel from cycle timers and the BPS / carry / preload scales, override-else-estimate-minus-missed, shift parity (Won Auto XOR Hub Activation
// Override), climb points. The per-field `scoring` rules on the two climb fields below are DISPLAY ONLY (they put "+15 pts" / "+10" on the
// tiles and give team stats a per-field average); under custom scoring `calculateScore` ignores them, so nothing is counted twice.
//
// Two things differ from CS on purpose: the human-player counters are one per teleop segment (docs/ROUTES.md D8, fixing CS's shared counter), and the
// incidents are seven yes/no fields (`incidents_died` ...), not one list, so the stat roles (reliability, died ...) attach to each. `incidentsFromValues` /
// `incidentValuesFromList` convert between those fields and CS's `incidents: string[]`.

const GROUP = {
  auto: { capability: "auto-capability", fuel: "auto-fuel", climb: "auto-climb" },
  teleop: { capability: "teleop-capability", parity: "teleop-parity" },
  endgame: { fuel: "endgame-fuel", climb: "endgame-climb" },
} as const;

const base = (key: string, groupId?: string): Pick<FormField, "id" | "key" | "groupId"> => ({ id: `f-${key}`, key, ...(groupId ? { groupId } : {}) });

const noScore = { mode: "none" } as const;

const counter = (key: string, label: string, groupId: string, category: string, helpText?: string, extra: Partial<FormField> = {}): FormField => ({
  ...base(key, groupId),
  type: "counter",
  label,
  ...(helpText ? { helpText } : {}),
  min: 0,
  step: 1,
  scoring: noScore,
  analytics: { include: true, category, aggregate: "avg" },
  ...extra,
});

const toggle = (key: string, label: string, groupId: string, category: string, helpText?: string, extra: Partial<FormField> = {}): FormField => ({
  ...base(key, groupId),
  type: "toggle",
  label,
  ...(helpText ? { helpText } : {}),
  scoring: noScore,
  analytics: { include: true, category, aggregate: "rate" },
  ...extra,
});

/** A CS scale slider: the stored value is the step INDEX; the control shows the range label ("4-6"). */
const scale = (key: string, label: string, groupId: string, category: string, labels: readonly string[], helpText: string): FormField => ({
  ...base(key, groupId),
  type: "slider",
  label,
  helpText,
  min: 0,
  max: labels.length - 1,
  step: 1,
  ticks: true,
  stepLabels: [...labels],
  default: 0,
  scoring: noScore,
  analytics: { include: true, category, aggregate: "avg" },
});

const timer = (key: string, label: string, groupId: string, category: string, helpText: string): FormField => ({
  ...base(key, groupId),
  type: "timerList",
  label,
  helpText,
  max: 150,
  maxCycles: 60,
  scoring: noScore,
  analytics: { include: true, category, aggregate: "avg" },
});

const notice = (key: string, label: string, groupId: string, when: VisibleWhen, helpText?: string, color?: "success" | "warning"): FormField => ({
  ...base(key, groupId),
  type: "notice",
  label,
  ...(helpText ? { helpText } : {}),
  visibleWhen: when,
  ...(color ? { ui: { color } } : {}),
  analytics: { include: false },
});

const PARITY = { fieldKey: "auto_wonAuto", otherFieldKey: "auto_hubActivationOverride" } as const;
/** Shift parity true = Shifts 2 and 4 count; false = Shifts 1 and 3 count (config `shifts.countedWhenParity`). */
const parityIs = (value: boolean): VisibleWhen => ({ op: "xor", ...PARITY, value });

const OVERRIDE_HELP = "If above 0, this replaces the cycle estimate.";
const MISSED_HELP = "Subtracted from the cycle estimate when there is no override.";

/** One fuel block (cycle timer, scored override, missed fuel), as CS draws it in every phase. */
function fuelFields(timerKey: string, groupId: string, category: string, timerLabel: string, overrideKey: string, missedKey: string): FormField[] {
  return [
    timer(timerKey, timerLabel, groupId, category, "Start when the robot begins a cycle, Stop when it finishes. Each stop records one cycle."),
    counter(overrideKey, "Counter override: scored fuel", groupId, category, OVERRIDE_HELP),
    counter(missedKey, "Counter override: missed fuel", groupId, category, MISSED_HELP),
  ];
}

const hp = (key: string, groupId: string, category: string): FormField => counter(key, "Human player: scored fuel", groupId, category, "Fuel the human player scored in this segment.");

// --- sections ---------------------------------------------------------------------------------------------------

const autoGroups: FormGroup[] = [
  { id: GROUP.auto.capability, title: "Robot capability" },
  { id: GROUP.auto.fuel, title: "Fuel" },
  { id: GROUP.auto.climb, title: "Climb" },
];

const SHIFTS = C.shifts.shifts;
/** Which shifts count for each parity, from config. */
const countsWhenParity = (shift: (typeof SHIFTS)[number]): boolean => (C.shifts.countedWhenParity.true as readonly string[]).includes(shift);

const teleopGroups: FormGroup[] = [
  { id: GROUP.teleop.capability, title: "Robot capability" },
  { id: GROUP.teleop.parity, title: "Counted shifts" },
  { id: "teleop-transition", title: "Transition Shift" },
  ...SHIFTS.map((s, i) => ({ id: `teleop-${s}`, title: `Shift ${i + 1}` })),
];

function shiftFields(): FormField[] {
  const out: FormField[] = [
    ...fuelFields("teleop_transitionCycles", "teleop-transition", "Transition Shift", "Transition cycle timer", "teleop_transitionOverride", "teleop_transitionMissedFuel"),
    hp("teleop_humanPlayerFuel_transition", "teleop-transition", "Transition Shift"),
  ];
  SHIFTS.forEach((shift, i) => {
    const n = i + 1;
    const group = `teleop-${shift}`;
    const category = `Shift ${n}`;
    // Shifts 2 and 4 count when parity is true (Won Auto XOR Hub Activation Override); 1 and 3 when it is false.
    const countedValue = countsWhenParity(shift);
    out.push(
      notice(`teleop_${shift}_counted`, `Shift ${n} (Counted)`, group, parityIs(countedValue), "This shift's fuel counts toward the score.", "success"),
      notice(`teleop_${shift}_notCounted`, `Shift ${n} (Not Counted)`, group, parityIs(!countedValue), "Won Auto and Hub Activation Override decide which shifts count. You can still record it."),
      ...fuelFields(`teleop_${shift}Cycles`, group, category, `Shift ${n} cycle timer`, `teleop_${shift}Override`, `teleop_${shift}MissedFuel`),
      hp(`teleop_humanPlayerFuel_${shift}`, group, category)
    );
  });
  return out;
}

const incidentKey = (value: string): string => `incidents_${value.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}`;

/** CS's seven incidents with the form key each one is stored under (`never-started` -> `incidents_neverStarted`). */
export const REBUILT_INCIDENTS = C.incidents.map((i) => ({ value: i.value, key: incidentKey(i.value), label: i.label }));

const INCIDENT_ROLES: Record<string, StatRole[]> = {
  died: ["reliability", "died"],
  "never-started": ["reliability", "neverStarted"],
  disabled: ["reliability", "disabled"],
  recovered: ["reliability", "recoveredFromFreeze"],
  tipped: ["reliability"],
};

/** CS's `incidents: string[]` from the form's seven incident fields (what the game plugin's `valuesToDoc` reads). */
export function incidentsFromValues(values: Record<string, unknown>): string[] {
  return REBUILT_INCIDENTS.filter((i) => values[i.key] === true).map((i) => i.value);
}

/** The seven incident fields from CS's `incidents: string[]` (unknown entries are ignored). */
export function incidentValuesFromList(list: unknown): Record<string, boolean> {
  const set = new Set(Array.isArray(list) ? list.map((v) => String(v)) : []);
  return Object.fromEntries(REBUILT_INCIDENTS.map((i) => [i.key, set.has(i.value)]));
}

const incident = (i: (typeof REBUILT_INCIDENTS)[number]): FormField => ({
  id: `f-${i.key}`,
  key: i.key,
  type: "checkbox",
  label: i.label,
  scoring: noScore,
  analytics: { include: true, category: "Incidents", aggregate: "rate" },
  ...(INCIDENT_ROLES[i.value] ? { statRoles: INCIDENT_ROLES[i.value] } : {}),
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
    title: "Pre-Match Info",
    phase: "prematch",
    visible: true,
    fields: [
      { id: "sys-scout", key: "scoutName", type: "scoutName", label: "Scout name", required: true, analytics: { include: true, category: "Pre-Match", label: "Scout" } },
      { id: "sys-team", key: "teamNumber", type: "teamPicker", label: "Team number", required: true, analytics: { include: true, category: "Information", label: "Team" } },
      {
        id: "f-startingPosition",
        key: "startingPosition",
        type: "select",
        label: "Starting Position",
        placeholder: "Select Position",
        options: C.startingPositions.map((o) => ({ value: o.value, label: o.label })),
        scoring: noScore,
        analytics: { include: true, category: "Pre-Match", aggregate: "last" },
      },
    ],
  },
  {
    id: "autonomous",
    title: "Autonomous",
    phase: "auto",
    visible: true,
    groups: autoGroups,
    fields: [
      scale("auto_preloadScale", "Preload Capacity", GROUP.auto.capability, "Robot capability", C.scales.preload.labels, "Fuel the robot starts with. Slide to the range that matches."),
      scale("auto_bpsScale", "Balls Per Second", GROUP.auto.capability, "Robot capability", C.scales.bps.labels, "How fast the robot shoots, in balls per second."),
      scale("auto_carryingScale", "Carrying Capacity", GROUP.auto.capability, "Robot capability", C.scales.carry.labels, "How many balls the robot holds before it must reload."),
      ...fuelFields("auto_cycleTimes", GROUP.auto.fuel, "Fuel", "Auto Cycle Timer", "auto_counterOverride", "auto_counterOverrideMissedFuel"),
      counter("auto_humanPlayerFuel", "Human player: scored fuel", GROUP.auto.fuel, "Fuel", "Fuel the human player scored in auto."),
      counter("auto_failedClimb", "Failed Climb", GROUP.auto.climb, "Climb", "Tally each failed auto climb attempt. It does not score."),
      toggle("auto_successfulClimb", "Successful Climb", GROUP.auto.climb, "Climb", undefined, { scoring: { mode: "whenOn", value: C.points.autoClimb } }),
      toggle("auto_wonAuto", "Won Auto", GROUP.auto.climb, "Climb", "Flips which teleop shifts count (with Hub Activation Override)."),
      toggle("auto_hubActivationOverride", "Hub Activation Override", GROUP.auto.climb, "Climb", "Flips which teleop shifts count, for when the hub activated against the usual order."),
    ],
  },
  {
    id: "teleop",
    title: "Teleoperated",
    phase: "teleop",
    visible: true,
    groups: teleopGroups,
    fields: [
      scale("teleop_bpsScale", "Balls Per Second", GROUP.teleop.capability, "Robot capability", C.scales.bps.labels, "How fast the robot shoots, in balls per second."),
      scale("teleop_carryingScale", "Carrying Capacity", GROUP.teleop.capability, "Robot capability", C.scales.carry.labels, "How many balls the robot holds before it must reload."),
      notice("teleop_counted24", "Counted shifts right now: Transition + Shift 2 + Shift 4", GROUP.teleop.parity, parityIs(true), "Toggle Won Auto or Hub Activation Override (in Autonomous) to flip the counted shifts.", "success"),
      notice("teleop_counted13", "Counted shifts right now: Transition + Shift 1 + Shift 3", GROUP.teleop.parity, parityIs(false), "Toggle Won Auto or Hub Activation Override (in Autonomous) to flip the counted shifts.", "success"),
      ...shiftFields(),
    ],
  },
  {
    id: "endgame",
    title: "Endgame",
    phase: "endgame",
    visible: true,
    groups: [
      { id: GROUP.endgame.fuel, title: "Fuel" },
      { id: GROUP.endgame.climb, title: "Climb" },
    ],
    fields: [
      ...fuelFields("endgame_cycleTimes", GROUP.endgame.fuel, "Fuel", "Endgame Cycle Timer", "endgame_counterOverride", "endgame_counterOverrideMissedFuel"),
      counter("endgame_humanPlayerFuel", "Human player: scored fuel", GROUP.endgame.fuel, "Fuel", "Fuel the human player scored in the endgame."),
      counter("endgame_failedClimb", "Failed Climb", GROUP.endgame.climb, "Climb", "Tally each failed climb attempt. It does not score."),
      {
        ...base("endgame_status", GROUP.endgame.climb),
        type: "select",
        label: "Status At End of Match",
        placeholder: "Status At End of Match",
        options: C.endgameStatuses
          .filter((o) => o.value !== "")
          .map((o) => ({ value: o.value, label: o.label, points: (C.points.endgameClimb as Record<string, number>)[o.value] ?? 0 })),
        scoring: { mode: "byOption" },
        analytics: { include: true, category: "Climb", aggregate: "last" },
      },
    ],
  },
  {
    id: "general",
    title: "Incidents & Notes",
    phase: "misc",
    visible: true,
    fields: [
      ...REBUILT_INCIDENTS.map(incident),
      {
        id: "f-notes",
        key: "notes",
        type: "textarea",
        label: "Notes",
        placeholder: "Anything notable: robot issues, standout driving, penalties...",
        statRoles: ["comments"],
        scoring: noScore,
        analytics: { include: true, category: "Comments", aggregate: "list" },
      },
    ],
  },
];

export const REBUILT_FORM: Form = {
  id: "rebuilt",
  name: "REBUILT",
  description: "The 2026 REBUILT season's match scouting form: cycle timers, shooter and carry scales, shift parity, human player fuel, climb and incident flags.",
  formType: "match-scout",
  tags: ["rebuilt", "2026"],
  version: 1,
  status: "published",
  scoringEnabled: true,
  // The score is the REBUILT game plugin's `scoreValues` (lib/games/rebuilt.ts), not a sum of per-field rules.
  scoring: { mode: "custom", scorer: `game:${C.id}` },
  sections,
  origin: "built-in",
  createdBy: "system",
};
