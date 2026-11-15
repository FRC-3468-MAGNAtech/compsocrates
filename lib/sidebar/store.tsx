"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { collection, doc, getDoc, onSnapshot, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore";
import { storageKey } from "@/config/brand";
import { DEFAULT_PROGRAM, type ProgramId } from "@/config/programs/types";
import { buildAuditEntry } from "@/lib/audit-log";
import { useAuth } from "@/lib/auth";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { programPath } from "@/lib/firebase/paths";
import { describeFirestoreError, reportFirestoreError } from "@/lib/firestore-errors";
import { useProgram } from "@/lib/program/context";
import { toConfig } from "@/lib/sidebar/edit";
import { normalizeEntries, parseSidebarConfig } from "@/lib/sidebar/layout";
import { SIDEBAR_CONFIG_VERSION, type SidebarConfig, type SidebarEntry } from "@/lib/sidebar/types";

// The sidebar config doc `teams/{teamId}/settings/sidebar` (a namespaced program: the same path under its own prefix, built with `programPath`): one doc per team and program, read by every
// member, written by team admins only (firestore.rules). One shared subscription for the whole shell. The last good config is cached on the device per program and
// team, so the sidebar paints the right layout immediately and swaps in the live one without a flash. A failed read never shows in the sidebar: the cached (or
// default) layout stays and the customizer says so.

const settingsRef = (teamId: string, program: ProgramId = DEFAULT_PROGRAM, database: Firestore = db) => doc(database, programPath(program, "teams"), teamId, "settings", "sidebar");

const cacheKey = (program: ProgramId, teamId: string) => storageKey(`sidebar.${program}.${teamId}`);

