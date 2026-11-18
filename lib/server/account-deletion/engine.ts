import { PROGRAMS } from "@/config/programs";
import type { ProgramId } from "@/config/programs/types";
import { DELETED_ACCOUNT_NAME } from "@/lib/deletion/constants";
import type { Finder, RegistryEntry } from "@/lib/deletion/registry";
import { normalizeName, rewriteDocument, rewriteNameOnly } from "@/lib/deletion/rewrite";
import { libraryMatchId } from "@/lib/library/ids";
import { programPath } from "@/lib/firebase/paths";
import type { Data, Deps, StoreOp, StoredDoc, StoreQuery } from "./ports";

/**
 * Runs the registry's entries for one person: finds their documents with path-based equality queries (never a collection group), and rewrites or deletes them
 * within a budget. Every query is a cursor of its own: a rewritten document no longer matches, so a crashed or interrupted run simply looks again.
 * `mode: "count"` is the final sweep: it reads and writes nothing, and counts the documents that still hold the person.
 */
export class BudgetExhausted extends Error {
  constructor(readonly which: "reads" | "writes" | "time") {
    super(`run budget exhausted (${which})`);
    this.name = "BudgetExhausted";
  }
}

export type Counters = { reads: number; writes: number; rewritten: Record<string, number>; deleted: Record<string, number>; skippedNamesakes: Record<string, number> };
export const emptyCounters = (): Counters => ({ reads: 0, writes: 0, rewritten: {}, deleted: {}, skippedNamesakes: {} });

export type Ctx = {
  deps: Deps;
  uid: string;
  opaque: string;
  mode: "apply" | "count";
  maxReads: number;
  maxWrites: number;
  /** The run stops starting new work after this time (epoch ms), so a request never outlives its deadline. */
  deadlineAt: number;
  readsUsed: number;
  writesUsed: number;
  programs: readonly ProgramId[];
  teamIds: Record<string, Set<string>>;
  derived: { liveMatchKeys: Record<string, Set<string>>; lobbyIds: Record<string, Set<string>> };
  derivedDirty: boolean;
  /** Called BEFORE a batch that rewrites sessions is committed, so the derived keys survive a crash in between. */
  persistDerived: () => Promise<void>;
  /** In memory only, never stored: the names and emails this person is known by. */
  identity: { names: string[]; emails: string[]; emailsLower: string[] };
  rosterNames: Map<string, Set<string>>;
  counters: Counters;
  /** Count mode: documents that still hold the person. */
  found: number;
  /** Count mode: the entries that still hold them (ids only). */
  foundIn: string[];
};

const PAGE = 200;
const CHUNK = 400;

const scopeOf = (entry: RegistryEntry, program: ProgramId): string => (entry.scope === "site" ? "site" : program);
export const doneKey = (entry: RegistryEntry, program: ProgramId): string => `${scopeOf(entry, program)}:${entry.id}`;
const rootOf = (entry: RegistryEntry) => entry.collection.split("/")[0];
const collPath = (entry: RegistryEntry, program: ProgramId) => (entry.scope === "site" ? rootOf(entry) : programPath(program, rootOf(entry)));
const teamsPath = (program: ProgramId) => programPath(program, "teams");
const teamsOf = (ctx: Ctx, program: ProgramId): string[] => [...(ctx.teamIds[program] ?? [])];

function bump(map: Record<string, number>, key: string, by: number): void {
  if (by > 0) map[key] = (map[key] ?? 0) + by;
}

export function checkBudget(ctx: Ctx): void {
  if (ctx.readsUsed >= ctx.maxReads) throw new BudgetExhausted("reads");
  if (ctx.deps.now() > ctx.deadlineAt) throw new BudgetExhausted("time");
}

/** A page of a query. In count mode (the sweep) it asks for one document only, unless `full` (a lookup the sweep itself needs, such as a roster). */
async function readPage(ctx: Ctx, q: StoreQuery, full = false): Promise<StoredDoc[]> {
  checkBudget(ctx);
  const docs = await ctx.deps.store.query(ctx.mode === "count" && !full ? { ...q, limit: Math.min(q.limit, 1) } : q);
  ctx.readsUsed += Math.max(1, docs.length);
  return docs;
}

async function readDoc(ctx: Ctx, path: string): Promise<StoredDoc | null> {
  checkBudget(ctx);
  const d = await ctx.deps.store.get(path);
  ctx.readsUsed += 1;
  return d;
}

