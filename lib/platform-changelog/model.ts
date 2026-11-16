import { PROGRAM_IDS, type ProgramId } from "@/config/programs/types";
import { CHANGE_TYPE_IDS, MAX_CHANGE_TEXT, MAX_TITLE, MAX_VERSION, isChangeType, isValidIsoDate, type ChangeType } from "@/lib/changelog";
import { findUnsafeLinks, richTextToPlain } from "@/lib/rich-text";

// The platform changelog (Session 7): ONE changelog for the whole site, stored in `platformChangelog/{id}` and served through server routes (the
// Admin SDK; the rules keep the collection closed to clients). A release (entry) groups items under a title and an optional version; the entry
// and each item are tagged with the programs they apply to. Programs are DATA here (`programs: ProgramId[]`): nothing in this file or its users
// compares a program id. Pure: the server routes, the page and the editor share it, and it is unit tested.

export type PlatformStatus = "draft" | "published";

export type PlatformItem = {
  category: ChangeType;
  text: string;
  /** Optional override of the entry's tags. Absent: the item follows its entry. */
  programs?: ProgramId[];
};

export type PlatformEntry = {
  id: string;
  title: string;
  /** Optional version label ("CompSocrates v2.0.0"). Empty when none. */
  version: string;
  /** YYYY-MM-DD. */
  date: string;
  status: PlatformStatus;
  /** The entry's default tags: the programs its items apply to unless an item says otherwise. */
  programs: ProgramId[];
  items: PlatformItem[];
  /** An entry brought over from the old app: listed below the current ones, never lights the unread dot. */
  legacy: boolean;
  createdBy: string;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  /** When it first went live (drives the unread dot). Null for a draft. */
  publishedAtMs: number | null;
  /** Counts saves; an edit must name the revision it started from, so two edits cannot silently overwrite each other. */
  rev: number;
};

/** What the editor sends: everything the owner edits, nothing the server owns. */
export type EntryInput = {
  title: string;
  version: string;
  date: string;
  programs: ProgramId[];
  items: PlatformItem[];
};

export const MAX_ITEMS = 80;
/** Characters over every item and the title together: keeps one document far below Firestore's size limit. */
export const MAX_TOTAL_TEXT = 16000;

// --- program tags ------------------------------------------------------------------------------------------------------------------------------

/** A list of program ids as a clean tag set: known ids only, no duplicates, in the registry's order. Null when it is not a non-empty list of known ids. */
export function normalizeTags(raw: unknown): ProgramId[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 10) return null;
  if (!raw.every((p) => typeof p === "string" && (PROGRAM_IDS as readonly string[]).includes(p))) return null;
  const set = new Set(raw as string[]);
  return PROGRAM_IDS.filter((id) => set.has(id));
}

/** The tags an item really has: its own, else its entry's. */
export const itemTags = (entry: Pick<PlatformEntry, "programs">, item: PlatformItem): ProgramId[] => item.programs ?? entry.programs;

/** Is the item for this program? `null` asks for every program ("Show all programs"). */
export const itemVisible = (entry: Pick<PlatformEntry, "programs">, item: PlatformItem, program: ProgramId | null): boolean => program === null || itemTags(entry, item).includes(program);

export const visibleItems = (entry: Pick<PlatformEntry, "programs" | "items">, program: ProgramId | null): PlatformItem[] => entry.items.filter((i) => itemVisible(entry, i, program));

export const entryHasVisibleItems = (entry: Pick<PlatformEntry, "programs" | "items">, program: ProgramId | null): boolean => entry.items.some((i) => itemVisible(entry, i, program));

/** True when the item is tagged for every program: it needs no badge. */
export const taggedForAll = (tags: readonly ProgramId[]): boolean => PROGRAM_IDS.every((id) => tags.includes(id));

/** The three choices the editor offers for a tag: one program, or all of them. Returns the tag set for the chosen option ("all" or a program id). */
export function tagsFromChoice(choice: string): ProgramId[] | null {
  if (choice === "all") return [...PROGRAM_IDS];
  return normalizeTags([choice]);
}

/** The editor's choice for a tag set: "all" or the one program id; a set that is neither (cannot happen from the editor) reads as "all". */
export function choiceFromTags(tags: readonly ProgramId[]): string {
  return tags.length === 1 ? tags[0] : "all";
}

// --- grouping and ordering ---------------------------------------------------------------------------------------------------------------------

/** Items grouped by category in display order, skipping empty groups (each item keeps its position within its group). */
export function groupItems(items: readonly PlatformItem[]): { category: ChangeType; items: PlatformItem[] }[] {
  return CHANGE_TYPE_IDS.map((category) => ({ category, items: items.filter((i) => i.category === category) })).filter((g) => g.items.length > 0);
}

