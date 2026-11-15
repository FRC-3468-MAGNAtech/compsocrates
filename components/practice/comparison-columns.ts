/**
 * The column count of the practice results Comparison row: one tile per scouted robot plus the penalties and total tiles (a match with no official score
 * has no penalties tile). One table for the solo and the live results screens, with entries for 2-robot and 3-robot alliances.
 * Full literal class names so Tailwind picks them up.
 */
export const COMPARISON_COLUMNS: Record<number, string> = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4", 5: "sm:grid-cols-5" };

/** The grid class for `robots` tiles; `officialScore` adds the penalties tile. */
export function comparisonColumns(robots: number, officialScore: boolean): string {
  return COMPARISON_COLUMNS[robots + (officialScore ? 2 : 1)] ?? "sm:grid-cols-4";
}