/** Commits the ops in batches, never past the write budget (the part that fits is committed first, then the run stops). */
async function writeOps(ctx: Ctx, ops: StoreOp[]): Promise<void> {
  for (let i = 0; i < ops.length; i += CHUNK) {
    const room = ctx.maxWrites - ctx.writesUsed;
    if (room <= 0) throw new BudgetExhausted("writes");
    if (ctx.deps.now() > ctx.deadlineAt) throw new BudgetExhausted("time");
    const chunk = ops.slice(i, i + Math.min(CHUNK, room));
    await ctx.deps.store.commit(chunk);
    ctx.writesUsed += chunk.length;
    if (chunk.length < Math.min(CHUNK, ops.length - i)) throw new BudgetExhausted("writes");
  }
}

const isPreconditionFailure = (err: unknown) => (err as { code?: unknown })?.code === 9;

// ---------------------------------------------------------------------------------------------------------------------------------------------
// what to do with one found document
// ---------------------------------------------------------------------------------------------------------------------------------------------

function discover(ctx: Ctx, program: ProgramId, entry: RegistryEntry, docs: readonly StoredDoc[]): void {
  for (const d of docs) {
    const teamId = d.data.teamId;
    const set = (ctx.teamIds[program] ??= new Set());
    if (typeof teamId === "string" && teamId !== "") set.add(teamId);
    // A pending-join pointer lists the teams the person asked to join (their request documents sit under those teams).
    if (Array.isArray(d.data.entries)) for (const e of d.data.entries as { teamId?: unknown }[]) if (typeof e?.teamId === "string" && e.teamId !== "") set.add(e.teamId);
    if (entry.id === "practiceSessions") {
      const lobby = d.data.lobbyId;
      if (typeof lobby === "string" && lobby !== "") {
        const set = (ctx.derived.lobbyIds[program] ??= new Set());
        if (!set.has(lobby)) {
          set.add(lobby);
          ctx.derivedDirty = true;
        }
      }
      const { eventCode, matchType, matchNumber } = d.data;
      if (typeof eventCode === "string" && eventCode !== "" && typeof matchType === "string" && typeof matchNumber === "number") {
        const key = libraryMatchId(eventCode, matchType as never, matchNumber);
        const set = (ctx.derived.liveMatchKeys[program] ??= new Set());
        if (!set.has(key)) {
          set.add(key);
          ctx.derivedDirty = true;
        }
      }
    }
  }
}

type Opts = { knownMatch?: boolean; nameOnly?: { nameField: string; name: string; matchedName: boolean } };

/** The writes for one document, or [] when it holds nothing of the person. */
function opsFor(ctx: Ctx, entry: RegistryEntry, doc: StoredDoc, opts: Opts): { ops: StoreOp[]; kind: "rewritten" | "deleted" } {
  if (entry.action === "delete") return { ops: [{ kind: "delete", path: doc.path }], kind: "deleted" };
  if (opts.nameOnly) {
    const patch = rewriteNameOnly(doc.data, opts.nameOnly.nameField);
    if (!patch) return { ops: [], kind: "rewritten" };
    const renamed = entry.renameId?.(doc.id, opts.nameOnly.name) ?? null;
    if (renamed) {
      const parent = doc.path.slice(0, doc.path.lastIndexOf("/"));
      return { ops: [{ kind: "set", path: `${parent}/${renamed}`, data: { ...doc.data, ...patch.set } }, { kind: "delete", path: doc.path }], kind: "rewritten" };
    }
    return { ops: [{ kind: "update", path: doc.path, data: patch.set, ifUnchangedSince: doc.updateTime }], kind: "rewritten" };
  }
  const spec = entry.rewrite;
  if (!spec) return { ops: [], kind: "rewritten" };
  const patch = rewriteDocument({ id: doc.id, data: doc.data, uid: ctx.uid, opaque: ctx.opaque, spec, knownMatch: opts.knownMatch });
  if (!patch) return { ops: [], kind: "rewritten" };
  return { ops: [{ kind: "update", path: doc.path, data: patch.set, deleteFields: patch.deleteFields, ifUnchangedSince: doc.updateTime }], kind: "rewritten" };
}

