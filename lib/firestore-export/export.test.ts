import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { GeoPoint, Timestamp } from "firebase-admin/firestore";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UsageError, checkOutDir, parseArgs, readCredentials } from "./args";
import { decodeDocument, decodeValue, encodeDocument, encodeValue } from "./codec";
import { applyDiscovery, knownPlan, selectPlan } from "./collections";
import { LEDGER_FILE, assertWithinCeiling, pacificDay } from "./ledger";
import { MockDb, type MockData } from "./mock-db";
import { guardReadOnly } from "./read-db";
import { REDACTED, discover, dryRun, runExport, type Deps, type RunConfig } from "./runner";

const REPO = path.resolve(__dirname, "../..");
const PREFIXES = ["", "programs/ftc/"];
const collection = () => null;
const makeRef = (p: string) => ({ path: p, id: p.split("/").pop() as string, collection });

describe("typed encoding", () => {
  it("round-trips every Firestore value type", () => {
    const data = {
      when: new Timestamp(1700000000, 123456789),
      where: new GeoPoint(37.5, -122.25),
      bytes: Buffer.from([0, 1, 2, 250, 255]),
      ref: makeRef("teams/abc"),
      nan: NaN,
      inf: Infinity,
      ninf: -Infinity,
      nested: { a: [1, "two", { b: new Timestamp(5, 6) }, [NaN]], c: null, d: true },
      tagged: { __fs: "timestamp", seconds: 1 },
      deep: { x: { __fs: { y: 1 } } },
    };
    const line = encodeDocument("teams/t1", data);
    expect(line.endsWith("\n")).toBe(true);
    const back = decodeDocument(line, makeRef);
    expect(back.path).toBe("teams/t1");
    expect(back.data).toEqual(data);
    expect(Number.isNaN(back.data.nan)).toBe(true);
    expect(back.data.inf).toBe(Infinity);
    expect(back.data.ninf).toBe(-Infinity);
  });

  it("keeps negative zero and big integers, and leaves a user map with the tag key alone", () => {
    expect(Object.is(decodeValue(encodeValue(-0), makeRef), -0)).toBe(true);
    const big = BigInt("12345678901234567890");
    expect(decodeValue(encodeValue(big), makeRef)).toBe(big);
    const user = { __fs: "geopoint", latitude: 1 };
    expect(decodeValue(encodeValue(user), makeRef)).toEqual(user);
  });

  it("refuses a value it cannot represent", () => {
    expect(() => encodeValue(undefined)).toThrow();
    expect(() => encodeValue(new (class Odd {})())).toThrow();
  });
});

describe("read-only by construction", () => {
  const writeCalls = ["set(", "update(", "delete(", "create(", "batch(", "bulkWriter", "runTransaction", "commit("];
  const dir = path.join(REPO, "lib/firestore-export");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.includes(".test.") && f !== "mock-db.ts")
    .map((f) => path.join(dir, f))
    .concat(path.join(REPO, "scripts/export-firestore.ts"));

  it("no export source contains a write call", () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const w of writeCalls) if (text.includes(w)) hits.push(`${path.basename(f)}: ${w}`);
    }
    expect(hits).toEqual([]);
  });

  it("the Firestore guard throws on a write method before anything is sent", () => {
    const fake = { collection: () => ({ delete: () => "sent" }), set: () => "sent", batch: () => "sent" };
    const g = guardReadOnly(fake);
    expect(() => (g as unknown as { set: () => void }).set()).toThrow(/read-only/);
    expect(() => (g as unknown as { batch: () => void }).batch()).toThrow(/read-only/);
    expect(() => (g.collection() as unknown as { delete: () => void }).delete()).toThrow(/read-only/);
  });
});

