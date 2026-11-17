import path from "node:path";
import { isInsideRepo } from "../changelog/legacy-export";

// Command-line options and the output-folder rules of scripts/export-firestore.ts. Pure: nothing here touches Firestore.

export class UsageError extends Error {}

export const DEFAULT_REDACT = ["tbaApiKey", "tbaApiKeyEncrypted", "encryptedUserData", "fcmTokens"] as const;

export type Options = {
  run: boolean;
  force: boolean;
  allowSynced: boolean;
  out: string | null;
  confirmProject: string | null;
  collections: string[] | null;
  maxReads: number;
  pageSize: number;
  pauseMs: number;
  dailyCeiling: number;
  redact: string[];
  /** `true` = the newest unfinished export folder; a string = that folder name. */
  resume: string | true | null;
};

const BOOLEANS = new Set(["run", "force", "allow-synced"]);
const VALUES = new Set(["out", "confirm-project", "collections", "max-reads", "page-size", "pause-ms", "daily-ceiling", "redact"]);

const KEY_FILE_ARG = /\.(json|pem|p12|pfx|key|der)$/i;
const KEY_FLAG = /^--(key|keyfile|key-file|credentials?|service-?account|private-key|google-application-credentials)/i;

function int(name: string, raw: string, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

export function parseArgs(argv: string[]): Options {
  for (const a of argv) {
    if (KEY_FLAG.test(a) || KEY_FILE_ARG.test(a)) {
      throw new UsageError("Refusing an argument that looks like a key file. Credentials come from the environment variables only (CS_ADMIN_PROJECT_ID, CS_ADMIN_CLIENT_EMAIL, CS_ADMIN_PRIVATE_KEY).");
    }
  }
  const o: Options = {
    run: false,
    force: false,
    allowSynced: false,
    out: null,
    confirmProject: null,
    collections: null,
    maxReads: 20000,
    pageSize: 300,
    pauseMs: 250,
    dailyCeiling: 25000,
    redact: [...DEFAULT_REDACT],
    resume: null,
  };
  for (const a of argv) {
    if (!a.startsWith("--")) throw new UsageError(`Unexpected argument "${a}".`);
    const eq = a.indexOf("=");
    const name = a.slice(2, eq === -1 ? undefined : eq);
    const val = eq === -1 ? null : a.slice(eq + 1);
    if (name === "resume") {
      o.resume = val ? val : true;
    } else if (BOOLEANS.has(name)) {
      if (val !== null) throw new UsageError(`--${name} takes no value.`);
      if (name === "run") o.run = true;
      if (name === "force") o.force = true;
      if (name === "allow-synced") o.allowSynced = true;
    } else if (VALUES.has(name)) {
      if (!val) throw new UsageError(`--${name} needs a value (--${name}=...).`);
      if (name === "out") o.out = val;
      if (name === "confirm-project") o.confirmProject = val;
      if (name === "collections") o.collections = val.split(",").map((s) => s.trim()).filter(Boolean);
      if (name === "max-reads") o.maxReads = int(name, val, 1, 1_000_000);
      if (name === "page-size") o.pageSize = int(name, val, 1, 1000);
      if (name === "pause-ms") o.pauseMs = int(name, val, 0, 60_000);
      if (name === "daily-ceiling") o.dailyCeiling = int(name, val, 1, 1_000_000);
      if (name === "redact") o.redact = val === "none" ? [] : val.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      throw new UsageError(`Unknown option --${name}.`);
    }
  }
  if (o.collections && o.collections.length === 0) throw new UsageError("--collections needs at least one name.");
  return o;
}

const SYNCED = /(onedrive|dropbox|icloud|google ?drive|googledrive)/i;

/** The resolved output folder, or a UsageError when it is inside the repository or a cloud-synced folder. `warning` is set when the synced check was waived. */
export function checkOutDir(out: string | null, repoRoot: string, allowSynced: boolean): { dir: string; warning: string | null } {
  if (!out) throw new UsageError("Pass --out=<folder> (a folder outside this repository and outside any cloud-synced folder).");
  const dir = path.resolve(out);
  if (isInsideRepo(dir, repoRoot)) throw new UsageError(`Refusing an output folder inside the repository (${dir}). The export holds personal data and must never be committed.`);
  const synced = dir.split(/[\\/]+/).some((seg) => SYNCED.test(seg));
  if (synced && !allowSynced) throw new UsageError(`Refusing an output folder inside a cloud-synced folder (${dir}): the files would be copied to a cloud service. Pick a local folder, or pass --allow-synced to override.`);
  return { dir, warning: synced ? `WARNING: ${dir} looks like a cloud-synced folder; the export will be uploaded by the sync client.` : null };
}

export type Credentials = { projectId: string; clientEmail: string; privateKey: string };

/** The service account, from these three variables ONLY (no fallback names, no file). A missing one stops the run and names it. */
export function readCredentials(env: Record<string, string | undefined>): Credentials {
  const need = (name: string) => {
    const v = (env[name] || "").trim();
    if (!v) throw new UsageError(`Missing environment variable ${name}`);
    return v;
  };
  return { projectId: need("CS_ADMIN_PROJECT_ID"), clientEmail: need("CS_ADMIN_CLIENT_EMAIL"), privateKey: need("CS_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n") };
}
