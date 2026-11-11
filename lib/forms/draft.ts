import type { Form, FormValues } from "@/lib/forms/types";
import { defaultValues } from "@/lib/forms/values";
import { storageKey } from "@/config/brand";

// Draft protection for the scout form: the in-progress values are autosaved to localStorage so a dead battery, a dropped tab or a reload at a venue
// with bad Wi-Fi doesn't lose a match. One draft per user + form + match + team (plus a pointer to the latest one, so a reload that forgot which match
// was open can still offer it). Pure functions over an injected `Storage`, so it is unit-tested without a browser; every storage call is wrapped
// because localStorage can be missing, full or blocked (private windows, quota).

export const DRAFT_VERSION = 1;
/** A draft older than this is ignored (and removed when read): it belongs to a match long gone. */
export const DRAFT_TTL_MS = 48 * 60 * 60 * 1000;
/** How long after the last change the draft is written (a flush also happens when the page is hidden). */
export const DRAFT_DEBOUNCE_MS = 600;

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** What a draft holds. `match` is whatever the form's match picker produced (kept opaque here, so this module doesn't depend on the picker). */
export type Draft<M = unknown> = {
  v: typeof DRAFT_VERSION;
  savedAt: number;
  formId: string;
  match: M | null;
  teamNumber: number | null;
  values: FormValues;
};

export type DraftIdentity = { uid: string; formId: string; matchKey?: string | null; teamNumber?: number | null };

/** `Qualification-12` for an assigned match ({ type, match: { matchNumber } }), or null when none is picked. */
export function matchKeyOf(match: { type: string; match: { matchNumber: number } } | null | undefined): string | null {
  return match ? `${match.type}-${match.match.matchNumber}` : null;
}

const PREFIX = `${storageKey("scout-draft")}:v${DRAFT_VERSION}`;

/** The storage key of one draft: user, form, match and team (`-` while not picked yet). */
export const draftKey = (id: DraftIdentity): string => `${PREFIX}:${id.uid}:${id.formId}:${id.matchKey ?? "-"}:${id.teamNumber ?? "-"}`;

/** The key of the pointer to the latest draft of a user's form. */
export const lastDraftKey = (uid: string, formId: string): string => `${PREFIX}:${uid}:${formId}:last`;

/** Do the values differ from a fresh form's? Only then is a draft worth keeping (picking a match or team alone is not). */
export function hasProgress(form: Pick<Form, "sections">, values: FormValues): boolean {
  const base = defaultValues(form);
  const keys = new Set([...Object.keys(base), ...Object.keys(values)]);
  for (const k of keys) if (JSON.stringify(values[k] ?? base[k] ?? null) !== JSON.stringify(base[k] ?? null)) return true;
  return false;
}

/** A stored string read as a draft, or null when it is missing, damaged, from another version or form, or expired. */
export function parseDraft<M = unknown>(raw: string | null, formId: string, now: number = Date.now()): Draft<M> | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<Draft<M>> | null;
    if (!d || typeof d !== "object" || d.v !== DRAFT_VERSION || d.formId !== formId) return null;
    if (typeof d.savedAt !== "number" || !Number.isFinite(d.savedAt) || now - d.savedAt > DRAFT_TTL_MS) return null;
    if (!d.values || typeof d.values !== "object" || Array.isArray(d.values)) return null;
    const teamNumber = typeof d.teamNumber === "number" && Number.isInteger(d.teamNumber) && d.teamNumber > 0 ? d.teamNumber : null;
    return { v: DRAFT_VERSION, savedAt: d.savedAt, formId, match: (d.match ?? null) as M | null, teamNumber, values: d.values as FormValues };
  } catch {
    return null;
  }
}

/** Writes the draft under its own key and moves the "latest" pointer to it. Returns false when storage refused (the scout just doesn't get a draft). */
export function saveDraft<M>(storage: DraftStorage, id: Omit<DraftIdentity, "matchKey" | "teamNumber">, draft: Omit<Draft<M>, "v" | "formId" | "savedAt">, matchKey: string | null, now: number = Date.now()): boolean {
  try {
    const key = draftKey({ ...id, matchKey, teamNumber: draft.teamNumber });
    const full: Draft<M> = { v: DRAFT_VERSION, savedAt: now, formId: id.formId, ...draft };
    storage.setItem(key, JSON.stringify(full));
    storage.setItem(lastDraftKey(id.uid, id.formId), key);
    return true;
  } catch {
    return false;
  }
}

/** The draft stored for exactly this user, form, match and team. */
export function loadDraft<M = unknown>(storage: DraftStorage, id: DraftIdentity, now: number = Date.now()): Draft<M> | null {
  try {
    const key = draftKey(id);
    const raw = storage.getItem(key);
    const draft = parseDraft<M>(raw, id.formId, now);
    if (raw && !draft) storage.removeItem(key); // expired or damaged
    return draft;
  } catch {
    return null;
  }
}

/** The latest draft this user saved for the form, whatever its match and team (what a reload offers before a match is picked again). */
export function loadLastDraft<M = unknown>(storage: DraftStorage, uid: string, formId: string, now: number = Date.now()): Draft<M> | null {
  try {
    const key = storage.getItem(lastDraftKey(uid, formId));
    if (!key || !key.startsWith(`${PREFIX}:${uid}:${formId}:`)) return null;
    const raw = storage.getItem(key);
    const draft = parseDraft<M>(raw, formId, now);
    if (raw && !draft) storage.removeItem(key);
    return draft;
  } catch {
    return null;
  }
}

/** Removes one draft (a successful submit, or "Discard"), and the latest-pointer if it pointed there. */
export function clearDraft(storage: DraftStorage, id: DraftIdentity): void {
  try {
    const key = draftKey(id);
    storage.removeItem(key);
    const pointer = lastDraftKey(id.uid, id.formId);
    if (storage.getItem(pointer) === key) storage.removeItem(pointer);
  } catch {
    // storage is unavailable: there is nothing to clear
  }
}

/** "just now", "5 min ago", "3 h ago": how long ago a draft was saved, for the restore banner. */
export function draftAge(savedAt: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - savedAt) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** The browser's localStorage, or null where it is missing or blocked (SSR, a locked-down webview). */
export function browserDraftStorage(): DraftStorage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}
