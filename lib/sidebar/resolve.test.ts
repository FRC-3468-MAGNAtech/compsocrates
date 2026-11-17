import { describe, expect, it } from "vitest";
import { BarChart3, Star } from "lucide-react";
import { NAV_PAGES, mainNav, secondaryNav } from "@/lib/nav";
import { canAccessPage, defaultPageAccessConfig, type AccessUser } from "@/lib/page-access/access";
import { defaultEntries, normalizeEntries, parseSidebarConfig } from "@/lib/sidebar/layout";
import { resolveSidebar, type ResolveInput, type SidebarNode } from "@/lib/sidebar/resolve";
import { FOOTER_ZONE, FORMS_GROUP_ID, SIDEBAR_CONFIG_VERSION, type SidebarConfig, type SidebarEntry } from "@/lib/sidebar/types";

const cfg = (entries: SidebarEntry[], rev = 1): SidebarConfig => ({ version: SIDEBAR_CONFIG_VERSION, rev, entries });
const input = (over: Partial<ResolveInput> = {}): ResolveInput => ({ program: "frc", isAdmin: true, can: () => true, config: null, ...over });
const flat = (nodes: SidebarNode[]): SidebarNode[] => nodes.flatMap((n) => [n, ...(n.children ?? [])]);
const ids = (nodes: SidebarNode[]) => flat(nodes).map((n) => n.id);
const topIds = (nodes: SidebarNode[]) => nodes.map((n) => n.id);
const FORM_IDS = ["match-scout-form", "lead-scout-form", "match-strategy-form", "drive-reflection-form", "pit-scout-form", "team-strategy-form", "helper-form"];
/** The default entries with some entries replaced or added. */
const withEntries = (change: (e: SidebarEntry[]) => SidebarEntry[]) => cfg(change(defaultEntries()));

describe("default layout (no config)", () => {
  it("has a Forms group holding every form page, in the code's order", () => {
    const out = resolveSidebar(input());
    const forms = out.main.find((n) => n.id === FORMS_GROUP_ID);
    expect(forms?.kind).toBe("group");
    expect(forms?.label).toBe("Forms");
    expect(forms?.children?.map((c) => c.id)).toEqual(FORM_IDS);
    expect(out.ignoredConfig).toBe(false);
  });

  it("keeps non-form pages (Analytics, Practice Scouting, Judge Book) outside the group, and today's order otherwise", () => {
    const out = resolveSidebar(input());
    expect(topIds(out.main)).toEqual(["event-selection", "assignments", "dashboard", "match-list", "forms", "analytics", "practice-scouting", "scout-accuracy", "my-scouting", "judge-book", "people", "achievements", "team-management"]);
    expect(topIds(out.footer)).toEqual(secondaryNav.map((i) => i.id));
  });

  it("shows exactly the code's pages for an admin who can open everything", () => {
    const out = resolveSidebar(input());
    expect(ids([...out.main, ...out.footer]).filter((id) => id !== FORMS_GROUP_ID).sort()).toEqual(NAV_PAGES.map((p) => p.id).sort());
  });

  it("is the same for every team that never customized (null, an empty config, an unreadable one)", () => {
    const base = resolveSidebar(input());
    expect(resolveSidebar(input({ config: parseSidebarConfig({ version: 1, rev: 0, entries: [] }) }))).toEqual(base);
    expect(resolveSidebar(input({ config: parseSidebarConfig({ version: 99, rev: 1, entries: [{ id: "x" }] }) }))).toEqual(base);
    expect(resolveSidebar(input({ config: parseSidebarConfig("garbage") }))).toEqual(base);
  });

  it("uses the label helper for form pages and the code's label otherwise", () => {
    const out = resolveSidebar(input({ labelOf: (item) => (item.formType ? `REBUILT ${item.label}` : item.label) }));
    const forms = out.main.find((n) => n.id === FORMS_GROUP_ID);
    expect(forms?.children?.[0].label).toBe("REBUILT Match Scout Form");
    expect(out.main.find((n) => n.id === "dashboard")?.label).toBe("Dashboard");
  });
});

