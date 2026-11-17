import type { ProgramId } from "@/config/programs/types";
import { programPath } from "@/lib/firebase/paths";
import { UsageError } from "@/lib/firestore-export/args";
import { ledgerTotal, pacificDay, type Ledger } from "@/lib/firestore-export/ledger";
import type { BackfillOptions } from "./args";
import { planBackfill, type ExistingMembership, type Plan, type PlannedCreate, type UserRow } from "./plan";

// The backfill's run: the ONLY way it talks to Firestore is the small `BackfillDb` interface below. It can read, count, and CREATE membership documents.
// It has no update or delete and no way to name a user document for writing. Quota-careful: the plain dry run only counts; reads and writes are capped per
// run and per Pacific day (the export script's ledger), batches are 400 documents with a pause between them.

export const BATCH_SIZE = 400;

export interface BackfillDb {
  /** `appSettings/global.membershipsEnabled === true` (one read). */
  membershipsEnabled(): Promise<boolean>;
  /** Users with a non-empty `teamId` (optionally one team). A count() aggregation: about one read per 1000 index entries. */
  countUsers(program: ProgramId, team: string | null): Promise<number>;
  countMemberships(program: ProgramId): Promise<number>;
  readUsers(program: ProgramId, team: string | null, limit: number): Promise<UserRow[]>;
  readMemberships(program: ProgramId, limit: number): Promise<ExistingMembership[]>;
  /** Which of these team ids exist as team documents (one read each). */
  teamsExist(program: ProgramId, teamIds: string[]): Promise<Set<string>>;
  /** Creates the documents (create-only: an existing one is never overwritten). Returns how many were created and how many already existed. */
  createBatch(program: ProgramId, items: PlannedCreate[]): Promise<{ created: number; existed: number }>;
}

/** The read and write counters per Pacific day, in two ledgers (the export script's format). */
export interface BackfillLedgers {
  reads(): Ledger;
  writes(): Ledger;
  saveReads(l: Ledger): void;
  saveWrites(l: Ledger): void;
}

export type RunDeps = { db: BackfillDb; ledgers: BackfillLedgers; now: () => Date; sleep: (ms: number) => Promise<void>; log: (line: string) => void };

export type RunResult = { exitCode: number; plan: Plan | null; created: number; existed: number; reads: number; writes: number };

/** Throws when this Pacific day's recorded `kind`s plus this run's cap would pass the daily ceiling. */
export function assertUnderCeiling(kind: "reads" | "writes", ledger: Ledger, day: string, cap: number, ceiling: number): void {
  const used = ledgerTotal(ledger, day);
  if (used + cap > ceiling) {
    throw new UsageError(`Refusing to run: this script has already used ${used} ${kind} on ${day} (Pacific), this run could use up to ${cap}, and the daily ${kind} ceiling is ${ceiling}. Lower the cap, raise the ceiling, or run after midnight Pacific.`);
  }
}

const bump = (l: Ledger, day: string, n: number): Ledger => ({ days: { ...l.days, [day]: ledgerTotal(l, day) + n } });

