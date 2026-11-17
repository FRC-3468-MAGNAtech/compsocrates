import { describe, expect, it } from "vitest";
import {
  canHide,
  createGroup,
  deleteGroup,
  isItemCustomized,
  moveEntry,
  moveTargets,
  moveTo,
  rename,
  resetAll,
  resetItem,
  sameLayout,
  saveBlocker,
  setHidden,
  setIcon,
  toConfig,
} from "@/lib/sidebar/edit";
import { childrenOf, defaultEntries, normalizeEntries, parseSidebarConfig } from "@/lib/sidebar/layout";
import { FOOTER_ZONE, FORMS_GROUP_ID, MAX_SIDEBAR_ENTRIES } from "@/lib/sidebar/types";

const start = () => defaultEntries();
const order = (entries: ReturnType<typeof start>, parent: string | null) => childrenOf(entries, parent).map((e) => e.id);

describe("moving", () => {
  it("moveEntry puts an entry at a position of a zone or a group, and renumbers", () => {
    const e = start();
    const first = moveEntry(e, "dashboard", null, 0);
    expect(order(first, null).slice(0, 3)).toEqual(["dashboard", "event-selection", "assignments"]);
    const orders = first.filter((x) => x.parent === null).map((x) => x.order).sort((x, y) => x - y);
    expect(orders).toEqual(orders.map((_, i) => i));
    // into the middle of a group, out of a group, and to a position past the end (clamped)
    const inside = moveEntry(e, "analytics", FORMS_GROUP_ID, 2);
    expect(order(inside, FORMS_GROUP_ID).indexOf("analytics")).toBe(2);
    expect(order(moveEntry(inside, "analytics", null, 1), null)[1]).toBe("analytics");
    expect(order(moveEntry(e, "people", FOOTER_ZONE, 99), FOOTER_ZONE).at(-1)).toBe("people");
    // moving within the same parent keeps the others in their order
    const same = moveEntry(e, "event-selection", null, 2);
    expect(order(same, null).slice(0, 3)).toEqual(["assignments", "dashboard", "event-selection"]);
  });

  it("moveEntry never nests a group, never moves into a page or a missing parent, and a moved group keeps its pages", () => {
    const e = start();
    const g = createGroup(e, "Test");
    expect(moveEntry(g.entries, FORMS_GROUP_ID, g.id as string, 0)).toEqual(g.entries);
    expect(moveEntry(e, "people", "dashboard", 0)).toEqual(e);
    expect(moveEntry(e, "people", "no-such-group", 0)).toEqual(e);
    expect(moveEntry(e, "no-such-entry", null, 0)).toEqual(e);
    const moved = moveEntry(e, FORMS_GROUP_ID, FOOTER_ZONE, 0);
    expect(order(moved, FOOTER_ZONE)[0]).toBe(FORMS_GROUP_ID);
    expect(order(moved, FORMS_GROUP_ID)).toEqual(order(e, FORMS_GROUP_ID));
  });

  it("moves to a zone or a group, never a group into a group", () => {
    const e = start();
    expect(order(moveTo(e, "people", FOOTER_ZONE), FOOTER_ZONE).at(-1)).toBe("people");
    expect(order(moveTo(e, "people", FORMS_GROUP_ID), FORMS_GROUP_ID).at(-1)).toBe("people");
    const g = createGroup(e, "Test");
    expect(moveTo(g.entries, FORMS_GROUP_ID, g.id as string)).toEqual(g.entries);
    expect(moveTo(e, "people", "no-such-group")).toEqual(e);
    expect(moveTargets(e, "people").map((t) => t.value)).toEqual(["@main", FOOTER_ZONE, FORMS_GROUP_ID]);
    expect(moveTargets(e, FORMS_GROUP_ID).map((t) => t.value)).toEqual(["@main", FOOTER_ZONE]);
  });

  it("never mutates what it was given", () => {
    const e = start();
    const copy = JSON.stringify(e);
    moveEntry(e, "dashboard", null, 0);
    moveEntry(e, "analytics", FORMS_GROUP_ID, 0);
    setHidden(e, "people", true);
    rename(e, "people", "Folks");
    deleteGroup(e, FORMS_GROUP_ID);
    expect(JSON.stringify(e)).toBe(copy);
  });
});

