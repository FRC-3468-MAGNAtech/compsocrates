import { describe, expect, it, vi } from "vitest";
import { parseEntryInput } from "@/lib/platform-changelog/model";
import { CREDENTIAL_VARS, SEED_ACTOR, SEED_DOC_ID, parseSeedArgs, runSeed, todayUtc, type SeedDb, type SeedRun } from "@/lib/platform-changelog/seed";
import { v2EntryInput } from "@/lib/platform-changelog/v2-entry";
import { v2Template } from "@/lib/platform-changelog/template";

const NOW = Date.UTC(2026, 10, 16, 15, 30);
const ENV = { CS_ADMIN_PROJECT_ID: "proj-1", CS_ADMIN_CLIENT_EMAIL: "svc@proj-1.iam.gserviceaccount.com", CS_ADMIN_PRIVATE_KEY: "SECRET-KEY-DO-NOT-PRINT" };

/** A mocked Firestore: records every create; `existing` ids make the commit fail the way Firestore does for create(). */
function mockDb(existing: string[] = []) {
  const creates: { path: string; data: Record<string, unknown> }[] = [];
  const db: SeedDb = {
    doc: (path) => ({ path }),
    collection: (name) => ({ doc: () => ({ path: `${name}/auto-id` }) }),
    batch: () => {
      const pending: { path: string; data: Record<string, unknown> }[] = [];
      return {
        create: (ref, data) => void pending.push({ path: (ref as { path: string }).path, data: data as Record<string, unknown> }),
        commit: async () => {
          if (pending.some((p) => existing.includes(p.path))) throw Object.assign(new Error("6 ALREADY_EXISTS: Document already exists"), { code: 6 });
          creates.push(...pending);
        },
      };
    },
  };
  return { db, creates };
}

function setup(argv: string[], over: Partial<SeedRun> = {}, existing: string[] = []) {
  const m = mockDb(existing);
  const lines: string[] = [];
  const makeDb = vi.fn(() => m.db);
  const run = () => runSeed({ argv, env: ENV, nowMs: NOW, makeDb, log: (l) => lines.push(l), ...over });
  return { ...m, lines, makeDb, run, text: () => lines.join("\n") };
}

