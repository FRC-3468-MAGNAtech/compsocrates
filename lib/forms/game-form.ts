import type { GameField, GameFieldPoints, PointTableGameDefinition } from "@/config/games/definition";
import { incidentField, incidentSpecs } from "@/lib/forms/incidents";
import { pointsFor } from "@/lib/games/point-table";
import { systemFields } from "@/lib/forms/new-form";
import type { FieldType, Form, FormField, FormSection } from "@/lib/forms/types";

// The match scouting Form of a point-table game, GENERATED from its `GameDefinition` (config/games/*): sections, groups, labels, options, the points
// shown on each tile, one checkbox per incident, and the system pickers in front. Value keys are exactly the definition's field keys (the KEY CONVENTION in
// lib/games/types.ts: `auto_gridBottom`, `autoCoralL1`), so what the form stores is what `plugin.valuesToDoc` writes and `plugin.docToValues` reads.
//
// SCORING is the game plugin's own (`scoring: custom`, `game:<ID>`): the per-field rules below only put points on the tiles (display) and are ignored by
// `calculateScore` under custom scoring, so nothing is counted twice. Incidents are seven yes/no fields (`incidents_died` ...), converted to and from CS's
// `incidents: string[]` by `docToFormValues` / `formValuesToCsDoc` (data/cs/scouting.ts), the same as REBUILT's.

const none = { mode: "none" } as const;

const TYPE_OF_KIND: Record<GameField["kind"], FieldType> = {
  counter: "counter",
  toggle: "toggle",
  select: "select",
  number: "number",
  text: "text",
  textarea: "textarea",
};

const AGGREGATE_OF_KIND = { counter: "avg", toggle: "rate", select: "last", number: "avg", text: "last", textarea: "list" } as const;

/** The scoring rule shown on a field's tile (display only; the plugin does the real scoring). */
function displayScoring(points: GameFieldPoints | undefined): FormField["scoring"] {
  if (!points) return none;
  switch (points.mode) {
    case "perTally":
      return { mode: "perTally", value: points.value };
    case "whenOn":
      return { mode: "whenOn", value: points.value };
    default:
      return { mode: "byOption" };
  }
}

function toFormField(def: PointTableGameDefinition<string>, f: GameField): FormField {
  const options = f.options?.map((o) => ({ value: o.value, label: o.label, ...(f.points ? { points: pointsFor(f.points, o.value) } : {}) }));
  return {
    id: `f-${f.key}`,
    key: f.key,
    type: TYPE_OF_KIND[f.kind],
    label: f.label,
    ...(f.group ? { groupId: f.group } : {}),
    ...(f.helpText ? { helpText: f.helpText } : {}),
    ...(f.kind === "number" && f.key === def.penaltyPath && def.strings.penaltyHelp ? { helpText: def.strings.penaltyHelp } : {}),
    ...(f.kind === "counter" ? { min: 0, step: 1 } : {}),
    ...(f.kind === "number" ? { min: 0, decimals: 0 } : {}),
    ...(f.kind === "textarea" ? { placeholder: f.placeholder ?? def.strings.notesPlaceholder } : f.placeholder ? { placeholder: f.placeholder } : {}),
    ...(options ? { options } : {}),
    scoring: displayScoring(f.points),
    analytics: { include: true, category: f.category, aggregate: AGGREGATE_OF_KIND[f.kind] },
    ...(f.statRoles && f.statRoles.length > 0 ? { statRoles: [...f.statRoles] } : {}),
    ...(f.unrealisticAbove !== undefined ? { unrealisticAbove: f.unrealisticAbove } : {}),
  };
}

/** The match-scout Form for a point-table game. Pure: the same definition always gives the same form (its content hash is what an override is compared with). */
export function buildGameForm(def: PointTableGameDefinition<string>): Form {
  const sections: FormSection[] = [
    {
      id: "assigned-match",
      title: "Assigned Match",
      phase: "prematch",
      visible: true,
      fields: systemFields().filter((f) => f.type === "matchPicker"),
    },
  ];

  def.sections.forEach((section) => {
    const own = def.fields.filter((f) => f.section === section.id).map((f) => toFormField(def, f));
    const fields: FormField[] = [];
    if (section.phase === "prematch") fields.push(...systemFields().filter((f) => f.type !== "matchPicker"));
    if (section.phase === "misc") {
      // the incident checkboxes sit above the notes (the field that mirrors to the entry's comment), or at the end when there are none
      const incidents = incidentSpecs(def.incidents).map(incidentField);
      const at = own.findIndex((f) => f.statRoles?.includes("comments"));
      fields.push(...(at === -1 ? [...own, ...incidents] : [...own.slice(0, at), ...incidents, ...own.slice(at)]));
    } else {
      fields.push(...own);
    }
    sections.push({
      id: section.id,
      title: section.title,
      phase: section.phase,
      visible: true,
      ...(section.groups ? { groups: section.groups.map((g) => ({ id: g.id, title: g.title })) } : {}),
      fields,
    });
  });

  return {
    id: def.formId,
    name: def.label,
    description: def.strings.formDescription,
    formType: "match-scout",
    tags: [def.id.toLowerCase().replace(/_/g, "-"), String(def.year)],
    version: 1,
    status: "published",
    scoringEnabled: true,
    // the score is the game plugin's `scoreValues` (lib/games/point-table.ts), not a sum of the per-field display rules
    scoring: { mode: "custom", scorer: `game:${def.id}` },
    sections,
    origin: "built-in",
    createdBy: "system",
  };
}
