import { PROGRAMS } from "@/config/programs";
import { PROGRAM_IDS, type ProgramId } from "@/config/programs/types";
import { COOLDOWN_MS, DELETED_ACCOUNT_NAME, DELETION_STEPS, MAX_SWEEP_LOOPS, isDeletedAccountId, type DeletionStatus, type DeletionStep } from "@/lib/deletion/constants";
import { PERSON_DATA_REGISTRY, siteEntries, type RegistryEntry } from "@/lib/deletion/registry";
import { guardEnding, rosterRowFromMembership, rosterRowFromUser, teamOwnerUid, mergeRosterRows, type RosterRow } from "@/lib/memberships/flows";
import { buildMembershipFromUser, membershipKey, readMembership } from "@/lib/memberships/model";
import { programPath } from "@/lib/firebase/paths";
import { isPlatformOwnerToken } from "@/lib/server/owner-admin";
import { BudgetExhausted, checkBudget, doneKey, emptyCounters, orderEntries, readDoc, readPage, runEntry, type Counters, type Ctx } from "./engine";
import type { Data, Deps, RunBudget, StoredDoc } from "./ports";

/**
 * THE ACCOUNT DELETION JOB (memberships build 4). A resumable, budgeted sequence of steps over `accountDeletions/{uid}` (server only; no email, no name):
 *
 *   disable -> cooldown (70 min) -> rewrite -> memberships -> delete -> avatars -> sweep -> auth -> finish
 *
 * - disable: the Auth user is disabled and its refresh tokens revoked. An ID token already issued stays valid for up to an hour, so nothing is rewritten until the
 *   cooldown has passed, and the SWEEP at the end must find nothing: a row written late (a stale admin screen, a sign-in sync) sends the job back to rewrite and
 *   delete, up to MAX_SWEEP_LOOPS times, then the job is marked `stalled` for the owner. Rules cannot check revocation, so this is the protection.
 * - rewrite: the person's uid becomes the job's opaque id and their name "Deleted Account" in every kept row (the registry says which). It runs BEFORE the
 *   memberships are ended because the names the person is known by (needed for rows that carry only a name) come from documents the next steps replace.
 * - memberships: every membership becomes `past` / `deleted` with the opaque id and the name "Deleted Account", copied to {teamId}_{opaque} (the old id holds the uid).
 * - delete: everything else about the person. avatars: the Blob prefix. auth: the Auth user. finish: the job document goes, so nothing links the person to the id.
 * Every step is idempotent (a query that finds nothing once it is done) and a run stops at its budget; the next run continues.
 */
export const JOB_COLLECTION = "accountDeletions";
export const jobPath = (uid: string) => `${JOB_COLLECTION}/${uid}`;

export type JobDoc = {
  status: DeletionStatus;
  step: DeletionStep;
  opaqueId: string;
  programs: ProgramId[];
  requestedBy: "self" | "owner";
  startedAt: number;
  updatedAt: number;
  /** End of the cooldown (epoch ms); null once it has passed. */
  notBeforeMs: number | null;
  /** Entries finished in the current pass of the current step (`<program|site>:<entry id>`). */
  passDone: string[];
  sweepLoops: number;
  runs: number;
  /** Team ids (not people) the person's rows may sit in; per program. */
  teamIds: Record<string, string[]>;
  /** Paths derived from the person's own sessions before those were rewritten (match keys, lobby ids); per program. */
  derived: { liveMatchKeys: Record<string, string[]>; lobbyIds: Record<string, string[]> };
  counters: Counters;
  /** The class or code of the last failure, never a message (a message can hold data). */
  lastError: string | null;
};

export type Result = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown> = {}): Result => ({ status: 200, body: { ok: true, ...body } });
export const fail = (status: number, code: string, error: string): Result => ({ status, body: { ok: false, code, error } });

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const listMap = (v: unknown): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Data)) out[k] = strList(x);
  return out;
};
const numMap = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Data)) if (typeof x === "number") out[k] = x;
  return out;
};