describe("config handling", () => {
  it("ignores entries for pages that no longer exist, duplicate ids, and a group that clashes with a page id", () => {
    const config = withEntries((e) => [
      ...e,
      { id: "retired-page", kind: "page", parent: null, order: 0 },
      { id: "dashboard", kind: "page", parent: null, order: 99 },
      { id: "dashboard", kind: "group", parent: null, order: 100, label: "Clash" },
    ]);
    const out = resolveSidebar(input({ config }));
    const all = ids([...out.main, ...out.footer]);
    expect(all).not.toContain("retired-page");
    expect(all.filter((id) => id === "dashboard")).toHaveLength(1);
    expect(out.main.find((n) => n.id === "dashboard")?.kind).toBe("page");
  });

  it("appends a code page the config does not mention, so a new page never vanishes", () => {
    // A config saved when only a few pages existed.
    const config = cfg([
      { id: "dashboard", kind: "page", parent: null, order: 0 },
      { id: "admin-panel", kind: "page", parent: FOOTER_ZONE, order: 0 },
    ]);
    const out = resolveSidebar(input({ config }));
    expect(ids([...out.main, ...out.footer]).sort()).toEqual(NAV_PAGES.map((p) => p.id).sort());
    expect(out.main[0].id).toBe("dashboard");
    // Footer pages come back in the footer; a form page with no Forms group in the config lands at the top level.
    expect(topIds(out.footer)).toContain("changelog");
    expect(topIds(out.main)).toContain("lead-scout-form");
  });

  it("appends a missing form page to the END of the Forms group when the group exists", () => {
    const config = withEntries((e) => e.filter((x) => x.id !== "helper-form"));
    const out = resolveSidebar(input({ config }));
    expect(out.main.find((n) => n.id === FORMS_GROUP_ID)?.children?.map((c) => c.id).at(-1)).toBe("helper-form");
  });

  it("falls back to the zone when an entry's parent group does not exist, and flattens a group inside a group", () => {
    const config = withEntries((e) => [
      ...e.map((x) => (x.id === "people" ? { ...x, parent: "ghost-group" } : x)).filter((x) => x.id !== "my-scouting"),
      { id: "g-a", kind: "group", parent: null, order: 50, label: "A", icon: "Star" },
      { id: "g-b", kind: "group", parent: "g-a", order: 0, label: "B" },
      { id: "my-scouting", kind: "page", parent: "g-b", order: 0 },
    ]);
    const normalized = normalizeEntries(config);
    expect(normalized.find((x) => x.id === "people")?.parent).toBeNull();
    expect(normalized.find((x) => x.id === "g-b")?.parent).toBeNull();
    // my-scouting pointed at g-b, which is now a top-level group, so it still shows inside it
    const out = resolveSidebar(input({ config }));
    expect(out.main.find((n) => n.id === "g-b")?.children?.map((c) => c.id)).toEqual(["my-scouting"]);
  });

  it("reorders and moves pages the way the config says", () => {
    const config = withEntries((e) => e.map((x) => (x.id === "dashboard" ? { ...x, order: -1 } : x.id === "analytics" ? { ...x, parent: FORMS_GROUP_ID, order: 99 } : x)));
    const out = resolveSidebar(input({ config }));
    expect(out.main[0].id).toBe("dashboard");
    expect(out.main.find((n) => n.id === FORMS_GROUP_ID)?.children?.at(-1)?.id).toBe("analytics");
  });

  it("hides a page the config marks hidden", () => {
    const config = withEntries((e) => e.map((x) => (x.id === "people" ? { ...x, hidden: true } : x)));
    expect(ids(resolveSidebar(input({ config })).main)).not.toContain("people");
  });

  it("applies label and icon overrides, and an override wins over the label helper", () => {
    const config = withEntries((e) => e.map((x) => (x.id === "lead-scout-form" ? { ...x, label: "Leads", icon: "Star" } : x.id === "dashboard" ? { ...x, icon: "not-an-icon" } : x)));
    const out = resolveSidebar(input({ config, labelOf: (item) => `X ${item.label}` }));
    const lead = flat(out.main).find((n) => n.id === "lead-scout-form");
    expect(lead?.label).toBe("Leads");
    expect(lead?.icon).toBe(Star);
    // an unknown icon key falls back to the page's own icon, and the helper label stays for the rest
    expect(flat(out.main).find((n) => n.id === "dashboard")?.label).toBe("X Dashboard");
    expect(flat(out.main).find((n) => n.id === "analytics")?.icon).toBe(BarChart3);
  });
});