/** Applies the entry to the documents. Returns how many documents had something to do. */
async function applyDocs(ctx: Ctx, program: ProgramId, entry: RegistryEntry, docs: readonly StoredDoc[], opts: Opts = {}): Promise<number> {
  discover(ctx, program, entry, docs);
  const all: StoreOp[] = [];
  let touched = 0;
  let kind: "rewritten" | "deleted" = entry.action === "delete" ? "deleted" : "rewritten";
  for (const d of docs) {
    const r = opsFor(ctx, entry, d, opts);
    if (r.ops.length === 0) continue;
    touched += 1;
    kind = r.kind;
    all.push(...r.ops);
  }
  if (touched === 0) return 0;
  if (ctx.mode === "count") {
    ctx.found += touched;
    if (!ctx.foundIn.includes(entry.id)) ctx.foundIn.push(entry.id);
    return touched;
  }
  if (ctx.derivedDirty) {
    await ctx.persistDerived();
    ctx.derivedDirty = false;
  }
  await writeOps(ctx, all);
  bump(kind === "deleted" ? ctx.counters.deleted : ctx.counters.rewritten, `${scopeOf(entry, program)}:${entry.id}`, touched);
  return touched;
}

/** One narrowed query, run until it returns nothing (every handled document leaves the result). */
async function drain(ctx: Ctx, program: ProgramId, entry: RegistryEntry, q: StoreQuery, opts: Opts = {}): Promise<void> {
  let stale = 0;
  for (;;) {
    const docs = await readPage(ctx, q);
    if (docs.length === 0) return;
    let touched: number;
    try {
      touched = await applyDocs(ctx, program, entry, docs, opts);
    } catch (err) {
      // A document changed between our read and our write: look again (the read gets a fresh version). Never loop forever.
      if (isPreconditionFailure(err) && ++stale <= 5) continue;
      throw err;
    }
    if (ctx.mode === "count" || touched === 0 || docs.length < q.limit) return;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// finders
// ---------------------------------------------------------------------------------------------------------------------------------------------

async function rosterNamesOf(ctx: Ctx, program: ProgramId, teamId: string): Promise<Set<string>> {
  const key = `${program}:${teamId}`;
  const cached = ctx.rosterNames.get(key);
  if (cached) return cached;
  const names = new Set<string>();
  const fields = PROGRAMS[program].membership.nameFields;
  const users = await readPage(ctx, { path: programPath(program, "users"), where: [{ field: "teamId", op: "==", value: teamId }], limit: 500 }, true);
  for (const u of users) {
    if (u.id === ctx.uid) continue;
    for (const f of fields) {
      const v = u.data[f];
      if (typeof v === "string" && v.trim() !== "") names.add(normalizeName(v));
    }
  }
  const mems = await readPage(ctx, { path: programPath(program, "memberships"), where: [{ field: "teamId", op: "==", value: teamId }], limit: 500 }, true);
  for (const m of mems) {
    if (m.data.uid === ctx.uid) continue;
    const n = m.data.name;
    if (typeof n === "string" && n.trim() !== "") names.add(normalizeName(n));
  }
  ctx.rosterNames.set(key, names);
  return names;
}

async function runNames(ctx: Ctx, program: ProgramId, entry: RegistryEntry, f: Extract<Finder, { kind: "namesInTeams" }>): Promise<void> {
  if (ctx.mode === "count") return; // names are only known while the account's documents exist; the sweep checks by uid
  const coll = collPath(entry, program);
  for (const teamId of teamsOf(ctx, program)) {
    const roster = await rosterNamesOf(ctx, program, teamId);
    for (const name of ctx.identity.names) {
      const q: StoreQuery = { path: coll, where: [{ field: f.teamField, op: "==", value: teamId }, { field: f.nameField, op: "==", value: name }], limit: PAGE };
      const nameOnly = { nameField: f.nameField, name, matchedName: true };
      const wanted = (d: StoredDoc) => (f.idPrefix !== undefined ? d.id.startsWith(f.idPrefix) : f.uidFields.every((u) => typeof d.data[u] !== "string" || (d.data[u] as string).trim() === ""));
      if (roster.has(normalizeName(name))) {
        // A namesake on the same team: never guess. Count the rows that would have matched, by collection, and leave them.
        const docs = await readPage(ctx, q);
        bump(ctx.counters.skippedNamesakes, entry.id, docs.filter(wanted).length);
        continue;
      }
      for (let stale = 0; ; ) {
        const docs = (await readPage(ctx, q)).filter(wanted);
        if (docs.length === 0) break;
        try {
          const n = await applyDocs(ctx, program, entry, docs, { nameOnly });
          if (n === 0 || docs.length < PAGE) break;
        } catch (err) {
          if (isPreconditionFailure(err) && ++stale <= 5) continue;
          throw err;
        }
      }
    }
  }
}

async function runFinder(ctx: Ctx, program: ProgramId, entry: RegistryEntry, f: Finder): Promise<void> {
  const coll = collPath(entry, program);
  const uid = ctx.uid;
  switch (f.kind) {
    case "equals":
      return drain(ctx, program, entry, { path: coll, where: [{ field: f.field, op: "==", value: uid }], limit: PAGE });
    case "arrayContains":
      return drain(ctx, program, entry, { path: coll, where: [{ field: f.field, op: "array-contains", value: uid }], limit: PAGE });
    case "equalsKnown": {
      const values = f.known === "email" ? ctx.identity.emails : ctx.identity.emailsLower;
      for (const v of new Set(values)) await drain(ctx, program, entry, { path: coll, where: [{ field: f.field, op: "==", value: v }], limit: PAGE }, { knownMatch: true });
      return;
    }
    case "docId": {
      const d = await readDoc(ctx, `${coll}/${uid}`);
      if (d) await applyDocs(ctx, program, entry, [d]);
      return;
    }
    case "idPrefix":
      for (const p of f.prefixes) await drain(ctx, program, entry, { path: coll, idPrefix: `${p}${uid}_`, limit: PAGE });
      return;
    case "userTree": {
      for (const sub of f.subcollections) await drain(ctx, program, entry, { path: `${coll}/${uid}/${sub}`, limit: PAGE });
      const parent = await readDoc(ctx, `${coll}/${uid}`);
      if (parent) await applyDocs(ctx, program, entry, [parent]);
      return;
    }
    case "perTeamDoc":
      for (const t of teamsOf(ctx, program)) {
        for (const p of f.paths) {
          const d = await readDoc(ctx, `${teamsPath(program)}/${t}/${p.replace("{uid}", uid)}`);
          if (d) await applyDocs(ctx, program, entry, [d]);
        }
      }
      return;
    case "perTeamEquals":
      for (const t of teamsOf(ctx, program)) await drain(ctx, program, entry, { path: `${teamsPath(program)}/${t}/${f.sub}`, where: [{ field: f.field, op: "==", value: uid }], limit: PAGE });
      return;
    case "teamChildren":
      for (const t of teamsOf(ctx, program)) {
        const parents = await readPage(ctx, { path: coll, where: [{ field: f.teamField, op: "==", value: t }], limit: PAGE }, true);
        for (const p of parents) await drain(ctx, program, entry, { path: `${coll}/${p.id}/${f.child}`, where: [{ field: f.field, op: "==", value: uid }], limit: PAGE });
      }
      return;
    case "teamDocs":
      for (const t of teamsOf(ctx, program)) {
        const d = await readDoc(ctx, `${coll}/${t}`);
        if (d) await applyDocs(ctx, program, entry, [d]);
      }
      return;
    case "teamScan":
      for (const t of teamsOf(ctx, program)) {
        const docs = await readPage(ctx, { path: coll, where: [{ field: f.teamField, op: "==", value: t }], limit: 500 }, true);
        if (docs.length > 0) await applyDocs(ctx, program, entry, docs);
      }
      return;
    case "derived": {
      const keys = f.source === "liveMatchKeys" ? ctx.derived.liveMatchKeys[program] : ctx.derived.lobbyIds[program];
      for (const k of keys ?? []) {
        const d = await readDoc(ctx, f.child ? `${coll}/${k}/${f.child}/${uid}` : `${coll}/${k}`);
        if (d) await applyDocs(ctx, program, entry, [d]);
      }
      return;
    }
    case "namesInTeams":
      return runNames(ctx, program, entry, f);
  }
}

const SCAN_KINDS = new Set<Finder["kind"]>(["perTeamDoc", "perTeamEquals", "teamChildren", "teamDocs", "teamScan", "derived"]);

/** Entries that read other entries' results (team ids, derived keys) go last; the order inside each group is the registry's. */
export function orderEntries(entries: readonly RegistryEntry[]): RegistryEntry[] {
  const late = (e: RegistryEntry) => e.finders.some((f) => SCAN_KINDS.has(f.kind));
  return [...entries.filter((e) => !late(e)), ...entries.filter(late)];
}

export { readDoc, readPage, writeOps };
export async function runEntry(ctx: Ctx, program: ProgramId, entry: RegistryEntry): Promise<void> {
  for (const f of entry.finders) await runFinder(ctx, program, entry, f);
}

/** Stand-in name used when a row only carries a name and the person's names are not known any more. */
export const REPLACEMENT_NAME = DELETED_ACCOUNT_NAME;
export type { Data };