export function parseJob(data: Data | undefined): JobDoc | null {
  if (!data || typeof data.opaqueId !== "string") return null;
  const step = (DELETION_STEPS as readonly string[]).includes(data.step as string) ? (data.step as DeletionStep) : "disable";
  const d = (data.derived ?? {}) as Data;
  const c = (data.counters ?? {}) as Data;
  return {
    status: data.status === "cooldown" || data.status === "stalled" ? data.status : "running",
    step,
    opaqueId: data.opaqueId,
    programs: strList(data.programs).filter((p): p is ProgramId => (PROGRAM_IDS as readonly string[]).includes(p)),
    requestedBy: data.requestedBy === "owner" ? "owner" : "self",
    startedAt: typeof data.startedAt === "number" ? data.startedAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    notBeforeMs: typeof data.notBeforeMs === "number" ? data.notBeforeMs : null,
    passDone: strList(data.passDone),
    sweepLoops: typeof data.sweepLoops === "number" ? data.sweepLoops : 0,
    runs: typeof data.runs === "number" ? data.runs : 0,
    teamIds: listMap(data.teamIds),
    derived: { liveMatchKeys: listMap(d.liveMatchKeys), lobbyIds: listMap(d.lobbyIds) },
    counters: {
      reads: typeof c.reads === "number" ? c.reads : 0,
      writes: typeof c.writes === "number" ? c.writes : 0,
      rewritten: numMap(c.rewritten),
      deleted: numMap(c.deleted),
      skippedNamesakes: numMap(c.skippedNamesakes),
    },
    lastError: typeof data.lastError === "string" ? data.lastError : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// guards and start
// ---------------------------------------------------------------------------------------------------------------------------------------------

const PAGE = 500;

/** Teams the person is on in a program: the user document's pointer plus every membership (any status), so rows in teams they left are found too. */
async function teamsOfPerson(deps: Deps, program: ProgramId, uid: string): Promise<{ user: StoredDoc | null; pointer: string; active: Set<string>; all: Set<string>; memberships: StoredDoc[] }> {
  const user = await deps.store.get(programPath(program, "users") + `/${uid}`);
  const pointer = typeof user?.data.teamId === "string" ? user.data.teamId.trim() : "";
  const memberships = await deps.store.query({ path: programPath(program, "memberships"), where: [{ field: "uid", op: "==", value: uid }], limit: PAGE });
  const active = new Set<string>();
  const all = new Set<string>();
  if (pointer) {
    active.add(pointer);
    all.add(pointer);
  }
  for (const m of memberships) {
    const rec = readMembership(m.data);
    if (!rec) continue;
    all.add(rec.teamId);
    if (rec.status === "active") active.add(rec.teamId);
  }
  return { user, pointer, active, all, memberships };
}

/** The roster of a team as the guards see it: the pointer roster, plus the team's active memberships while the memberships switch is ON. */
async function rosterOf(deps: Deps, program: ProgramId, teamId: string, membershipsOn: boolean): Promise<RosterRow[]> {
  const users = await deps.store.query({ path: programPath(program, "users"), where: [{ field: "teamId", op: "==", value: teamId }], limit: 1000 });
  const rows = users.map((u) => rosterRowFromUser(program, u.id, u.data));
  if (!membershipsOn) return rows;
  const mems = await deps.store.query({ path: programPath(program, "memberships"), where: [{ field: "teamId", op: "==", value: teamId }, { field: "status", op: "==", value: "active" }], limit: 1000 });
  const memRows: RosterRow[] = [];
  for (const m of mems) {
    const rec = readMembership(m.data);
    if (rec) memRows.push(rosterRowFromMembership(rec));
  }
  return mergeRosterRows(rows, memRows);
}

export type StartInput = { uid: string; requestedBy: "self" | "owner"; actor: { uid: string; name: string }; budget: RunBudget; deadlineMs?: number };

/**
 * The refusals, in the order the person would hit them: 409 `deletion_in_progress` (an open job), 403 `platform_owner` (deleting a platform owner is a separate,
 * deliberate operation), 409 `last_admin` (the only active admin or owner of a team that still has other active members must transfer ownership or leave first).
 */
export async function checkGuards(deps: Deps, uid: string): Promise<{ refusal: Result | null; teamIds: Record<string, string[]> }> {
  const teamIds: Record<string, string[]> = {};
  const existing = await deps.store.get(jobPath(uid));
  if (existing) return { refusal: fail(409, "deletion_in_progress", "This account is already being deleted."), teamIds };
  const rec = await deps.auth.getUser(uid);
  if (isPlatformOwnerToken({ uid, email: rec?.email ?? null, email_verified: rec?.emailVerified === true, platformOwner: rec?.platformOwnerClaim === true })) {
    return { refusal: fail(403, "platform_owner", "A platform owner's account cannot be deleted here."), teamIds };
  }
  const membershipsOn = await deps.membershipsEnabled();
  for (const program of PROGRAM_IDS) {
    const p = await teamsOfPerson(deps, program, uid);
    teamIds[program] = [...p.all];
    for (const teamId of p.active) {
      const team = await deps.store.get(`${programPath(program, "teams")}/${teamId}`);
      const mem = p.memberships.map((m) => readMembership(m.data)).find((m) => m?.teamId === teamId) ?? null;
      const onPointer = p.pointer === teamId;
      const target: RosterRow = onPointer && p.user ? rosterRowFromUser(program, uid, p.user.data) : { uid, name: mem?.name ?? "", isAdmin: mem?.isAdmin === true, isOwner: mem?.isOwner === true, pointer: false };
      const ownerUid = team ? teamOwnerUid(program, team.data) : "";
      const needsRoster = target.isAdmin || target.isOwner || ownerUid === uid;
      if (!needsRoster) continue;
      const others = (await rosterOf(deps, program, teamId, membershipsOn)).filter((r) => r.uid !== uid);
      const refusal = guardEnding({ target, others, teamOwnerUid: ownerUid, force: false });
      if (refusal) return { refusal: fail(409, "last_admin", "You are the only admin or owner of a team that still has other members. Transfer ownership or make another member an admin first, or leave the team, then delete the account."), teamIds };
    }
  }
  return { refusal: null, teamIds };
}

export async function startDeletion(deps: Deps, input: StartInput): Promise<Result> {
  const { uid } = input;
  if (typeof uid !== "string" || uid.trim() === "" || uid.includes("/")) return fail(400, "bad_request", "Missing account.");
  const guarded = await checkGuards(deps, uid);
  if (guarded.refusal) return guarded.refusal;
  const opaqueId = deps.newOpaqueId();
  if (!isDeletedAccountId(opaqueId)) throw new Error("the opaque id has the wrong shape");
  const now = deps.now();
  const job: Record<string, unknown> = {
    status: "running",
    step: "disable",
    opaqueId,
    programs: [...PROGRAM_IDS],
    requestedBy: input.requestedBy,
    startedAt: now,
    updatedAt: now,
    notBeforeMs: null,
    passDone: [],
    sweepLoops: 0,
    runs: 0,
    teamIds: guarded.teamIds,
    derived: { liveMatchKeys: {}, lobbyIds: {} },
    counters: emptyCounters(),
    lastError: null,
  };
  try {
    await deps.store.commit([{ kind: "create", path: jobPath(uid), data: job }]);
  } catch (err) {
    if ((err as { code?: unknown })?.code === 6) return fail(409, "deletion_in_progress", "This account is already being deleted.");
    throw err;
  }
  await deps.audit("start-account-deletion", input.actor, { requestedBy: input.requestedBy, programs: [...PROGRAM_IDS] });
  return runDeletion(deps, uid, input.budget, { deadlineMs: input.deadlineMs });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// running
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type RunOpts = { resumeStalled?: boolean; actor?: { uid: string; name: string }; deadlineMs?: number };

type Run = { deps: Deps; uid: string; job: JobDoc; ctx: Ctx; baseReads: number; baseWrites: number };

const toLists = (m: Record<string, Set<string>>): Record<string, string[]> => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort()]));

