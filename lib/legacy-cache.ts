// A per-device cache for the two "legacy" fallbacks that find rows the team query cannot see (scouting rows and practice sessions with an EMPTY teamId, reached through
// the team's members by `scoutId in` / `scoutName in`). Those queries return every document the members ever wrote, of every team, and keep only the few with no teamId,
// so they cost about twice the team's entries on EVERY page load; the kept rows are historical and tiny. The kept rows are remembered here for 6 hours.
//
//  - Keyed by uid, program and team (and the member set for sessions). A different key reads fresh, and only the latest key per kind is kept.
//  - Cleared on sign-out and on a team or program switch, and by the Refresh control; also dropped after this device edits or deletes an entry or rescoring writes.
//  - Bounded: a value that does not fit (MAX_CHARS) or is not plain data is simply not stored, and the read runs as it always did. Never an error.
//  - It holds what the browser's own Firestore cache already holds, but it is still cleared at sign-out.
import { storageKey } from "@/config/brand";

export const LEGACY_TTL_MS = 6 * 60 * 60 * 1000;
export const LEGACY_MAX_CHARS = 400_000;

export type LegacyKind = "entries" | "sessions";
type Slot = { key: string; at: number; value: unknown };
type Store = Partial<Record<LegacyKind, Slot>>;

const name = () => storageKey("legacyRows");

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function load(s: Storage): Store {
  try {
    const raw = s.getItem(name());
    const parsed = raw ? (JSON.parse(raw) as Store) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export const legacyCacheKey = (parts: { uid: string; program: string; teamId: string; extra?: string }): string => [parts.uid, parts.program, parts.teamId, parts.extra ?? ""].join("|");

/**
 * The value as plain JSON data, or `unsafe` when it holds something a JSON round trip would change. A Firestore Timestamp (anything with `toMillis`) and a Date become epoch
 * milliseconds: every reader of these rows turns timestamps into milliseconds (`toEpochMs`) anyway, so what is displayed does not change.
 */
export const UNSAFE = Symbol("unsafe");
export function toStorable(value: unknown, depth = 0): unknown {
  if (depth > 12) return UNSAFE;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : UNSAFE;
  if (value === undefined) return undefined;
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const v = toStorable(item, depth + 1);
      if (v === UNSAFE) return UNSAFE;
      out.push(v === undefined ? null : v);
    }
    return out;
  }
  if (typeof value === "object") {
    const maybe = value as { toMillis?: unknown };
    if (typeof maybe.toMillis === "function") {
      const ms = (maybe.toMillis as () => number).call(value);
      return Number.isFinite(ms) ? ms : UNSAFE;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return UNSAFE;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const s = toStorable(v, depth + 1);
      if (s === UNSAFE) return UNSAFE;
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return UNSAFE;
}

/** The remembered value for `key`, or null (no entry, another key, older than 6 hours, unreadable). */
export function readLegacy<T>(kind: LegacyKind, key: string, now: number = Date.now()): T | null {
  const s = storage();
  if (!s) return null;
  const slot = load(s)[kind];
  if (!slot || slot.key !== key || typeof slot.at !== "number" || now - slot.at >= LEGACY_TTL_MS || now < slot.at) return null;
  return slot.value as T;
}

/** Remember `value` under `key` (replacing the kind's earlier key). Returns false when it was not stored. */
export function writeLegacy(kind: LegacyKind, key: string, value: unknown, now: number = Date.now()): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const plain = toStorable(value);
    if (plain === UNSAFE) return false;
    const store = load(s);
    store[kind] = { key, at: now, value: plain };
    const raw = JSON.stringify(store);
    if (raw.length > LEGACY_MAX_CHARS) {
      delete store[kind];
      s.setItem(name(), JSON.stringify(store));
      return false;
    }
    s.setItem(name(), raw);
    return true;
  } catch {
    return false;
  }
}

/** Forget everything remembered (sign-out, a team or program switch, Refresh, a local edit or rescore). */
export function clearLegacyCache(): void {
  try {
    storage()?.removeItem(name());
  } catch {
    // blocked storage: nothing was kept
  }
}