describe("seed script: the v2.0.0 draft", () => {
  it("dry run (the default) prints the whole entry and writes nothing, with no credentials and no database", async () => {
    const s = setup([], { env: {} });
    expect(await s.run()).toBe(0);
    expect(s.makeDb).not.toHaveBeenCalled();
    expect(s.creates).toHaveLength(0);
    expect(s.text()).toContain("DRY RUN");
    expect(s.text()).toContain("CompSocrates v2.0.0");
    expect(s.text()).toContain('"status": "draft"');
    expect(s.text()).toContain("Assignments now show an event's name instead of its code");
  });

  it("--apply without --confirm-project is refused", async () => {
    const s = setup(["--apply"]);
    expect(await s.run()).toBe(1);
    expect(s.makeDb).not.toHaveBeenCalled();
    expect(s.text()).toContain("--confirm-project=proj-1");
  });

  it("--confirm-project that differs from the credentials' project is refused", async () => {
    const s = setup(["--apply", "--confirm-project=other-project"]);
    expect(await s.run()).toBe(1);
    expect(s.makeDb).not.toHaveBeenCalled();
    expect(s.creates).toHaveLength(0);
  });

  it("missing credentials name every missing variable, and no fallback names are read", async () => {
    const s = setup(["--apply", "--confirm-project=proj-1"], { env: { CS_ADMIN_PROJECT_ID: "proj-1", FIREBASE_ADMIN_CLIENT_EMAIL: "x", FIREBASE_ADMIN_PRIVATE_KEY: "y" } });
    expect(await s.run()).toBe(1);
    expect(s.text()).toContain("CS_ADMIN_CLIENT_EMAIL");
    expect(s.text()).toContain("CS_ADMIN_PRIVATE_KEY");
    expect(s.makeDb).not.toHaveBeenCalled();
    const none = setup(["--apply"], { env: {} });
    await none.run();
    for (const v of CREDENTIAL_VARS) expect(none.text()).toContain(v);
  });

  it("a key-file argument is refused, and so is any unknown argument", async () => {
    for (const arg of ["--key-file=sa.json", "--credentials=C:\\keys\\sa.json", "sa.json", "--service-account=x", "--bogus"]) {
      const s = setup(["--apply", "--confirm-project=proj-1", arg]);
      expect(await s.run(), arg).toBe(1);
      expect(s.makeDb, arg).not.toHaveBeenCalled();
    }
    expect(parseSeedArgs(["--date=2026-02-30"], "2026-11-16").ok).toBe(false);
  });

  it("apply writes ONE draft with create(), plus the audit entry, in one batch, and prints the project and account but never the key", async () => {
    const s = setup(["--apply", "--confirm-project=proj-1", "--date=2026-11-20"]);
    expect(await s.run()).toBe(0);
    expect(s.creates.map((c) => c.path)).toEqual([`platformChangelog/${SEED_DOC_ID}`, "platformAuditLog/auto-id"]);
    const doc = s.creates[0].data as Record<string, unknown>;
    expect(doc).toMatchObject({ status: "draft", legacy: false, rev: 1, publishedAt: null, createdBy: SEED_ACTOR, createdAt: NOW, updatedAt: NOW, date: "2026-11-20", title: "CompSocrates v2.0.0", version: "v2.0.0" });
    expect("postedAt" in doc).toBe(false);
    expect(doc.items).toHaveLength(46);
    expect(s.creates[1].data).toMatchObject({ action: "create-platform-changelog-entry", actorUid: SEED_ACTOR });
    expect(s.text()).toContain("proj-1");
    expect(s.text()).toContain(ENV.CS_ADMIN_CLIENT_EMAIL);
    expect(s.text()).not.toContain(ENV.CS_ADMIN_PRIVATE_KEY);
  });

  it("the date defaults to today (UTC)", async () => {
    const s = setup(["--apply", "--confirm-project=proj-1"]);
    await s.run();
    expect((s.creates[0].data as { date: string }).date).toBe("2026-11-16");
    expect(todayUtc(Date.UTC(2026, 0, 1, 23, 59))).toBe("2026-01-01");
  });

  it("is create-only: an existing id is refused, nothing is replaced, and the script never reads", async () => {
    const s = setup(["--apply", "--confirm-project=proj-1"], {}, [`platformChangelog/${SEED_DOC_ID}`]);
    expect(await s.run()).toBe(1);
    expect(s.creates).toHaveLength(0);
    expect(s.text()).toMatch(/already exists/);
    // the mock database has no read or set/update/delete at all: only doc(), collection().doc() and batch().create()/commit()
    expect(Object.keys(s.db).sort()).toEqual(["batch", "collection", "doc"]);
  });

  it("an entry the server's validator rejects is refused before anything else", async () => {
    const s = setup(["--apply", "--confirm-project=proj-1"], { entry: (d) => ({ ...v2EntryInput(d), items: [{ category: "new", text: "x".repeat(500), programs: ["frc"] }] }) });
    expect(await s.run()).toBe(1);
    expect(s.makeDb).not.toHaveBeenCalled();
    expect(s.text()).toContain("not valid");
    const html = setup([], { entry: (d) => ({ ...v2EntryInput(d), title: "<b>x</b>" }) });
    expect(await html.run()).toBe(1);
  });

  it("the stored entry passes the same validator the server route uses", async () => {
    const s = setup(["--apply", "--confirm-project=proj-1"]);
    await s.run();
    const doc = s.creates[0].data as { title: string; version: string; date: string; programs: string[]; items: unknown[] };
    expect(parseEntryInput({ title: doc.title, version: doc.version, date: doc.date, programs: doc.programs, items: doc.items }).ok).toBe(true);
  });

  it("the editor template and the script use the same data module", async () => {
    const s = setup(["--apply", "--confirm-project=proj-1", "--date=2026-11-20"]);
    await s.run();
    const doc = s.creates[0].data as { items: unknown[]; programs: unknown };
    const t = v2Template("2026-11-20");
    expect(doc.items).toEqual(t.items);
    expect(doc.programs).toEqual(t.programs);
  });
});