function readCache(program: ProgramId, teamId: string): SidebarConfig | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(program, teamId));
    return raw ? parseSidebarConfig(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCache(program: ProgramId, teamId: string, config: SidebarConfig | null): void {
  try {
    if (config) window.localStorage.setItem(cacheKey(program, teamId), JSON.stringify(config));
    else window.localStorage.removeItem(cacheKey(program, teamId));
  } catch {
    // storage blocked or full: the sidebar just has no cache
  }
}

export class SidebarConflictError extends Error {
  constructor() {
    super("The sidebar was changed by someone else since you opened this screen.");
    this.name = "SidebarConflictError";
  }
}

type Actor = { teamId: string; uid: string; name: string };

/** Plain stored form of an entry (Firestore rejects `undefined`). */
const stored = (e: SidebarEntry) => ({ id: e.id, kind: e.kind, parent: e.parent, order: e.order, ...(e.label ? { label: e.label } : {}), ...(e.icon ? { icon: e.icon } : {}), ...(e.hidden ? { hidden: true } : {}) });

/**
 * The one write: in a transaction, stores `entries` as the next revision of this team's layout in `program` and writes one `edit-sidebar` audit entry. With an
 * `expectedRev` it only lands if the stored `rev` is still that one (0 when there is no doc), so two admins editing at once never silently overwrite each other
 * (`SidebarConflictError`); with `null` it replaces whatever is stored (a deliberate sync). Returns the config as stored.
 */
async function commitLayout(database: Firestore, actor: Actor, entries: readonly SidebarEntry[], program: ProgramId, expectedRev: number | null, extraTarget: Record<string, unknown> = {}): Promise<SidebarConfig> {
  return runTransaction(database, async (tx) => {
    const snap = await tx.get(settingsRef(actor.teamId, program, database));
    const current = snap.exists() ? parseSidebarConfig(snap.data()) : null;
    const storedRev = current?.rev ?? (snap.exists() && typeof snap.data().rev === "number" ? (snap.data().rev as number) : 0);
    if (expectedRev !== null && storedRev !== expectedRev) throw new SidebarConflictError();
    const next = toConfig(entries, storedRev + 1);
    tx.set(settingsRef(actor.teamId, program, database), {
      version: SIDEBAR_CONFIG_VERSION,
      rev: next.rev,
      entries: next.entries.map(stored),
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    });
    const summary = (list: readonly SidebarEntry[]) => ({ entries: list.length, hidden: list.filter((e) => e.hidden).length, groups: list.filter((e) => e.kind === "group").length });
    tx.set(doc(collection(database, programPath(program, "auditLog"))), buildAuditEntry(actor.teamId, actor.uid, actor.name, "edit-sidebar", { rev: next.rev, ...extraTarget }, current ? summary(current.entries) : null, summary(next.entries)));
    return next;
  });
}

/** Saves a layout, checked against the revision the admin loaded (`expectedRev`, 0 when there was no doc): a stale one throws `SidebarConflictError`. */
export async function saveSidebarConfig(
  actor: Actor,
  entries: readonly SidebarEntry[],
  expectedRev: number,
  program: ProgramId = DEFAULT_PROGRAM,
  /** The Firestore to write to (the app's by default; the emulator tests pass theirs). */
  database: Firestore = db
): Promise<SidebarConfig> {
  return commitLayout(database, actor, entries, program, expectedRev);
}

// --- sync between the two programs --------------------------------------------------------------------------------------------------
// Each program has its own layout doc for the team, and no admin panel of its own yet in one of them, so the Sidebar tab of the program that has one can copy
// a layout across. The same person has a separate account (profile and team id) in each program, so the other side is found through their profile there;
// the rules then decide whether they may write it (an admin of that account's team). Someone without an account there gets `SidebarSyncError("no-account")`.

export class SidebarSyncError extends Error {
  constructor(
    readonly reason: "no-account",
    message: string
  ) {
    super(message);
    this.name = "SidebarSyncError";
  }
}

async function accountIn(program: ProgramId, uid: string, database: Firestore): Promise<{ teamId: string; name: string }> {
  const none = new SidebarSyncError("no-account", "You have no account on a team in the other program, so there is nothing to sync with.");
  let data: Record<string, unknown> | null = null;
  try {
    const snap = await getDoc(doc(database, programPath(program, "users"), uid));
    data = snap.exists() ? snap.data() : null;
  } catch (err) {
    // The rules answer "denied" for a profile that does not exist (they read `resource.data.teamId`), which is the same thing as no account.
    if ((err as { code?: unknown } | null)?.code === "permission-denied") throw none;
    throw err;
  }
  const teamId = typeof data?.teamId === "string" ? data.teamId : "";
  if (!teamId) throw none;
  return { teamId, name: typeof data?.name === "string" ? data.name : "" };
}

/** Replaces the layout of the person's team in `target` with `entries` (the layout of `from`). Throws `SidebarSyncError` without an account there; the rules refuse a non-admin. */
export async function pushSidebarLayout(person: { uid: string; name: string }, entries: readonly SidebarEntry[], from: ProgramId, target: ProgramId, database: Firestore = db): Promise<SidebarConfig> {
  const account = await accountIn(target, person.uid, database);
  return commitLayout(database, { teamId: account.teamId, uid: person.uid, name: person.name }, entries, target, null, { syncedFrom: from });
}

/** The layout of the person's team in `source` as a complete entry list (the default layout when that team never saved one). Read only. */
export async function pullSidebarLayout(person: { uid: string }, source: ProgramId, database: Firestore = db): Promise<SidebarEntry[]> {
  const account = await accountIn(source, person.uid, database);
  const snap = await getDoc(settingsRef(account.teamId, source, database));
  return normalizeEntries(snap.exists() ? parseSidebarConfig(snap.data()) : null);
}

type SidebarConfigValue = {
  /** The team's config, or null (= the default layout). Cached value until the live read arrives. */
  config: SidebarConfig | null;
  /** The live read has arrived (or there is nothing to read). The customizer waits for this before editing. */
  loaded: boolean;
  /** A failed live read, for the customizer only. The sidebar never shows it. */
  error: string | null;
};

const DEFAULT_VALUE: SidebarConfigValue = { config: null, loaded: true, error: null };
const SidebarConfigContext = createContext<SidebarConfigValue | null>(null);

type Live = { key: string; config: SidebarConfig | null; error: string | null };

export function SidebarConfigProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const program = useProgram();
  const teamId = profile?.teamId ?? null;
  const key = teamId ? `${program}|${teamId}` : null;
  const [live, setLive] = useState<Live | null>(null);
  // Read the device cache once per program and team; it is a first paint, never the truth.
  const cached = useMemo(() => (teamId && typeof window !== "undefined" ? readCache(program, teamId) : null), [program, teamId]);

  useEffect(() => {
    if (!teamId || !key || !isFirebaseConfigured()) return;
    return onSnapshot(
      settingsRef(teamId, program),
      (snap) => {
        const config = snap.exists() ? parseSidebarConfig(snap.data()) : null;
        writeCache(program, teamId, config);
        setLive({ key, config, error: null });
      },
      (err) => {
        reportFirestoreError("sidebar config subscription failed", err, `teams/${teamId}/settings/sidebar`);
        const failure = describeFirestoreError("sidebar config", err);
        setLive({ key, config: null, error: `Could not read the sidebar layout (${failure.code}). Members keep the last layout this device saw, or the default.` });
      }
    );
  }, [teamId, program, key]);

  const current = live && live.key === key ? live : null;
  const value = useMemo<SidebarConfigValue>(() => {
    // A failed read keeps the cached layout; a good read (even "no doc") replaces it.
    const config = current && !current.error ? current.config : cached;
    return { config, loaded: current !== null || !teamId || !isFirebaseConfigured(), error: current?.error ?? null };
  }, [current, cached, teamId]);

  return <SidebarConfigContext.Provider value={value}>{children}</SidebarConfigContext.Provider>;
}

/** The shared sidebar config. Outside the provider (a test fixture) it is the default layout. */
export function useSidebarConfig(): SidebarConfigValue {
  return useContext(SidebarConfigContext) ?? DEFAULT_VALUE;
}
