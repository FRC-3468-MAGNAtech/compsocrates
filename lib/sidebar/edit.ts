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
// Where a move is not allowed (an indent with no group above, a group inside a group) the list comes back unchanged.

type Entries = readonly SidebarEntry[];

const find = (entries: Entries, id: string) => entries.find((e) => e.id === id);
const isZone = (parent: string | null) => parent === MAIN_ZONE || parent === FOOTER_ZONE;
const update = (entries: Entries, id: string, patch: Partial<SidebarEntry>): SidebarEntry[] => entries.map((e) => (e.id === id ? { ...e, ...patch } : { ...e }));
const without = (e: SidebarEntry, ...keys: (keyof SidebarEntry)[]): SidebarEntry => {
  const copy = { ...e };
  for (const k of keys) delete copy[k];
  return copy;
};

/** The siblings that `id` shares a parent with, in order. */
export const siblingsOf = (entries: Entries, id: string): SidebarEntry[] => {
  const e = find(entries, id);
  return e ? childrenOf(entries, e.parent) : [];
};

export function canMoveUp(entries: Entries, id: string): boolean {
  const sibs = siblingsOf(entries, id);
  return sibs.length > 0 && sibs[0].id !== id;
}
export function canMoveDown(entries: Entries, id: string): boolean {
  const sibs = siblingsOf(entries, id);
  return sibs.length > 0 && sibs[sibs.length - 1].id !== id;
}

function swapWith(entries: Entries, id: string, delta: -1 | 1): SidebarEntry[] {
  const sibs = siblingsOf(entries, id);
  const at = sibs.findIndex((s) => s.id === id);
  const other = sibs[at + delta];
  if (at < 0 || !other) return entries.map((e) => ({ ...e }));
  const a = sibs[at];
  return renumber(entries.map((e) => (e.id === a.id ? { ...e, order: other.order } : e.id === other.id ? { ...e, order: a.order } : { ...e })));
}
export const moveUp = (entries: Entries, id: string) => swapWith(entries, id, -1);
export const moveDown = (entries: Entries, id: string) => swapWith(entries, id, 1);

/** Indent: a page goes inside the group directly above it (same zone). Not for groups (one level) and not when the item above is not a group. */
export function canIndent(entries: Entries, id: string): boolean {
  const e = find(entries, id);
  if (!e || e.kind !== "page" || !isZone(e.parent)) return false;
  const sibs = siblingsOf(entries, id);
  const above = sibs[sibs.findIndex((s) => s.id === id) - 1];
  return above?.kind === "group";
}
export function indent(entries: Entries, id: string): SidebarEntry[] {
  if (!canIndent(entries, id)) return entries.map((e) => ({ ...e }));
  const sibs = siblingsOf(entries, id);
  const above = sibs[sibs.findIndex((s) => s.id === id) - 1];
  return moveTo(entries, id, above.id);
}

/** Outdent: a page leaves its group and lands right after it. */
export function canOutdent(entries: Entries, id: string): boolean {
  const e = find(entries, id);
  return !!e && e.kind === "page" && !isZone(e.parent);
}
export function outdent(entries: Entries, id: string): SidebarEntry[] {
  const e = find(entries, id);
  if (!e || !canOutdent(entries, id)) return entries.map((x) => ({ ...x }));
  const group = find(entries, e.parent as string);
  const zone = group?.parent ?? MAIN_ZONE;
  const after = group?.order ?? Number.MAX_SAFE_INTEGER;
  // Make room right after the group, then drop the page there.
  const shifted = entries.map((x) => (x.parent === zone && x.order > after ? { ...x, order: x.order + 1 } : { ...x }));
  return renumber(shifted.map((x) => (x.id === id ? { ...x, parent: zone, order: after + 0.5 } : x)));
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
  const e = find(entries, id);
  const parent = target === "@main" ? MAIN_ZONE : target;
  if (!e) return entries.map((x) => ({ ...x }));
  if (e.kind === "group" && !isZone(parent)) return entries.map((x) => ({ ...x }));
  if (!isZone(parent) && find(entries, parent as string)?.kind !== "group") return entries.map((x) => ({ ...x }));
  const last = entries.filter((x) => x.parent === parent && x.id !== id).reduce((m, x) => Math.max(m, x.order), -1);
  return renumber(update(entries, id, { parent, order: last + 1 }));
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
