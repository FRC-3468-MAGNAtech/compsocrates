import { STANDARD_INCIDENTS, type GameIncident } from "@/config/games";
import type { FormField } from "@/lib/forms/types";

// CS stores what happened in a match as one list (`incidents: ["died", "yellow-card"]`). The form asks it as one checkbox per incident, so each can carry
// its own stat roles (reliability, died ...) and its own analytics column. These helpers convert between the two, for every game: the incident list
// of a game is part of its definition (`GameDefinition.incidents`), and all three games share the standard seven.

/** The form key of an incident (`never-started` -> `incidents_neverStarted`). */
export const incidentKey = (value: string): string => `incidents_${value.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}`;

export type IncidentSpec = { value: string; key: string; label: string; statRoles: NonNullable<FormField["statRoles"]> };

/** A game's incidents with the form key each one is stored under. */
export const incidentSpecs = (incidents: readonly GameIncident[] = STANDARD_INCIDENTS): IncidentSpec[] =>
  incidents.map((i) => ({ value: i.value, key: incidentKey(i.value), label: i.label, statRoles: [...(i.statRoles ?? [])] }));

/** CS's `incidents: string[]` from the form's incident checkboxes (what a game plugin's `valuesToDoc` reads). */
export function incidentsFromValues(values: Record<string, unknown>, incidents: readonly GameIncident[] = STANDARD_INCIDENTS): string[] {
  return incidentSpecs(incidents)
    .filter((i) => values[i.key] === true)
    .map((i) => i.value);
}

/** The incident checkboxes from CS's `incidents: string[]` (an entry that is not in the game's list is ignored). */
export function incidentValuesFromList(list: unknown, incidents: readonly GameIncident[] = STANDARD_INCIDENTS): Record<string, boolean> {
  const set = new Set(Array.isArray(list) ? list.map((v) => String(v)) : []);
  return Object.fromEntries(incidentSpecs(incidents).map((i) => [i.key, set.has(i.value)]));
}

/** One incident as a form checkbox. */
export const incidentField = (i: IncidentSpec): FormField => ({
  id: `f-${i.key}`,
  key: i.key,
  type: "checkbox",
  label: i.label,
  scoring: { mode: "none" },
  analytics: { include: true, category: "Incidents", aggregate: "rate" },
  ...(i.statRoles.length > 0 ? { statRoles: [...i.statRoles] } : {}),
});
