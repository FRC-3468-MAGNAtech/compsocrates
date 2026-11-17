import { describe, expect, it, vi } from "vitest";
import type { ProgramId } from "@/config/programs/types";
import { UsageError } from "@/lib/firestore-export/args";
import { pacificDay, type Ledger } from "@/lib/firestore-export/ledger";
import { assertConfirmedProject, parseBackfillArgs, type BackfillOptions } from "./args";
import { makeBackfillDb, userFieldsToRead } from "./firestore-db";
import { planBackfill, type ExistingMembership, type UserRow } from "./plan";
import { BATCH_SIZE, assertUnderCeiling, chunk, runBackfill, type BackfillDb, type BackfillLedgers } from "./runner";

// Synthetic fixtures and a mocked Firestore: no network, no files, no real project.

const NOW = new Date("2026-11-20T18:00:00Z");
const opts = (over: Partial<BackfillOptions> = {}): BackfillOptions => ({ ...parseBackfillArgs([]), ...over });

type Store = { users: Record<ProgramId, UserRow[]>; memberships: Record<ProgramId, ExistingMembership[]>; teams: Record<ProgramId, string[]>; enabled: boolean };
const store = (over: Partial<Store> = {}): Store => ({ users: { frc: [], ftc: [] }, memberships: { frc: [], ftc: [] }, teams: { frc: [], ftc: [] }, enabled: true, ...over });
const user = (uid: string, teamId: string, over: Record<string, unknown> = {}): UserRow => ({ uid, data: { displayName: uid, email: `${uid}@example.com`, teamId, role: "match-scout", isTeamAdmin: false, ...over } });
const ftcUser = (uid: string, teamId: string): UserRow => ({ uid, data: { name: uid, teamId, primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false } });

/** An in-memory BackfillDb that records every call (so a test can see what was read and written). */
function mockDb(s: Store) {
  const calls: string[] = [];
  const created: { program: ProgramId; id: string; doc: Record<string, unknown> }[] = [];
  const db: BackfillDb = {
    async membershipsEnabled() {
      calls.push("enabled");
      return s.enabled;
    },
    async countUsers(p, team) {
      calls.push(`countUsers ${p}`);
      return s.users[p].filter((u) => u.data.teamId && (!team || u.data.teamId === team)).length;
    },
    async countMemberships(p) {
      calls.push(`countMemberships ${p}`);
      return s.memberships[p].length;
    },
    async readUsers(p, team) {
      calls.push(`readUsers ${p}`);
      return s.users[p].filter((u) => u.data.teamId && (!team || u.data.teamId === team));
    },
    async readMemberships(p) {
      calls.push(`readMemberships ${p}`);
      return s.memberships[p];
    },
    async teamsExist(p, ids) {
      calls.push(`teamsExist ${p}`);
      return new Set(ids.filter((id) => s.teams[p].includes(id)));
    },
    async createBatch(p, items) {
      calls.push(`createBatch ${p} ${items.length}`);
      let n = 0;
      let existed = 0;
      for (const it of items) {
        if (s.memberships[p].some((m) => `${m.teamId}_${m.uid}` === it.id)) {
          existed++;
          continue;
        }
        s.memberships[p].push({ program: p, uid: it.doc.uid, teamId: it.doc.teamId, status: it.doc.status });
        created.push({ program: p, id: it.id, doc: it.doc as unknown as Record<string, unknown> });
        n++;
      }
      return { created: n, existed };
    },
  };
  return { db, calls, created };
}

function ledgers() {
  let reads: Ledger = { days: {} };
  let writes: Ledger = { days: {} };
  const l: BackfillLedgers = { reads: () => reads, writes: () => writes, saveReads: (x) => (reads = x), saveWrites: (x) => (writes = x) };
  return { l, get reads() { return reads; }, get writes() { return writes; } };
}

const run = (o: BackfillOptions, s: Store, lg = ledgers(), now = NOW) => {
  const m = mockDb(s);
  const lines: string[] = [];
  const sleeps: number[] = [];
  const promise = runBackfill(o, { db: m.db, ledgers: lg.l, now: () => now, sleep: async (ms) => void sleeps.push(ms), log: (x) => lines.push(x) });
  return { ...m, lines, sleeps, lg, promise };
};

