import { DEFAULT_SEASON_ID } from "@/lib/seasons";

// Which summary module reads a non-match form's entries. The six forms exist twice (docs/ROUTES.md D1): the REBUILT set that the CS adapter persists
// ("pit-scout-v1", ...) and the BIOBUZZ set ("biobuzz-pit-scout-v1", ...). Their stored `values` have different keys, so each set has its own summary module:
//   - "rebuilt": lib/analytics/form-summaries-rebuilt.ts (the keys of data/cs/form-field-keys.ts)
//   - "biobuzz": lib/analytics/form-summaries.ts (the original CE module)
// Components pick a module ONCE, here, from a form id or a season; they never branch on individual fields. Pure.

export type SummaryFlavor = "rebuilt" | "biobuzz";

const BIOBUZZ_PREFIX = "biobuzz-";

/** The flavor of a season: BIOBUZZ for the FTC program's season, REBUILT for every other one (REBUILT, and the read-only FRC games the adapter attributes to it). */
export const summaryFlavorForSeason = (seasonId: string = DEFAULT_SEASON_ID): SummaryFlavor => (seasonId === "biobuzz" ? "biobuzz" : "rebuilt");

/**
 * The flavor of a form id: a `biobuzz-*` built-in is BIOBUZZ, one of the adapter's ids ("pit-scout-v1") is REBUILT. A custom form id says nothing, so it follows the
 * running program's season (what the analytics pages are showing).
 */
export function summaryFlavorForFormId(formId: string, seasonId: string = DEFAULT_SEASON_ID): SummaryFlavor {
  if (formId.startsWith(BIOBUZZ_PREFIX)) return "biobuzz";
  if (/^(pit-scout|lead-scout|team-strategy|match-strategy|drive-reflection|helper)-v\d+$/.test(formId)) return "rebuilt";
  return summaryFlavorForSeason(seasonId);
}
