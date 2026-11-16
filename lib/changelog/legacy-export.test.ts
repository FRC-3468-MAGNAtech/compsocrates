import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GLOBAL_KEY, assertOutsideRepo, buildExport, exportCounts, isInsideRepo, readOnly } from "@/lib/changelog/legacy-export";

// ALL FIXTURES ARE SYNTHETIC (invented teams and notes).
const repo = path.resolve(__dirname, "../..");
const outside = mkdtempSync(path.join(tmpdir(), "cs-export-test-"));
afterAll(() => rmSync(outside, { recursive: true, force: true }));

describe("the export path must be outside the repository", () => {
  it("refuses the repository folder, anything inside it, and a path that climbs back in", () => {
    for (const p of [repo, path.join(repo, "notes.json"), path.join(repo, "docs", "x", "notes.json"), path.join(repo, "a", "..", "notes.json"), path.join(repo, "does-not-exist-yet", "notes.json")]) {
      expect(isInsideRepo(p, repo), p).toBe(true);
      expect(() => assertOutsideRepo(p, repo), p).toThrow(/inside the repository/);
    }
  });
  it("accepts a path outside it, even a sibling with the same name prefix", () => {
    expect(() => assertOutsideRepo(path.join(outside, "notes.json"), repo)).not.toThrow();
    expect(isInsideRepo(`${repo}-sibling/notes.json`, repo)).toBe(false);
  });
});

describe("building the export", () => {
  const teams = [
    { id: "teamA", data: { name: "Secret team name", joinCode: "ABC123", versionReleases: [{ id: "r1", title: "T", body: "Added x", createdAt: 1000, updatedAt: 2000, authorName: "Someone", authorUid: "uid-1", teamId: "teamA" }] } },
    { id: "teamB", data: { name: "No notes" } },
  ];
  const root = [{ id: "g1", data: { title: "G", body: "Fixed y", createdAt: { toMillis: () => 3000 }, authorUid: "uid-2" } }];

  it("keeps only id, title, body and the two times: no author, join code or other team field", () => {
    const data = buildExport(teams, root);
    expect(data).toEqual({
      teamA: [{ id: "r1", title: "T", body: "Added x", createdAt: 1000, updatedAt: 2000 }],
      [GLOBAL_KEY]: [{ id: "g1", title: "G", body: "Fixed y", createdAt: 3000, updatedAt: 0 }],
    });
    const text = JSON.stringify(data);
    for (const secret of ["Secret team name", "ABC123", "Someone", "uid-1", "uid-2"]) expect(text).not.toContain(secret);
    expect(exportCounts(data)).toEqual({ teams: 1, notes: 2, global: 1 });
  });
});

describe("the read-only guard", () => {
  const calls: string[] = [];
  const ref = (path: string): Record<string, unknown> => ({
    get: async () => ({ path }),
    set: async () => void calls.push(`set ${path}`),
    update: async () => void calls.push(`update ${path}`),
    delete: async () => void calls.push(`delete ${path}`),
    create: async () => void calls.push(`create ${path}`),
    collection: (n: string) => ref(`${path}/${n}`),
    doc: (n: string) => ref(`${path}/${n}`),
  });
  type Fn = (...a: string[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const db = readOnly<Record<string, Fn>>({ ...(ref("root") as Record<string, Fn>), batch: () => calls.push("batch"), runTransaction: async () => calls.push("tx"), bulkWriter: () => calls.push("bulk") });

  it("allows get and list calls, down through collections and documents", async () => {
    await expect(db.collection("teams").get()).resolves.toEqual({ path: "root/teams" });
  });
  it("throws on every write, at any depth, before anything runs", () => {
    const col = db.collection("teams");
    const doc = col.doc("t1");
    for (const [name, fn] of [["set", doc.set], ["update", doc.update], ["delete", doc.delete], ["create", col.create], ["batch", db.batch], ["runTransaction", db.runTransaction], ["bulkWriter", db.bulkWriter]] as const) {
      expect(() => fn(), name).toThrow(/read-only/);
    }
    expect(calls).toEqual([]);
  });
});

describe("the scripts themselves", () => {
  const src = (name: string) => readFileSync(path.join(repo, "scripts", name), "utf8");

  it("the export script never calls a write method, takes no secret from a file, and checks the path before reading", () => {
    const text = src("export-cs-changelog.ts");
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/\.(set|update|delete|create|add|batch|runTransaction|bulkWriter)\(/);
    // process.env[...] is how credentials arrive; what must not appear is reading a file (an .env file, a service-account JSON).
    expect(code).not.toMatch(/readFileSync|["'`/\\]\.env|serviceAccount|require\(/);
    expect(code.indexOf("assertOutsideRepo")).toBeGreaterThan(-1);
    expect(code.indexOf("assertOutsideRepo")).toBeLessThan(code.indexOf(".get()"));
  });

  it("the export script refuses a path inside the repository and reads nothing (no credentials are set, so it would fail first if it tried)", () => {
    let message = "";
    try {
      execFileSync(process.execPath, ["node_modules/vite-node/vite-node.mjs", "--config", "vitest.config.ts", "scripts/export-cs-changelog.ts", `--out=${path.join(repo, "docs", "should-not-exist.json")}`], {
        cwd: repo,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } as unknown as NodeJS.ProcessEnv,
        stdio: "pipe",
      });
    } catch (err) {
      message = String((err as { stderr?: Buffer }).stderr ?? "");
    }
    expect(message).toContain("Refusing to write inside the repository");
    expect(message).not.toContain("Missing environment variable"); // refused before any credential was needed
  });

  it("the importer refuses --apply without a confirmed project, before any connection (dry run needs no credentials)", () => {
    const input = path.join(outside, "in.json");
    execFileSync(process.execPath, ["-e", `require("fs").writeFileSync(${JSON.stringify(input)}, JSON.stringify({ t: [{ id: "a", title: "Synthetic", body: "Added x", createdAt: 1700000000000, updatedAt: 1700000000000 }] }))`]);
    const run = (extra: string[], env: Record<string, string> = {}) => {
      try {
        const out = execFileSync(process.execPath, ["node_modules/vite-node/vite-node.mjs", "--config", "vitest.config.ts", "scripts/import-cs-changelog.ts", `--input=${input}`, ...extra], {
          cwd: repo,
          env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env } as unknown as NodeJS.ProcessEnv,
          stdio: "pipe",
        });
        return { code: 0, out: String(out), err: "" };
      } catch (err) {
        const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
        return { code: e.status ?? 1, out: String(e.stdout ?? ""), err: String(e.stderr ?? "") };
      }
    };
    const dry = run([]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("DRY RUN");
    expect(dry.out).toContain("cs-legacy-t-a");
    const noConfirm = run(["--apply"], { CS_ADMIN_PROJECT_ID: "demo-project", CS_ADMIN_CLIENT_EMAIL: "x@example.test", CS_ADMIN_PRIVATE_KEY: "not-a-key" });
    expect(noConfirm.code).toBe(1);
    expect(noConfirm.err).toContain("--apply needs --confirm-project=demo-project");
    const wrong = run(["--apply", "--confirm-project=other"], { CS_ADMIN_PROJECT_ID: "demo-project", CS_ADMIN_CLIENT_EMAIL: "x@example.test", CS_ADMIN_PRIVATE_KEY: "not-a-key" });
    expect(wrong.code).toBe(1);
    expect(wrong.err).toContain("Nothing was written");
  }, 60_000);
});
