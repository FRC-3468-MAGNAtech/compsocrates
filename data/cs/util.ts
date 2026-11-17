/**
 * Small pure helpers shared by the CS adapters. No React, no Firebase.
 */
import type { CsRecord } from "@/data/cs/types";

export function isRecord(value: unknown): value is CsRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function asRecord(value: unknown): CsRecord {
  return isRecord(value) ? value : {};
}

/** Structural equality for Firestore-shaped values (plain objects, arrays, primitives). `undefined` keys count as absent. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

/** Deep copy of a Firestore-shaped value (plain objects and arrays are copied, anything else, such as a Timestamp, is shared). */
export function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as unknown as T;
  if (isRecord(value) && Object.getPrototypeOf(value) === Object.prototype) {
    const out: CsRecord = {};
    for (const [key, item] of Object.entries(value)) out[key] = cloneValue(item);
    return out as T;
  }
  return value;
}

/**
 * Merges `patch` into `base` the way Firestore's `setDoc(..., { merge: true })` does: nested maps are merged key by key,
 * everything else (arrays, primitives) is replaced. Returns a new object; `base` is not changed.
 */
export function deepMerge(base: CsRecord, patch: CsRecord): CsRecord {
  const out: CsRecord = cloneValue(base);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const existing = out[key];
    out[key] = isRecord(value) && isRecord(existing) ? deepMerge(existing, value) : cloneValue(value);
  }
  return out;
}

/** The top-level keys of `next` whose value differs from `base`: what a merge write must send. */
export function changedTopLevel(base: CsRecord, next: CsRecord): CsRecord {
  const out: CsRecord = {};
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    if (!deepEqual(base[key], value)) out[key] = value;
  }
  return out;
}

/**
 * An epoch-millisecond number from the shapes CS has stored for a time: a number, a numeric string, a Firestore Timestamp
 * (anything with `toMillis`), or a Date. 0 when it is none of them.
 */
export function toEpochMs(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  if (value instanceof Date) return value.getTime() > 0 ? value.getTime() : 0;
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: unknown }).toMillis === "function") {
    const ms = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }
  return 0;
}

export function isoFromMs(ms: number): string {
  return new Date(Math.max(0, ms)).toISOString();
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

/** Digits of a team number string ("254", " 254 ", "254B" -> 254); 0 when there are none. */
export function digitsToNumber(value: unknown): number {
  const n = Number(String(value ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Deep copy without `undefined` values (Firestore rejects them). Plain objects and arrays only; other values are shared. */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripUndefined(item)) as unknown as T;
  if (isRecord(value) && Object.getPrototypeOf(value) === Object.prototype) {
    const out: CsRecord = {};
    for (const [key, item] of Object.entries(value)) if (item !== undefined) out[key] = stripUndefined(item);
    return out as T;
  }
  return value;
}
