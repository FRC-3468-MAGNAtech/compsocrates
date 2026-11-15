import { mainNav, secondaryNav, NAV_PAGES, type NavItem } from "@/lib/nav";
import { isSidebarIconKey } from "@/lib/sidebar/icons";
import {
  FOOTER_ZONE,
  FORMS_GROUP_ID,
  MAIN_ZONE,
  MAX_LABEL_LENGTH,
  SIDEBAR_CONFIG_VERSION,
  type SidebarConfig,
  type SidebarEntry,
} from "@/lib/sidebar/types";

// Pure: the default layout, reading a stored config, and `normalizeEntries`, which turns any config (or none) into a COMPLETE list of entries: every page
// the code defines exactly once, every valid group, no dangling parents. The resolver and the customizer both start from that list.

const PAGE_BY_ID = new Map<string, NavItem>(NAV_PAGES.map((p) => [p.id, p]));
const FOOTER_IDS = new Set(secondaryNav.map((p) => p.id));

export const pageById = (id: string): NavItem | null => PAGE_BY_ID.get(id) ?? null;

/** A page that opens a form (it carries a `formType`). These sit in the "Forms" group by default. Analytics, Practice Scouting and Judge Book are not forms. */
export const isFormPage = (page: NavItem): boolean => page.formType !== undefined;

/** Where a page lives with no config: the Forms group for a form page, else the zone of the code list it is in. */
export function defaultParentOf(page: NavItem): string | null {
  if (isFormPage(page)) return FORMS_GROUP_ID;
  return FOOTER_IDS.has(page.id) ? FOOTER_ZONE : MAIN_ZONE;
}

/** Today's layout, except every form page sits in a "Forms" group (placed where the first form page was). */
export function defaultEntries(): SidebarEntry[] {
  const out: SidebarEntry[] = [];
  let main = 0;
  let inForms = 0;
  let groupAdded = false;
  for (const item of mainNav) {
    if (isFormPage(item)) {
      if (!groupAdded) {
        out.push({ id: FORMS_GROUP_ID, kind: "group", parent: MAIN_ZONE, order: main++, label: "Forms", icon: "ClipboardList" });
        groupAdded = true;
      }
      out.push({ id: item.id, kind: "page", parent: FORMS_GROUP_ID, order: inForms++ });
    } else {
      out.push({ id: item.id, kind: "page", parent: MAIN_ZONE, order: main++ });
    }
  }
  secondaryNav.forEach((item, i) => out.push({ id: item.id, kind: "page", parent: FOOTER_ZONE, order: i }));
  return out;
}

const clean = (text: unknown): string | undefined => {
  if (typeof text !== "string") return undefined;
  const t = text.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH);
  return t || undefined;
};

/** Reads a stored doc. Anything that is not a version-1 config with at least one entry reads as `null` (= the default layout); a bad entry is dropped, never thrown. */
export function parseSidebarConfig(raw: unknown): SidebarConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (data.version !== SIDEBAR_CONFIG_VERSION || !Array.isArray(data.entries)) return null;
  const entries: SidebarEntry[] = [];
  for (const e of data.entries) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id || (r.kind !== "page" && r.kind !== "group")) continue;
    if (r.parent !== null && typeof r.parent !== "string") continue;
    if (typeof r.order !== "number" || !Number.isFinite(r.order)) continue;
    const entry: SidebarEntry = { id: r.id, kind: r.kind, parent: r.parent, order: r.order };
    const label = clean(r.label);
    if (label) entry.label = label;
    if (isSidebarIconKey(r.icon)) entry.icon = r.icon;
    if (r.hidden === true) entry.hidden = true;
    entries.push(entry);
  }
  if (entries.length === 0) return null;
  const rev = typeof data.rev === "number" && Number.isInteger(data.rev) && data.rev >= 0 ? data.rev : 0;
  return { version: SIDEBAR_CONFIG_VERSION, rev, entries };
}

/** Siblings of one parent in display order. */
export const childrenOf = (entries: readonly SidebarEntry[], parent: string | null): SidebarEntry[] =>
  entries.filter((e) => e.parent === parent).sort((a, b) => a.order - b.order);

/** Orders 0..n-1 inside every parent, keeping the current sequence. */
export function renumber(entries: readonly SidebarEntry[]): SidebarEntry[] {
  const index = new Map(entries.map((e, i) => [e, i]));
  const next = new Map<SidebarEntry, number>();
  const parents = new Set(entries.map((e) => e.parent));
  for (const parent of parents) {
    childrenOf(entries, parent)
      .sort((a, b) => a.order - b.order || (index.get(a) ?? 0) - (index.get(b) ?? 0))
      .forEach((e, i) => next.set(e, i));
  }
  return entries.map((e) => ({ ...e, order: next.get(e) ?? e.order }));
}

/**
 * A complete, valid list of entries from a config (or none). Entries for a page the code no longer has, duplicates, and groups that clash with a page id are ignored;
 * a parent that does not exist (or a group inside a group) falls back to the entry's default zone; a page the code has but the config lacks is appended at the end of
 * its default group (when that group exists) or its default zone, so a new page never silently vanishes.
 */
export function normalizeEntries(config: SidebarConfig | null): SidebarEntry[] {
  if (!config || config.entries.length === 0) return defaultEntries();
  const seen = new Set<string>();
  const groups = new Set<string>();
  const kept: SidebarEntry[] = [];
  for (const e of config.entries) {
    if (e.kind !== "group" || seen.has(e.id) || PAGE_BY_ID.has(e.id) || e.id === FOOTER_ZONE) continue;
    seen.add(e.id);
    groups.add(e.id);
    kept.push({ ...e, label: clean(e.label) ?? "Group" });
  }
  for (const e of config.entries) {
    if (e.kind !== "page" || seen.has(e.id) || !PAGE_BY_ID.has(e.id)) continue;
    seen.add(e.id);
    kept.push({ ...e });
  }
  const zoneOf = (id: string): string | null => (FOOTER_IDS.has(id) ? FOOTER_ZONE : MAIN_ZONE);
  for (const e of kept) {
    const validParent = e.parent === MAIN_ZONE || e.parent === FOOTER_ZONE || (e.parent !== null && groups.has(e.parent) && e.kind === "page");
    if (!validParent) e.parent = e.kind === "page" ? zoneOf(e.id) : MAIN_ZONE;
  }
  for (const page of NAV_PAGES) {
    if (seen.has(page.id)) continue;
    const want = defaultParentOf(page);
    const parent = want !== null && want !== FOOTER_ZONE && !groups.has(want) ? MAIN_ZONE : want;
    const last = kept.filter((e) => e.parent === parent).reduce((m, e) => Math.max(m, e.order), -1);
    kept.push({ id: page.id, kind: "page", parent, order: last + 1 });
  }
  return renumber(kept);
}