/** Writes the job document (always allowed, even at the budget: it is how a run makes its progress durable). */
async function save(run: Run, patch: Partial<JobDoc> = {}): Promise<void> {
  Object.assign(run.job, patch);
  run.job.teamIds = toLists(run.ctx.teamIds);
  run.job.derived = { liveMatchKeys: toLists(run.ctx.derived.liveMatchKeys), lobbyIds: toLists(run.ctx.derived.lobbyIds) };
  run.job.counters = { ...run.ctx.counters, reads: run.baseReads + run.ctx.readsUsed, writes: run.baseWrites + run.ctx.writesUsed };
  run.job.updatedAt = run.deps.now();
  await run.deps.store.commit([{ kind: "set", path: jobPath(run.uid), data: run.job as unknown as Data }]);
  run.ctx.writesUsed += 1;
}

function makeCtx(deps: Deps, uid: string, job: JobDoc, budget: RunBudget, mode: "apply" | "count", deadlineMs: number, persist: () => Promise<void>): Ctx {
  const sets = (m: Record<string, string[]>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, new Set(v)]));
  return {
    deps, uid, opaque: job.opaqueId, mode, maxReads: budget.reads, maxWrites: budget.writes, deadlineAt: deps.now() + deadlineMs, readsUsed: 0, writesUsed: 0,
    programs: job.programs, teamIds: sets(job.teamIds), derived: { liveMatchKeys: sets(job.derived.liveMatchKeys), lobbyIds: sets(job.derived.lobbyIds) }, derivedDirty: false,
    persistDerived: persist, identity: { names: [], emails: [], emailsLower: [] }, rosterNames: new Map(),
    counters: { ...job.counters, rewritten: { ...job.counters.rewritten }, deleted: { ...job.counters.deleted }, skippedNamesakes: { ...job.counters.skippedNamesakes } },
    found: 0, foundIn: [],
  };
}

