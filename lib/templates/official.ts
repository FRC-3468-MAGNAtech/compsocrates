import { BRAND } from "@/config/brand";
import { GAME_DEFINITIONS, GAME_ID_LIST } from "@/config/games";
import { BUILTIN_FORMS, GAME_FORMS, NON_MATCH_FORM_IDS, type NonMatchFormType } from "@/lib/forms/builtin";
import { createBlankForm } from "@/lib/forms/new-form";
import type { Form } from "@/lib/forms/types";
import { buildTemplateContent, type TemplateContent } from "@/lib/templates/build";

// P23: the templates we ship. A platform owner publishes them with "Seed official templates" (Admin Panel > Template Review): they are created from the game
// registry's built-in forms (one match scout template per game), the six non-match forms (REBUILT only, as in CS) and the blank starter, public and marked
// official, under the author name `BRAND.name`. Seeding again only adds a new version when the content has changed (accounts that used the template then see
// "Update available").

export const OFFICIAL_AUTHOR = BRAND.name;

export type OfficialTemplate = { id: string; content: TemplateContent };

function blankStarter(): Form {
  // Scoring is off: a blank form has nothing that scores yet, and a form that scores but doesn't would be unpublishable. Turn it on in Form settings.
  return { ...createBlankForm({ id: "blank", name: "Blank (standard phases)", createdBy: "", description: "Pre-Match, Autonomous, Teleoperated, Endgame and Misc, with the locked system fields. Scoring is off: turn it on in Form settings when you add points." }), scoringEnabled: false, tags: ["starter"] };
}

/** The non-match templates: the form type, the template's name and its tags (the name is the form's own). */
const NON_MATCH_TEMPLATES: readonly { type: NonMatchFormType; slug: string; name: string; tags: string[] }[] = [
  { type: "lead-scout", slug: "lead-scout", name: "Lead Scout", tags: ["lead scout", "alliance", "official"] },
  { type: "match-strategy", slug: "match-strategy", name: "Match Strategy", tags: ["strategy", "alliance", "official"] },
  { type: "drive-reflection", slug: "drive-reflection", name: "Drive Reflection", tags: ["reflection", "alliance", "official"] },
  { type: "pit-scout", slug: "pit-scout", name: "Pit Scout", tags: ["pit scout", "team", "official"] },
  { type: "team-strategy", slug: "team-strategy", name: "Team Strategy", tags: ["strategy", "team", "official"] },
  { type: "helper", slug: "helper", name: "Helper", tags: ["helper", "team", "official"] },
];

export function officialTemplates(): OfficialTemplate[] {
  const entries: { id: string; result: ReturnType<typeof buildTemplateContent> }[] = [];

  // one match scout template per game, from the game registry
  for (const gameId of GAME_ID_LIST) {
    const def = GAME_DEFINITIONS[gameId];
    const form = GAME_FORMS[def.formId];
    entries.push({
      id: `official-${gameId.toLowerCase().replace(/_/g, "-")}`,
      result: buildTemplateContent({ form, name: `${def.label} Match Scout`, description: form.description, tags: [gameId.toLowerCase().replace(/_/g, "-"), String(def.year), "match scout", "official"] }),
    });
  }

  entries.push({
    id: "official-blank",
    result: buildTemplateContent({ form: blankStarter(), name: "Blank (standard phases)", description: "The five standard categories and the locked system fields, ready to build on. Scoring is off until you turn it on.", tags: ["starter", "blank"] }),
  });

  // the match-based (P28) and team-based (P29) forms are public templates too, so another account can start from them
  for (const t of NON_MATCH_TEMPLATES) {
    const form = BUILTIN_FORMS[NON_MATCH_FORM_IDS[t.type]];
    entries.push({ id: `official-${t.slug}`, result: buildTemplateContent({ form, name: t.name, description: form.description, tags: t.tags }) });
  }

  const failed = entries.flatMap((e) => (e.result.ok ? [] : e.result.errors));
  if (failed.length > 0) throw new Error(`The official templates must be valid: ${failed.join("; ")}`);
  return entries.map((e) => ({ id: e.id, content: (e.result as { ok: true; content: TemplateContent }).content }));
}