/** Current entries first (newest date, then newest publish/create time, then version), legacy entries below whatever their date. */
export function compareEntries(a: PlatformEntry, b: PlatformEntry): number {
  if (a.legacy !== b.legacy) return a.legacy ? 1 : -1;
  if (a.date !== b.date) return b.date.localeCompare(a.date);
  const at = a.publishedAtMs ?? a.createdAtMs ?? 0;
  const bt = b.publishedAtMs ?? b.createdAtMs ?? 0;
  if (at !== bt) return bt - at;
  const v = b.version.localeCompare(a.version, undefined, { numeric: true });
  return v !== 0 ? v : a.id.localeCompare(b.id);
}

export const sortEntries = (entries: readonly PlatformEntry[]): PlatformEntry[] => [...entries].sort(compareEntries);

/** The entries a reader sees for a program (or all): entries with no visible item are dropped, and each keeps only its visible items. */
export function entriesForProgram(entries: readonly PlatformEntry[], program: ProgramId | null): PlatformEntry[] {
  return entries.filter((e) => entryHasVisibleItems(e, program)).map((e) => ({ ...e, items: visibleItems(e, program) }));
}

// --- the unread dot ----------------------------------------------------------------------------------------------------------------------------

/**
 * Is there news for this program? A published, non-legacy entry with at least one item visible to the program, published after the later of
 * the account's `lastSeenChangelogAt` and the account's creation (an account never sees a pile of entries from before it existed).
 */
export function hasUnread(entries: readonly PlatformEntry[], program: ProgramId, lastSeenMs: number | null, accountCreatedMs: number | null): boolean {
  const since = Math.max(lastSeenMs ?? 0, accountCreatedMs ?? 0);
  return entries.some((e) => !e.legacy && e.status === "published" && e.publishedAtMs !== null && e.publishedAtMs > since && entryHasVisibleItems(e, program));
}

/** The newest publish time of a current entry visible to the program: what opening the page stamps as seen. */
export function latestVisiblePublishedMs(entries: readonly PlatformEntry[], program: ProgramId): number | null {
  const times = entries.filter((e) => !e.legacy && e.status === "published" && e.publishedAtMs !== null && entryHasVisibleItems(e, program)).map((e) => e.publishedAtMs!);
  return times.length === 0 ? null : Math.max(...times);
}

// --- reading a stored document -----------------------------------------------------------------------------------------------------------------

const asMs = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && "toMillis" in v && typeof (v as { toMillis: unknown }).toMillis === "function") return (v as { toMillis: () => number }).toMillis();
  return null;
};

/** A stored `platformChangelog/{id}` document as an entry. Defensive: a malformed item is dropped, never fatal. */
export function entryFromDoc(id: string, data: Record<string, unknown>): PlatformEntry {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const items: PlatformItem[] = [];
  for (const raw of Array.isArray(data.items) ? data.items : []) {
    if (!raw || typeof raw !== "object" || !isChangeType((raw as PlatformItem).category) || typeof (raw as PlatformItem).text !== "string") continue;
    const programs = normalizeTags((raw as PlatformItem).programs);
    items.push({ category: (raw as PlatformItem).category, text: (raw as PlatformItem).text, ...(programs ? { programs } : {}) });
  }
  return {
    id,
    title: str(data.title),
    version: str(data.version),
    date: str(data.date),
    status: data.status === "published" ? "published" : "draft",
    programs: normalizeTags(data.programs) ?? [...PROGRAM_IDS],
    items,
    legacy: data.legacy === true,
    createdBy: str(data.createdBy),
    createdAtMs: asMs(data.createdAt),
    updatedAtMs: asMs(data.updatedAt),
    publishedAtMs: asMs(data.publishedAt),
    rev: typeof data.rev === "number" && Number.isInteger(data.rev) ? data.rev : 0,
  };
}

// --- validation (the server's, and the editor's own check before it sends) ---------------------------------------------------------------------

export type EntryErrors = { title?: string; version?: string; date?: string; programs?: string; items?: string; itemRows?: Record<number, string> };
export type EntryParse = { ok: true; value: EntryInput } | { ok: false; errors: EntryErrors };

/** Text that looks like an HTML tag or a control character. The page renders text and the safe markup only, but nothing tag-like is stored. */
const HTML_LIKE = /<\s*\/?\s*[a-zA-Z!?]/;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Why one text field is not acceptable, or null. */
function textProblem(text: string, max: number): string | null {
  if (text.length > max) return `Keep it under ${max} characters.`;
  if (HTML_LIKE.test(text)) return "HTML isn't allowed. Use plain text, **bold**, *italic* or [label](https://link).";
  if (CONTROL.test(text)) return "Remove the control characters.";
  if (findUnsafeLinks(text).length > 0) return "Links must start with https://.";
  return null;
}

/**
 * Validates and normalizes an entry the owner submitted (any unknown value in, a clean EntryInput out). Trims text, drops empty item rows,
 * keeps only the known keys of an item, and reports per-field errors. Used by the server (the one that counts) and by the editor.
 */
