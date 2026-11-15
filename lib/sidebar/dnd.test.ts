import { describe, expect, it } from "vitest";
import { FOOTER_DIVIDER_ID, flattenRows, projectDrop } from "@/lib/sidebar/dnd";
import { createGroup, moveEntry } from "@/lib/sidebar/edit";
import { childrenOf, defaultEntries } from "@/lib/sidebar/layout";
import { FOOTER_ZONE, FORMS_GROUP_ID } from "@/lib/sidebar/types";

const INDENT = 32;
const entries = defaultEntries();
const drop = (activeId: string, overId: string, offsetX = 0, list = entries) => projectDrop({ entries: list, activeId, overId, offsetX, indentWidth: INDENT });
const order = (list: typeof entries, parent: string | null) => childrenOf(list, parent).map((e) => e.id);
const apply = (activeId: string, overId: string, offsetX = 0, list = entries) => {
  const p = drop(activeId, overId, offsetX, list);
  expect(p, `${activeId} over ${overId}`).not.toBeNull();
  return moveEntry(list, activeId, (p as NonNullable<typeof p>).parent, (p as NonNullable<typeof p>).index);
};

describe("flattenRows", () => {
  const rows = flattenRows(entries);

  it("lists the main list, a divider, then the bottom block, with a group's pages under it", () => {
    expect(rows[0].id).toBe("event-selection");
    const at = rows.findIndex((r) => r.id === FORMS_GROUP_ID);
    expect(rows.slice(at + 1, at + 8).map((r) => [r.depth, r.parent])).toEqual(Array(7).fill([1, FORMS_GROUP_ID]));
    const divider = rows.findIndex((r) => r.id === FOOTER_DIVIDER_ID);
    expect(rows[divider].kind).toBe("divider");
    expect(rows.slice(divider + 1).every((r) => r.parent === FOOTER_ZONE && r.depth === 0)).toBe(true);
    expect(rows.slice(divider + 1).map((r) => r.id)).toEqual(order(entries, FOOTER_ZONE));
  });

  it("leaves a dragged group's pages out", () => {
    const collapsed = flattenRows(entries, FORMS_GROUP_ID);
    expect(collapsed.length).toBe(rows.length - 7);
    expect(collapsed.some((r) => r.parent === FORMS_GROUP_ID)).toBe(false);
  });
});

describe("projectDrop", () => {
  it("a row left where it is lands where it is", () => {
    expect(drop("dashboard", "dashboard")).toEqual({ parent: null, index: 2, depth: 0 });
    expect(drop("lead-scout-form", "lead-scout-form")).toEqual({ parent: FORMS_GROUP_ID, index: 1, depth: 1 });
    expect(drop("admin-panel", "admin-panel")).toEqual({ parent: FOOTER_ZONE, index: 0, depth: 0 });
  });

  it("reorders within the main list, up and down", () => {
    expect(order(apply("dashboard", "event-selection"), null).slice(0, 3)).toEqual(["dashboard", "event-selection", "assignments"]);
    expect(order(apply("event-selection", "dashboard"), null).slice(0, 3)).toEqual(["assignments", "dashboard", "event-selection"]);
  });

  it("dragging a page right under a group's last page puts it in the group; without the sideways drag it lands after the group, outside", () => {
    expect(drop("analytics", "helper-form", INDENT)).toEqual({ parent: FORMS_GROUP_ID, index: 6, depth: 1 });
    const inside = apply("analytics", "helper-form", INDENT);
    expect(order(inside, FORMS_GROUP_ID)).toEqual([...order(entries, FORMS_GROUP_ID).slice(0, 6), "analytics", "helper-form"]);
    expect(drop("analytics", "helper-form", 0)?.depth).toBe(0);
  });

  it("dragging a page right onto an empty group puts it in the group", () => {
    const { entries: withGroup, id } = createGroup(entries, "Test");
    expect(drop("dashboard", id as string, INDENT, withGroup)).toEqual({ parent: id, index: 0, depth: 1 });
    expect(order(apply("dashboard", id as string, INDENT, withGroup), id)).toEqual(["dashboard"]);
  });

  it("dragging a group's page down past the end of the group, or left, takes it out", () => {
    expect(drop("helper-form", "analytics")).toMatchObject({ parent: null, depth: 0 });
    const out = apply("helper-form", "analytics");
    expect(order(out, null).indexOf("helper-form")).toBe(order(out, null).indexOf("analytics") + 1);
    expect(drop("lead-scout-form", "lead-scout-form", -INDENT)).toMatchObject({ parent: null, depth: 0 });
  });

  it("never nests a page under a plain page, and never nests a group", () => {
    expect(drop("analytics", "assignments", INDENT * 3)).toMatchObject({ parent: null, depth: 0 });
    expect(drop(FORMS_GROUP_ID, FORMS_GROUP_ID, INDENT * 3)).toMatchObject({ parent: null, depth: 0 });
    const { entries: withGroup, id } = createGroup(entries, "Test");
    expect(drop(FORMS_GROUP_ID, id as string, INDENT, withGroup)?.depth).toBe(0);
  });

  it("crossing the divider moves a page or a group into or out of the bottom block", () => {
    expect(drop("people", FOOTER_DIVIDER_ID)).toMatchObject({ parent: FOOTER_ZONE, index: 0 }); // dragged down over the divider: first in the bottom block
    expect(order(apply("people", "admin-panel"), FOOTER_ZONE)[1]).toBe("people");
    const up = apply("admin-panel", FOOTER_DIVIDER_ID); // dragged up over the divider: end of the main list
    expect(order(up, null).at(-1)).toBe("admin-panel");
    expect(order(up, FOOTER_ZONE)).not.toContain("admin-panel");
    const group = apply(FORMS_GROUP_ID, FOOTER_DIVIDER_ID);
    expect(order(group, FOOTER_ZONE)[0]).toBe(FORMS_GROUP_ID);
    expect(order(group, FORMS_GROUP_ID)).toEqual(order(entries, FORMS_GROUP_ID)); // its pages came along
  });

  it("answers null for a row that is not in the list, and never for the divider as the dragged row", () => {
    expect(drop("nope", "dashboard")).toBeNull();
    expect(drop("dashboard", "nope")).toBeNull();
    expect(drop(FOOTER_DIVIDER_ID, "dashboard")).toBeNull();
  });

  it("a sideways drag of less than half a level changes nothing", () => {
    expect(drop("lead-scout-form", "lead-scout-form", -INDENT / 3)?.depth).toBe(1);
  });
});