describe("arguments", () => {
  it("defaults: dry run, both programs, caps 5000 writes and 10000 a day", () => {
    const o = parseBackfillArgs([]);
    expect(o).toMatchObject({ apply: false, programs: ["frc", "ftc"], teams: [], max: null, maxWrites: 5000, dailyWriteCeiling: 10000, detail: false });
  });
  it("--team is repeatable, --program picks one, --max caps", () => {
    const o = parseBackfillArgs(["--program=ftc", "--team=A1", "--team=B2", "--max=50", "--apply", "--confirm-project=demo"]);
    expect(o).toMatchObject({ programs: ["ftc"], teams: ["A1", "B2"], max: 50, apply: true, confirmProject: "demo" });
    expect(parseBackfillArgs(["--program=both"]).programs).toEqual(["frc", "ftc"]);
  });
  it("refuses a key file or credentials flag", () => {
    for (const bad of ["--key=sa.json", "--credentials=x", "service-account.json", "--google-application-credentials=a", "--private-key=abc"]) expect(() => parseBackfillArgs([bad])).toThrow(/key file|Unexpected/);
  });
  it("--apply needs --confirm-project; unknown options and bad numbers are refused", () => {
    expect(() => parseBackfillArgs(["--apply"])).toThrow(/confirm-project/);
    expect(() => parseBackfillArgs(["--wat"])).toThrow(/Unknown option/);
    expect(() => parseBackfillArgs(["--max=0"])).toThrow(/whole number/);
    expect(() => parseBackfillArgs(["--program=nba"])).toThrow(/--program/);
  });
  it("--confirm-project must equal the project in the credentials", () => {
    expect(() => assertConfirmedProject("other", "prod-1")).toThrow(/does not equal/);
    expect(() => assertConfirmedProject(null, "prod-1")).toThrow(/needs --confirm-project/);
    expect(() => assertConfirmedProject("prod-1", "prod-1")).not.toThrow();
  });
});

describe("the plan", () => {
  const base = { users: { frc: [user("u1", "AAA1"), user("u2", "AAA1"), user("u3", "BBB2")], ftc: [ftcUser("u1", "fff1")] }, existing: [] as ExistingMembership[], teamsFound: { frc: new Set(["AAA1", "BBB2"]), ftc: new Set(["fff1"]) }, onlyTeams: [] as string[], nowMs: 5 };

  it("creates a pointer-origin membership for every user with a team and none, counted per team", () => {
    const plan = planBackfill(base);
    expect(plan.toCreate.map((c) => `${c.program}:${c.id}`)).toEqual(["frc:AAA1_u1", "frc:AAA1_u2", "frc:BBB2_u3", "ftc:fff1_u1"]);
    expect(plan.toCreate.every((c) => c.doc.origin === "pointer" && c.doc.status === "active")).toBe(true);
    expect(plan.perTeam).toEqual(expect.arrayContaining([{ program: "frc", teamId: "AAA1", toCreate: 2 }, { program: "frc", teamId: "BBB2", toCreate: 1 }, { program: "ftc", teamId: "fff1", toCreate: 1 }]));
  });
  it("skips users that already have a membership (active or past) and users with no team", () => {
    const plan = planBackfill({ ...base, users: { frc: [user("u1", "AAA1"), user("u2", "AAA1"), user("u9", "")], ftc: [] }, existing: [{ program: "frc", teamId: "AAA1", uid: "u1", status: "past" }] });
    expect(plan.toCreate.map((c) => c.id)).toEqual(["AAA1_u2"]);
    expect(plan.alreadyHave).toBe(1);
  });
  it("reports users whose team document does not exist (reported, not backfilled)", () => {
    const plan = planBackfill({ ...base, teamsFound: { frc: new Set(["AAA1"]), ftc: new Set(["fff1"]) } });
    expect(plan.missingTeams).toEqual([{ program: "frc", teamId: "BBB2", uids: ["u3"] }]);
    expect(plan.toCreate.map((c) => c.id)).not.toContain("BBB2_u3");
  });
  it("reports ids that cannot make a key", () => {
    const plan = planBackfill({ ...base, users: { frc: [user("u1", "A_B"), user("u_2", "AAA1")], ftc: [] } });
    expect(plan.invalidIds).toEqual([{ program: "frc", teamId: "AAA1", uid: "u_2" }, { program: "frc", teamId: "A_B", uid: "u1" }]);
    expect(plan.toCreate).toEqual([]);
  });
  it("reports users who would pass 5 active memberships across both programs", () => {
    const existing: ExistingMembership[] = [{ program: "frc", teamId: "X1", uid: "u1", status: "active" }, { program: "frc", teamId: "X2", uid: "u1", status: "active" }, { program: "frc", teamId: "X3", uid: "u1", status: "active" }, { program: "ftc", teamId: "Y1", uid: "u1", status: "active" }];
    const first = planBackfill({ ...base, existing });
    expect(first.toCreate.map((c) => `${c.program}:${c.id}`)).toContain("frc:AAA1_u1"); // 4 + 1 = 5: allowed
    expect(first.wouldExceed).toEqual([{ program: "ftc", teamId: "fff1", uid: "u1" }]); // the ftc one would be the 6th
  });
  it("--team limits it to the named teams", () => {
    const plan = planBackfill({ ...base, onlyTeams: ["BBB2"] });
    expect(plan.toCreate.map((c) => c.id)).toEqual(["BBB2_u3"]);
    expect(plan.outsideTeamFilter).toBe(3);
  });
  it("stores raw role fields and no email", () => {
    const plan = planBackfill({ ...base, users: { frc: [user("u1", "AAA1", { role: "coach", isTeamAdmin: true })], ftc: [] } });
    expect(plan.toCreate[0].doc).toMatchObject({ role: "coach", isAdmin: true, roles: null });
    expect(JSON.stringify(plan.toCreate[0].doc)).not.toContain("example.com");
  });
});

