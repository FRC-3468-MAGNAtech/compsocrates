/**
 * Copies the sister app's Firestore data into this project's FTC namespace (`programs/ftc/...`), and optionally imports
 * its Auth users. NEVER run by the build or the tests. It is a manual, reviewed step.
 *
 *   Dry run (the default; reads, prints counts, writes nothing):
 *     npx vite-node scripts/migrate-ce-to-ftc.ts
 *   Apply:
 *     npx vite-node scripts/migrate-ce-to-ftc.ts --apply --confirm-project=<destination project id>
 *   Also import Auth users from `firebase auth:export users.json --format=json` (keeps uids, passwords and provider links):
 *     ... --auth-export=users.json --hash-key=<base64 signer key> --hash-salt-separator=<base64> --hash-rounds=8 --hash-mem-cost=14
 *
 * Environment (service accounts; names only here, never commit values):
 *   CE_ADMIN_PROJECT_ID, CE_ADMIN_CLIENT_EMAIL, CE_ADMIN_PRIVATE_KEY     source (read only)
 *   CS_ADMIN_PROJECT_ID, CS_ADMIN_CLIENT_EMAIL, CS_ADMIN_PRIVATE_KEY     destination (written only with --apply)
 *     (the app's own FIREBASE_ADMIN_* names are accepted as a fallback for the destination)
 *
 * Safety: dry run unless `--apply`; `--apply` also needs `--confirm-project` equal to CS_ADMIN_PROJECT_ID; writes are
 * idempotent (`set` with the same ids), so a repeat run converges. Nothing is ever deleted. Accounts whose email already
 * exists in the destination are mapped CE uid -> destination uid and every id in the copied data is rewritten to match.
 */
import { readFileSync } from "node:fs";
import { cert, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type UserImportRecord } from "firebase-admin/auth";
import { getFirestore, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { MIGRATED_COLLECTIONS, destinationData, destinationPath, type UidMap } from "../lib/ftc/migration";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const APPLY = flag("apply");

/** The destination (CS) also accepts the app's own FIREBASE_ADMIN_* names. */
function need(name: string): string {
  const alt = name.startsWith("CS_ADMIN_") ? name.replace("CS_ADMIN_", "FIREBASE_ADMIN_") : "";
  const v = (process.env[name] || (alt ? process.env[alt] : "") || "").trim();
  if (!v) throw new Error(`Missing environment variable ${name}${alt ? ` (or ${alt})` : ""}`);
  return v;
}

function app(prefix: "CE" | "CS"): App {
  return initializeApp(
    {
      credential: cert({
        projectId: need(`${prefix}_ADMIN_PROJECT_ID`),
        clientEmail: need(`${prefix}_ADMIN_CLIENT_EMAIL`),
        privateKey: need(`${prefix}_ADMIN_PRIVATE_KEY`).replace(/\\n/g, "\n"),
      }),
    },
    prefix,
  );
}

/** CE uid -> destination uid for accounts that exist in both projects (matched by lower-cased email). */
async function buildUidMap(ce: App, cs: App): Promise<UidMap> {
  const map = new Map<string, string>();
  let token: string | undefined;
  do {
    const page = await getAuth(ce).listUsers(1000, token);
    for (const u of page.users) {
      if (!u.email) continue;
      try {
        const existing = await getAuth(cs).getUserByEmail(u.email);
        if (existing.uid !== u.uid) map.set(u.uid, existing.uid);
      } catch {
        /* not in the destination: keeps its own uid (imported with --auth-export) */
      }
    }
    token = page.pageToken;
  } while (token);
  return map;
}

async function copyTree(srcDb: Firestore, dstDb: Firestore, ref: DocumentReference, uidMap: UidMap, counts: Map<string, number>) {
  const snap = await ref.get();
  if (snap.exists) {
    const dest = destinationPath(ref.path, uidMap);
    if (dest) {
      counts.set(ref.parent.id, (counts.get(ref.parent.id) ?? 0) + 1);
      if (APPLY) await dstDb.doc(dest).set(destinationData(snap.data() ?? {}, uidMap));
    }
  }
  for (const sub of await ref.listCollections()) {
    for (const child of await sub.listDocuments()) await copyTree(srcDb, dstDb, child, uidMap, counts);
  }
}

/** One user of `firebase auth:export --format=json` (only the fields used). */
type ExportedUser = {
  localId: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  photoUrl?: string;
  disabled?: boolean;
  passwordHash?: string;
  salt?: string;
  providerUserInfo?: { providerId: string; rawId: string; email?: string; displayName?: string; photoUrl?: string }[];
};

function toImportRecords(file: string): UserImportRecord[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { users: ExportedUser[] };
  return raw.users.map((u) => ({
    uid: u.localId,
    email: u.email,
    emailVerified: Boolean(u.emailVerified),
    displayName: u.displayName,
    photoURL: u.photoUrl,
    disabled: Boolean(u.disabled),
    passwordHash: u.passwordHash ? Buffer.from(u.passwordHash, "base64") : undefined,
    passwordSalt: u.salt ? Buffer.from(u.salt, "base64") : undefined,
    providerData: (u.providerUserInfo ?? [])
      .filter((p) => p.providerId !== "password")
      .map((p) => ({ uid: p.rawId, providerId: p.providerId, email: p.email, displayName: p.displayName, photoURL: p.photoUrl })),
  }));
}

async function main() {
  const ce = app("CE");
  const cs = app("CS");
  const dstProject = need("CS_ADMIN_PROJECT_ID");
  if (APPLY && value("confirm-project") !== dstProject) {
    throw new Error(`--apply needs --confirm-project=${dstProject} (the destination project id). Nothing was written.`);
  }
  console.log(APPLY ? `APPLY: writing to ${dstProject}` : "DRY RUN: nothing is written. Add --apply --confirm-project=<id> to write.");

  const uidMap = await buildUidMap(ce, cs);
  console.log(`accounts in both projects (uids rewritten): ${uidMap.size}`);

  const counts = new Map<string, number>();
  const srcDb = getFirestore(ce);
  const dstDb = getFirestore(cs);
  for (const name of MIGRATED_COLLECTIONS) {
    for (const ref of await srcDb.collection(name).listDocuments()) await copyTree(srcDb, dstDb, ref, uidMap, counts);
  }
  for (const [name, n] of [...counts].sort()) console.log(`${APPLY ? "wrote" : "would write"} ${String(n).padStart(6)}  ${name}`);

  const authFile = value("auth-export");
  if (authFile) {
    const records = toImportRecords(authFile).filter((r) => !uidMap.has(r.uid));
    console.log(`${APPLY ? "importing" : "would import"} ${records.length} auth users (accounts that exist in both are skipped)`);
    if (APPLY && records.length) {
      const hashKey = value("hash-key");
      if (!hashKey) throw new Error("--auth-export with --apply needs --hash-key (and the other hash parameters from the source project).");
      const result = await getAuth(cs).importUsers(records, {
        hash: {
          algorithm: "SCRYPT",
          key: Buffer.from(hashKey, "base64"),
          saltSeparator: Buffer.from(value("hash-salt-separator") ?? "", "base64"),
          rounds: Number(value("hash-rounds") ?? 8),
          memoryCost: Number(value("hash-mem-cost") ?? 14),
        },
      });
      console.log(`auth import: ${result.successCount} ok, ${result.failureCount} failed`);
      for (const e of result.errors) console.log(`  #${e.index}: ${e.error.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