describe("gating is applied after the config (customization never grants access)", () => {
  const member: AccessUser = { uid: "m", isAdmin: false, isOwner: false, primaryRole: "match-scout", secondaryRoles: [] };
  const can = (id: string) => canAccessPage(member, id, defaultPageAccessConfig());

  it("hides pages the person cannot open, even if the config lists them", () => {
    const config = withEntries((e) => e); // lists every page, visible
    const out = resolveSidebar(input({ isAdmin: false, can, config }));
    const all = ids([...out.main, ...out.footer]);
    expect(all).not.toContain("assignments"); // restricted to lead scouts
    expect(all).not.toContain("admin-panel"); // admin only
    expect(all).toContain("dashboard");
  });

  it("never shows the Admin Panel to a non-admin, whatever the config", () => {
    const config = withEntries((e) => e.map((x) => (x.id === "admin-panel" ? { ...x, parent: null, order: -5 } : x)));
    expect(ids(resolveSidebar(input({ isAdmin: false, can: () => true, config })).main)).not.toContain("admin-panel");
  });

  it("HIDES a page the program does not have (FTC), in the default layout and under a config, and keeps it for FRC", () => {
    const has = (r: ReturnType<typeof resolveSidebar>) => flat([...r.main, ...r.footer]).some((n) => n.id === "judge-book");
    expect(has(resolveSidebar(input({ program: "ftc" })))).toBe(false);
    expect(has(resolveSidebar(input({ program: "ftc", config: withEntries((e) => e) })))).toBe(false);
    expect(has(resolveSidebar(input({ program: "frc" })))).toBe(true);
  });

  it("hides an FTC-unavailable page when the config hides it too", () => {
    const config = withEntries((e) => e.map((x) => (x.id === "judge-book" ? { ...x, hidden: true } : x)));
    expect(ids(resolveSidebar(input({ program: "ftc", config })).main)).not.toContain("judge-book");
  });

  it("hides a group with no visible children (all denied by access, or all hidden by the config)", () => {
    const denied = resolveSidebar(input({ isAdmin: false, can: (id) => !id.endsWith("-form") }));
    expect(topIds(denied.main)).not.toContain(FORMS_GROUP_ID);
    const hidden = resolveSidebar(input({ config: withEntries((e) => e.map((x) => (FORM_IDS.includes(x.id) ? { ...x, hidden: true } : x))) }));
    expect(topIds(hidden.main)).not.toContain(FORMS_GROUP_ID);
    // a hidden group hides its pages too
    const groupHidden = resolveSidebar(input({ config: withEntries((e) => e.map((x) => (x.id === FORMS_GROUP_ID ? { ...x, hidden: true } : x))) }));
    expect(ids(groupHidden.main)).not.toContain("lead-scout-form");
  });

  it("shows a group when only some children are visible", () => {
    const some = resolveSidebar(input({ isAdmin: false, can: (id) => id === "helper-form" || id === "dashboard" }));
    expect(some.main.find((n) => n.id === FORMS_GROUP_ID)?.children?.map((c) => c.id)).toEqual(["helper-form"]);
  });
});

describe("admin lockout guard", () => {
  it("ignores a config that hides the Admin Panel from an admin and shows the default", () => {
    const config = withEntries((e) => e.map((x) => (x.id === "admin-panel" ? { ...x, hidden: true } : x)));
    const out = resolveSidebar(input({ config }));
    expect(out.ignoredConfig).toBe(true);
    expect(ids(out.footer)).toContain("admin-panel");
    expect(out).toEqual({ ...resolveSidebar(input()), ignoredConfig: true });
  });

  it("ignores a config that hides every page", () => {
    const config = withEntries((e) => e.map((x) => (x.kind === "page" ? { ...x, hidden: true } : x)));
    expect(resolveSidebar(input({ config })).ignoredConfig).toBe(true);
    expect(resolveSidebar(input({ isAdmin: false, can: () => true, config })).ignoredConfig).toBe(true);
  });

  it("does not apply to a member: hiding the Admin Panel is fine for someone who never had it", () => {
    const config = withEntries((e) => e.map((x) => (x.id === "admin-panel" ? { ...x, hidden: true } : x)));
    expect(resolveSidebar(input({ isAdmin: false, can: () => true, config })).ignoredConfig).toBe(false);
  });
});

describe("active route", () => {
  it("expands and highlights the group holding the current page", () => {
    const out = resolveSidebar(input({ pathname: "/lead-scout-form" }));
    const forms = out.main.find((n) => n.id === FORMS_GROUP_ID);
    expect(forms?.active).toBe(true);
    expect(forms?.children?.find((c) => c.id === "lead-scout-form")?.active).toBe(true);
    expect(forms?.children?.find((c) => c.id === "helper-form")?.active).toBe(false);
  });

  it("marks a prefix page (Analytics) active for its subpages, and no group", () => {
    const out = resolveSidebar(input({ pathname: "/analytics/rankings" }));
    expect(out.main.find((n) => n.id === "analytics")?.active).toBe(true);
    expect(out.main.find((n) => n.id === FORMS_GROUP_ID)?.active).toBe(false);
  });

  it("follows a page moved into another group", () => {
    const entries: SidebarEntry[] = [...defaultEntries(), { id: "g-test", kind: "group", parent: null, order: 40, label: "Test", icon: "Star" }];
    const config = cfg(entries.map((x) => (x.id === "people" ? { ...x, parent: "g-test", order: 0 } : x)));
    const out = resolveSidebar(input({ config, pathname: "/people" }));
    expect(out.main.find((n) => n.id === "g-test")?.active).toBe(true);
    expect(out.main.find((n) => n.id === FORMS_GROUP_ID)?.active).toBe(false);
  });

  it("matches the code list: every main page of the old list is reachable", () => {
    const out = resolveSidebar(input());
    for (const item of mainNav) expect(ids(out.main)).toContain(item.id);
  });
});