describe("a dry run counts and writes nothing", () => {
  it("only counts: no document is read, nothing is written", async () => {
    const s = store({ users: { frc: [user("u1", "AAA1")], ftc: [ftcUser("u1", "fff1")] } });
    const r = run(opts(), s);
    const res = await r.promise;
    expect(res.exitCode).toBe(0);
    expect(r.calls.every((c) => c.startsWith("count"))).toBe(true);
    expect(r.created).toEqual([]);
    expect(r.lines.join("\n")).toContain("DRY RUN (counts only)");
    expect(res.writes).toBe(0);
  });
  it("--detail reads the documents and lists per-team counts, still writes nothing", async () => {
    const s = store({ users: { frc: [user("u1", "AAA1"), user("u2", "AAA1")], ftc: [] }, teams: { frc: ["AAA1"], ftc: [] } });
    const r = run(opts({ detail: true }), s);
    await r.promise;
    expect(r.calls).toContain("readUsers frc");
    expect(r.lines.join("\n")).toContain("frc team AAA1: 2");
    expect(r.created).toEqual([]);
    expect(r.calls.some((c) => c.startsWith("createBatch"))).toBe(false);
  });
  it("records the reads it used in the ledger, per Pacific day", async () => {
    const r = run(opts(), store({ users: { frc: [user("u1", "AAA1")], ftc: [] } }));
    await r.promise;
    expect(r.lg.reads.days[pacificDay(NOW)]).toBeGreaterThan(0);
  });
  it("refuses a read that would pass --max-reads before reading any document", async () => {
    const users = Array.from({ length: 30 }, (_, i) => user(`u${i}`, "AAA1"));
    const r = run(opts({ detail: true, maxReads: 10 }), store({ users: { frc: users, ftc: [] } }));
    await expect(r.promise).rejects.toThrow(/over --max-reads/);
    expect(r.calls.some((c) => c.startsWith("read"))).toBe(false);
  });
  it("refuses when the day's read ledger plus the cap would pass the daily ceiling", async () => {
    const lg = ledgers();
    lg.l.saveReads({ days: { [pacificDay(NOW)]: 24_900 } });
    const r = run(opts({ detail: true }), store({ users: { frc: [user("u1", "AAA1")], ftc: [] } }), lg);
    await expect(r.promise).rejects.toThrow(/ceiling/);
  });
});