describe("groups", () => {
  it("creates a group at the end of the main list with a name and icon", () => {
    const { entries, id } = createGroup(start(), "  Test  ", "Star");
    expect(id).not.toBeNull();
    const g = entries.find((x) => x.id === id);
    expect(g).toMatchObject({ kind: "group", parent: null, label: "Test", icon: "Star" });
    expect(order(entries, null).at(-1)).toBe(id);
  });

  it("refuses an empty name and a full sidebar", () => {
    expect(createGroup(start(), "   ").id).toBeNull();
    const full = Array.from({ length: MAX_SIDEBAR_ENTRIES }, (_, i) => ({ id: `x${i}`, kind: "page" as const, parent: null, order: i }));
    expect(createGroup(full, "More").id).toBeNull();
  });

  it("deletes a group and keeps its pages where the group was", () => {
    const e = start();
    const out = deleteGroup(e, FORMS_GROUP_ID);
    expect(out.find((x) => x.id === FORMS_GROUP_ID)).toBeUndefined();
    const top = order(out, null);
    const at = top.indexOf("lead-scout-form");
    expect(top.slice(at - 1, at + 1)).toEqual(["match-scout-form", "lead-scout-form"]);
    expect(top.indexOf("match-list")).toBeLessThan(top.indexOf("match-scout-form"));
    expect(top.indexOf("helper-form")).toBeLessThan(top.indexOf("analytics"));
    expect(normalizeEntries({ version: 1, rev: 1, entries: out }).length).toBe(out.length);
  });

  it("renames a group, and a page's label can be set and cleared; a group never loses its name", () => {
    const e = start();
    expect(rename(e, FORMS_GROUP_ID, "Scouting forms").find((x) => x.id === FORMS_GROUP_ID)?.label).toBe("Scouting forms");
    expect(rename(e, FORMS_GROUP_ID, "  ").find((x) => x.id === FORMS_GROUP_ID)?.label).toBe("Forms");
    const named = rename(e, "people", "Folks");
    expect(named.find((x) => x.id === "people")?.label).toBe("Folks");
    expect(rename(named, "people", "").find((x) => x.id === "people")?.label).toBeUndefined();
    expect(rename(e, "people", "x".repeat(100)).find((x) => x.id === "people")?.label).toHaveLength(40);
  });
});

describe("hide, icon, reset", () => {
  it("hides, shows and sets the icon", () => {
    let e = setHidden(start(), "people", true);
    expect(e.find((x) => x.id === "people")?.hidden).toBe(true);
    e = setHidden(e, "people", false);
    expect(e.find((x) => x.id === "people")?.hidden).toBeUndefined();
    e = setIcon(e, "people", "Star");
    expect(e.find((x) => x.id === "people")?.icon).toBe("Star");
    expect(setIcon(e, "people", undefined).find((x) => x.id === "people")?.icon).toBeUndefined();
  });

  it("the Admin Panel can never be hidden, and a layout that hides it or every page is blocked", () => {
    expect(canHide("admin-panel")).toBe(false);
    expect(canHide("people")).toBe(true);
    expect(saveBlocker(setHidden(start(), "admin-panel", true))).toMatch(/Admin Panel/);
    expect(saveBlocker(start().map((x) => (x.kind === "page" ? { ...x, hidden: true } : x)))).toMatch(/Admin Panel/); // hiding every page includes the Admin Panel, so that guard fires first
    expect(saveBlocker(start())).toBeNull();
  });

  it("resets one page to its default place and look, and everything to the default", () => {
    let e = rename(setHidden(moveTo(start(), "lead-scout-form", "@main"), "lead-scout-form", true), "lead-scout-form", "Leads");
    expect(isItemCustomized(e, "lead-scout-form")).toBe(true);
    e = resetItem(e, "lead-scout-form");
    expect(e.find((x) => x.id === "lead-scout-form")).toEqual({ id: "lead-scout-form", kind: "page", parent: FORMS_GROUP_ID, order: 1 });
    expect(sameLayout(e, start())).toBe(true);
    expect(isItemCustomized(e, "lead-scout-form")).toBe(false);
    expect(sameLayout(resetAll(), start())).toBe(true);
  });

  it("resets a form page to the top level when its default group is gone", () => {
    const e = resetItem(deleteGroup(start(), FORMS_GROUP_ID), "helper-form");
    expect(e.find((x) => x.id === "helper-form")?.parent).toBeNull();
  });
});

describe("saving and reading", () => {
  it("sameLayout notices real changes only", () => {
    const e = start();
    expect(sameLayout(e, [...e].reverse())).toBe(true);
    expect(sameLayout(e, moveEntry(e, "dashboard", null, 0))).toBe(false);
    expect(sameLayout(e, setHidden(e, "people", true))).toBe(false);
  });

  it("toConfig bumps nothing by itself: the caller passes the next rev, and orders are 0..n", () => {
    const c = toConfig(moveEntry(start(), "dashboard", null, 0), 4);
    expect(c.rev).toBe(4);
    expect(c.version).toBe(1);
    const top = c.entries.filter((x) => x.parent === null).map((x) => x.order).sort((a, b) => a - b);
    expect(top).toEqual(top.map((_, i) => i));
  });

  it("round-trips through the stored shape and drops bad entries, bad icons and long labels without throwing", () => {
    const c = toConfig(rename(setIcon(start(), "people", "Star"), "people", "Folks"), 2);
    expect(parseSidebarConfig(JSON.parse(JSON.stringify(c)))).toEqual(c);
    const messy = parseSidebarConfig({
      version: 1,
      rev: 3.5,
      entries: [null, "x", { id: 5 }, { id: "a", kind: "nope" }, { id: "people", kind: "page", parent: null, order: 1, icon: "NotAnIcon", label: "y".repeat(90) }, { id: "dashboard", kind: "page", parent: 7, order: 0 }],
    });
    expect(messy?.rev).toBe(0);
    expect(messy?.entries).toHaveLength(1);
    expect(messy?.entries[0].icon).toBeUndefined();
    expect(messy?.entries[0].label).toHaveLength(40);
  });
});
