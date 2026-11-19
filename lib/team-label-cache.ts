"use client";

// The first-paint cache of the last known team label, so a page load shows the real name at once instead of waiting for a document. Device-local (localStorage, brand key), keyed by
// account, program and team, and CLEARED ON SIGN-OUT (`lib/auth.tsx` calls `clearTeamLabelCache`). It holds a number and a name only, never an id; storage that is blocked or holds
// junk reads as nothing. Zero Firestore reads.
import { storageKey } from "@/config/brand";
import type { NameParts } from "@/lib/team-label";

/** `team`: the team-level label (rows); `context`: what the trigger shows (the robot team being viewed as). */
export type CacheKind = "team" | "context";

type Store = Record<string, { n: string | null; m: string | null }>;
const KEY = storageKey("teamLabels");
const MAX_ENTRIES = 40;

const entryKey = (uid: string, program: string, teamId: string, kind: CacheKind) => `${uid}|${program}|${teamId}|${kind}`;

function read(): Store {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

/** The last known parts for this account, program and team, or null. */
export function recallTeamLabel(uid: string | null | undefined, program: string, teamId: string, kind: CacheKind): NameParts | null {
  if (!uid || typeof window === "undefined") return null;
  const hit = read()[entryKey(uid, program, teamId, kind)];
  return hit && (typeof hit.n === "string" || typeof hit.m === "string") ? { number: hit.n, name: hit.m } : null;
}

/** The teams of this account remembered for a program (team-level labels), so the panel can list the other program's teams before they are read. Ids here are only for the switch; they are never shown. */
export function listRememberedTeams(uid: string | null | undefined, program: string): { teamId: string; parts: NameParts }[] {
  if (!uid || typeof window === "undefined") return [];
  const prefix = `${uid}|${program}|`;
  const suffix = "|team";
  return Object.entries(read())
    .filter(([key, hit]) => key.startsWith(prefix) && key.endsWith(suffix) && hit && (typeof hit.n === "string" || typeof hit.m === "string"))
    .map(([key, hit]) => ({ teamId: key.slice(prefix.length, key.length - suffix.length), parts: { number: hit.n, name: hit.m } }));
}

/** Forget one remembered team (it was left, or the program was read and no longer lists it). */
export function forgetTeamLabel(uid: string | null | undefined, program: string, teamId: string): void {
  if (!uid || typeof window === "undefined") return;
  try {
    const store = read();
    for (const kind of ["team", "context"] as const) delete store[entryKey(uid, program, teamId, kind)];
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* nothing to forget */
  }
}

/** Remember a READY label's parts (call only with a real number and name, never an id). A repeat with the same parts writes nothing. */
export function rememberTeamLabel(uid: string | null | undefined, program: string, teamId: string, kind: CacheKind, parts: { number: string | null; name: string | null }): void {
  if (!uid || typeof window === "undefined" || (parts.number === null && parts.name === null)) return;
  try {
    const store = read();
    const key = entryKey(uid, program, teamId, kind);
    const old = store[key];
    if (old && old.n === parts.number && old.m === parts.name) return;
    delete store[key];
    store[key] = { n: parts.number, m: parts.name };
    for (const k of Object.keys(store).slice(0, Math.max(0, Object.keys(store).length - MAX_ENTRIES))) delete store[k];
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage blocked: the label just is not remembered */
  }
}

/** Forget every remembered label (sign-out). */
export function clearTeamLabelCache(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing was kept */
  }
}