describe("arguments and credentials", () => {
  it("refuses anything that looks like a key file", () => {
    for (const a of ["--key=serviceAccount.json", "--credentials=C:\\k\\key.pem", "--service-account=x", "--out=C:\\keys\\prod.json", "creds.json"]) {
      expect(() => parseArgs([a])).toThrow(/key file/);
    }
  });

  it("has safe defaults, a redaction default and a way to turn it off or change it", () => {
    const d = parseArgs([]);
    expect(d).toMatchObject({ run: false, maxReads: 20000, dailyCeiling: 25000, pageSize: 300, pauseMs: 250 });
    expect(d.redact).toEqual(["tbaApiKey", "tbaApiKeyEncrypted", "encryptedUserData", "fcmTokens"]);
    expect(parseArgs(["--redact=none"]).redact).toEqual([]);
    expect(parseArgs(["--redact=a,b"]).redact).toEqual(["a", "b"]);
    expect(() => parseArgs(["--bogus"])).toThrow(UsageError);
    expect(() => parseArgs(["--max-reads=0"])).toThrow(/whole number/);
  });

  it("names the missing variable and has no fallback to other variable names", () => {
    const env = { FIREBASE_ADMIN_PROJECT_ID: "p", FIREBASE_ADMIN_CLIENT_EMAIL: "e", FIREBASE_ADMIN_PRIVATE_KEY: "k" };
    expect(() => readCredentials(env)).toThrow("Missing environment variable CS_ADMIN_PROJECT_ID");
    expect(() => readCredentials({ CS_ADMIN_PROJECT_ID: "p" })).toThrow("Missing environment variable CS_ADMIN_CLIENT_EMAIL");
    expect(() => readCredentials({ CS_ADMIN_PROJECT_ID: "p", CS_ADMIN_CLIENT_EMAIL: "e", CS_ADMIN_PRIVATE_KEY: "  " })).toThrow("CS_ADMIN_PRIVATE_KEY");
    expect(readCredentials({ CS_ADMIN_PROJECT_ID: "p", CS_ADMIN_CLIENT_EMAIL: "e", CS_ADMIN_PRIVATE_KEY: "a\\nb" }).privateKey).toBe("a\nb");
  });
});

describe("output folder", () => {
  it("requires --out and refuses the repository", () => {
    expect(() => checkOutDir(null, REPO, false)).toThrow(/--out/);
    expect(() => checkOutDir(path.join(REPO, "exports"), REPO, false)).toThrow(/inside the repository/);
    expect(() => checkOutDir(REPO, REPO, false)).toThrow(/inside the repository/);
  });

  it("refuses cloud-synced folders unless allowed, and then warns", () => {
    for (const seg of ["OneDrive", "OneDrive - School", "Dropbox", "iCloudDrive", "Google Drive", "GoogleDrive"]) {
      const p = path.join(os.tmpdir(), seg, "exports");
      expect(() => checkOutDir(p, REPO, false)).toThrow(/cloud-synced/);
      expect(checkOutDir(p, REPO, true).warning).toMatch(/WARNING/);
    }
  });

  it("accepts a local folder outside the repository", () => {
    const r = checkOutDir(path.join(os.tmpdir(), "cs-exports"), REPO, false);
    expect(r.warning).toBeNull();
  });
});

describe("ledger", () => {
  it("counts by Pacific day and refuses a run that would pass the ceiling", () => {
    expect(pacificDay(new Date("2026-11-17T03:00:00Z"))).toBe("2026-11-16");
    expect(pacificDay(new Date("2026-11-17T09:00:00Z"))).toBe("2026-11-17");
    expect(() => assertWithinCeiling({ days: { "2026-11-16": 6000 } }, "2026-11-16", 20000, 25000)).toThrow(/Refusing to run/);
    expect(() => assertWithinCeiling({ days: { "2026-11-15": 24000 } }, "2026-11-16", 20000, 25000)).not.toThrow();
  });
});

// --- the run, against the mock ---------------------------------------------------------------------------------------------------------------