const entriesOf = (program: ProgramId, pick: (e: RegistryEntry) => boolean) => orderEntries(PERSON_DATA_REGISTRY[program].filter((e) => e.scope !== "site" && pick(e)));
const siteOf = (pick: (e: RegistryEntry) => boolean) => orderEntries(siteEntries().filter(pick));
const isRewrite = (e: RegistryEntry) => e.action === "rewrite" && e.customStep === undefined;
const isDelete = (e: RegistryEntry) => e.action === "delete" && e.customStep === undefined;

/** The names and emails the person is known by, in memory only. Names come from documents that exist until the delete step; the email also from the Auth user. */
async function gatherIdentity(run: Run): Promise<void> {
  const { ctx, uid, deps } = run;
  const names = new Set<string>();
  const emails = new Set<string>();
  const add = (set: Set<string>, v: unknown) => {
    if (typeof v === "string" && v.trim() !== "" && v.trim() !== DELETED_ACCOUNT_NAME) set.add(v.trim());
  };
  const rec = await deps.auth.getUser(uid);
  add(names, rec?.displayName);
  add(emails, rec?.email);
  if (ctx.mode === "apply") {
    for (const program of run.job.programs) {
      const user = await readDoc(ctx, `${programPath(program, "users")}/${uid}`);
      if (user) {
        for (const f of PROGRAMS[program].membership.nameFields) add(names, user.data[f]);
        add(emails, user.data.email);
      }
      const profile = await readDoc(ctx, `${programPath(program, "profiles")}/${uid}`);
      add(names, profile?.data.displayName);
      for (const m of await readPage(ctx, { path: programPath(program, "memberships"), where: [{ field: "uid", op: "==", value: uid }], limit: 100 })) add(names, m.data.name);
    }
  }
  ctx.identity = { names: [...names], emails: [...emails], emailsLower: [...emails].map((e) => e.toLowerCase()) };
}

async function runEntries(run: Run, pick: (e: RegistryEntry) => boolean): Promise<void> {
  const { ctx } = run;
  const work: { program: ProgramId; entry: RegistryEntry }[] = [];
  for (const program of run.job.programs) for (const entry of entriesOf(program, pick)) work.push({ program, entry });
  for (const entry of siteOf(pick)) work.push({ program: run.job.programs[0], entry });
  for (const { program, entry } of work) {
    const key = doneKey(entry, program);
    if (run.job.passDone.includes(key)) continue;
    checkBudget(ctx);
    const before = ctx.writesUsed;
    await runEntry(ctx, program, entry);
    run.job.passDone.push(key);
    if (ctx.writesUsed > before) await save(run);
  }
}

