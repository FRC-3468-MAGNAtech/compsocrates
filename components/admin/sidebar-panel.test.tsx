import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidebarEditor, SidebarPanelView, SidebarPreview, type SidebarPanelViewProps } from "./sidebar-panel";
import { createGroup, setHidden } from "@/lib/sidebar/edit";
import { NAV_PAGES } from "@/lib/nav";
import { defaultEntries, pageLabel } from "@/lib/sidebar/layout";

const html = (node: React.ReactNode) => renderToString(node).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const label = (item: { label: string }) => item.label;
const noop = () => {};
const pageCount = NAV_PAGES.length;

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

  it("is a drag and drop list: every page and group has a drag handle, and there are no up/down/indent arrow buttons", () => {
    expect(out).toContain("Main list");
    expect(out).toContain("Bottom block");
    for (const text of ["Drag Dashboard", "Drag Forms", "Drag Admin Panel", "Drag Helper Form"]) expect(out).toContain(`aria-label="${text}"`);
    expect((out.match(/aria-label="Drag /g) ?? []).length).toBe(pageCount + 1); // every page, plus the Forms group
    for (const gone of ["Move Dashboard up", "Move Dashboard down", "Indent ", "Outdent "]) expect(out).not.toContain(gone);
    expect(out).toContain("Drag a row by its handle");
  });

  it("draws the sidebar as one list: groups at depth 0 with their pages at depth 1, then the bottom block under a divider", () => {
    expect(out).toMatch(/data-entry="forms"[^>]*data-depth="0"/);
    expect(out).toMatch(/data-entry="helper-form"[^>]*data-depth="1"/);
    expect(out).toMatch(/data-entry="dashboard"[^>]*data-depth="0"/);
    expect(out.indexOf("data-divider")).toBeGreaterThan(out.indexOf('data-entry="team-management"'));
    expect(out.indexOf("data-divider")).toBeLessThan(out.indexOf('data-entry="admin-panel"'));
    expect(out).toContain("Group of 7");
  });

  it("keeps rename, reset, hide and delete-group, and the Admin Panel can never be hidden", () => {
    for (const text of ["Rename, change the icon or move Dashboard", "Show Dashboard in the sidebar", "Delete the group Forms", "Reset Dashboard to its default"]) expect(out).toContain(`aria-label="${text}"`);
    expect(isDisabled(tagOf(out, "Show Admin Panel in the sidebar"))).toBe(true);
    expect(isDisabled(tagOf(out, "Show Dashboard in the sidebar"))).toBe(false);
    expect(isDisabled(tagOf(out, "Reset Dashboard to its default"))).toBe(true); // nothing to reset yet
    expect(out).toContain("Always shown");
  });

  it("marks hidden, renamed and greyed-out items", () => {
    const entries = setHidden(defaultEntries(), "people", true).map((e) => (e.id === "dashboard" ? { ...e, label: "Home" } : e));
    const ftc = html(<SidebarEditor entries={entries} onChange={noop} labelOf={label} program="ftc" />);
    expect(ftc).toContain("Hidden from the sidebar");
    expect(ftc).toContain("Renamed (was Dashboard)");
    expect(ftc).toContain("Greyed out: not in this program yet"); // Judge Book in FTC
    expect(isDisabled(tagOf(ftc, "Reset Home to its default"))).toBe(false);
    expect(html(<SidebarEditor entries={entries} onChange={noop} labelOf={label} program="frc" />)).not.toContain("Greyed out");
  });

  it("shows a new empty group and says how to fill it", () => {
    const { entries } = createGroup(defaultEntries(), "Test");
    const result = html(<SidebarEditor entries={entries} onChange={noop} labelOf={label} program="frc" />);
    expect(result).toContain("Test");
    expect(result).toContain("Empty group");
  });

  it("locks every control while saving, the drag handles too", () => {
    const busy = html(<SidebarEditor entries={defaultEntries()} onChange={noop} labelOf={label} program="frc" disabled />);
    expect(isDisabled(tagOf(busy, "Drag Dashboard"))).toBe(true);
    expect(isDisabled(tagOf(busy, "Rename, change the icon or move Dashboard"))).toBe(true);
    expect(isDisabled(tagOf(out, "Drag Dashboard"))).toBe(false);
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

describe("sync with the other program", () => {
  const sync = (over: Partial<NonNullable<SidebarPanelViewProps["sync"]>> = {}) => ({ otherName: "FTC", busy: false, message: null, onSend: noop, onPull: noop, ...over });
  const buttonTag = (out: string, text: string) => out.slice(out.lastIndexOf("<button", out.indexOf(text)), out.indexOf(text) + text.length);

  it("offers to send this layout to the other program or bring its layout here", () => {
    const out = html(<SidebarPanelView {...view({ sync: sync() })} />);
    expect(out).toContain("Sync with FTC");
    expect(out).toContain("Send this layout to FTC");
    expect(out).toContain("Copy FTC's layout here");
    expect(isDisabled(buttonTag(out, "Send this layout to FTC"))).toBe(false);
  });

  it("only sends a saved layout: sending waits for Save, and never during a conflict or while busy", () => {
    const dirty = html(<SidebarPanelView {...view({ dirty: true, sync: sync() })} />);
    expect(isDisabled(buttonTag(dirty, "Send this layout to FTC"))).toBe(true);
    expect(dirty).toContain("Save your changes first");
    expect(isDisabled(buttonTag(html(<SidebarPanelView {...view({ conflict: true, sync: sync() })} />), "Send this layout to FTC"))).toBe(true);
    const busy = html(<SidebarPanelView {...view({ sync: sync({ busy: true }) })} />);
    expect(isDisabled(buttonTag(busy, "Send this layout to FTC"))).toBe(true);
  });

  it("shows how it went: an alert for a failure, a status for a success", () => {
    expect(html(<SidebarPanelView {...view({ sync: sync({ message: { ok: false, text: "FTC refused it." } }) })} />)).toMatch(/role="alert"[^>]*>FTC refused it./);
    expect(html(<SidebarPanelView {...view({ sync: sync({ message: { ok: true, text: "Sent." } }) })} />)).toMatch(/role="status"[^>]*>Sent./);
  });

  it("has no sync card when there is no other program", () => {
    expect(html(<SidebarPanelView {...view()} />)).not.toContain("Sync with");
  });
});

describe("sidebar text", () => {
  it("the sidebar and the builder name pages by their own label, never a game-prefixed form name (owner decision, Session E)", () => {
    for (const file of ["components/layout/sidebar.tsx", "components/admin/sidebar-panel.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/useNavLabel|useFormDisplayNames|formDisplayName/);
      expect(source, file).toContain("pageLabel");
    }
    const lead = NAV_PAGES.find((p) => p.id === "lead-scout-form");
    expect(lead && pageLabel(lead)).toBe("Lead Scout Form");
    expect(html(<SidebarPreview entries={defaultEntries()} program="frc" labelOf={pageLabel} />)).toContain("Lead Scout Form");
  });
});
