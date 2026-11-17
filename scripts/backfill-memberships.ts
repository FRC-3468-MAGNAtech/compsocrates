/**
 * Creates the membership documents for accounts that already have an active team (docs/MEMBERSHIP_BUILD1_RESULTS.md). NEVER run by the build, the tests or a
 * deploy. WRITE-ONLY into the new membership collections (one per program): it creates documents that do not exist and never overwrites one,
 * and it never touches a user document. It runs against whatever project the credentials name, and there is no staging project: take a managed Firestore export
 * first, run the dry run, then one small team, then the rest.
 *
 *   Dry run (the default; COUNTS only, reads no documents):
 *     npm run backfill:memberships
 *   Dry run that reads the user documents and lists per-team counts, missing teams and over-limit accounts (costs reads):
 *     npm run backfill:memberships -- --detail
 *   Apply (needs --confirm-project equal to the credentials' project AND appSettings/global.membershipsEnabled == true):
 *     npm run backfill:memberships -- --apply --confirm-project=<project id> --team=<teamId> --max=200
 *   Options: --program=<program id>|both  --team=<id> (repeatable)  --max=<documents created this run>  --max-writes=5000  --daily-write-ceiling=10000
 *            --max-reads=20000  --daily-ceiling=25000  --pause-ms=250  --ledger-dir=<folder outside the repo>
 *
 * Environment (a service account; names only here, never put values in a file): CS_ADMIN_PROJECT_ID, CS_ADMIN_CLIENT_EMAIL, CS_ADMIN_PRIVATE_KEY.
 * There is no fallback to other variable names and no key-file argument. Every read and write counts against the free daily quota shared with the live site;
 * the read and write counters per Pacific day are kept in the ledger folder (default: a folder in your home directory).
 */
import os from "node:os";
import path from "node:path";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { UsageError, checkOutDir, readCredentials } from "../lib/firestore-export/args";
import { readLedger, saveLedger } from "../lib/firestore-export/ledger";
import { assertConfirmedProject, parseBackfillArgs } from "../lib/membership-backfill/args";
import { makeBackfillDb } from "../lib/membership-backfill/firestore-db";
import { runBackfill, type BackfillLedgers } from "../lib/membership-backfill/runner";

async function main(): Promise<number> {
  const o = parseBackfillArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, "..");
  const { dir: ledgerDir } = checkOutDir(o.ledgerDir ?? path.join(os.homedir(), "cs-membership-backfill"), repoRoot, false); // before credentials and before anything is read

  const { projectId, clientEmail, privateKey } = readCredentials(process.env);
  console.log(`Project: ${projectId}`);
  console.log(`Service account: ${clientEmail}`);
  console.log(o.apply ? "MODE: APPLY (documents will be created)." : "MODE: dry run (nothing is written).");
  if (o.apply) assertConfirmedProject(o.confirmProject, projectId); // nothing is read or written before this passes

  let app;
  try {
    app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }, `backfill-${Date.now()}`);
  } catch {
    throw new UsageError("The service-account credentials could not be used. Check the three CS_ADMIN_* variables (the key is never printed).");
  }

  const readsFile = path.join(ledgerDir, "backfill-reads-ledger.json");
  const writesFile = path.join(ledgerDir, "backfill-writes-ledger.json");
  const ledgers: BackfillLedgers = {
    reads: () => readLedger(readsFile),
    writes: () => readLedger(writesFile),
    saveReads: (l) => saveLedger(readsFile, l),
    saveWrites: (l) => saveLedger(writesFile, l),
  };
  const result = await runBackfill(o, { db: makeBackfillDb(getFirestore(app)), ledgers, now: () => new Date(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log: (l) => console.log(l) });
  return result.exitCode;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(`backfill-memberships: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
);
