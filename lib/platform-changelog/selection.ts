import type { ChangeType } from "@/lib/changelog";

// Session 9: multi-select for the owner's item list. Pure, over any row that has a stable `key` and a `category`; the editor keeps the selected keys.
// Wording is never touched here: a move changes only the category, a delete removes whole rows.

type Row = { key: number; category: ChangeType };

export const toggleKey = (selected: ReadonlySet<number>, key: number): Set<number> => {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

/** How much of a category group is selected, for its "select all" checkbox. */
export function categoryState(rows: readonly Row[], selected: ReadonlySet<number>, category: ChangeType): "none" | "some" | "all" {
  const inGroup = rows.filter((r) => r.category === category);
  const n = inGroup.filter((r) => selected.has(r.key)).length;
  return n === 0 ? "none" : n === inGroup.length ? "all" : "some";
}

/** "Select all" of one category: selects every row of it, or (when they are all selected already) deselects them. Other rows keep their state. */
export function toggleCategory(rows: readonly Row[], selected: ReadonlySet<number>, category: ChangeType): Set<number> {
  const next = new Set(selected);
  const inGroup = rows.filter((r) => r.category === category);
  const all = inGroup.length > 0 && inGroup.every((r) => next.has(r.key));
  for (const r of inGroup) {
    if (all) next.delete(r.key);
    else next.add(r.key);
  }
  return next;
}

/** The selected rows moved to a category (same order, same everything else). */
export const moveSelected = <R extends Row>(rows: readonly R[], selected: ReadonlySet<number>, category: ChangeType): R[] => rows.map((r) => (selected.has(r.key) ? { ...r, category } : r));

/** The rows without the selected ones. */
export const deleteSelected = <R extends Row>(rows: readonly R[], selected: ReadonlySet<number>): R[] => rows.filter((r) => !selected.has(r.key));

/** Keys that still exist (after a delete, an undo or a reload): a selection never points at a row that is gone. */
export const pruneSelection = (rows: readonly Row[], selected: ReadonlySet<number>): Set<number> => new Set(rows.filter((r) => selected.has(r.key)).map((r) => r.key));
