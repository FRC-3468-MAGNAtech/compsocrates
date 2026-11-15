import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidebarEditor, SidebarPanelView, SidebarPreview, type SidebarPanelViewProps } from "./sidebar-panel";
import { createGroup, setHidden } from "@/lib/sidebar/edit";
import { defaultEntries } from "@/lib/sidebar/layout";

const html = (node: React.ReactNode) => renderToString(node).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const label = (item: { label: string }) => item.label;
const noop = () => {};

/** The opening tag of the element carrying this aria-label (a button or a switch). */
const tagOf = (out: string, ariaLabel: string): string => {
  const at = out.indexOf(`aria-label="${ariaLabel}"`);
  expect(at, `no element labelled "${ariaLabel}"`).toBeGreaterThan(-1);
  return out.slice(out.lastIndexOf("<", at), out.indexOf(">", at) + 1);
};
const isDisabled = (tag: string) => /\sdisabled(=|\s|>)/.test(tag);

const view = (over: Partial<SidebarPanelViewProps> = {}): SidebarPanelViewProps => ({
  loaded: true,
  loadError: null,
  entries: defaultEntries(),
  program: "frc",
  labelOf: label,
  dirty: false,
  saving: false,
  conflict: false,
  saveError: null,
  notice: null,
  onChange: noop,
  onSave: noop,
  onDiscard: noop,
  onResetAll: noop,
  onReloadLatest: noop,
  ...over,
});

describe("SidebarEditor", () => {
  const out = html(<SidebarEditor entries={defaultEntries()} onChange={noop} labelOf={label} program="frc" />);

  it("lists every page and the Forms group with buttons for move, indent, outdent, rename, reset and hide (no drag needed)", () => {
    expect(out).toContain("Main list");
    expect(out).toContain("Bottom block");
    expect(out).toContain("Forms");
    for (const text of ["Move Dashboard up", "Move Dashboard down", "Indent Analytics into the group above", "Outdent Helper Form out of its group", "Rename or change the icon of Dashboard", "Show Dashboard in the sidebar", "Delete the group Forms"]) {
      expect(out).toContain(`aria-label="${text}"`);
    }
  });

  it("disables what cannot apply: the first item cannot move up, a top-level page cannot outdent, the Admin Panel cannot be hidden", () => {
    expect(isDisabled(tagOf(out, "Move Active Events up"))).toBe(true);
    expect(isDisabled(tagOf(out, "Move Active Events down"))).toBe(false);
    expect(isDisabled(tagOf(out, "Outdent Dashboard out of its group"))).toBe(true);
    expect(isDisabled(tagOf(out, "Indent Analytics into the group above"))).toBe(false);
    expect(isDisabled(tagOf(out, "Show Admin Panel in the sidebar"))).toBe(true);
    expect(isDisabled(tagOf(out, "Show Dashboard in the sidebar"))).toBe(false);
    expect(out).toContain("Always shown");
  });

  it("marks hidden, renamed and greyed-out items", () => {
    const entries = setHidden(defaultEntries(), "people", true).map((e) => (e.id === "dashboard" ? { ...e, label: "Home" } : e));
    const ftc = html(<SidebarEditor entries={entries} onChange={noop} labelOf={label} program="ftc" />);
    expect(ftc).toContain("Hidden from the sidebar");
    expect(ftc).toContain("Renamed (was Dashboard)");
    expect(ftc).toContain("Greyed out: not in this program yet"); // Judge Book in FTC
    expect(html(<SidebarEditor entries={entries} onChange={noop} labelOf={label} program="frc" />)).not.toContain("Greyed out");
  });

  it("shows a new empty group and says it is not shown until it has a page", () => {
    const { entries } = createGroup(defaultEntries(), "Test");
    const result = html(<SidebarEditor entries={entries} onChange={noop} labelOf={label} program="frc" />);
    expect(result).toContain("Test");
    expect(result).toContain("Empty group");
  });

  it("locks every control while saving", () => {
    const busy = html(<SidebarEditor entries={defaultEntries()} onChange={noop} labelOf={label} program="frc" disabled />);
    expect(isDisabled(tagOf(busy, "Move Dashboard down"))).toBe(true);
    expect(isDisabled(tagOf(busy, "Rename or change the icon of Dashboard"))).toBe(true);
  });
});

