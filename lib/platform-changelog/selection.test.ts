import { describe, expect, it } from "vitest";
import type { ChangeType } from "@/lib/changelog";
import { categoryState, deleteSelected, moveSelected, pruneSelection, toggleCategory, toggleKey } from "@/lib/platform-changelog/selection";

// SYNTHETIC fixture that mimics the problem seen after the import: the old section headings "Added:" and "Fixed:" became items (under New and Fixed),
// and every real note, already a separate item, landed under Improved.
type R = { key: number; category: ChangeType; text: string };
const rows: R[] = [
  { key: 1, category: "new", text: "Added:" },
  { key: 2, category: "fixed", text: "Fixed:" },
  { key: 3, category: "improved", text: "Synthetic note one" },
  { key: 4, category: "improved", text: "Synthetic note two" },
  { key: 5, category: "improved", text: "Synthetic note three" },
  { key: 6, category: "improved", text: "Synthetic note four" },
];

describe("selecting", () => {
  it("toggles one row without touching the others and never mutates", () => {
    const a = new Set<number>([1]);
    const b = toggleKey(a, 3);
    expect([...b].sort()).toEqual([1, 3]);
    expect([...a]).toEqual([1]);
    expect([...toggleKey(b, 1)]).toEqual([3]);
  });
  it("'select all' of a category selects exactly that group, reports its state, and toggles back off", () => {
    let sel = toggleCategory(rows, new Set(), "improved");
    expect([...sel].sort()).toEqual([3, 4, 5, 6]);
    expect(categoryState(rows, sel, "improved")).toBe("all");
    expect(categoryState(rows, sel, "new")).toBe("none");
    sel = toggleKey(sel, 4);
    expect(categoryState(rows, sel, "improved")).toBe("some");
    sel = toggleCategory(rows, sel, "improved"); // some -> all
    expect(categoryState(rows, sel, "improved")).toBe("all");
    sel = toggleCategory(rows, sel, "improved"); // all -> none
    expect([...sel]).toEqual([]);
  });
  it("selecting a category keeps what was selected elsewhere; an empty category selects nothing", () => {
    expect([...toggleCategory(rows, new Set([1]), "improved")].sort()).toEqual([1, 3, 4, 5, 6]);
    expect([...toggleCategory(rows, new Set(), "removed")]).toEqual([]);
  });
});

describe("the observed clean-up", () => {
  it("deletes the stray 'Added:' and 'Fixed:' items and leaves the notes untouched, in order", () => {
    const left = deleteSelected(rows, new Set([1, 2]));
    expect(left.map((r) => r.text)).toEqual(["Synthetic note one", "Synthetic note two", "Synthetic note three", "Synthetic note four"]);
  });
  it("moves chosen notes to Fixed: only the category changes (wording, order and the other rows stay)", () => {
    const moved = moveSelected(rows, new Set([3, 5]), "fixed");
    expect(moved.map((r) => [r.key, r.category])).toEqual([[1, "new"], [2, "fixed"], [3, "fixed"], [4, "improved"], [5, "fixed"], [6, "improved"]]);
    expect(moved.map((r) => r.text)).toEqual(rows.map((r) => r.text));
    expect(rows[2].category).toBe("improved"); // the original list is not mutated: that is what makes Undo possible
  });
  it("an empty selection changes nothing, and a selection never keeps a row that no longer exists", () => {
    expect(moveSelected(rows, new Set(), "removed")).toEqual(rows);
    expect(deleteSelected(rows, new Set())).toEqual(rows);
    const left = deleteSelected(rows, new Set([1, 2]));
    expect([...pruneSelection(left, new Set([1, 2, 3]))]).toEqual([3]);
  });
});