/** Ends every membership as `deleted`: copied to {teamId}_{opaque} (the id held the uid) with the opaque id and "Deleted Account", role and dates kept. */
async function endMemberships(run: Run): Promise<void> {
  const { ctx, uid, deps } = run;
  const membershipsOn = await deps.membershipsEnabled();
  const now = deps.now();
  for (const program of run.job.programs) {
    const coll = programPath(program, "memberships");
    const key = `${program}:memberships`;
    if (run.job.passDone.includes(key)) continue;
    const user = await readDoc(ctx, `${programPath(program, "users")}/${uid}`);
    const mems = await readPage(ctx, { path: coll, where: [{ field: "uid", op: "==", value: uid }], limit: PAGE }, true);
    const have = new Set(mems.map((m) => readMembership(m.data)?.teamId));
    const pointer = typeof user?.data.teamId === "string" ? user.data.teamId.trim() : "";
    const endedFrom = (data: Data): Data => ({ ...data, uid: ctx.opaque, name: DELETED_ACCOUNT_NAME, status: "past", endedBy: "deleted", leftAt: typeof data.leftAt === "number" && data.leftAt > 0 ? data.leftAt : now, updatedAt: now });
    const writes: { ops: Parameters<Deps["store"]["commit"]>[0]; teamId: string }[] = [];
    for (const m of mems) {
      const rec = readMembership(m.data);
      if (!rec) continue;
      const id = membershipKey(rec.teamId, ctx.opaque);
      if (!id.ok) continue;
      writes.push({ teamId: rec.teamId, ops: [{ kind: "set", path: `${coll}/${id.id}`, data: endedFrom(m.data) }, { kind: "delete", path: m.path }] });
    }
    // The pointer team of a person with no membership document there (only while memberships are ON; OFF uses the pointer as the only membership and writes none).
    if (membershipsOn && user && pointer && !have.has(pointer)) {
      const built = buildMembershipFromUser(program, uid, user.data, typeof user.data.createdAt === "number" ? user.data.createdAt : now);
      const id = membershipKey(pointer, ctx.opaque);
      if (built.ok && id.ok) writes.push({ teamId: pointer, ops: [{ kind: "set", path: `${coll}/${id.id}`, data: endedFrom(built.doc as unknown as Data) }] });
    }
    for (const w of writes) {
      checkBudget(ctx);
      if (ctx.writesUsed + w.ops.length > ctx.maxWrites) throw new BudgetExhausted("writes");
      await deps.store.commit(w.ops);
      ctx.writesUsed += w.ops.length;
      (ctx.teamIds[program] ??= new Set()).add(w.teamId);
      ctx.counters.rewritten[`${program}:memberships`] = (ctx.counters.rewritten[`${program}:memberships`] ?? 0) + 1;
    }
    // Memberships this person VERIFIED (their uid in `verifiedBy` on someone else's document).
    for (;;) {
      const docs = await readPage(ctx, { path: coll, where: [{ field: "verifiedBy", op: "==", value: uid }], limit: 200 });
      if (docs.length === 0) break;
      if (ctx.writesUsed + docs.length > ctx.maxWrites) throw new BudgetExhausted("writes");
      await deps.store.commit(docs.map((d) => ({ kind: "update" as const, path: d.path, data: { verifiedBy: ctx.opaque } })));
      ctx.writesUsed += docs.length;
      if (docs.length < 200) break;
    }
    run.job.passDone.push(key);
    await save(run);
  }
}

/**
 * The sweep: count (never write) what still holds the person, entry by entry. It stops at the FIRST finding (any finding sends the job back), and an entry that
 * found nothing is remembered in `passDone`, so a sweep that runs out of budget continues where it stopped instead of starting over.
 */
