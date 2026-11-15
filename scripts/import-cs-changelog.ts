/**
 * Imports the OLD CompSocrates changelog (release notes) into the new changelog, FRC only (root `changelog` collection).
 * Never run by the build or the tests. Dry run unless `--apply`.
 *
 *   Dry run (reads only the input file, needs no credentials, prints what would be written):
 *     npx vite-node --config vitest.config.ts scripts/import-cs-changelog.ts --input=cs-release-notes.json
 *   Write:
 *     npx vite-node --config vitest.config.ts scripts/import-cs-changelog.ts --input=cs-release-notes.json --apply --confirm-project=<project id>
 *
 * Input: a JSON object `{ "<teamId>": [ { "id", "title", "body", "createdAt", "updatedAt" }, ... ] }`, the `versionReleases` array of each
 * team doc (`teams/{id}.versionReleases`, the source of truth for team users in the old app), exported from the old project by an admin.
 * The old app's global `versionReleases` collection was only shown to people without a team, so it is not imported.
 * Credentials (only with --apply): FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY (or the CS_ADMIN_* names).
 *
 * Safe to repeat: every entry has a stable doc id (`cs-legacy-{teamId}-{oldId}`) and is created, never overwritten, so a second run writes
 * nothing new. Entries are written as published with the additive `legacy: true` field, so they list below the current entries and never
 * light the unread dot (lib/changelog/index.ts). Wording is kept as it was (lib/changelog/legacy.ts).
 */
import { readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { LEGACY_AUTHOR, planLegacyImport } from "../lib/changelog/legacy";

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
  const plan = planLegacyImport(JSON.parse(readFileSync(input, "utf8")) as Record<string, unknown>);

  console.log(APPLY ? "APPLY: writing to the changelog collection." : "DRY RUN: nothing is written. Add --apply --confirm-project=<id> to write.");
  console.log(`${plan.entries.length} entries to import, ${plan.skipped.length} skipped.`);
  for (const e of plan.entries) {
    console.log(`  ${e.id}  ${e.date}  "${e.title}"  (${e.changes.length} changes)${e.warnings.length ? `  WARN: ${e.warnings.join("; ")}` : ""}`);
  }
  for (const s of plan.skipped) console.log(`  SKIPPED ${s.teamId}/${s.id}: ${s.reason}`);
  if (!APPLY) return;

  const projectId = need("CS_ADMIN_PROJECT_ID");
  if (value("confirm-project") !== projectId) throw new Error(`--apply needs --confirm-project=${projectId}. Nothing was written.`);
  const db = getFirestore(
    initializeApp({ credential: cert({ projectId, clientEmail: need("CS_ADMIN_CLIENT_EMAIL"), privateKey: need("CS_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n") }) })
  );

  let created = 0;
  let existing = 0;
  for (const e of plan.entries) {
    const created_ =Timestamp.fromMillis(e.createdAtMs);
    try {
      await db.collection("changelog").doc(e.id).create({
        teamId: e.teamId,
        version: e.version,
        title: e.title,
        date: e.date,
        summary: e.summary,
        changes: e.changes,
        status: "published",
        pinned: false,
        createdBy: LEGACY_AUTHOR,
        createdAt: created_,
        updatedAt: Timestamp.fromMillis(e.updatedAtMs),
        publishedAt: created_,
        legacy: true,
      });
      created += 1;
    } catch (err) {
      if ((err as { code?: number }).code === 6) existing += 1; // ALREADY_EXISTS: imported on an earlier run
      else throw err;
    }
  }
  console.log(`done: ${created} created, ${existing} already there.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
