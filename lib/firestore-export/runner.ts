import { hash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { encodeDocument } from "./codec";
import { LEDGER_FILE, assertWithinCeiling, ledgerTotal, pacificDay, readLedger, saveLedger, withReads } from "./ledger";
import type { PlanItem } from "./collections";
import type { ReadDb } from "./read-db";

// The export itself (dry run and real run) over the ReadDb interface. Reads are counted as the quota counts them: a query that returns n documents
// costs max(1, n) reads, and a count() costs at least 1 (one more per 1,000 index entries). Nothing here can write to Firestore.

export const TOOL_VERSION = "1.0.0";
export const REDACTED = "[REDACTED]";
export const QUOTA_PER_DAY = 50000;
const BACKOFF_MS = [1000, 2000, 4000, 8000];

export type Deps = { db: ReadDb; now: () => Date; sleep: (ms: number) => Promise<void>; log: (line: string) => void };

export type StopKind = "cap" | "quota" | "permission" | "auth" | "network" | "error";

export class StopRun extends Error {
  constructor(
    message: string,
    public kind: StopKind
  ) {
    super(message);
  }
}

export function classifyError(e: unknown): "quota" | "permission" | "auth" | "transient" | "other" {
  const code = (e as { code?: unknown } | null)?.code;
  const c = typeof code === "string" ? code.toLowerCase().replace(/_/g, "-") : code;
  if (c === 8 || c === "resource-exhausted") return "quota";
  if (c === 7 || c === "permission-denied") return "permission";
  if (c === 16 || c === "unauthenticated") return "auth";
  if (c === 14 || c === 4 || c === 13 || c === 10 || c === "unavailable" || c === "deadline-exceeded" || c === "aborted" || c === "internal") return "transient";
  if (typeof c === "string" && ["econnreset", "etimedout", "enotfound", "eai-again", "econnrefused", "epipe"].includes(c)) return "transient";
  return "other";
}

const readsFor = (n: number) => Math.max(1, n);
const countReads = (n: number) => Math.max(1, Math.ceil(n / 1000));

/** Runs a read; transient failures are retried with a growing pause (never in a tight loop), anything else stops the run with a clear message. */
async function guarded<T>(fn: () => Promise<T>, deps: Deps, what: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof StopRun) throw e;
      const kind = classifyError(e);
      const detail = e instanceof Error ? e.message : String(e);
      if (kind === "quota") throw new StopRun(`Firestore reported the read quota is exhausted while ${what}. Stop here: the live site shares this quota. Wait until midnight Pacific, check the Usage tab, then continue with --resume.`, "quota");
      if (kind === "permission") throw new StopRun(`Permission denied while ${what}: the service account may not read this data. ${detail}`, "permission");
      if (kind === "auth") throw new StopRun(`The credentials were rejected while ${what}. Check the three CS_ADMIN_* variables. ${detail}`, "auth");
      if (kind === "transient" && attempt < BACKOFF_MS.length) {
        deps.log(`  network or service problem while ${what} (${detail}); retrying in ${BACKOFF_MS[attempt] / 1000}s`);
        await deps.sleep(BACKOFF_MS[attempt]);
        continue;
      }
      throw new StopRun(`Stopped while ${what}: ${detail}. Continue later with --resume.`, kind === "transient" ? "network" : "error");
    }
  }
}

// --- redaction ---------------------------------------------------------------------------------------------------------------------------------

