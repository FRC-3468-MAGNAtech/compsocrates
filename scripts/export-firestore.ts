/**
 * READ-ONLY safety copy of the Firestore data: one NDJSON file per collection plus a manifest, written OUTSIDE the repository.
 * NEVER run by the build or the tests. The managed export needs billing, so this reads documents through the Admin SDK instead, and every
 * document read counts against the daily read quota (50,000 on the Spark plan, shared with the live site).
 *
 *   Dry run (the default; counts only, reads no documents):
 *     npm run export:firestore -- --out=C:\Users\<you>\firestore-exports
 *   Real run (needs --confirm-project equal to the project id in the credentials):
 *     npm run export:firestore -- --out=C:\Users\<you>\firestore-exports --run --confirm-project=<project id>
 *   Options: --collections=a,b  --max-reads=20000  --daily-ceiling=25000  --page-size=300  --pause-ms=250  --redact=a,b|none
 *            --resume[=<folder>]  --force  --allow-synced
 *
 * Environment (a service account; names only here, never put values in a file): CS_ADMIN_PROJECT_ID, CS_ADMIN_CLIENT_EMAIL, CS_ADMIN_PRIVATE_KEY.
 * There is no fallback to other variable names and no key-file argument. The runner (`vite-node`) loads `.env*` files into the process for variables that
 * are not already set, so set the three variables yourself in a fresh shell, and check the project id and account the script prints before confirming.
 */
import path from "node:path";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { UsageError, checkOutDir, parseArgs, readCredentials } from "../lib/firestore-export/args";
import { applyDiscovery, knownPlan, prefixDocPath, programPrefixes, selectPlan } from "../lib/firestore-export/collections";
import { LEDGER_FILE, assertWithinCeiling, ledgerTotal, pacificDay, readLedger, saveLedger, withReads } from "../lib/firestore-export/ledger";
import { makeReadDb } from "../lib/firestore-export/read-db";
import { dryRun, discover, runExport, type Deps } from "../lib/firestore-export/runner";

async function main(): Promise<number> {
  const o = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, "..");
  const { dir: outRoot, warning } = checkOutDir(o.out, repoRoot, o.allowSynced); // before credentials and before anything is read
  if (warning) console.warn(warning);

  const { projectId, clientEmail, privateKey } = readCredentials(process.env);
  console.log(`Project: ${projectId}`);
  console.log(`Service account: ${clientEmail}`);
  console.log("NOTICE: the export contains personal data (names, emails, scouting history of students) and fields that look like secrets. Keep it out of the repository and out of cloud-synced folders, store it somewhere access-controlled, and delete it when it is no longer needed.");
  console.log(o.redact.length ? `Redacted fields (any depth): ${o.redact.join(", ")}` : "No fields are redacted (--redact=none): secret-like fields will be in the files.");

  if (o.run) {
    if (!o.confirmProject) throw new UsageError(`--run needs --confirm-project=<project id>; the credentials are for project ${projectId}.`);
    if (o.confirmProject !== projectId) throw new UsageError(`--confirm-project (${o.confirmProject}) does not equal the project in the credentials (${projectId}); nothing was read.`);
  }

  let app;
  try {
    app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }, `export-${Date.now()}`);
  } catch {
    throw new UsageError("The service-account credentials could not be used. Check the three CS_ADMIN_* variables (the key is never printed).");
  }
  const deps: Deps = { db: makeReadDb(getFirestore(app)), now: () => new Date(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log: (l) => console.log(l) };

  const today = pacificDay(deps.now());
  const ledgerFile = path.join(outRoot, LEDGER_FILE);
  const ledger = readLedger(ledgerFile);
  if (o.run) assertWithinCeiling(ledger, today, o.maxReads, o.dailyCeiling); // before the first read

  const state = { reads: 0 };
  const prefixes = programPrefixes();
  try {
    const listed = await discover(deps, prefixes.map((prefix) => ({ prefix, doc: prefixDocPath(prefix) })), state);
    const found = applyDiscovery(knownPlan(), listed);
    if (found.unknown.length) console.warn(`NOTE: collections that exist but are not in the known list (they are included): ${found.unknown.join(", ")}`);
    const selected = selectPlan(found.plan, o.collections);

    if (!o.run) {
      console.log("DRY RUN: no documents are read.");
      const r = await dryRun(selected, deps, state, { maxReads: o.maxReads, dailyCeiling: o.dailyCeiling, ledgerToday: ledgerTotal(ledger, today) });
      for (const l of r.lines) console.log(l);
      console.log("To export: add --run --confirm-project=<project id>.");
      return 0;
    }

    console.log(`Subcollections other than the known ones cannot be listed without reading documents and are not exported.`);
    const result = await runExport(
      { projectId, outRoot, plan: found.plan, selected, selectionNames: o.collections, maxReads: o.maxReads, dailyCeiling: o.dailyCeiling, pageSize: o.pageSize, pauseMs: o.pauseMs, redactFields: o.redact, force: o.force, resume: o.resume },
      deps
    );
    console.log(`Output: ${result.dir}`);
    console.log(result.manifest.complete ? "Export COMPLETE." : "Export NOT complete (see above); continue with --resume.");
    return result.exitCode;
  } finally {
    // Listing and counting are reads too; a real run has already recorded its own document reads.
    if (state.reads) saveLedger(ledgerFile, withReads(readLedger(ledgerFile), today, state.reads));
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(`export-firestore: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
);
