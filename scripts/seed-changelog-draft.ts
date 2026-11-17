/**
 * Puts the approved "CompSocrates v2.0.0" changelog entry into the platform changelog as ONE DRAFT (`platformChangelog/v2-0-0-draft`). Never run by the
 * build or the tests. DRY RUN unless `--apply`.
 *
 *   Dry run (writes nothing, needs no credentials, prints the entry as it would be stored):
 *     npm run changelog:seed-v2 -- --date=2026-11-20
 *   Write (only with --apply and --confirm-project):
 *     npm run changelog:seed-v2 -- --date=2026-11-20 --apply --confirm-project=<project id>
 *
 * Credentials, only with --apply, ONLY from environment variables in your own shell: CS_ADMIN_PROJECT_ID, CS_ADMIN_CLIENT_EMAIL, CS_ADMIN_PRIVATE_KEY.
 * No key file is read or accepted. `--confirm-project` must equal CS_ADMIN_PROJECT_ID. The write is create-only: it fails if the id exists and never
 * replaces anything. Logic and tests: lib/platform-changelog/seed.ts. The wording is lib/platform-changelog/v2-entry.ts (shared with the editor template).
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { runSeed, type SeedDb } from "../lib/platform-changelog/seed";

runSeed({
  argv: process.argv.slice(2),
  env: process.env,
  nowMs: Date.now(),
  log: (line) => console.log(line),
  makeDb: (creds) => getFirestore(initializeApp({ credential: cert({ projectId: creds.projectId, clientEmail: creds.clientEmail, privateKey: creds.privateKey }) })) as unknown as SeedDb,
})
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
