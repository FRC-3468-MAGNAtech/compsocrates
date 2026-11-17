import { isUnavailableInProgram } from "@/config/programs";
import type { ProgramId } from "@/config/programs/types";
import { pageById, childrenOf } from "@/lib/sidebar/layout";
import { FOOTER_ZONE, MAIN_ZONE, type SidebarEntry } from "@/lib/sidebar/types";
import { ALWAYS_ON_PAGES, PAGES, getPage } from "@/lib/page-access/pages";

// Session 6: the ONE list of pages the Page Access screens show (the Roles chart and the All Members matrix), grouped like the sidebar (Session F groups). Pure.
// The program supplies only which pages it lacks (`unavailablePaths`, the same rule the sidebar resolver uses); nothing here names a program.

/**
 *  - `restricted`: configurable, closed unless a role (or the member) is given it.
 *  - `open`: open to everyone by default; an admin can still close it for a role.
 *  - `always`: open, and can never be closed (the reason is `reason`).
 *  - `admin`: admins only, never grantable.
 */
export type AccessRowKind = "restricted" | "open" | "always" | "admin";

export type AccessPageRow = { id: string; title: string; kind: AccessRowKind; /** The one-line reason, for `always` and `admin` rows. */ reason?: string };
export type AccessPageGroup = { id: string; label: string; rows: AccessPageRow[] };

/** Group ids that are not sidebar groups. */
export const LOOSE_GROUP_ID = "@pages";
export const FOOTER_GROUP_ID = "@footer";
export const MORE_GROUP_ID = "@more";

const ADMIN_REASON = "Admins only. Admins always keep Page Access and the Admin Panel.";

function rowFor(id: string, label?: string): AccessPageRow | null {
  const page = getPage(id);
  if (!page) return null;
  const title = label ?? pageById(id)?.label ?? page.title;
  if (page.access === "admin") return { id, title, kind: "admin", reason: ADMIN_REASON };
  if (page.access === "restricted") return { id, title, kind: "restricted" };
  if (id in ALWAYS_ON_PAGES) return { id, title, kind: "always", reason: ALWAYS_ON_PAGES[id] };
  return { id, title, kind: "open" };
}

/**
 * Every page of the program that page access knows, grouped in sidebar order: each sidebar group, then the pages that sit loose in the main list, then the
 * footer block, then the few pages with no sidebar entry (Event Details, the Analytics sub-pages). A page the program does not have is left out.
 * `entries` is `normalizeEntries(config)` (the team's own arrangement, or the default).
 */
export function accessPageGroups(program: ProgramId, entries: readonly SidebarEntry[]): AccessPageGroup[] {
  const available = (id: string) => {
    const page = getPage(id);
    return !!page && !isUnavailableInProgram(program, page.routes[0]);
  };
  const seen = new Set<string>();
  const take = (e: SidebarEntry): AccessPageRow | null => {
    if (e.kind !== "page" || seen.has(e.id) || !available(e.id)) return null;
    const row = rowFor(e.id, e.label);
    if (row) seen.add(e.id);
    return row;
  };

  const groups: AccessPageGroup[] = [];
  const loose: AccessPageRow[] = [];
  let looseAt = -1;
  for (const e of childrenOf(entries, MAIN_ZONE)) {
    if (e.kind === "page") {
      const row = take(e);
      if (row) {
        if (looseAt < 0) looseAt = groups.length;
        loose.push(row);
      }
      continue;
    }
    const rows = childrenOf(entries, e.id).map(take).filter((r): r is AccessPageRow => r !== null);
    if (rows.length > 0) groups.push({ id: e.id, label: e.label ?? "Group", rows });
  }
  if (loose.length > 0) groups.splice(looseAt, 0, { id: LOOSE_GROUP_ID, label: "Pages", rows: loose });

  const footer = childrenOf(entries, FOOTER_ZONE).map(take).filter((r): r is AccessPageRow => r !== null);
  if (footer.length > 0) groups.push({ id: FOOTER_GROUP_ID, label: "Account and info", rows: footer });

  const more = PAGES.filter((p) => !seen.has(p.id) && available(p.id)).map((p) => rowFor(p.id, p.title)).filter((r): r is AccessPageRow => r !== null);
  if (more.length > 0) groups.push({ id: MORE_GROUP_ID, label: "More pages", rows: more });
  return groups;
}

export const flatRows = (groups: readonly AccessPageGroup[]): AccessPageRow[] => groups.flatMap((g) => g.rows);

/** Case-insensitive filter by page title or group label; groups with no match are dropped. A match on the group label keeps all of its rows. */
export function filterGroups(groups: readonly AccessPageGroup[], text: string): AccessPageGroup[] {
  const q = text.trim().toLowerCase();
  if (!q) return [...groups];
  return groups
    .map((g) => (g.label.toLowerCase().includes(q) ? g : { ...g, rows: g.rows.filter((r) => r.title.toLowerCase().includes(q)) }))
    .filter((g) => g.rows.length > 0);
}
