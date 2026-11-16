/**
 * Exports the OLD CompSocrates release notes to a JSON file, for the importer. READ-ONLY: the Firestore object is wrapped so any call other than a
 * get or list throws before anything is sent (lib/changelog/legacy-export.ts), and nothing here ever writes to a database. Never run by the build or
 * the tests.
 *
 *   npx vite-node --config vitest.config.ts scripts/export-cs-changelog.ts --out="C:\Users\<you>\cs-release-notes.json"
 *
 * The output path MUST be outside this repository (the export is the old notes' wording and must never be committed): a path inside it is refused.
 * An existing file is never overwritten. Credentials come from environment variables in YOUR shell only, nothing is read from a file:
 * CS_ADMIN_PROJECT_ID, CS_ADMIN_CLIENT_EMAIL, CS_ADMIN_PRIVATE_KEY (or the FIREBASE_ADMIN_* names). Nothing secret is written or printed.
 *
 * It reads two places of the old app: every `teams/{id}.versionReleases[]` (only that array is used from a team document) and the root
 * `versionReleases` collection (filed under the key "global"). It writes `{ "<teamId>": [ { id, title, body, createdAt, updatedAt } ] }`: only those
 * five fields, no author names, uids or any other team field. It prints counts only.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { OLD_ROOT_COLLECTION, OLD_TEAMS_COLLECTION, assertOutsideRepo, buildExport, exportCounts, readOnly } from "../lib/changelog/legacy-export";

const args = process.argv.slice(2);
const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function need(name: string): string {
  const alt = name.replace("CS_ADMIN_", "FIREBASE_ADMIN_");
  const v = (process.env[name] || process.env[alt] || "").trim();
  if (!v) throw new Error(`Missing environment variable ${name} (or ${alt})`);
  return v;
}

async function main() {
  const out = value("out");
  if (!out) throw new Error("Pass --out=<file.json> (a path outside this repository, see the header of this script).");
  const target = path.resolve(out);
  assertOutsideRepo(target, path.resolve(__dirname, "..")); // checked BEFORE anything is read

  const db = readOnly(
    getFirestore(initializeApp({ credential: cert({ projectId: need("CS_ADMIN_PROJECT_ID"), clientEmail: need("CS_ADMIN_CLIENT_EMAIL"), privateKey: need("CS_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n") }) }))
  );

  const teams = await db.collection(OLD_TEAMS_COLLECTION).get();
  const root = await db.collection(OLD_ROOT_COLLECTION).get();
  const data = buildExport(
    teams.docs.map((d) => ({ id: d.id, data: d.data() })),
    root.docs.map((d) => ({ id: d.id, data: d.data() }))
  );

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); // wx: never overwrite an existing file
  const c = exportCounts(data);
  console.log(`Read ${teams.size} team documents and ${root.size} root notes. Wrote ${c.notes} notes (${c.teams} teams with notes, ${c.global} global) to ${target}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
