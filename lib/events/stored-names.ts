import { normalizeEventKey } from "@/config/event";
import { usableEventName } from "@/lib/events/names";

/**
 * Gathers `{ eventKey -> eventName }` from data the app has already loaded, so the resolver's "stored" step needs no new
 * Firestore read. Pure.
 *
 * Accepts row lists (practice sessions, library matches and events, practice entries: anything with an event key under
 * `eventKey` or `eventCode` and a name under `eventName`) and ready-made records (the team doc's `selectedEventNames`).
 * Keys are alias-normalized and lowercased; a name that is empty or just the key again (CS writes `eventName || eventKey`)
 * is skipped; for one key the FIRST usable name wins, so pass the most trusted source first.
 */

export type StoredNameRow = { eventKey?: string | null; eventCode?: string | null; eventName?: string | null };

export type StoredNameSource = readonly StoredNameRow[] | Readonly<Record<string, string>> | null | undefined;

export function collectStoredEventNames(...sources: StoredNameSource[]): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (rawKey: unknown, rawName: unknown) => {
    if (typeof rawKey !== "string") return;
    const key = normalizeEventKey(rawKey);
    if (!key || Object.prototype.hasOwnProperty.call(out, key)) return;
    // Also reject a name that is the key as typed (`2025lake` before aliasing).
    const name = usableEventName(rawName, key) ?? null;
    if (name && usableEventName(name, rawKey)) out[key] = name;
  };
  for (const source of sources) {
    if (!source) continue;
    if (Array.isArray(source)) {
      for (const row of source as readonly StoredNameRow[]) {
        if (row) add(row.eventKey ?? row.eventCode, row.eventName);
      }
    } else {
      for (const [key, name] of Object.entries(source as Readonly<Record<string, string>>)) add(key, name);
    }
  }
  return out;
}

/** Every distinct event key (alias-normalized, first-seen order) found on rows under `eventKey` or `eventCode`. Used to name every event in an export. */
export function collectEventKeys(...sources: (readonly StoredNameRow[] | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const rows of sources) {
    if (!rows) continue;
    for (const row of rows) {
      const raw = row?.eventKey ?? row?.eventCode;
      if (typeof raw !== "string") continue;
      const key = normalizeEventKey(raw);
      if (key) seen.add(key);
    }
  }
  return [...seen];
}
