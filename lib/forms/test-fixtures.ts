import type { Form, FormField, FormSection } from "@/lib/forms/types";

// A NEUTRAL sample match-scout form for tests that need "some form" (the builder, the store, templates, scout status, the dashboard smoke test, analytics): it
// names no game. Test-only: nothing in the app imports it. Its shape is deliberately the common one (a few toggles and counters per phase, two groups in
// teleop, the standard incident checkboxes, a comments field), so a test can exercise scoring, stat roles and analytics columns without depending on
// any real game's fields.
//
// Scoring (field rules): Leave 3 + Park 5 in auto, counter A 20 each; teleop counter A 20, bonus B 5, counter B 2, counter C 1; endgame Park 5.

/** The "unrealistic above" limits of the sample counters (what the auto-flag rules compare against). */
export const SAMPLE_UNREALISTIC = { AUTO_A: 3, TELE_A: 6, TELE_B: 20, TELE_C: 40 } as const;

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
      counter("autoScoreA", "Score A", 20, "Target A", "Target A", { statRoles: ["primaryScoring"], unrealisticAbove: SAMPLE_UNREALISTIC.AUTO_A }),
    ],
  },
  {
    id: "teleop",
    title: "Teleoperated",
    phase: "teleop",
    visible: true,
    groups: [
      { id: "target-a", title: "Target A" },
      { id: "target-b", title: "Target B" },
      { id: "target-c", title: "Target C" },
    ],
    fields: [
      counter("teleScoreA", "Score A", 20, "Target A", "Target A", { groupId: "target-a", statRoles: ["primaryScoring"], unrealisticAbove: SAMPLE_UNREALISTIC.TELE_A }),
      toggle("teleBonusB", "Bonus B", 5, "Target B", "Target B", { groupId: "target-b" }),
      counter("teleScoreB", "Score B", 2, "Target B", "Target B", { groupId: "target-b", unrealisticAbove: SAMPLE_UNREALISTIC.TELE_B }),
      counter("teleScoreC", "Score C", 1, "Target C", "Target C", { groupId: "target-c", unrealisticAbove: SAMPLE_UNREALISTIC.TELE_C }),
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
      incident("disabledByOfficial", "Disabled by an Official", ["reliability", "disabled"]),
      incident("recoveredFromFreeze", "Recovered from Freeze", ["reliability", "recoveredFromFreeze"]),
      incident("tippedOver", "Tipped Over", ["reliability"]),
      incident("yellowCard", "Yellow Card"),
      incident("redCard", "Red Card"),
      {
        id: "f-comments",
        key: "comments",
        type: "textarea",
        label: "Comments",
        placeholder: "Anything notable: robot issues, standout driving, penalties...",
        statRoles: ["comments"],
        scoring: { mode: "none" },
        analytics: { include: true, category: "Comments", aggregate: "list" },
      },
    ],
  },
];

/** The neutral sample form (id `sample`, version 1, built-in, field scoring on, sticky notes on). */
export const SAMPLE_FORM: Form = {
  id: "sample",
  name: "Sample",
  description: "A neutral sample match scouting form for tests.",
  formType: "match-scout",
  tags: ["sample"],
  version: 1,
  status: "published",
  scoringEnabled: true,
  sections,
  stickyNotes: { enabled: true, defaultOpen: false },
  origin: "built-in",
  createdBy: "system",
};
