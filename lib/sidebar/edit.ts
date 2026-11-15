import {
  childrenOf,
  defaultEntries,
  defaultParentOf,
  normalizeEntries,
  pageById,
  renumber,
} from "@/lib/sidebar/layout";
import {
  ADMIN_PAGE_ID,
  FOOTER_ZONE,
  MAIN_ZONE,
  MAX_LABEL_LENGTH,
  MAX_SIDEBAR_ENTRIES,
  SIDEBAR_CONFIG_VERSION,
  type SidebarConfig,
  type SidebarEntry,
} from "@/lib/sidebar/types";

// Pure edit operations for the customizer. Each takes the COMPLETE entry list (`normalizeEntries`) and returns a new one; none mutates its input.
// Where a move is not allowed (a group inside a group, a page into something that is not a group) the list comes back unchanged.

type Entries = readonly SidebarEntry[];

const find = (entries: Entries, id: string) => entries.find((e) => e.id === id);
const isZone = (parent: string | null) => parent === MAIN_ZONE || parent === FOOTER_ZONE;
const update = (entries: Entries, id: string, patch: Partial<SidebarEntry>): SidebarEntry[] => entries.map((e) => (e.id === id ? { ...e, ...patch } : { ...e }));
const without = (e: SidebarEntry, ...keys: (keyof SidebarEntry)[]): SidebarEntry => {
  const copy = { ...e };
  for (const k of keys) delete copy[k];
  return copy;
};

/**
 * Drag and drop: puts `id` into `parent` (a zone or a group) at position `index` among that parent's other children (clamped; `Infinity` = the end). A group
 * can only go to a zone (one level), and a page only to a zone or an existing group; anything else comes back unchanged. A group keeps its pages.
 */
export function moveEntry(entries: Entries, id: string, parent: string | null, index: number): SidebarEntry[] {
  const e = find(entries, id);
  if (!e) return entries.map((x) => ({ ...x }));
  if (e.kind === "group" && !isZone(parent)) return entries.map((x) => ({ ...x }));
  if (!isZone(parent) && find(entries, parent as string)?.kind !== "group") return entries.map((x) => ({ ...x }));
  const others = childrenOf(entries, parent).filter((x) => x.id !== id);
  const at = Math.min(Math.max(Number.isNaN(index) ? others.length : index, 0), others.length);
  const sequence = [...others.slice(0, at).map((x) => x.id), id, ...others.slice(at).map((x) => x.id)];
  const position = new Map(sequence.map((x, i) => [x, i]));
  return entries.map((x) => (x.id === id ? { ...x, parent, order: position.get(id) as number } : x.parent === parent ? { ...x, order: position.get(x.id) as number } : { ...x }));
}

/** The places an entry may be moved to: the two zones and every group (a group can only go to a zone). */
export function moveTargets(entries: Entries, id: string): { value: string; label: string }[] {
  const e = find(entries, id);
  if (!e) return [];
  const out: { value: string; label: string }[] = [
    { value: "@main", label: "Top of the sidebar" },
    { value: FOOTER_ZONE, label: "Bottom block" },
  ];
  if (e.kind === "page") for (const g of entries.filter((x) => x.kind === "group")) out.push({ value: g.id, label: `In group: ${g.label ?? "Group"}` });
  return out;
}

/** Move to the end of a zone (`"@main"`, `"@footer"`) or of a group. */
export function moveTo(entries: Entries, id: string, target: string): SidebarEntry[] {
  return moveEntry(entries, id, target === "@main" ? MAIN_ZONE : target, Infinity);
}

const cleanLabel = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH);

/** Sets a label override (empty clears it; a group keeps its old name if cleared, since a group needs one). */
export function rename(entries: Entries, id: string, label: string): SidebarEntry[] {
  const e = find(entries, id);
  if (!e) return entries.map((x) => ({ ...x }));
  const text = cleanLabel(label);
  if (!text) return e.kind === "group" ? entries.map((x) => ({ ...x })) : entries.map((x) => (x.id === id ? without(x, "label") : { ...x }));
  return update(entries, id, { label: text });
}
export const setIcon = (entries: Entries, id: string, icon: string | undefined): SidebarEntry[] =>
  entries.map((e) => (e.id === id ? (icon ? { ...e, icon } : without(e, "icon")) : { ...e }));
export const setHidden = (entries: Entries, id: string, hidden: boolean): SidebarEntry[] =>
  entries.map((e) => (e.id === id ? (hidden ? { ...e, hidden: true } : without(e, "hidden")) : { ...e }));

/** Whether an entry can be hidden: the Admin Panel never can (an admin must always reach this screen). */
export const canHide = (id: string): boolean => id !== ADMIN_PAGE_ID;