describe("--apply", () => {
  const fixture = () => store({ users: { frc: [user("u1", "AAA1"), user("u2", "AAA1"), user("u3", "BBB2")], ftc: [ftcUser("u1", "fff1")] }, teams: { frc: ["AAA1", "BBB2"], ftc: ["fff1"] } });

  it("is refused while the kill switch is not true, and nothing is read or written", async () => {
    const r = run(opts({ apply: true, confirmProject: "p" }), store({ ...fixture(), enabled: false }));
    await expect(r.promise).rejects.toThrow(/membershipsEnabled/);
    expect(r.calls).toEqual(["enabled"]);
  });
  it("creates the memberships, only in the membership collections, and reads no user document for writing", async () => {
    const s = fixture();
    const r = run(opts({ apply: true, confirmProject: "p" }), s);
    const res = await r.promise;
    expect(res.created).toBe(4);
    expect(r.created.map((c) => `${c.program}:${c.id}`).sort()).toEqual(["frc:AAA1_u1", "frc:AAA1_u2", "frc:BBB2_u3", "ftc:fff1_u1"]);
    expect(r.calls.filter((c) => c.startsWith("createBatch"))).toEqual(["createBatch frc 3", "createBatch ftc 1"]);
    expect(r.lg.writes.days[pacificDay(NOW)]).toBe(4);
  });
  it("is idempotent: a second run creates nothing", async () => {
    const s = fixture();
    await run(opts({ apply: true, confirmProject: "p" }), s).promise;
    const second = run(opts({ apply: true, confirmProject: "p" }), s);
    expect((await second.promise).created).toBe(0);
    expect(second.created).toEqual([]);
  });
  it("--team applies to the chosen teams only", async () => {
    const s = fixture();
    const r = run(opts({ apply: true, confirmProject: "p", teams: ["BBB2"] }), s);
    await r.promise;
    expect(r.created.map((c) => c.id)).toEqual(["BBB2_u3"]);
  });
  it("--max caps the documents created in one run", async () => {
    const r = run(opts({ apply: true, confirmProject: "p", max: 2 }), fixture());
    expect((await r.promise).created).toBe(2);
    expect(r.lines.join("\n")).toContain("Capped at 2 of 4");
  });
  it("--max-writes caps it too, and the writes ledger records what was written", async () => {
    const r = run(opts({ apply: true, confirmProject: "p", maxWrites: 3 }), fixture());
    expect((await r.promise).created).toBe(3);
    expect(r.lg.writes.days[pacificDay(NOW)]).toBe(3);
  });
  it("refuses when the day's writes plus this run's cap would pass the daily write ceiling (before any read)", async () => {
    const lg = ledgers();
    lg.l.saveWrites({ days: { [pacificDay(NOW)]: 9_000 } });
    const r = run(opts({ apply: true, confirmProject: "p", maxWrites: 5000 }), fixture(), lg);
    await expect(r.promise).rejects.toThrow(/daily writes ceiling/);
    expect(r.calls).toEqual([]);
  });
  it("writes in batches of 400, pausing between them", async () => {
    const users = Array.from({ length: 1000 }, (_, i) => user(`u${String(i).padStart(4, "0")}`, "AAA1"));
    const s = store({ users: { frc: users, ftc: [] }, teams: { frc: ["AAA1"], ftc: [] } });
    const r = run(opts({ apply: true, confirmProject: "p", maxWrites: 5000, programs: ["frc"], pauseMs: 250, maxReads: 100_000, dailyReadCeiling: 200_000 }), s);
    await r.promise;
    expect(BATCH_SIZE).toBe(400);
    expect(r.calls.filter((c) => c.startsWith("createBatch"))).toEqual(["createBatch frc 400", "createBatch frc 400", "createBatch frc 200"]);
    expect(r.sleeps).toEqual([250, 250, 250]);
  });
  it("an existing membership is left as it is (create-only)", async () => {
    const s = fixture();
    s.memberships.frc.push({ program: "frc", teamId: "AAA1", uid: "u1", status: "past" });
    const r = run(opts({ apply: true, confirmProject: "p" }), s);
    await r.promise;
    expect(r.created.map((c) => c.id)).not.toContain("AAA1_u1");
  });
});

describe("helpers", () => {
  it("chunk splits into batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk(Array.from({ length: 401 }), 400).map((c) => c.length)).toEqual([400, 1]);
  });
  it("assertUnderCeiling names reads or writes", () => {
    expect(() => assertUnderCeiling("writes", { days: { d: 9000 } }, "d", 2000, 10000)).toThrow(UsageError);
    expect(() => assertUnderCeiling("reads", { days: {} }, "d", 100, 10000)).not.toThrow();
  });
});