function isPlain(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

/** Copy of `value` with every field named in `fields` (at any depth) replaced by a marker. Returns the number replaced through `counter`. */
export function redact(value: unknown, fields: ReadonlySet<string>, counter: { n: number }): unknown {
  if (Array.isArray(value)) return value.map((v) => redact(v, fields, counter));
  if (!isPlain(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (fields.has(k)) {
      out[k] = REDACTED;
      counter.n++;
    } else out[k] = redact(v, fields, counter);
  }
  return out;
}

// --- planning ----------------------------------------------------------------------------------------------------------------------------------

/** Lists the collections that exist (1 read per listing) and returns them by prefix. */
export async function discover(deps: Deps, prefixDocs: { prefix: string; doc: string | null }[], state: { reads: number }): Promise<Record<string, string[]>> {
  const listed: Record<string, string[]> = {};
  for (const { prefix, doc } of prefixDocs) {
    listed[prefix] = await guarded(() => deps.db.listCollections(doc), deps, `listing the collections${doc ? ` under ${doc}` : ""}`);
    state.reads += 1;
  }
  return listed;
}

export type DryRunResult = { totalDocs: number; estimatedReads: number; usedReads: number; lines: string[] };

/** Counts only: no document is read. Subcollection numbers are an UPPER BOUND (a collection-group count adds up every program's copy). */
export async function dryRun(plan: PlanItem[], deps: Deps, state: { reads: number }, opts: { maxReads: number; dailyCeiling: number; ledgerToday: number }): Promise<DryRunResult> {
  const lines: string[] = [];
  const counts: Record<string, number> = {};
  const roots = plan.filter((i) => !i.parent);
  let totalDocs = 0;
  let est = 0;
  lines.push("Collection path | documents | estimated reads");
  for (const item of roots) {
    const n = await guarded(() => deps.db.count(item.path), deps, `counting ${item.path}`);
    state.reads += countReads(n);
    counts[item.path] = n;
    totalDocs += n;
    const e = readsFor(n) + 1; // the documents, plus the count that checks the export afterwards
    est += e;
    lines.push(`${item.path} | ${n} | ${e}`);
  }
  const subs = plan.filter((i) => i.parent);
  const names = [...new Set(subs.map((i) => i.sub as string))];
  if (names.length) lines.push("Subcollections: UPPER-BOUND estimate (a collection-group count adds the copies under every program prefix; the real run reads exact paths)");
  for (const name of names) {
    const g = await guarded(() => deps.db.countGroup(name), deps, `counting the subcollections named ${name}`);
    state.reads += countReads(g);
    const parentsOf = subs.filter((i) => i.sub === name).map((i) => i.parent as string);
    let parents = 0;
    for (const p of parentsOf) {
      if (counts[p] === undefined) {
        counts[p] = await guarded(() => deps.db.count(p), deps, `counting ${p}`);
        state.reads += countReads(counts[p]);
      }
      parents += counts[p];
    }
    const e = g + parents + 1; // documents, one query per parent document (empty ones cost 1), the check count
    totalDocs += g;
    est += e;
    lines.push(`*/${name} (all programs combined, upper bound) | <= ${g} | <= ${e}`);
  }
  const perRun = Math.min(opts.maxReads, Math.max(1, opts.dailyCeiling - opts.ledgerToday));
  const runs = Math.max(1, Math.ceil(est / perRun));
  lines.push(`TOTAL: ${totalDocs} documents (upper bound), ESTIMATED ${est} reads (plus about ${state.reads} already spent counting).`);
  lines.push(`Quota: ${QUOTA_PER_DAY.toLocaleString("en-US")} reads per day on the Spark plan, shared with the live site. Per run: --max-reads ${opts.maxReads}; per Pacific day: --daily-ceiling ${opts.dailyCeiling} (this script's own reads only; ${opts.ledgerToday} recorded today).`);
  lines.push(`Recommendation: about ${runs} run(s) of up to ${perRun} reads${runs > 1 ? `, spread over at least ${Math.ceil(est / Math.max(1, opts.dailyCeiling))} day(s), using --collections to split them and --resume to continue` : ""}.`);
  lines.push("Check the Firebase console (Firestore > Usage) for the real daily reads. Set --daily-ceiling to 50,000 minus about twice the site's typical daily reads.");
  return { totalDocs, estimatedReads: est, usedReads: state.reads, lines };
}

// --- the run -----------------------------------------------------------------------------------------------------------------------------------

export type FileEntry = {
  file: string;
  documents: number;
  complete: boolean;
  sha256: string | null;
  lastDocPath: string | null;
  redactedValues: number;
  countCheck?: { counted: number; exported: number; match: boolean };
};

export type Manifest = {
  tool: string;
  toolVersion: string;
  projectId: string;
  startedAtUtc: string;
  updatedAtUtc: string;
  complete: boolean;
  stoppedReason: string | null;
  redactedFields: string[];
  selection: string[] | "all";
  files: Record<string, FileEntry>;
  subcollectionChecks: Record<string, { counted: number; exported: number; match: boolean }>;
  mismatches: string[];
};

export type RunConfig = {
  projectId: string;
  outRoot: string;
  plan: PlanItem[];
  selected: PlanItem[];
  selectionNames: string[] | null;
  maxReads: number;
  dailyCeiling: number;
  pageSize: number;
  pauseMs: number;
  redactFields: string[];
  force: boolean;
  resume: string | true | null;
};

export type RunResult = { manifest: Manifest; dir: string; reads: number; stopped: StopRun | null; exitCode: number };

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const fileNameFor = (p: string) => `${p.replace(/\//g, "__")}.ndjson`;
const sha = (file: string) => hash("sha256", readFileSync(file), "hex");

function saveManifest(dir: string, m: Manifest, now: Date): void {
  m.updatedAtUtc = now.toISOString();
  const file = path.join(dir, "manifest.json");
  writeFileSync(`${file}.tmp`, `${JSON.stringify(m, null, 2)}\n`, "utf8");
  renameSync(`${file}.tmp`, file);
}

function findResumeDir(outRoot: string, resume: string | true): string {
  if (resume !== true) {
    const dir = path.join(outRoot, resume);
    if (!existsSync(path.join(dir, "manifest.json"))) throw new Error(`No export to resume at ${dir}.`);
    return dir;
  }
  const dirs = existsSync(outRoot) ? readdirSync(outRoot).filter((n) => /^\d{8}T\d{6}Z$/.test(n) && existsSync(path.join(outRoot, n, "manifest.json"))) : [];
  const open = dirs.sort().reverse().find((n) => !(JSON.parse(readFileSync(path.join(outRoot, n, "manifest.json"), "utf8")) as Manifest).complete);
  if (!open) throw new Error(`No unfinished export found in ${outRoot}.`);
  return path.join(outRoot, open);
}

function readLines(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return text.split("\n").filter(Boolean);
}

export async function runExport(cfg: RunConfig, deps: Deps): Promise<RunResult> {
  const today = pacificDay(deps.now());
  const ledgerFile = path.join(cfg.outRoot, LEDGER_FILE);
  const ledger0 = readLedger(ledgerFile);
  assertWithinCeiling(ledger0, today, cfg.maxReads, cfg.dailyCeiling); // before any read and before any file is made

  let dir: string;
  let manifest: Manifest;
  if (cfg.resume) {
    dir = findResumeDir(cfg.outRoot, cfg.resume);
    manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
    if (manifest.projectId !== cfg.projectId) throw new Error(`That export is for project ${manifest.projectId}, not ${cfg.projectId}.`);
    if (JSON.stringify([...manifest.redactedFields].sort()) !== JSON.stringify([...cfg.redactFields].sort())) {
      throw new Error("The redaction list differs from the one recorded in that export; resume with the same --redact, or start a new export.");
    }
    manifest.complete = false;
    manifest.stoppedReason = null;
  } else {
    dir = path.join(cfg.outRoot, stamp(deps.now()));
    mkdirSync(dir, { recursive: true });
    manifest = {
      tool: "export-firestore", toolVersion: TOOL_VERSION, projectId: cfg.projectId, startedAtUtc: deps.now().toISOString(), updatedAtUtc: "", complete: false,
      stoppedReason: null, redactedFields: [...cfg.redactFields], selection: cfg.selectionNames ?? "all", files: {}, subcollectionChecks: {}, mismatches: [],
    };
  }
  if (cfg.selectionNames) manifest.selection = [...new Set([...(Array.isArray(manifest.selection) ? manifest.selection : []), ...cfg.selectionNames])];

  const redactSet = new Set(cfg.redactFields);
  const state = { reads: 0 };
  let stopped: StopRun | null = null;
  const touched: string[] = [];

  const fileOf = (p: string) => path.join(dir, fileNameFor(p));

  async function exportItem(item: PlanItem): Promise<void> {
    const prior = manifest.files[item.path];
    if (prior?.complete && !cfg.force) {
      deps.log(`skip ${item.path}: already complete (${prior.documents} documents)`);
      return;
    }
    let sources: string[];
    if (item.parent) {
      const pe = manifest.files[item.parent];
      if (!pe?.complete) {
        deps.log(`skip ${item.path}: its parent ${item.parent} is not exported completely yet (export the parent first)`);
        return;
      }
      sources = readLines(fileOf(item.parent)).map((l) => `${(JSON.parse(l) as { path: string }).path}/${item.sub}`).sort();
    } else sources = [item.path];

    const file = fileOf(item.path);
    let entry: FileEntry;
    let startIdx = 0;
    let after: string | undefined;
    if (prior && !prior.complete && prior.lastDocPath && !cfg.force) {
      const lines = existsSync(file) ? readLines(file) : [];
      const last = lines.length ? (JSON.parse(lines[lines.length - 1]) as { path: string }).path : null;
      if (lines.length !== prior.documents || last !== prior.lastDocPath) {
        throw new StopRun(`The file for ${item.path} does not match the manifest (it was changed or damaged). Use --force to export that collection again from the start.`, "error");
      }
      entry = prior;
      const srcOfLast = prior.lastDocPath.split("/").slice(0, -1).join("/");
      startIdx = Math.max(0, sources.indexOf(srcOfLast));
      after = prior.lastDocPath.split("/").pop();
      deps.log(`resume ${item.path}: ${prior.documents} documents already saved`);
    } else {
      writeFileSync(file, "", "utf8");
      entry = { file: path.basename(file), documents: 0, complete: false, sha256: null, lastDocPath: null, redactedValues: 0 };
      manifest.files[item.path] = entry;
    }
    manifest.files[item.path] = entry;
    touched.push(item.path);

    for (let i = startIdx; i < sources.length; i++) {
      const src = sources[i];
      for (;;) {
        const remaining = cfg.maxReads - state.reads;
        if (remaining <= 0) throw new StopRun(`Reached the read cap for this run (--max-reads ${cfg.maxReads}) in ${item.path}; ${entry.documents} documents saved so far. Run again with --resume.`, "cap");
        const limit = Math.min(cfg.pageSize, remaining);
        const page = await guarded(() => deps.db.getPage(src, { limit, startAfter: after }), deps, `reading ${src}`);
        state.reads += readsFor(page.length);
        if (page.length) {
          const counter = { n: 0 };
          const text = page.map((d) => encodeDocument(d.path, redact(d.data, redactSet, counter) as Record<string, unknown>)).join("");
          appendFileSync(file, text, "utf8");
          entry.documents += page.length;
          entry.redactedValues += counter.n;
          entry.lastDocPath = page[page.length - 1].path;
          saveManifest(dir, manifest, deps.now());
        }
        if (page.length < limit) break;
        after = page[page.length - 1].id;
        await deps.sleep(cfg.pauseMs);
      }
      after = undefined;
      if (i < sources.length - 1) await deps.sleep(cfg.pauseMs);
    }

    entry.complete = true;
    entry.sha256 = sha(file);
    if (!item.parent) {
      const counted = await guarded(() => deps.db.count(item.path), deps, `checking the count of ${item.path}`);
      state.reads += countReads(counted);
      entry.countCheck = { counted, exported: entry.documents, match: counted === entry.documents };
      if (!entry.countCheck.match) manifest.mismatches.push(`${item.path}: exported ${entry.documents}, count() says ${counted}`);
    }
    saveManifest(dir, manifest, deps.now());
    deps.log(`done ${item.path}: ${entry.documents} documents${entry.countCheck && !entry.countCheck.match ? ` (COUNT MISMATCH: count() says ${entry.countCheck.counted})` : ""} [${state.reads} reads so far]`);
  }

  try {
    for (const item of cfg.selected) await exportItem(item);
    // A subcollection name is verified against one collection-group count once every copy of it has been exported.
    const names = [...new Set(cfg.plan.filter((i) => i.parent).map((i) => i.sub as string))];
    for (const name of names) {
      const items = cfg.plan.filter((i) => i.sub === name);
      if (!items.every((i) => manifest.files[i.path]?.complete)) continue;
      const exported = items.reduce((sum, i) => sum + manifest.files[i.path].documents, 0);
      const counted = await guarded(() => deps.db.countGroup(name), deps, `checking the count of the subcollections named ${name}`);
      state.reads += countReads(counted);
      manifest.subcollectionChecks[name] = { counted, exported, match: counted === exported };
      if (counted !== exported) manifest.mismatches.push(`*/${name}: exported ${exported}, count() says ${counted}`);
    }
    const wanted = cfg.selected.length === cfg.plan.length;
    manifest.complete = wanted && cfg.plan.every((i) => manifest.files[i.path]?.complete);
  } catch (e) {
    stopped = e instanceof StopRun ? e : new StopRun(e instanceof Error ? e.message : String(e), "error");
    manifest.stoppedReason = stopped.message;
    deps.log(`STOPPED: ${stopped.message}`);
  } finally {
    for (const p of touched) {
      const e = manifest.files[p];
      if (e && existsSync(fileOf(p))) e.sha256 = sha(fileOf(p));
    }
    saveManifest(dir, manifest, deps.now());
    saveLedger(ledgerFile, withReads(ledger0, today, state.reads));
  }
  const total = ledgerTotal(withReads(ledger0, today, state.reads), today);
  deps.log(`Reads this run: ${state.reads}. This script's recorded reads for ${today} (Pacific): ${total} of ceiling ${cfg.dailyCeiling} (the ledger counts only this script; check the Usage tab for the real total).`);
  for (const m of manifest.mismatches) deps.log(`COUNT MISMATCH ${m}`);
  const exitCode = stopped ? (stopped.kind === "cap" ? 2 : 1) : manifest.mismatches.length ? 3 : 0;
  return { manifest, dir, reads: state.reads, stopped, exitCode };
}