let groupCounter = 0;
export function newGroupId(): string {
  groupCounter += 1;
  return `g-${Date.now().toString(36)}${groupCounter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** A new group at the end of the main list. Returns the list and the new group's id (null when the label is empty or the list is full). */
export function createGroup(entries: Entries, label: string, icon = "Folder", id: string = newGroupId()): { entries: SidebarEntry[]; id: string | null } {
  const text = cleanLabel(label);
  if (!text || entries.length >= MAX_SIDEBAR_ENTRIES) return { entries: entries.map((e) => ({ ...e })), id: null };
  const last = entries.filter((e) => e.parent === MAIN_ZONE).reduce((m, e) => Math.max(m, e.order), -1);
  return { entries: [...entries.map((e) => ({ ...e })), { id, kind: "group", parent: MAIN_ZONE, order: last + 1, label: text, icon }], id };
}

/** Deletes a group; its pages land in the group's zone, where the group was. */
export function deleteGroup(entries: Entries, id: string): SidebarEntry[] {
  const g = find(entries, id);
  if (!g || g.kind !== "group") return entries.map((e) => ({ ...e }));
  const zone = g.parent ?? MAIN_ZONE;
  const moved = entries
    .filter((e) => e.id !== id)
    .map((e) => (e.parent === id ? { ...e, parent: zone, order: g.order + (e.order + 1) / 1000 } : { ...e }));
  return renumber(moved);
}

/** One page back to its default place and look (default group when that group exists, else its zone). A group has no default. */
export function resetItem(entries: Entries, id: string): SidebarEntry[] {
  const page = pageById(id);
  const e = find(entries, id);
  if (!page || !e) return entries.map((x) => ({ ...x }));
  const want = defaultParentOf(page);
  const parent = want !== null && want !== FOOTER_ZONE && find(entries, want)?.kind !== "group" ? MAIN_ZONE : want;
  // Back at its default position among its new siblings (a hole is fine: `renumber` closes it).
  const position = defaultEntries().find((x) => x.id === id)?.order ?? 0;
  return renumber(entries.map((x) => (x.id === id ? { id: x.id, kind: "page" as const, parent, order: position - 0.5 } : { ...x })));
}

/** True when this page differs from its default (placement, label, icon, hidden): drives the "Reset" button. */
export function isItemCustomized(entries: Entries, id: string): boolean {
  const e = find(entries, id);
  if (!e || e.kind !== "page") return false;
  if (e.label || e.icon || e.hidden) return true;
  const base = defaultEntries();
  const was = base.find((x) => x.id === id);
  if (!was) return false;
  const pos = (list: Entries, x: SidebarEntry) => `${x.parent}|${childrenOf(list, x.parent).findIndex((s) => s.id === x.id)}`;
  return pos(entries, e) !== pos(base, was);
}

export const resetAll = (): SidebarEntry[] => defaultEntries();

/** Whether two layouts are the same (what "unsaved changes" means). */
export function sameLayout(a: Entries, b: Entries): boolean {
  const key = (list: Entries) =>
    JSON.stringify(
      renumber(list)
        .map((e) => ({ id: e.id, kind: e.kind, parent: e.parent, order: e.order, label: e.label ?? null, icon: e.icon ?? null, hidden: e.hidden === true }))
        .sort((x, y) => x.id.localeCompare(y.id))
    );
  return key(a) === key(b);
}

/** Why a layout must not be saved, or null. Mirrors the resolver's lockout guard so the customizer never writes a config the sidebar would ignore. */
export function saveBlocker(entries: Entries): string | null {
  const byId = new Map(entries.map((e) => [e.id, e]));
  if (entries.length > MAX_SIDEBAR_ENTRIES) return `A sidebar can have at most ${MAX_SIDEBAR_ENTRIES} entries.`;
  if (byId.get(ADMIN_PAGE_ID)?.hidden) return "The Admin Panel cannot be hidden: you need it to reach this screen.";
  const pages = entries.filter((e) => e.kind === "page");
  if (pages.length > 0 && pages.every((e) => e.hidden)) return "At least one page must stay visible.";
  for (const g of entries.filter((e) => e.kind === "group")) if (!g.label?.trim()) return "Every group needs a name.";
  return null;
}

/** The doc to store: the complete layout, `rev` one higher than the version it was loaded from. */
export const toConfig = (entries: Entries, rev: number): SidebarConfig => ({ version: SIDEBAR_CONFIG_VERSION, rev, entries: renumber(entries) });

/** The working copy for the customizer: the team's config merged over the code's pages, or the default. */
export const workingCopy = (config: SidebarConfig | null): SidebarEntry[] => normalizeEntries(config);