async function sweep(run: Run): Promise<number> {
  const { ctx } = run;
  const gone = await run.deps.auth.getUser(run.uid);
  if (gone?.email) {
    ctx.identity.emails = [...new Set([...ctx.identity.emails, gone.email])];
    ctx.identity.emailsLower = ctx.identity.emails.map((e) => e.toLowerCase());
  }
  const work: { key: string; program: ProgramId; entry: RegistryEntry }[] = [];
  for (const program of run.job.programs) for (const entry of entriesOf(program, (e) => isRewrite(e) || isDelete(e))) work.push({ key: `sweep:${doneKey(entry, program)}`, program, entry });
  for (const entry of siteOf((e) => isRewrite(e) || isDelete(e))) work.push({ key: `sweep:${doneKey(entry, run.job.programs[0])}`, program: run.job.programs[0], entry });
  ctx.mode = "count";
  ctx.found = 0;
  ctx.foundIn = [];
  try {
    for (const { key, program, entry } of work) {
      if (run.job.passDone.includes(key)) continue;
      checkBudget(ctx);
      await runEntry(ctx, program, entry);
      if (ctx.found > 0) break;
      run.job.passDone.push(key);
    }
    if (ctx.found === 0) {
      // Memberships still under the person's uid, or verified by it.
      for (const program of run.job.programs) {
        const key = `sweep:${program}:memberships`;
        if (run.job.passDone.includes(key)) continue;
        for (const field of ["uid", "verifiedBy"]) {
          const docs = await readPage(ctx, { path: programPath(program, "memberships"), where: [{ field, op: "==", value: run.uid }], limit: 1 });
          if (docs.length > 0) {
            ctx.found += docs.length;
            ctx.foundIn.push(`${program}:memberships`);
          }
        }
        if (ctx.found > 0) break;
        run.job.passDone.push(key);
      }
    }
  } finally {
    ctx.mode = "apply";
  }
  run.job.lastError = ctx.found > 0 ? `sweep found rows in: ${[...new Set(ctx.foundIn)].join(", ")}` : null;
  return ctx.found;
}

export type RunResult = { done: boolean; status: DeletionStatus | "finished"; step: DeletionStep; waitingUntilMs: number | null; reads: number; writes: number; stoppedBy: "budget" | "time" | "cooldown" | null };

const body = (run: Run, over: Partial<RunResult>): Result =>
  ok({ done: false, status: run.job.status, step: run.job.step, waitingUntilMs: run.job.notBeforeMs, reads: run.ctx.readsUsed, writes: run.ctx.writesUsed, stoppedBy: null, ...over });