describe("SidebarPreview", () => {
  it("shows the Forms group with its form pages, from the same resolver as the sidebar", () => {
    const out = html(<SidebarPreview entries={defaultEntries()} program="frc" labelOf={label} />);
    expect(out).toContain("Forms");
    expect(out).toContain("Lead Scout Form");
    expect(out).toContain("Admin Panel");
    expect(out).not.toContain("lock an admin out");
  });

  it("drops hidden pages and an empty group, and warns when the layout would lock an admin out", () => {
    const hidden = setHidden(defaultEntries(), "people", true);
    expect(html(<SidebarPreview entries={hidden} program="frc" labelOf={label} />)).not.toContain("People");
    const locked = html(<SidebarPreview entries={defaultEntries().map((e) => (e.id === "admin-panel" ? { ...e, hidden: true } : e))} program="frc" labelOf={label} />);
    expect(locked).toContain("lock an admin out");
    expect(locked).toContain("Admin Panel"); // the default layout is shown instead
  });
});

describe("SidebarPanelView states", () => {
  it("shows a loading skeleton, not the editor, until the layout has been read", () => {
    const out = html(<SidebarPanelView {...view({ loaded: false })} />);
    expect(out).not.toContain("sidebar-editor");
    expect(out).not.toContain("Reset everything");
  });

  it("explains that hiding is cosmetic and that members see changes after a reload", () => {
    const out = html(<SidebarPanelView {...view()} />);
    expect(out).toContain("after they reload");
    expect(out).toContain("does not block the page");
    expect(out).toContain("Page Access decides");
  });

  it("keeps Save off until there is a change, and Discard too", () => {
    const clean = html(<SidebarPanelView {...view()} />);
    expect(isDisabled(clean.slice(clean.lastIndexOf("<button", clean.indexOf(">Save<")), clean.indexOf(">Save<") + 1))).toBe(true);
    const dirty = html(<SidebarPanelView {...view({ dirty: true })} />);
    expect(dirty).toContain("Unsaved changes");
    expect(isDisabled(dirty.slice(dirty.lastIndexOf("<button", dirty.indexOf(">Save<")), dirty.indexOf(">Save<") + 1))).toBe(false);
  });

  it("shows a version conflict as an alert, offers the latest layout, and blocks Save", () => {
    const out = html(<SidebarPanelView {...view({ dirty: true, conflict: true })} />);
    expect(out).toContain('role="alert"');
    expect(out).toContain("Someone else changed the sidebar");
    expect(out).toContain("Load the latest layout");
    expect(isDisabled(out.slice(out.lastIndexOf("<button", out.indexOf(">Save<")), out.indexOf(">Save<") + 1))).toBe(true);
  });

  it("shows a failed read and a failed save in the panel, and the saved notice when it worked", () => {
    expect(html(<SidebarPanelView {...view({ loadError: "Could not read the sidebar layout (permission-denied)." })} />)).toContain("permission-denied");
    expect(html(<SidebarPanelView {...view({ saveError: "Could not save the sidebar." })} />)).toContain("Could not save the sidebar.");
    expect(html(<SidebarPanelView {...view({ notice: "Saved. Members see the new layout." })} />)).toContain("Saved. Members see the new layout.");
  });

  it("blocks saving a layout that hides the Admin Panel, and says why", () => {
    const entries = defaultEntries().map((e) => (e.id === "admin-panel" ? { ...e, hidden: true } : e));
    const out = html(<SidebarPanelView {...view({ entries, dirty: true })} />);
    expect(out).toContain("The Admin Panel cannot be hidden");
    expect(isDisabled(out.slice(out.lastIndexOf("<button", out.indexOf(">Save<")), out.indexOf(">Save<") + 1))).toBe(true);
  });
});