export function parseEntryInput(raw: unknown): EntryParse {
  const errors: EntryErrors = {};
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const title = typeof src.title === "string" ? src.title.trim() : "";
  const version = typeof src.version === "string" ? src.version.trim() : "";
  const date = typeof src.date === "string" ? src.date.trim() : "";

  if (title === "") errors.title = "Add a title.";
  else {
    const p = textProblem(title, MAX_TITLE);
    if (p) errors.title = p;
  }
  if (version !== "") {
    const p = textProblem(version, MAX_VERSION);
    if (p) errors.version = p;
  }
  if (!isValidIsoDate(date)) errors.date = "Pick a valid date.";

  const programs = normalizeTags(src.programs);
  if (!programs) errors.programs = "Pick which programs this entry is for.";

  const rawItems = Array.isArray(src.items) ? src.items : null;
  const items: PlatformItem[] = [];
  const rowErrors: Record<number, string> = {};
  let total = title.length;
  if (!rawItems) errors.items = "Add at least one item.";
  else {
    rawItems.forEach((r, index) => {
      const item = r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : null;
      if (!item) {
        rowErrors[index] = "Not a valid item.";
        return;
      }
      const text = typeof item.text === "string" ? item.text.trim() : "";
      if (text === "") return; // an empty row is dropped, as the old editor did
      if (!isChangeType(item.category)) {
        rowErrors[index] = "Pick a category.";
        return;
      }
      const problem = textProblem(text, MAX_CHANGE_TEXT);
      if (problem) {
        rowErrors[index] = problem;
        return;
      }
      let tags: ProgramId[] | undefined;
      if (item.programs !== undefined && item.programs !== null) {
        const n = normalizeTags(item.programs);
        if (!n) {
          rowErrors[index] = "Pick which programs this item is for.";
          return;
        }
        tags = n;
      }
      total += text.length;
      items.push({ category: item.category, text, ...(tags ? { programs: tags } : {}) });
    });
    if (Object.keys(rowErrors).length > 0) errors.itemRows = rowErrors;
    if (items.length === 0 && !errors.itemRows) errors.items = "Add at least one item.";
    else if (items.length > MAX_ITEMS) errors.items = `At most ${MAX_ITEMS} items per entry.`;
    else if (total > MAX_TOTAL_TEXT) errors.items = `The entry is too long (over ${MAX_TOTAL_TEXT} characters in all).`;
  }

  if (Object.keys(errors).length > 0 || !programs) return { ok: false, errors };
  return { ok: true, value: { title, version, date, programs, items } };
}

/** A one-line summary of validation errors, for a 400 answer. */
export function describeErrors(errors: EntryErrors): string {
  const first = errors.title ?? errors.version ?? errors.date ?? errors.programs ?? errors.items ?? (errors.itemRows ? `Item ${Number(Object.keys(errors.itemRows)[0]) + 1}: ${Object.values(errors.itemRows)[0]}` : null);
  return first ?? "That entry isn't valid.";
}

/** An entry as the editor holds it (the same fields as the input, plus the revision it started from). */
export const emptyEntryInput = (todayIso: string): EntryInput => ({ title: "", version: "", date: todayIso, programs: [...PROGRAM_IDS], items: [{ category: "new", text: "" }] });

export const entryToInput = (e: Pick<PlatformEntry, "title" | "version" | "date" | "programs" | "items">): EntryInput => ({
  title: e.title,
  version: e.version,
  date: e.date,
  programs: [...e.programs],
  items: e.items.map((i) => ({ ...i, ...(i.programs ? { programs: [...i.programs] } : {}) })),
});

/** Moves list[index] up (-1) or down (+1) by one; the same order at the ends. Never mutates. */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const j = index + delta;
  if (index < 0 || index >= list.length || j < 0 || j >= list.length) return [...list];
  const next = [...list];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

// --- search and category filter (the page) -----------------------------------------------------------------------------------------------------

export type EntryFilter = { types: ChangeType[]; query: string };

/**
 * The page's filters over entries already narrowed to a program: with categories selected an entry keeps only items of those categories (and is
 * dropped when none are left); the search keeps an entry whose version, title or any item text (markup stripped) contains it.
 */
export function filterPlatformEntries(entries: readonly PlatformEntry[], filter: EntryFilter): PlatformEntry[] {
  const q = filter.query.trim().toLowerCase();
  return entries
    .map((e) => (filter.types.length === 0 ? e : { ...e, items: e.items.filter((i) => filter.types.includes(i.category)) }))
    .filter((e) => e.items.length > 0)
    .filter((e) => q === "" || [e.version, e.title, ...e.items.map((i) => richTextToPlain(i.text))].join("\n").toLowerCase().includes(q));
}

/** How many entries have at least one item of each category (for the filter chips). */
export function countByCategory(entries: readonly PlatformEntry[]): Record<ChangeType, number> {
  const counts: Record<ChangeType, number> = { new: 0, improved: 0, fixed: 0, removed: 0 };
  for (const e of entries) for (const c of new Set(e.items.map((i) => i.category))) counts[c] += 1;
  return counts;
}
