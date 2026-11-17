import { platformAuditDoc } from "@/lib/server/audit";
import { docFor } from "@/lib/server/platform-changelog";
import { isValidIsoDate } from "@/lib/changelog";
import { describeErrors, parseEntryInput, type EntryInput } from "@/lib/platform-changelog/model";
import { v2EntryInput } from "@/lib/platform-changelog/v2-entry";

// The logic behind `scripts/seed-changelog-draft.ts` (`npm run changelog:seed-v2`): put the approved v2.0.0 entry into `platformChangelog` as ONE DRAFT.
// Pure apart from the injected `makeDb` and `log`, so the tests drive it with a mocked Firestore. It never reads a file, never reads Firestore, and
// never replaces a document: the write is `create()` in one batch (the entry plus its audit entry), which fails if the id already exists.

export const SEED_DOC_ID = "v2-0-0-draft";
/** `createdBy` and the audit actor. Neither the validator nor the audit helper requires a real uid (they take any string). */
export const SEED_ACTOR = "seed-script";
export const CREDENTIAL_VARS = ["CS_ADMIN_PROJECT_ID", "CS_ADMIN_CLIENT_EMAIL", "CS_ADMIN_PRIVATE_KEY"] as const;

export type SeedArgs = { apply: boolean; confirmProject: string | null; date: string };
export type Credentials = { projectId: string; clientEmail: string; privateKey: string };

/** The slice of the Admin SDK Firestore the script uses (a mock implements the same three calls). */
export type SeedDb = {
  doc(path: string): unknown;
  collection(name: string): { doc(): unknown };
  batch(): { create(ref: unknown, data: unknown): unknown; commit(): Promise<unknown> };
};

export const todayUtc = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

/** Only `--apply`, `--confirm-project=<id>` and `--date=YYYY-MM-DD` exist. Anything else (a key-file argument above all) is refused. */
export function parseSeedArgs(argv: readonly string[], today: string): { ok: true; args: SeedArgs } | { ok: false; error: string } {
  const args: SeedArgs = { apply: false, confirmProject: null, date: today };
  for (const a of argv) {
    if (a === "--apply") args.apply = true;
    else if (a.startsWith("--confirm-project=")) args.confirmProject = a.slice("--confirm-project=".length);
    else if (a.startsWith("--date=")) {
      const d = a.slice("--date=".length);
      if (!isValidIsoDate(d)) return { ok: false, error: `--date must be a real calendar date, YYYY-MM-DD (got "${d}").` };
      args.date = d;
    } else if (/key|cert|credential|service|account|\.json$/i.test(a)) {
      return { ok: false, error: "A key file is never accepted. Set CS_ADMIN_PROJECT_ID, CS_ADMIN_CLIENT_EMAIL and CS_ADMIN_PRIVATE_KEY as environment variables in your own shell." };
    } else return { ok: false, error: `Unknown argument "${a}". Allowed: --apply, --confirm-project=<project id>, --date=YYYY-MM-DD.` };
  }
  return { ok: true, args };
}

/** The credentials, from the three CS_ADMIN_* variables only. */
export function readCredentials(env: Record<string, string | undefined>): { ok: true; creds: Credentials } | { ok: false; missing: string[] } {
  const get = (n: string) => (env[n] ?? "").trim();
  const missing = CREDENTIAL_VARS.filter((n) => get(n) === "");
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, creds: { projectId: get("CS_ADMIN_PROJECT_ID"), clientEmail: get("CS_ADMIN_CLIENT_EMAIL"), privateKey: get("CS_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n") } };
}

