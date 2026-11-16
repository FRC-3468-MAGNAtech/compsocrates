/**
 * Imports the OLD CompSocrates release notes into the PLATFORM changelog (`platformChangelog/{id}`), tagged for the default program and marked
 * `legacy: true` (listed below the current entries, never lights the unread dot). Never run by the build or the tests. DRY RUN unless `--apply`.
 *
 *   Dry run (reads only the input file, needs no credentials, prints every entry it would create):
 *     npx vite-node --config vitest.config.ts scripts/import-cs-changelog.ts --input="C:\Users\<you>\cs-release-notes.json"
 *   Write:
 *     npx vite-node --config vitest.config.ts scripts/import-cs-changelog.ts --input="C:\Users\<you>\cs-release-notes.json" --apply --confirm-project=<project id>
 *
 * Input: the file written by scripts/export-cs-changelog.ts, `{ "<teamId>": [ { id, title, body, createdAt, updatedAt } ] }`.
 * Credentials (only with --apply, from environment variables in your own shell): CS_ADMIN_PROJECT_ID, CS_ADMIN_CLIENT_EMAIL, CS_ADMIN_PRIVATE_KEY
 * (or the FIREBASE_ADMIN_* names). `--confirm-project` must equal CS_ADMIN_PROJECT_ID, or nothing is written.
 *
 * Safe to repeat: every entry has a stable id (`cs-legacy-{teamId}-{oldId}`) and is only ever CREATED (an id that exists is left alone, never
 * overwritten), written in batches of 400. Wording is kept as it was (lib/changelog/legacy.ts); a note that cannot be stored as it is is listed as
 * skipped, never edited. A starter draft (id starting `starter-`) is never imported.
 */
import { readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { IMPORT_BATCH_SIZE, applyPlatformImport, planPlatformImport, type ImportDb } from "../lib/changelog/legacy-platform";

const args = process.argv.slice(2);
const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const APPLY = args.includes("--apply");

function need(name: string): string {
  const alt = name.replace("CS_ADMIN_", "FIREBASE_ADMIN_");
  const v = (process.env[name] || process.env[alt] || "").trim();
  if (!v) throw new Error(`Missing environment variable ${name} (or ${alt})`);
  return v;
}

async function main() {
  const input = value("input");
  if (!input) throw new Error("Pass --input=<file.json> (see the header of this script).");
  const plan = planPlatformImport(JSON.parse(readFileSync(input, "utf8")) as Record<string, unknown>);

  console.log(APPLY ? "APPLY: creating entries in platformChangelog (existing ids are left alone)." : "DRY RUN: nothing is written. Add --apply --confirm-project=<id> to write.");
  console.log(`${plan.entries.length} entries to create, ${plan.skipped.length} skipped.`);
  for (const e of plan.entries) {
    console.log(`  ${e.id}  ${e.doc.date}  "${e.doc.title}"  (${e.doc.items.length} items)${e.warnings.length ? `  WARN: ${e.warnings.join("; ")}` : ""}`);
  }
  for (const s of plan.skipped) console.log(`  SKIPPED ${s.teamId}/${s.id}: ${s.reason}`);
  if (!APPLY) return;

  const projectId = need("CS_ADMIN_PROJECT_ID");
  if (value("confirm-project") !== projectId) throw new Error(`--apply needs --confirm-project=${projectId}. Nothing was written.`);
  const db = getFirestore(initializeApp({ credential: cert({ projectId, clientEmail: need("CS_ADMIN_CLIENT_EMAIL"), privateKey: need("CS_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n") }) }));
  const { created, existing } = await applyPlatformImport(db as unknown as ImportDb, plan, IMPORT_BATCH_SIZE);
  console.log(`done: ${created} created, ${existing} already there.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