function fixture(): MockData {
  const users = Array.from({ length: 5 }, (_, i) => ({ id: `u${i}`, data: { name: `User ${i}`, fcmTokens: ["tok"], joined: new Timestamp(100 + i, 0) } }));
  const teams = ["t1", "t2", "t3"].map((id) => ({ id, data: { name: id, tbaApiKey: "SECRET", settings: { tbaApiKeyEncrypted: "ENC", keep: 1 }, joinCode: "JOIN" } }));
  return {
    users,
    teams,
    "teams/t1/settings": [{ id: "sidebar", data: { rev: 1 } }],
    "teams/t2/settings": [{ id: "sidebar", data: { rev: 2 } }, { id: "other", data: { x: NaN } }],
    "programs/ftc/users": [{ id: "f1", data: { name: "FTC user" } }],
    "programs/ftc/teams": [{ id: "ft1", data: { name: "FTC team" } }],
    "programs/ftc/teams/ft1/settings": [{ id: "sidebar", data: { rev: 9 } }],
    surprise: [{ id: "s1", data: { v: 1 } }],
  };
}

let tmp = "";
const NOW = new Date("2026-11-16T20:00:00Z");
let sleeps: number[] = [];
let logs: string[] = [];

function deps(db: MockDb): Deps {
  return { db, now: () => NOW, sleep: async (ms) => void sleeps.push(ms), log: (l) => void logs.push(l) };
}

async function plan(db: MockDb) {
  const d = deps(db);
  const listed = await discover(d, PREFIXES.map((prefix) => ({ prefix, doc: prefix ? prefix.replace(/\/$/, "") : null })), { reads: 0 });
  return applyDiscovery(knownPlan(PREFIXES), listed, PREFIXES);
}

function config(p: ReturnType<typeof applyDiscovery>, over: Partial<RunConfig> = {}): RunConfig {
  return {
    projectId: "proj", outRoot: tmp, plan: p.plan, selected: p.plan, selectionNames: null, maxReads: 20000, dailyCeiling: 25000, pageSize: 2, pauseMs: 250,
    redactFields: ["tbaApiKey", "tbaApiKeyEncrypted", "encryptedUserData", "fcmTokens"], force: false, resume: null, ...over,
  };
}

const linesOf = (dir: string, file: string) => readFileSync(path.join(dir, file), "utf8").split("\n").filter(Boolean);

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "cs-export-test-"));
  sleeps = [];
  logs = [];
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("discovery and plan", () => {
  it("drops known collections that do not exist, adds unknown ones, and keeps the program prefix out of literals", async () => {
    const db = new MockDb(fixture());
    const p = await plan(db);
    const paths = p.plan.map((i) => i.path);
    expect(paths).toContain("users");
    expect(paths).toContain("programs/ftc/teams");
    expect(paths).toContain("surprise");
    expect(paths).not.toContain("pickLists");
    expect(p.unknown).toEqual(["surprise"]);
    expect(paths.indexOf("teams")).toBeLessThan(paths.indexOf("teams/settings"));
    expect(() => selectPlan(p.plan, ["nope"])).toThrow(/Not a known/);
    expect(selectPlan(p.plan, ["users"]).map((i) => i.path)).toEqual(["users"]);
  });
});

describe("dry run", () => {
  it("reads no documents, labels subcollection numbers as an upper bound and talks about the quota", async () => {
    const db = new MockDb(fixture());
    const p = await plan(db);
    const state = { reads: 0 };
    const r = await dryRun(p.plan, deps(db), state, { maxReads: 20000, dailyCeiling: 25000, ledgerToday: 0 });
    expect(db.docReads).toBe(0);
    const text = r.lines.join("\n");
    expect(text).toMatch(/UPPER-BOUND/);
    expect(text).toMatch(/50,000 reads per day/);
    expect(text).toMatch(/Usage/);
    expect(r.totalDocs).toBeGreaterThan(10);
    expect(state.reads).toBeGreaterThan(0);
  });
});

