import type { LucideIcon } from "lucide-react";
import { isUnavailableInProgram } from "@/config/programs";
import type { ProgramId } from "@/config/programs/types";
import type { NavItem } from "@/lib/nav";
import { pageForPath } from "@/lib/page-access/pages";
import { childrenOf, normalizeEntries, pageById } from "@/lib/sidebar/layout";
import { sidebarIcon } from "@/lib/sidebar/icons";
import { ADMIN_PAGE_ID, FOOTER_ZONE, MAIN_ZONE, type SidebarConfig, type SidebarEntry } from "@/lib/sidebar/types";
import { PERSONAL_PAGE_IDS, PERSONAL_PLATFORM_OWNER_PAGE_IDS } from "@/lib/personal/routing";

// The ONE resolver every component that renders navigation goes through. Pure. It arranges pages the code defines; role, page access and program gating are applied
// here with the same checks the route guard uses, AFTER the config, so a config can rearrange and hide but never show a page the person cannot open.
// Sidebar visibility is cosmetic: hiding a page does not block its route, and showing one does not grant access.

export type SidebarNode = {
  id: string;
  kind: "page" | "group";
  label: string;
  icon: LucideIcon;
  /** Pages only. */
  href?: string;
  matchPrefix?: boolean;
  /** Groups only: the visible children (never empty). */
  children?: SidebarNode[];
  /** A page: it is the current route. A group: it contains the current route. */
  active: boolean;
};

export type ResolvedSidebar = {
  main: SidebarNode[];
  footer: SidebarNode[];
  /** The config would have locked someone out (no Admin Panel for an admin, or nothing left to show), so the default layout was used. */
  ignoredConfig: boolean;
};

export type ResolveInput = {
  program: ProgramId;
  isAdmin: boolean;
  /** Page-access check for the signed-in person (`usePageAccess().can`); null = no signed-in person (a test fixture), nothing is hidden. */
  can: ((pageId: string) => boolean) | null;
  config: SidebarConfig | null;
  /** The text of a page (form pages read `formDisplayName`). Default: the code's `label`. An admin's label override always wins. */
  labelOf?: (item: NavItem) => string;
  /** Program-relative route, for the active page and the group to expand. */
  pathname?: string;
  /**
   * Personal mode (memberships ON, no team): ONLY the personal pages (`PERSONAL_PAGE_IDS`, plus the Admin Panel for a platform owner), in the default order, with the
   * team's sidebar config and page access ignored (there is no team to read them from). Absent: the layout is exactly as before.
   */
  personal?: { isPlatformOwner: boolean };
};

/**
 * The same rule as `visibleNav`: a page no registered page owns is kept; Admin Panel also needs `isAdmin`. A page the program does not have (its
 * `unavailablePaths`) is HIDDEN, never shown greyed out: the sidebar, the mobile drawer and the customizer all go through here.
 */
export function canShowPage(page: NavItem, input: Pick<ResolveInput, "isAdmin" | "can"> & { program?: ProgramId }): boolean {
  if (input.program && isUnavailableInProgram(input.program, page.href)) return false;
  if (page.id === ADMIN_PAGE_ID && !input.isAdmin) return false;
  if (!input.can) return true;
  const owner = pageForPath(page.href);
  return !owner || input.can(owner.id);
}

const isActive = (page: NavItem, pathname: string): boolean => (page.matchPrefix ? pathname.startsWith(page.href) : pathname === page.href);

function build(entries: SidebarEntry[], input: ResolveInput, honourHidden: boolean): { main: SidebarNode[]; footer: SidebarNode[]; pageCount: number; adminShown: boolean } {
  const pathname = input.pathname ?? "";
  const labelOf = input.labelOf ?? ((item: NavItem) => item.label);
  let pageCount = 0;
  let adminShown = false;

  const pageNode = (e: SidebarEntry): SidebarNode | null => {
    const page = pageById(e.id);
    if (!page || !canShowPage(page, input)) return null;
    if (honourHidden && e.hidden) return null;
    pageCount++;
    if (page.id === ADMIN_PAGE_ID) adminShown = true;
    return {
      id: page.id,
      kind: "page",
      label: e.label ?? labelOf(page),
      icon: sidebarIcon(e.icon, page.icon),
      href: page.href,
      matchPrefix: page.matchPrefix,
      active: isActive(page, pathname),
    };
  };

  const nodesIn = (parent: string | null): SidebarNode[] => {
    const out: SidebarNode[] = [];
    for (const e of childrenOf(entries, parent)) {
      if (e.kind === "page") {
        const node = pageNode(e);
        if (node) out.push(node);
        continue;
      }
      if (honourHidden && e.hidden) continue;
      const children = childrenOf(entries, e.id)
        .map(pageNode)
        .filter((n): n is SidebarNode => n !== null);
      // A parent with no visible children (all hidden by role, access, or the config) is not shown.
      if (children.length === 0) continue;
      out.push({ id: e.id, kind: "group", label: e.label ?? "Group", icon: sidebarIcon(e.icon), children, active: children.some((c) => c.active) });
    }
    return out;
  };

  return { main: nodesIn(MAIN_ZONE), footer: nodesIn(FOOTER_ZONE), pageCount, adminShown };
}

/** The layout for the signed-in person, from the code's pages, the team's config (or none) and the person's access. */
/** The default layout cut down to the personal pages. A group left with no page is dropped. */
function resolvePersonal(input: ResolveInput, isPlatformOwner: boolean): ResolvedSidebar {
  const ids = new Set<string>([...PERSONAL_PAGE_IDS, ...(isPlatformOwner ? PERSONAL_PLATFORM_OWNER_PAGE_IDS : [])]);
  const base = build(normalizeEntries(null), { ...input, can: null, isAdmin: isPlatformOwner }, false);
  const keep = (nodes: SidebarNode[]): SidebarNode[] =>
    nodes.flatMap((n) => {
      if (n.kind === "page") return ids.has(n.id) ? [n] : [];
      const children = keep(n.children ?? []);
      return children.length > 0 ? [{ ...n, children, active: children.some((c) => c.active) }] : [];
    });
  return { main: keep(base.main), footer: keep(base.footer), ignoredConfig: false };
}

export function resolveSidebar(input: ResolveInput): ResolvedSidebar {
  if (input.personal) return resolvePersonal(input, input.personal.isPlatformOwner);
  if (input.config) {
    const custom = build(normalizeEntries(input.config), input, true);
    // Lockout guard: an admin must always reach the Admin Panel (the customizer lives there), and nobody may end up with an empty sidebar.
    const lockedOut = custom.pageCount === 0 || (input.isAdmin && !custom.adminShown);
    if (!lockedOut) return { main: custom.main, footer: custom.footer, ignoredConfig: false };
    const fallback = build(normalizeEntries(null), input, false);
    return { main: fallback.main, footer: fallback.footer, ignoredConfig: true };
  }
  const base = build(normalizeEntries(null), input, false);
  return { main: base.main, footer: base.footer, ignoredConfig: false };
}
