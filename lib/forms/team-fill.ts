import { repeatGroupOf, slotKey } from "@/lib/forms/repeat";
import { allianceTitle } from "@/lib/forms/form-page-logic";
import type { Form, FormValues } from "@/lib/forms/types";

// Which form fields hold "the team in alliance position n", so the schedule can fill them once an alliance and a match are chosen. Pure.
// Two shapes exist: a `teamPicker` inside a repeating group (stored `t1_team`, `t2_team`: the forms of a 2-team-alliance program and custom forms), and the explicit
// per-robot number fields of the REBUILT alliance forms (`robot1_teamNumber` .. `robot3_teamNumber`: Lead Scout, Match Strategy, Drive Reflection).

const ROBOT_TEAM_KEY = /^robot([1-9])_teamNumber$/;
/** The Lead Scout's text box for the whole alliance: "RED / 1111, 2222, 3333". */
const ALLIANCE_TEXT_KEY = "overallAlliance_teams";

/** One fillable field: its storage key, its 1-based position in the alliance, and whether it stores text (`robot1_teamNumber`) or a number (`t1_team`). */
export type TeamFillTarget = { storageKey: string; slot: number; asText: boolean };

/** Every field of the form the alliance's teams fill, in position order. */
export function teamFillTargets(form: Pick<Form, "sections">): TeamFillTarget[] {
  const out: TeamFillTarget[] = [];
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (field.type === "teamPicker" && repeatGroupOf(section, field)) {
        const max = repeatGroupOf(section, field)!.repeat.maxSlots;
        for (let slot = 1; slot <= max; slot++) out.push({ storageKey: slotKey(slot, field.key), slot, asText: false });
        continue;
      }
      const m = ROBOT_TEAM_KEY.exec(field.key);
      if (m && (field.type === "text" || field.type === "number")) out.push({ storageKey: field.key, slot: Number(m[1]), asText: field.type === "text" });
    }
  }
  return out.sort((a, b) => a.slot - b.slot);
}

/**
 * The values to set so each position holds its team: position n gets `allianceTeams[n - 1]`. A field the person edited (`touched`), one already holding
 * its team and a position the schedule has no team for are left alone. With the alliance colour it also fills the whole-alliance text box. Null when nothing changes.
 */
export function teamFillFor(
  form: Pick<Form, "sections">,
  allianceTeams: readonly number[],
  values: FormValues,
  touched: ReadonlySet<string> = new Set(),
  alliance: "red" | "blue" | null = null
): FormValues | null {
  let next: FormValues | null = null;
  // the alliance text box ("RED / 1111, 2222, 3333") needs the colour and at least one team
  if (alliance && allianceTeams.length > 0 && !touched.has(ALLIANCE_TEXT_KEY) && form.sections.some((s) => s.fields.some((f) => f.key === ALLIANCE_TEXT_KEY && f.type === "text"))) {
    const text = allianceTitle(alliance, allianceTeams);
    if (values[ALLIANCE_TEXT_KEY] !== text) next = { ...values, [ALLIANCE_TEXT_KEY]: text };
  }
  for (const t of teamFillTargets(form)) {
    const team = allianceTeams[t.slot - 1];
    if (team === undefined || touched.has(t.storageKey)) continue;
    const value = t.asText ? String(team) : team;
    if (values[t.storageKey] === value) continue;
    next ??= { ...values };
    next[t.storageKey] = value;
  }
  return next;
}
