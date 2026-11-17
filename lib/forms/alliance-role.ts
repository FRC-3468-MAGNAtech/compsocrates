import type { Form, FormField, FormValues } from "@/lib/forms/types";
import { defaultFieldValue } from "@/lib/forms/values";
import { mulberry32 } from "@/lib/scheduler/rng";

// Alliance roles: an objective scored by the ALLIANCE (a game's Hive, Flower and Garden) must be recorded by one scout per alliance, or it is counted twice.
// A form field names the role that records it (`FormField.allianceRole`); each scout is given one role per match; the fields of the other role are stored as
// ABSENT (not 0), so "not recorded" differs from "recorded zero". A value that is present always counts as recorded, whatever the entry's role (old entries
// kept every value and carry no role).
//
// The role is chosen from a seed everyone derives the same way (event, match, alliance), so both scouts of an alliance agree with no stored state and no
// network. It is NOT FRC's human-player rule (`isHumanPlayerSlot`: red1/blue1 always), which would hand the same objective to robot 1 in every match.

/** The value key (and the form's hidden select) that holds an entry's role: `"hive"`, `"garden"`, or absent. */
export const ALLIANCE_ROLE_KEY = "allianceRole";

/** The roles a form's fields name, in the order they first appear. */
export function allianceRoleIds(form: Pick<Form, "sections">): string[] {
  const ids: string[] = [];
  for (const s of form.sections) for (const f of s.fields) if (f.allianceRole && !ids.includes(f.allianceRole)) ids.push(f.allianceRole);
  return ids;
}

/** Does the form split any objective between scouts? */
export const hasAllianceRoles = (form: Pick<Form, "sections">): boolean => form.sections.some((s) => s.fields.some((f) => f.allianceRole !== undefined));

/** The fields a role records (all role fields when `role` is omitted). */
export function allianceRoleFields(form: Pick<Form, "sections">, role?: string): FormField[] {
  return form.sections.flatMap((s) => s.fields).filter((f) => f.allianceRole !== undefined && (role === undefined || f.allianceRole === role));
}

/** FNV-1a: a stable 32-bit hash of a string (the seed of the role choice). */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type RoleSeedInput = {
  /** The event key (or, in practice scouting, the library match id). */
  eventKey: string;
  matchType: string;
  matchNumber: number;
  alliance: "red" | "blue";
  /** Practice scouting: the session id, so one session's two robots agree and a replay of the same match can differ. */
  sessionId?: string | null;
};

export const roleSeedText = (s: RoleSeedInput): string => [s.eventKey, s.matchType, s.matchNumber, s.alliance, s.sessionId ?? ""].join("|");

/**
 * The role of `teamNumber` on an alliance of exactly two scouted robots: a seeded bit picks which of the two (ordered by team number) gets the FIRST role,
 * the other gets the second. Null when the alliance isn't exactly two distinct teams, the team isn't on it, or the form has fewer than two roles. Pure and
 * deterministic: every scout of the alliance computes the same split.
 */
export function assignAllianceRole(input: { seed: string; teams: readonly number[]; teamNumber: number; roles: readonly string[] }): string | null {
  const teams = [...new Set(input.teams.filter((t) => Number.isFinite(t) && t > 0))].sort((a, b) => a - b);
  if (teams.length !== 2 || input.roles.length < 2 || !teams.includes(input.teamNumber)) return null;
  const firstRoleTeamIndex = mulberry32(hashSeed(input.seed))() < 0.5 ? 0 : 1;
  return teams[firstRoleTeamIndex] === input.teamNumber ? input.roles[0] : input.roles[1];
}

/**
 * The values with a role applied: the fields of every OTHER role are removed (absent), the role's own fields keep their value or start at their default, and
 * the role key records the role. A null role clears the key and gives every role field its default (all of them are shown and recorded).
 */
export function applyAllianceRole(form: Pick<Form, "sections">, values: FormValues, role: string | null): FormValues {
  const next: FormValues = { ...values };
  for (const f of allianceRoleFields(form)) {
    if (role !== null && f.allianceRole !== role) delete next[f.key];
    else if (next[f.key] === undefined) next[f.key] = defaultFieldValue(f);
  }
  if (role === null) delete next[ALLIANCE_ROLE_KEY];
  else next[ALLIANCE_ROLE_KEY] = role;
  return next;
}

/** The values as an admin sees them: every role's fields are shown and scored (role visibility off), whatever role the entry was scouted in. */
export function withoutRole(values: FormValues): FormValues {
  const next = { ...values };
  delete next[ALLIANCE_ROLE_KEY];
  return next;
}

/** Was the field recorded on this entry? A present value is recorded (a counter at 0 included); an absent one was not asked. */
export const isRecorded = (values: Record<string, unknown>, key: string): boolean => values[key] !== undefined && values[key] !== null;

/** The role of one robot on one alliance for this form, or null when the form has no roles or the alliance isn't a known pair of teams (then every field is shown). */
export function allianceRoleFor(form: Pick<Form, "sections">, input: Omit<RoleSeedInput, "alliance"> & { alliance: "red" | "blue" | null; teams: readonly number[] | null | undefined; teamNumber: number | null }): string | null {
  const roles = allianceRoleIds(form);
  if (roles.length < 2 || input.alliance === null || !input.teams || input.teamNumber === null) return null;
  return assignAllianceRole({ seed: roleSeedText({ ...input, alliance: input.alliance }), teams: input.teams, teamNumber: input.teamNumber, roles });
}

/**
 * The form a practice session scouts with. A saved override of a game's match form that predates the alliance roles has no role block: both robots would then
 * record every objective and the alliance would count twice. When the program's built-in form splits roles and the resolved one does not, the built-in is used.
 */
export function formWithRoles<F extends Pick<Form, "sections">>(resolved: F, builtin: F | null | undefined): F {
  return builtin && hasAllianceRoles(builtin) && !hasAllianceRoles(resolved) ? builtin : resolved;
}

/** The label of a role, from the role field's options (`Hive`), or the id when the form doesn't list it. */
export function allianceRoleLabel(form: Pick<Form, "sections">, role: string): string {
  const field = form.sections.flatMap((s) => s.fields).find((f) => f.key === ALLIANCE_ROLE_KEY);
  return field?.options?.find((o) => o.value === role)?.label ?? role;
}

/**
 * Values an admin saved from the entry editor: if the entry has a role but now also holds a value of another role's field (the admin corrected it), the entry
 * records both roles, so the role is dropped (like an old entry). Otherwise a later rescore, which honours the role, would drop the admin's correction.
 */
export function reconcileRoleAfterEdit(form: Pick<Form, "sections">, values: FormValues): FormValues {
  const role = values[ALLIANCE_ROLE_KEY];
  if (typeof role !== "string" || role === "") return values;
  const holdsOtherRole = allianceRoleFields(form).some((f) => f.allianceRole !== role && isRecorded(values, f.key));
  return holdsOtherRole ? withoutRole(values) : values;
}
