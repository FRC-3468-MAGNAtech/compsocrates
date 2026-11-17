import { UsageError, assertNoKeyFileArgs } from "@/lib/firestore-export/args";
import { PROGRAM_IDS, type ProgramId } from "@/config/programs/types";

// Command-line options of scripts/backfill-memberships.ts. Pure: nothing here touches Firestore. The key-file guard is the export script's own.

export type BackfillOptions = {
  apply: boolean;
  confirmProject: string | null;
  programs: ProgramId[];
  /** Apply to these teams only (empty: every team). */
  teams: string[];
  /** Most membership documents one run may create (null: no cap beyond --max-writes). */
  max: number | null;
  maxWrites: number;
  dailyWriteCeiling: number;
  maxReads: number;
  dailyReadCeiling: number;
  pauseMs: number;
  /** Dry run only: read the user documents to list per-team counts (costs reads; the plain dry run only counts). */
  detail: boolean;
  ledgerDir: string | null;
};

const BOOLEANS = new Set(["apply", "detail"]);
const VALUES = new Set(["confirm-project", "program", "team", "max", "max-writes", "daily-write-ceiling", "max-reads", "daily-ceiling", "pause-ms", "ledger-dir"]);

function int(name: string, raw: string, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

export function parseBackfillArgs(argv: string[]): BackfillOptions {
  assertNoKeyFileArgs(argv);
  const o: BackfillOptions = {
    apply: false,
    confirmProject: null,
    programs: [...PROGRAM_IDS],
    teams: [],
    max: null,
    maxWrites: 5000,
    dailyWriteCeiling: 10000,
    maxReads: 20000,
    dailyReadCeiling: 25000,
    pauseMs: 250,
    detail: false,
    ledgerDir: null,
  };
  for (const a of argv) {
    if (!a.startsWith("--")) throw new UsageError(`Unexpected argument "${a}".`);
    const eq = a.indexOf("=");
    const name = a.slice(2, eq === -1 ? undefined : eq);
    const val = eq === -1 ? null : a.slice(eq + 1);
    if (BOOLEANS.has(name)) {
      if (val !== null) throw new UsageError(`--${name} takes no value.`);
      if (name === "apply") o.apply = true;
      if (name === "detail") o.detail = true;
    } else if (VALUES.has(name)) {
      if (!val) throw new UsageError(`--${name} needs a value (--${name}=...).`);
      if (name === "confirm-project") o.confirmProject = val;
      if (name === "program") {
        if (val === "both") o.programs = [...PROGRAM_IDS];
        else if ((PROGRAM_IDS as readonly string[]).includes(val)) o.programs = [val as ProgramId];
        else throw new UsageError(`--program must be ${PROGRAM_IDS.join(", ")} or both.`);
      }
      if (name === "team") o.teams.push(val);
      if (name === "max") o.max = int(name, val, 1, 1_000_000);
      if (name === "max-writes") o.maxWrites = int(name, val, 1, 1_000_000);
      if (name === "daily-write-ceiling") o.dailyWriteCeiling = int(name, val, 1, 1_000_000);
      if (name === "max-reads") o.maxReads = int(name, val, 1, 1_000_000);
      if (name === "daily-ceiling") o.dailyReadCeiling = int(name, val, 1, 1_000_000);
      if (name === "pause-ms") o.pauseMs = int(name, val, 0, 60_000);
      if (name === "ledger-dir") o.ledgerDir = val;
    } else {
      throw new UsageError(`Unknown option --${name}.`);
    }
  }
  if (o.apply && !o.confirmProject) throw new UsageError("--apply needs --confirm-project=<project id> (it must equal the project in the credentials).");
  return o;
}

/** The credentials' project must equal --confirm-project before anything is written. */
export function assertConfirmedProject(confirm: string | null, projectId: string): void {
  if (!confirm) throw new UsageError(`--apply needs --confirm-project=<project id>; the credentials are for project ${projectId}.`);
  if (confirm !== projectId) throw new UsageError(`--confirm-project (${confirm}) does not equal the project in the credentials (${projectId}); nothing was written.`);
}