/** The document and the audit entry, built with the same validator and document builder the server route uses. */
export function buildSeedPlan(entry: EntryInput, nowMs: number): { ok: true; doc: ReturnType<typeof docFor>; audit: ReturnType<typeof platformAuditDoc> } | { ok: false; error: string } {
  const parsed = parseEntryInput(entry);
  if (!parsed.ok) return { ok: false, error: `The entry is not valid: ${describeErrors(parsed.errors)}` };
  const doc = docFor(parsed.value, "draft", { createdBy: SEED_ACTOR, createdAt: nowMs, publishedAt: null, rev: 1, nowMs, legacy: false });
  const audit = platformAuditDoc("create-platform-changelog-entry", { uid: SEED_ACTOR, name: SEED_ACTOR }, { entryId: SEED_DOC_ID, title: doc.title, version: doc.version, status: "draft", items: doc.items.length, seededBy: SEED_ACTOR });
  return { ok: true, doc, audit };
}

export type SeedRun = {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  nowMs: number;
  /** Builds the database from the credentials; only called for a confirmed `--apply`. */
  makeDb: (creds: Credentials) => SeedDb;
  log: (line: string) => void;
  /** Tests only: a different entry. */
  entry?: (dateIso: string) => EntryInput;
};

/** Runs the script. Returns the exit code (0 = fine, 1 = refused or failed). */
export async function runSeed(run: SeedRun): Promise<number> {
  const { log } = run;
  const parsedArgs = parseSeedArgs(run.argv, todayUtc(run.nowMs));
  if (!parsedArgs.ok) {
    log(parsedArgs.error);
    return 1;
  }
  const { args } = parsedArgs;
  const plan = buildSeedPlan((run.entry ?? v2EntryInput)(args.date), run.nowMs);
  if (!plan.ok) {
    log(plan.error);
    return 1;
  }

  if (!args.apply) {
    log("DRY RUN: nothing is written, no credentials are needed.");
    log(`Would create platformChangelog/${SEED_DOC_ID} (create-only: it fails if that id exists) and one platformAuditLog entry, in one batch.`);
    log(`Release date: ${plan.doc.date}. Status: ${plan.doc.status}. ${plan.doc.items.length} items.`);
    log("The entry as it would be stored:");
    log(JSON.stringify(plan.doc, null, 2));
    log(`Audit entry: ${plan.audit.action} by ${plan.audit.actorUid} (createdAt is the server time at write).`);
    log("To write it: set the three CS_ADMIN_* variables in your own shell, then add --apply --confirm-project=<project id>.");
    return 0;
  }

  const cred = readCredentials(run.env);
  if (!cred.ok) {
    log(`Nothing was written. Missing environment variable(s): ${cred.missing.join(", ")}. Set all of ${CREDENTIAL_VARS.join(", ")} in your own shell (no key file is read).`);
    return 1;
  }
  const { creds } = cred;
  log(`Project: ${creds.projectId}`);
  log(`Service account: ${creds.clientEmail}`);
  if (args.confirmProject === null) {
    log(`Nothing was written. --apply needs --confirm-project=${creds.projectId}.`);
    return 1;
  }
  if (args.confirmProject !== creds.projectId) {
    log(`Nothing was written. --confirm-project="${args.confirmProject}" is not the project in the credentials ("${creds.projectId}").`);
    return 1;
  }

  const db = run.makeDb(creds);
  const batch = db.batch();
  batch.create(db.doc(`platformChangelog/${SEED_DOC_ID}`), plan.doc);
  batch.create(db.collection("platformAuditLog").doc(), plan.audit);
  try {
    await batch.commit();
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === 6 || code === "already-exists" || /already exists/i.test(String((err as Error)?.message ?? ""))) {
      log(`Nothing was written: platformChangelog/${SEED_DOC_ID} already exists, and this script never replaces a document. Edit it in Admin Panel > Changelog instead.`);
    } else log(`The write failed and nothing was changed: ${(err as Error)?.message ?? String(err)}`);
    return 1;
  }
  log(`Created platformChangelog/${SEED_DOC_ID} as a draft (${plan.doc.items.length} items, date ${plan.doc.date}). Open Admin Panel > Changelog to review and publish it.`);
  return 0;
}