describe("the Firestore adapter touches only what it should", () => {
  /** A tiny Admin-SDK double that records every call by name and path. */
  function fakeFirestore(failBatchWith?: number) {
    const log: string[] = [];
    const query = (path: string, desc: string) => {
      const q = {
        where: (f: string, op: string, v: unknown) => query(path, `${desc} where ${f}${op}${JSON.stringify(v)}`),
        select: (...f: string[]) => query(path, `${desc} select(${f.join(",")})`),
        limit: (n: number) => query(path, `${desc} limit ${n}`),
        count: () => ({ get: async () => (log.push(`count ${path}${desc}`), { data: () => ({ count: 7 }) }) }),
        get: async () => (log.push(`get ${path}${desc}`), { docs: [] }),
      };
      return q;
    };
    const db = {
      collection: (path: string) => ({ ...query(path, ""), doc: (id: string) => ({ path: `${path}/${id}`, id, create: async () => void log.push(`create ${path}/${id}`) }) }),
      doc: (path: string) => ({ get: async () => (log.push(`get ${path}`), { data: () => ({ membershipsEnabled: true }) }) }),
      getAll: async (...refs: { id: string }[]) => refs.map((r) => ({ id: r.id, exists: r.id !== "gone" })),
      batch: () => {
        const ops: string[] = [];
        return {
          create: (ref: { path: string }) => void ops.push(ref.path),
          commit: async () => {
            if (failBatchWith) throw Object.assign(new Error("ALREADY_EXISTS"), { code: failBatchWith });
            log.push(`batch ${ops.join(",")}`);
          },
        };
      },
    };
    return { db: db as never, log };
  }

  it("reads only the fields a membership is built from (no email, no token)", () => {
    expect(userFieldsToRead("frc").sort()).toEqual(["displayName", "isOwner", "isTeamAdmin", "name", "role", "roles", "secondaryRoles", "teamId"]);
    expect(userFieldsToRead("ftc")).not.toContain("email");
    expect(userFieldsToRead("ftc")).toContain("fieldTeamIds");
  });
  it("counts with count() queries on the right collections (users with a team, FTC under programs/ftc)", async () => {
    const f = fakeFirestore();
    const db = makeBackfillDb(f.db);
    expect(await db.countUsers("frc", null)).toBe(7);
    expect(await db.countUsers("ftc", "T1")).toBe(7);
    expect(await db.countMemberships("ftc")).toBe(7);
    expect(f.log).toEqual(['count users where teamId!=""', 'count programs/ftc/users where teamId==="T1"'.replace("===", "=="), "count programs/ftc/memberships"]);
  });
  it("writes ONLY with create() into a membership collection (one batch), never update, set or delete", async () => {
    const f = fakeFirestore();
    const db = makeBackfillDb(f.db);
    const doc = { uid: "u1" } as never;
    expect(await db.createBatch("frc", [{ program: "frc", id: "A_u1", doc }])).toEqual({ created: 1, existed: 0 });
    await db.createBatch("ftc", [{ program: "ftc", id: "T_u1", doc }]);
    expect(f.log).toEqual(["batch memberships/A_u1", "batch programs/ftc/memberships/T_u1"]);
  });
  it("on ALREADY_EXISTS falls back to one create() per document and leaves the existing ones", async () => {
    const f = fakeFirestore(6);
    const db = makeBackfillDb(f.db);
    const r = await db.createBatch("frc", [{ program: "frc", id: "A_u1", doc: {} as never }, { program: "frc", id: "A_u2", doc: {} as never }]);
    expect(r).toEqual({ created: 2, existed: 0 });
    expect(f.log).toEqual(["create memberships/A_u1", "create memberships/A_u2"]);
  });
  it("any other write error is thrown, not swallowed", async () => {
    const db = makeBackfillDb(fakeFirestore(8).db);
    await expect(db.createBatch("frc", [{ program: "frc", id: "A_u1", doc: {} as never }])).rejects.toMatchObject({ code: 8 });
  });
  it("the adapter has no update, set or delete", () => {
    expect(Object.keys(makeBackfillDb(fakeFirestore().db)).sort()).toEqual(["countMemberships", "countUsers", "createBatch", "membershipsEnabled", "readMemberships", "readUsers", "teamsExist"]);
  });
  it("teamsExist reports which team documents are there", async () => {
    const db = makeBackfillDb(fakeFirestore().db);
    expect([...(await db.teamsExist("frc", ["A", "gone", "B"]))].sort()).toEqual(["A", "B"]);
  });
});

describe("credentials come from the environment only", () => {
  it("the script reads no file and has no fallback names (checked on the module text)", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync("scripts/backfill-memberships.ts", "utf8");
    expect(text).toContain("readCredentials(process.env)");
    expect(text).not.toMatch(/readFileSync\(|FIREBASE_ADMIN_|GOOGLE_APPLICATION_CREDENTIALS|applicationDefault/);
    vi.restoreAllMocks();
  });
});