/** Splits into batches of `size` (400). */
export function chunk<T>(items: readonly T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function runBackfill(opts: BackfillOptions, deps: RunDeps): Promise<RunResult> {
  const { db, log } = deps;
  const today = pacificDay(deps.now());
  const counters = { reads: 0, writes: 0 };
  const result: RunResult = { exitCode: 0, plan: null, created: 0, existed: 0, reads: 0, writes: 0 };
  const teamFilter = opts.teams.length ? opts.teams : [null];

  try {
    if (opts.apply) {
      assertUnderCeiling("writes", deps.ledgers.writes(), today, opts.maxWrites, opts.dailyWriteCeiling);
      counters.reads += 1;
      if (!(await db.membershipsEnabled())) {
        throw new UsageError("appSettings/global.membershipsEnabled is not true, so --apply is refused. Set it to true by hand in the Firestore console first (see docs/MEMBERSHIP_BUILD1_RESULTS.md).");
      }
    }

    // 1. Counts (cheap).
    let userCount = 0;
    let membershipCount = 0;
    for (const program of opts.programs) {
      for (const team of teamFilter) {
        const n = await db.countUsers(program, team);
        counters.reads += 1;
        userCount += n;
        log(`${program}: ${n} user document(s) with a team${team ? ` ${team}` : ""}`);
      }
      const m = await db.countMemberships(program);
      counters.reads += 1;
      membershipCount += m;
      log(`${program}: ${m} membership document(s) already exist`);
    }
    const estimate = userCount + membershipCount;
    log(`A full read needs about ${estimate} document reads (users and existing memberships), plus one per distinct team. Per-run cap ${opts.maxReads}, daily ceiling ${opts.dailyReadCeiling}.`);

    if (!opts.apply && !opts.detail) {
      log("DRY RUN (counts only): no documents were read. Add --detail to read them and list per-team counts, or --apply --confirm-project=<project id> to create the memberships.");
      return finish(result, counters);
    }
    if (estimate > opts.maxReads) throw new UsageError(`This needs about ${estimate} reads, over --max-reads ${opts.maxReads}; nothing was read. Use --team=<id> to narrow it, or raise --max-reads.`);
    assertUnderCeiling("reads", deps.ledgers.reads(), today, Math.min(opts.maxReads, estimate + 200), opts.dailyReadCeiling);

    // 2. Read what the plan needs.
    const existing: ExistingMembership[] = [];
    for (const program of opts.programs) {
      const rows = await db.readMemberships(program, membershipCount + 50);
      counters.reads += rows.length;
      existing.push(...rows);
    }
    const users: Partial<Record<ProgramId, UserRow[]>> = {};
    for (const program of opts.programs) {
      const all: UserRow[] = [];
      for (const team of teamFilter) {
        const rows = await db.readUsers(program, team, userCount + 50);
        counters.reads += rows.length;
        all.push(...rows);
      }
      users[program] = all;
    }
    const teamsFound: Partial<Record<ProgramId, Set<string>>> = {};
    for (const program of opts.programs) {
      const ids = [...new Set((users[program] ?? []).map((u) => String(u.data.teamId ?? "")).filter((t) => t !== "" && !t.includes("/")))];
      teamsFound[program] = ids.length ? await db.teamsExist(program, ids) : new Set();
      counters.reads += ids.length;
    }

    // 3. Plan and report.
    const plan = planBackfill({ users, existing, teamsFound, onlyTeams: opts.teams, nowMs: deps.now().getTime() });
    result.plan = plan;
    report(plan, opts, log);

    if (!opts.apply) {
      log("DRY RUN: nothing was written. To create these, add --apply --confirm-project=<project id>.");
      return finish(result, counters);
    }

    // 4. Create (create-only, batches of 400, capped).
    const cap = Math.min(opts.max ?? Infinity, opts.maxWrites);
    const todo = plan.toCreate.slice(0, cap);
    if (todo.length < plan.toCreate.length) log(`Capped at ${todo.length} of ${plan.toCreate.length} (--max / --max-writes); run again for the rest.`);
    for (const program of opts.programs) {
      const mine = todo.filter((c) => c.program === program);
      for (const batch of chunk(mine)) {
        const r = await db.createBatch(program, batch);
        result.created += r.created;
        result.existed += r.existed;
        counters.writes += r.created;
        deps.ledgers.saveWrites(bump(deps.ledgers.writes(), today, r.created));
        log(`${program}: created ${r.created}${r.existed ? `, ${r.existed} already existed (left as they were)` : ""} (${result.created} so far)`);
        if (opts.pauseMs) await deps.sleep(opts.pauseMs);
      }
    }
    log(`Done: ${result.created} membership document(s) created in ${planPath(opts)}. No user document was touched.`);
    return finish(result, counters);
  } finally {
    // Counting and reading are reads too; record them so the next run sees the day's total.
    if (counters.reads) deps.ledgers.saveReads(bump(deps.ledgers.reads(), today, counters.reads));
  }
}

function finish(result: RunResult, counters: { reads: number; writes: number }): RunResult {
  result.reads = counters.reads;
  result.writes = counters.writes;
  return result;
}

const planPath = (opts: BackfillOptions) => opts.programs.map((p) => programPath(p, "memberships")).join(" and ");

export function report(plan: Plan, opts: BackfillOptions, log: (line: string) => void): void {
  log(`Would create ${plan.toCreate.length} membership(s); ${plan.alreadyHave} user(s) already have one${opts.teams.length ? `; ${plan.outsideTeamFilter} outside --team` : ""}.`);
  for (const t of [...plan.perTeam].sort((a, b) => b.toCreate - a.toCreate || (a.teamId < b.teamId ? -1 : 1))) log(`  ${t.program} team ${t.teamId}: ${t.toCreate}`);
  if (plan.missingTeams.length) {
    log(`Users whose teamId points at a team that does NOT exist (reported, not fixed, not backfilled):`);
    for (const t of plan.missingTeams) log(`  ${t.program} team ${t.teamId}: ${t.uids.length} user(s): ${t.uids.slice(0, 20).join(", ")}${t.uids.length > 20 ? ", ..." : ""}`);
  }
  if (plan.wouldExceed.length) {
    log(`Users who would pass the limit of active memberships per account (not backfilled):`);
    for (const u of plan.wouldExceed) log(`  ${u.program} ${u.uid} -> team ${u.teamId}`);
  }
  if (plan.invalidIds.length) {
    log(`Users whose teamId or uid contains "_" or "/" and cannot make a membership key (not backfilled):`);
    for (const u of plan.invalidIds) log(`  ${u.program} ${u.uid} -> team ${u.teamId}`);
  }
}