describe("export run", () => {
  it("exports every collection with typed lines, redaction, hashes, counts and a manifest", async () => {
    const db = new MockDb(fixture());
    const p = await plan(db);
    const r = await runExport(config(p), deps(db));
    expect(r.exitCode).toBe(0);
    expect(r.manifest.complete).toBe(true);
    expect(path.basename(r.dir)).toBe("20261116T200000Z");
    expect(r.manifest.files.users.documents).toBe(5);
    expect(r.manifest.files["teams/settings"].documents).toBe(3);
    expect(r.manifest.files["programs/ftc/teams/settings"].documents).toBe(1);
    expect(r.manifest.files.users.countCheck).toEqual({ counted: 5, exported: 5, match: true });
    expect(r.manifest.subcollectionChecks.settings).toEqual({ counted: 4, exported: 4, match: true });
    for (const e of Object.values(r.manifest.files)) {
      expect(e.sha256).toBe(createHash("sha256").update(readFileSync(path.join(r.dir, e.file))).digest("hex"));
    }
    const saved = JSON.parse(readFileSync(path.join(r.dir, "manifest.json"), "utf8"));
    expect(saved.redactedFields).toEqual(["tbaApiKey", "tbaApiKeyEncrypted", "encryptedUserData", "fcmTokens"]);
    const teams = linesOf(r.dir, "teams.ndjson").map((l) => decodeDocument(l, makeRef));
    expect(teams[0].data).toMatchObject({ tbaApiKey: REDACTED, joinCode: "JOIN", settings: { tbaApiKeyEncrypted: REDACTED, keep: 1 } });
    expect(readFileSync(path.join(r.dir, "teams.ndjson"), "utf8")).not.toContain("SECRET");
    expect(r.manifest.files.teams.redactedValues).toBe(6);
    const users = linesOf(r.dir, "users.ndjson").map((l) => decodeDocument(l, makeRef));
    expect(users[0].data.joined).toEqual(new Timestamp(100, 0));
    expect(users.map((u) => u.path)).toEqual(["users/u0", "users/u1", "users/u2", "users/u3", "users/u4"]);
    expect(sleeps).toContain(250);
  });

  it("redacts nothing when told to", async () => {
    const db = new MockDb(fixture());
    const p = await plan(db);
    const r = await runExport(config(p, { redactFields: [] }), deps(db));
    expect(readFileSync(path.join(r.dir, "teams.ndjson"), "utf8")).toContain("SECRET");
    expect(r.manifest.redactedFields).toEqual([]);
  });

  it("stops cleanly at the read cap, records where it stopped, and resumes without duplicates", async () => {
    const db = new MockDb(fixture());
    const p = await plan(db);
    const first = await runExport(config(p, { maxReads: 4 }), deps(db));
    expect(first.stopped?.kind).toBe("cap");
    expect(first.exitCode).toBe(2);
    expect(first.manifest.complete).toBe(false);
    expect(first.reads).toBeLessThanOrEqual(5);
    const partial = Object.values(first.manifest.files).find((e) => !e.complete);
    expect(partial?.lastDocPath).toBeTruthy();
    expect(first.manifest.stoppedReason).toMatch(/--resume/);
    const folder = path.basename(first.dir);
    const second = await runExport(config(p, { resume: folder }), deps(db));
    expect(second.manifest.complete).toBe(true);
    expect(second.manifest.files.users.documents).toBe(5);
    const paths = linesOf(second.dir, "users.ndjson").map((l) => (JSON.parse(l) as { path: string }).path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("resume skips a complete file unless --force", async () => {
    const db = new MockDb(fixture());
    const p = await plan(db);
    const first = await runExport(config(p), deps(db));
    const folder = path.basename(first.dir);
    const reads = db.docReads;
    await runExport(config(p, { resume: folder }), deps(db));
    expect(db.docReads).toBe(reads);
    expect(logs.some((l) => l.startsWith("skip users"))).toBe(true);
    await runExport(config(p, { resume: folder, force: true }), deps(db));
    expect(db.docReads).toBeGreaterThan(reads);
  });

  it("reports a count mismatch", async () => {
    const db = new MockDb(fixture());
    db.count = async (p: string) => (p === "users" ? 99 : (db.data[p] ?? []).length);
    const p = await plan(db);
    const r = await runExport(config(p), deps(db));
    expect(r.manifest.files.users.countCheck).toEqual({ counted: 99, exported: 5, match: false });
    expect(r.manifest.mismatches[0]).toMatch(/users: exported 5, count\(\) says 99/);
    expect(r.exitCode).toBe(3);
  });

  it("refuses before any read when the day's ledger plus the cap passes the ceiling", async () => {
    const db = new MockDb(fixture());
    const p = await plan(db);
    db.calls = [];
    mkdirSync(tmp, { recursive: true });
    writeFileSync(path.join(tmp, LEDGER_FILE), JSON.stringify({ days: { [pacificDay(NOW)]: 10000 } }));
    await expect(runExport(config(p, { maxReads: 20000 }), deps(db))).rejects.toThrow(/Refusing to run/);
    expect(db.calls).toEqual([]);
    expect(readdirSync(tmp)).toEqual([LEDGER_FILE]);
  });

  it("records the run's reads in the ledger", async () => {
    const db = new MockDb(fixture());
    const p = await plan(db);
    const r = await runExport(config(p), deps(db));
    const ledger = JSON.parse(readFileSync(path.join(tmp, LEDGER_FILE), "utf8"));
    expect(ledger.days[pacificDay(NOW)]).toBe(r.reads);
    expect(r.reads).toBeGreaterThan(10);
  });

  it("stops on a quota error without retrying, and keeps a resumable state", async () => {
    const db = new MockDb(fixture());
    const p = await plan(db);
    db.failures.getPage = [Object.assign(new Error("Quota exceeded"), { code: 8 })];
    const r = await runExport(config(p), deps(db));
    expect(r.stopped?.kind).toBe("quota");
    expect(r.stopped?.message).toMatch(/quota is exhausted/);
    expect(sleeps).toEqual([]);
    expect(r.manifest.complete).toBe(false);
    expect(JSON.parse(readFileSync(path.join(r.dir, "manifest.json"), "utf8")).stoppedReason).toMatch(/--resume/);
  });

  it("stops on a permission error", async () => {
    const db = new MockDb(fixture());
    const p = await plan(db);
    db.failures.getPage = [Object.assign(new Error("denied"), { code: 7 })];
    const r = await runExport(config(p), deps(db));
    expect(r.stopped?.kind).toBe("permission");
  });

  it("backs off on network errors (growing pauses) and then gives up", async () => {
    const db = new MockDb(fixture());
    const p = await plan(db);
    const unavailable = () => Object.assign(new Error("unavailable"), { code: 14 });
    db.failures.getPage = [unavailable(), unavailable()];
    const ok = await runExport(config(p, { pauseMs: 0 }), deps(db));
    expect(ok.manifest.complete).toBe(true);
    expect(sleeps.slice(0, 2)).toEqual([1000, 2000]);

    sleeps = [];
    const db2 = new MockDb(fixture());
    const p2 = await plan(db2);
    db2.failures.getPage = Array.from({ length: 10 }, unavailable);
    const bad = await runExport(config(p2, { pauseMs: 0, outRoot: path.join(tmp, "b") }), deps(db2));
    expect(bad.stopped?.kind).toBe("network");
    expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
  });

  it("does not export a subcollection before its parent is complete", async () => {
    const db = new MockDb(fixture());
    const p = await plan(db);
    const r = await runExport(config(p, { selected: selectPlan(p.plan, ["teams/settings"]), selectionNames: ["teams/settings"] }), deps(db));
    expect(r.manifest.files["teams/settings"]).toBeUndefined();
    expect(logs.some((l) => l.includes("parent teams is not exported"))).toBe(true);
    expect(r.manifest.complete).toBe(false);
  });
});