export async function runDeletion(deps: Deps, uid: string, budget: RunBudget, opts: RunOpts = {}): Promise<Result> {
  const snap = await deps.store.get(jobPath(uid));
  if (!snap) return fail(404, "no_such_deletion", "There is no deletion in progress for this account.");
  const job = parseJob(snap.data);
  if (!job) return fail(500, "bad_job", "The deletion job is unreadable.");
  const run: Run = { deps, uid, job, ctx: null as unknown as Ctx, baseReads: job.counters.reads, baseWrites: job.counters.writes };
  run.ctx = makeCtx(deps, uid, job, budget, "apply", opts.deadlineMs ?? 12_000, () => save(run));
  run.ctx.readsUsed += 1; // the job document itself

  if (job.status === "stalled") {
    if (!opts.resumeStalled) return body(run, {});
    await save(run, { status: "running", step: "rewrite", sweepLoops: 0, passDone: [], notBeforeMs: null, lastError: null });
    await deps.audit("resume-account-deletion", opts.actor ?? { uid: "system", name: "Account deletion" }, { stalledSweeps: job.sweepLoops });
  }
  job.runs += 1;
  try {
    for (;;) {
      checkBudget(run.ctx);
      switch (job.step) {
        case "disable":
          await deps.auth.disable(uid);
          await deps.auth.revokeTokens(uid);
          await save(run, { step: "cooldown", status: "cooldown", notBeforeMs: deps.now() + COOLDOWN_MS, passDone: [] });
          break;
        case "cooldown":
          if (job.notBeforeMs !== null && deps.now() < job.notBeforeMs) {
            await save(run, {});
            return body(run, { stoppedBy: "cooldown" });
          }
          await save(run, { status: "running", step: "rewrite", notBeforeMs: null, passDone: [] });
          break;
        case "rewrite":
          await gatherIdentity(run);
          await runEntries(run, isRewrite);
          await save(run, { step: "memberships", passDone: [] });
          break;
        case "memberships":
          await endMemberships(run);
          await save(run, { step: "delete", passDone: [] });
          break;
        case "delete":
          await gatherIdentity(run);
          await runEntries(run, isDelete);
          await save(run, { step: "avatars", passDone: [] });
          break;
        case "avatars":
          await deps.blobs.deleteAvatars(uid);
          await save(run, { step: "sweep", passDone: [] });
          break;
        case "sweep": {
          await gatherIdentity(run);
          const found = await sweep(run);
          if (found === 0) {
            await save(run, { step: "auth", passDone: [], lastError: null });
          } else if (job.sweepLoops >= MAX_SWEEP_LOOPS) {
            await save(run, { status: "stalled" });
            await deps.audit("stall-account-deletion", { uid: "system", name: "Account deletion" }, { sweeps: job.sweepLoops + 1 });
            return body(run, {});
          } else {
            await save(run, { step: "rewrite", sweepLoops: job.sweepLoops + 1, passDone: [] });
          }
          break;
        }
        case "auth":
          await deps.auth.deleteUser(uid);
          await save(run, { step: "finish" });
          break;
        case "finish": {
          const skipped = job.counters.skippedNamesakes;
          const unprocessed = [...new Set(PROGRAM_IDS.flatMap((p) => PERSON_DATA_REGISTRY[p]).filter((e) => e.action === "owner").map((e) => e.id))];
          await deps.audit("finish-account-deletion", { uid: "system", name: "Account deletion" }, { requestedBy: job.requestedBy, programs: job.programs, rewritten: job.counters.rewritten, deleted: job.counters.deleted, skippedNamesakes: skipped, unprocessed, sweepLoops: job.sweepLoops });
          await deps.store.commit([{ kind: "delete", path: jobPath(uid) }]);
          run.ctx.writesUsed += 1;
          return ok({ done: true, status: "finished", step: "finish", waitingUntilMs: null, reads: run.ctx.readsUsed, writes: run.ctx.writesUsed, stoppedBy: null });
        }
      }
    }
  } catch (err) {
    if (err instanceof BudgetExhausted) {
      await save(run, {}).catch(() => {});
      return body(run, { stoppedBy: err.which === "time" ? "time" : "budget" });
    }
    const code = (err as { code?: unknown })?.code;
    await save(run, { lastError: typeof code === "string" || typeof code === "number" ? `code ${code}` : err instanceof Error ? err.name : "error" }).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// the owner's views
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type JobSummary = { opaqueId: string; status: DeletionStatus; step: DeletionStep; startedAt: number; updatedAt: number; notBeforeMs: number | null; sweepLoops: number; runs: number; lastError: string | null; requestedBy: "self" | "owner" };

/** Opaque ids and statuses only: no uid (the document id), no name, no email. */
export async function listJobs(deps: Deps): Promise<JobSummary[]> {
  const docs = await deps.store.query({ path: JOB_COLLECTION, limit: 100 });
  const out: JobSummary[] = [];
  for (const d of docs) {
    const j = parseJob(d.data);
    if (j) out.push({ opaqueId: j.opaqueId, status: j.status, step: j.step, startedAt: j.startedAt, updatedAt: j.updatedAt, notBeforeMs: j.notBeforeMs, sweepLoops: j.sweepLoops, runs: j.runs, lastError: j.lastError, requestedBy: j.requestedBy });
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/** The job document's id (the uid) for an opaque id: the owner's Resume button sends the opaque id, never a uid. */
export async function uidForOpaque(deps: Deps, opaqueId: string): Promise<string | null> {
  if (!isDeletedAccountId(opaqueId)) return null;
  const docs = await deps.store.query({ path: JOB_COLLECTION, where: [{ field: "opaqueId", op: "==", value: opaqueId }], limit: 1 });
  return docs[0]?.id ?? null;
}

/** Every open job's uid, oldest first (the cron route resumes them; stalled ones are skipped: they wait for the owner). */
export async function openJobUids(deps: Deps): Promise<string[]> {
  const docs = await deps.store.query({ path: JOB_COLLECTION, limit: 100 });
  return docs.filter((d) => parseJob(d.data)?.status !== "stalled").sort((a, b) => (parseJob(a.data)?.startedAt ?? 0) - (parseJob(b.data)?.startedAt ?? 0)).map((d) => d.id);
}
