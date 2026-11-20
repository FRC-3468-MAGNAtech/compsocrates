// The snapshot route, with a fake Admin SDK (documents by path, counted reads) and a fake `next/cache` (a persisted cache shared by every "instance"): authorization, team
// isolation with the memberships switch ON and OFF, the pointer read on every request, TTL and manual freshness, the Refresh throttle, chunking at 5,000 rows, the
// quota, the flags, the cache-entry cap and the meter counters. Nothing here touches Firebase or the network.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const state = { token: null as string | null, reads: {} as Record<string, number>, failBuild: null as Error | null, buildQueries: 0 };
  const count = (path: string, n = 1) => {
    const parent = path.split("/").slice(0, -1).join("/");
    state.reads[parent] = (state.reads[parent] ?? 0) + n;
  };
  const snapOf = (path: string) => ({ id: path.split("/").pop() as string, exists: docs.has(path), data: () => docs.get(path), ref: { id: path.split("/").pop(), path, parent: { path: path.split("/").slice(0, -1).join("/") } } });
  const docRef = (path: string): Record<string, unknown> => ({
    firestore: {},
    path,
    get: async () => {
      if (docs.has(path)) count(path);
      return snapOf(path);
    },
  });
  const query = (collectionPath: string, filters: [string, unknown][]): Record<string, unknown> => ({
    firestore: {},
    where: (field: string, _op: string, value: unknown) => query(collectionPath, [...filters, [field, value]]),
    get: async () => {
      if (state.failBuild && !collectionPath.endsWith("users") ) throw state.failBuild;
      state.buildQueries += 1;
      const rows = [...docs.keys()].filter((p) => p.startsWith(collectionPath + "/") && p.split("/").length === collectionPath.split("/").length + 1).filter((p) => filters.every(([f, v]) => docs.get(p)?.[f] === v));
      for (const p of rows) count(p);
      return { docs: rows.map(snapOf), size: rows.length };
    },
  });
  const db = { firestore: {}, doc: (path: string) => docRef(path), collection: (path: string) => ({ ...query(path, []), doc: (id: string) => docRef(path + "/" + id) }) };
  return { docs, state, db };
});

vi.mock("@/lib/firebase/admin", () => ({ getAdminFirestore: () => h.db }));
vi.mock("@/lib/server/require-user", () => ({
  serverSignInProblem: () => null,
  verifyBearerToken: async (request: Request) => {
    const match = request.headers.get("authorization")?.match(/^Bearer (.+)$/);
    return match && match[1] !== "bad" ? { uid: match[1] } : null;
  },
}));
vi.mock("next/cache", async () => await import("@/test-stubs/fake-next-cache"));

import { cacheCalls, cacheEntries, resetFakeNextCache } from "@/test-stubs/fake-next-cache";
import { handleSnapshot, resetSnapshotRateForTests } from "@/lib/server/snapshot-route";
import { resetSnapshotCacheForTests } from "@/lib/server/snapshot-cache";
import { invalidateAppSettingsCache, resetMembershipsEnabledCache } from "@/lib/server/team-settings";
import { pendingServerCountsForTests, pendingSnapshotCountsForTests, resetServerMeterForTests } from "@/lib/server/read-meter";
import { csUserToMember } from "@/data/cs/users";
import { ftcUserToMember } from "@/data/ftc/users";
import { CHUNK_TARGET_BYTES } from "@/lib/snapshot/model";

const ON = { snapshotRoutesEnabled: true, snapshotRoster: true, snapshotLibrary: true };
const settings = (extra: Record<string, unknown> = {}) => {
  h.docs.set("appSettings/global", { ...ON, ...extra });
  invalidateAppSettingsCache();
  resetMembershipsEnabledCache();
};
const ts = (ms: number) => ({ toMillis: () => ms });

let T0 = 1_800_000_000_000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a response body is read freely by the assertions
type Out = { status: number; body: Record<string, any>; headers: Headers };
async function call(dataset: string, uid: string | null, query: string = "program=frc", at: number = T0): Promise<Out> {
  const res = await handleSnapshot(new Request(`http://x/api/snapshot/${dataset}?${query}`, { headers: uid ? { authorization: `Bearer ${uid}` } : {} }), dataset, at);
  return { status: res.status, body: await res.json(), headers: res.headers };
}
const usersRead = (path = "users") => h.state.reads[path] ?? 0;

function seedTeams() {
  h.docs.set("users/a1", { teamId: "TA", displayName: "Ana A", email: "ana@example.org", role: "match-scout", createdAt: ts(1_700_000_000_000) });
  h.docs.set("users/a2", { teamId: "TA", displayName: "Al A", email: "al@example.org", role: "lead-scout", isTeamAdmin: true });
  h.docs.set("users/b1", { teamId: "TB", displayName: "Bo B", email: "bo@example.org", role: "match-scout" });
  h.docs.set("users/nobody", { displayName: "No Team", email: "nt@example.org" });
}

beforeEach(() => {
  h.docs.clear();
  h.state.reads = {};
  h.state.failBuild = null;
  h.state.buildQueries = 0;
  resetFakeNextCache();
  resetSnapshotCacheForTests();
  resetSnapshotRateForTests();
  resetServerMeterForTests();
  T0 += 10_000_000; // a new window per test so nothing leaks through time
  settings();
  seedTeams();
});

describe("authorization", () => {
  it("no token: 401, and nothing is read", async () => {
    const r = await call("roster", null);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("not_signed_in");
    expect(Object.keys(h.state.reads)).toEqual([]);
  });
  it("a bad token: 401", async () => {
    expect((await call("roster", "bad")).status).toBe(401);
  });
  it("an unknown dataset is 404, an unbuilt one (entries) is 404 `snapshot_not_available` even with its flags on", async () => {
    expect((await call("nope", "a1")).status).toBe(404);
    settings({ snapshotEntries: true });
    const r = await call("entries", "a1");
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("snapshot_not_available");
  });
  it("the program is required and must be a program", async () => {
    expect((await call("roster", "a1", "chunk=0")).body.code).toBe("program_required");
    expect((await call("roster", "a1", "program=zzz")).body.code).toBe("unknown_program");
    expect((await call("roster", "a1", "program=frc&chunk=-1")).body.code).toBe("bad_chunk");
    expect((await call("roster", "a1", "program=frc&chunk=abc")).body.code).toBe("bad_chunk");
    expect((await call("roster", "a1", "program=frc&chunk=5")).body.code).toBe("bad_chunk");
  });
  it("a person with no team gets 403 `no_team` for the roster", async () => {
    const r = await call("roster", "nobody");
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("no_team");
  });
  it("a person with no user document at all gets 403 too", async () => {
    expect((await call("roster", "ghost")).status).toBe(403);
  });
  it("the client cannot ask for another team: a teamId in the query is ignored, the caller's own team is served", async () => {
    const r = await call("roster", "a1", "program=frc&teamId=TB&team=TB");
    expect(r.status).toBe(200);
    expect(r.body.teamId).toBe("TA");
    expect(r.body.rows.map((m: { uid: string }) => m.uid).sort()).toEqual(["a1", "a2"]);
  });
  it("a caller hammering the route is limited (per instance)", async () => {
    let last = 200;
    for (let i = 0; i < 100; i += 1) last = (await call("roster", "a1")).status;
    expect(last).toBe(429);
  });
});

describe("the flags: the master switch AND the dataset's own", () => {
  it.each([
    [{ snapshotRoutesEnabled: false, snapshotRoster: true }, "roster", 404],
    [{ snapshotRoutesEnabled: true, snapshotRoster: false }, "roster", 404],
    [{ snapshotRoutesEnabled: true }, "roster", 404],
    [{ snapshotRoutesEnabled: true, snapshotRoster: true, snapshotLibrary: false }, "library", 404],
    [{ snapshotRoutesEnabled: true, snapshotRoster: true, snapshotLibrary: true }, "library", 200],
    [{ snapshotRoutesEnabled: true, snapshotRoster: true }, "roster", 200],
  ])("%j for %s answers %i", async (flags, dataset, status) => {
    h.docs.set("appSettings/global", flags);
    invalidateAppSettingsCache();
    const r = await call(dataset, "a1");
    expect(r.status).toBe(status);
    if (status === 404) expect(r.body.code).toBe("snapshot_disabled");
  });
  it("no settings document at all is OFF", async () => {
    h.docs.delete("appSettings/global");
    invalidateAppSettingsCache();
    expect((await call("roster", "a1")).status).toBe(404);
  });
});

describe("the active team is read fresh on EVERY request and never cached", () => {
  it("each request reads the caller's user document once, hit or miss", async () => {
    await call("roster", "a1");
    await call("roster", "a1");
    await call("roster", "a1");
    expect(usersRead()).toBeGreaterThanOrEqual(3);
    // the user document itself: three requests, three reads of users/a1 (the roster rebuild reads users by query only once)
    const before = usersRead();
    await call("roster", "a1");
    expect(usersRead()).toBe(before + 1);
  });

  it("right after a team switch the next request serves the NEW team's roster and none of the old team's", async () => {
    const first = await call("roster", "a1");
    expect(first.body.teamId).toBe("TA");
    h.docs.set("users/a1", { ...h.docs.get("users/a1"), teamId: "TB" });
    const second = await call("roster", "a1");
    expect(second.body.teamId).toBe("TB");
    expect(second.body.rows.map((m: { uid: string }) => m.uid).sort()).toEqual(["a1", "b1"]);
    expect(JSON.stringify(second.body)).not.toContain("a2");
    expect(JSON.stringify(second.body)).not.toContain("al@example.org");
  });
});

describe("no cross-team leakage", () => {
  it("team A is never served team B's members, and the cache entries are separate per team", async () => {
    const a = await call("roster", "a1");
    const b = await call("roster", "b1");
    expect(a.body.rows.map((m: { uid: string }) => m.uid).sort()).toEqual(["a1", "a2"]);
    expect(b.body.rows.map((m: { uid: string }) => m.uid)).toEqual(["b1"]);
    expect(JSON.stringify(a.body)).not.toContain("bo@example.org");
    expect(JSON.stringify(b.body)).not.toContain("ana@example.org");
    // team B's request after team A's is a MISS of its own, not a hit on A's copy
    expect(b.headers.get("x-snapshot-cache")).toBe("MISS");
    const again = await call("roster", "a2");
    expect(again.headers.get("x-snapshot-cache")).toBe("HIT");
    expect(again.body.teamId).toBe("TA");
  });

  describe("memberships switch OFF and ON", () => {
    const seedMemberships = () => {
      h.docs.set("memberships/a3_TA", { uid: "a3", teamId: "TA", name: "Past-Active A3", status: "active", origin: "verified", role: "pit-scout", joinedAt: 5 });
      h.docs.set("memberships/a4_TA", { uid: "a4", teamId: "TA", name: "Left A4", status: "past", origin: "verified", joinedAt: 5 });
      h.docs.set("memberships/b9_TB", { uid: "b9", teamId: "TB", name: "Other Team B9", status: "active", origin: "verified", joinedAt: 5 });
      h.docs.set("users/a3", { teamId: "TC", displayName: "A3 on another active team" });
    };
    it("OFF: exactly the users query, no membership rows even if they exist", async () => {
      seedMemberships();
      const r = await call("roster", "a1");
      expect(r.body.rows.map((m: { uid: string }) => m.uid).sort()).toEqual(["a1", "a2"]);
      expect(h.state.reads["memberships"] ?? 0).toBe(0);
    });
    it("ON: the team's ACTIVE memberships are merged in (never a past one, never another team's)", async () => {
      settings({ membershipsEnabled: true });
      seedMemberships();
      const r = await call("roster", "a1");
      const uids = r.body.rows.map((m: { uid: string }) => m.uid);
      expect(uids).toEqual(["a1", "a2", "a3"]); // users first, then memberships a person's user document does not already give
      expect(uids).not.toContain("a4");
      expect(uids).not.toContain("b9");
      const a3 = r.body.rows.find((m: { uid: string }) => m.uid === "a3");
      expect(a3).toMatchObject({ name: "Past-Active A3", email: "" });
      // and team B's view stays clean
      const b = await call("roster", "b1");
      expect(b.body.rows.map((m: { uid: string }) => m.uid).sort()).toEqual(["b1", "b9"]);
    });
  });

  it("the library of a program with team-owned matches never carries another team's hand-made matches", async () => {
    h.docs.set("programs/ftc/users/f1", { teamId: "FA", displayName: "Fi" });
    h.docs.set("programs/ftc/libraryMatches/api1", { published: true, origin: "api", eventCode: "E1", seasonId: "s" });
    h.docs.set("programs/ftc/libraryMatches/mineA", { published: true, origin: "manual", teamId: "FA", eventCode: "E2", seasonId: "s" });
    h.docs.set("programs/ftc/libraryMatches/mineB", { published: true, origin: "manual", teamId: "FB", eventCode: "E3", seasonId: "s" });
    h.docs.set("programs/ftc/libraryMatches/draftA", { published: false, origin: "manual", teamId: "FA", eventCode: "E2", seasonId: "s" });
    h.docs.set("programs/ftc/libraryMatches/draftApi", { published: false, origin: "api", eventCode: "E1", seasonId: "s" });
    // two parts (the shared official matches, then this team's own): chunk 0 is the first part, chunk 1 the second
    const r = await call("library", "f1", "program=ftc&chunk=0");
    const own = await call("library", "f1", "program=ftc&chunk=1");
    expect(r.status).toBe(200);
    expect(r.body.teamId).toBe("FA");
    expect(r.body.chunks).toBe(2);
    expect([...r.body.rows, ...own.body.rows].map((d: { id: string }) => d.id).sort()).toEqual(["api1", "mineA"]);
  });
});

describe("the library is one shared copy per program", () => {
  beforeEach(() => {
    for (let i = 0; i < 6; i += 1) h.docs.set(`libraryMatches/m${i}`, { published: i !== 5, eventCode: "2026arli", seasonId: "rebuilt", matchType: "qualification", matchNumber: i, createdAt: ts(1_700_000_000_000 + i) });
  });
  it("two teams share one build: the second team's request is a HIT, and it reads no library documents; only published matches are in it", async () => {
    const a = await call("library", "a1");
    expect(a.headers.get("x-snapshot-cache")).toBe("MISS");
    expect(a.body.rows.map((d: { id: string }) => d.id)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(a.body.teamId).toBeNull();
    const readsAfterBuild = h.state.reads["libraryMatches"];
    const b = await call("library", "b1");
    expect(b.headers.get("x-snapshot-cache")).toBe("HIT");
    expect(h.state.reads["libraryMatches"]).toBe(readsAfterBuild);
    expect(b.body.rows).toEqual(a.body.rows);
  });
  it("a person with no team can still be served the shared library", async () => {
    const r = await call("library", "nobody");
    expect(r.status).toBe(200);
    expect(r.body.rows).toHaveLength(5);
  });
});

describe("TTL and manual freshness", () => {
  it("MISS, then HITs that read no roster documents, then a REBUILD once the TTL has passed", async () => {
    const first = await call("roster", "a1", "program=frc", T0);
    expect(first.headers.get("x-snapshot-cache")).toBe("MISS");
    const built = Number(first.headers.get("x-snapshot-built-at"));
    expect(built).toBe(T0);
    const usersAfterFirst = usersRead();
    const second = await call("roster", "a1", "program=frc", T0 + 100_000);
    expect(second.headers.get("x-snapshot-cache")).toBe("HIT");
    expect(second.headers.get("x-snapshot-built-at")).toBe(String(built));
    // the only new read is the caller's own user document (the pointer): the roster query did not run
    expect(usersRead()).toBe(usersAfterFirst + 1);
    const third = await call("roster", "a1", "program=frc", T0 + 120_001);
    expect(third.headers.get("x-snapshot-cache")).toBe("REBUILD");
    expect(Number(third.headers.get("x-snapshot-built-at"))).toBe(T0 + 120_001);
  });

  it("the owner changes the TTL in appSettings/global (no deploy): 600 s keeps a 5-minute-old copy fresh, 30 s does not", async () => {
    settings({ snapshotTtl: { roster: 600 } });
    await call("roster", "a1", "program=frc", T0);
    const kept = await call("roster", "a1", "program=frc", T0 + 300_000);
    expect(kept.headers.get("x-snapshot-cache")).toBe("HIT");
    settings({ snapshotTtl: { roster: 30 } });
    const dropped = await call("roster", "a1", "program=frc", T0 + 300_001);
    expect(dropped.headers.get("x-snapshot-cache")).toBe("REBUILD");
  });

  it("a TTL below 30 s is lifted to 30 s, above 3,600 s lowered to 3,600 s", async () => {
    settings({ snapshotTtl: { roster: 1 } });
    await call("roster", "a1", "program=frc", T0);
    expect((await call("roster", "a1", "program=frc", T0 + 29_000)).headers.get("x-snapshot-cache")).toBe("HIT");
    settings({ snapshotTtl: { roster: 999_999 } });
    expect((await call("roster", "a1", "program=frc", T0 + 3_599_000)).headers.get("x-snapshot-cache")).toBe("HIT");
    expect((await call("roster", "a1", "program=frc", T0 + 3_601_000)).headers.get("x-snapshot-cache")).toBe("REBUILD");
  });

  it("a rebuild shows a roster change made after the first build (and a HIT before it does not)", async () => {
    await call("roster", "a1", "program=frc", T0);
    h.docs.set("users/a9", { teamId: "TA", displayName: "New Nia", role: "match-scout" });
    const hit = await call("roster", "a1", "program=frc", T0 + 60_000);
    expect(hit.body.rows.map((m: { uid: string }) => m.uid)).not.toContain("a9");
    const rebuilt = await call("roster", "a1", "program=frc", T0 + 130_000);
    expect(rebuilt.body.rows.map((m: { uid: string }) => m.uid)).toContain("a9");
  });
});

describe("Refresh: at most one rebuild per 2 minutes per team and dataset", () => {
  it("inside the throttle: THROTTLED, the current data, and the remaining wait", async () => {
    await call("roster", "a1", "program=frc", T0);
    h.docs.set("users/a9", { teamId: "TA", displayName: "New Nia", role: "match-scout" });
    const r = await call("roster", "a1", "program=frc&refresh=1", T0 + 30_000);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-snapshot-cache")).toBe("THROTTLED");
    expect(r.body.refreshWaitMs).toBe(90_000);
    expect(r.body.rows.map((m: { uid: string }) => m.uid)).not.toContain("a9");
  });
  it("after 2 minutes it rebuilds on demand even when the TTL says fresh", async () => {
    settings({ snapshotTtl: { roster: 3600 } });
    await call("roster", "a1", "program=frc", T0);
    h.docs.set("users/a9", { teamId: "TA", displayName: "New Nia", role: "match-scout" });
    const r = await call("roster", "a1", "program=frc&refresh=1", T0 + 120_000);
    expect(r.headers.get("x-snapshot-cache")).toBe("REBUILD");
    expect(r.body.refreshWaitMs).toBeNull();
    expect(r.body.rows.map((m: { uid: string }) => m.uid)).toContain("a9");
    const again = await call("roster", "a1", "program=frc&refresh=1", T0 + 121_000);
    expect(again.headers.get("x-snapshot-cache")).toBe("THROTTLED");
    expect(again.body.refreshWaitMs).toBe(119_000);
  });
  it("a TTL that has already expired wins over the throttle (a 30 s TTL is stale at 40 s though a Refresh is still throttled)", async () => {
    settings({ snapshotTtl: { roster: 30 } });
    await call("roster", "a1", "program=frc", T0);
    const r = await call("roster", "a1", "program=frc&refresh=1", T0 + 40_000);
    expect(r.headers.get("x-snapshot-cache")).toBe("REBUILD");
  });
  it("many teams pressing Refresh together cause one rebuild each, and one team's Refresh does not rebuild another's", async () => {
    await call("roster", "a1", "program=frc", T0);
    await call("roster", "b1", "program=frc", T0);
    const before = h.state.buildQueries;
    const results = await Promise.all([call("roster", "a1", "program=frc&refresh=1", T0 + 5_000), call("roster", "a2", "program=frc&refresh=1", T0 + 5_000)]);
    expect(results.every((r) => r.headers.get("x-snapshot-cache") === "THROTTLED")).toBe(true);
    expect(h.state.buildQueries).toBe(before);
  });
});

describe("the cache is shared across server instances", () => {
  it("a second instance (no memory of the first) serves the same copy as a HIT, reading the chunk from the shared cache", async () => {
    const first = await call("roster", "a1", "program=frc", T0);
    expect(first.headers.get("x-snapshot-cache")).toBe("MISS");
    resetSnapshotCacheForTests(); // another instance: its memory is empty, the persisted cache is not
    const queriesBefore = h.state.buildQueries;
    const second = await call("roster", "a2", "program=frc", T0 + 1_000);
    expect(second.headers.get("x-snapshot-cache")).toBe("HIT");
    expect(second.body.rows).toEqual(first.body.rows);
    expect(h.state.buildQueries).toBe(queriesBefore);
  });
  it("a chunk that left the shared cache (and is not held by this instance) is rebuilt once, not an error", async () => {
    await call("roster", "a1", "program=frc", T0);
    resetSnapshotCacheForTests();
    resetFakeNextCache(); // everything gone, including the manifest
    const r = await call("roster", "a1", "program=frc", T0 + 1_000);
    expect(r.status).toBe(200);
    expect(r.body.rows).toHaveLength(2);
  });
});

describe("failures", () => {
  it("the daily quota while building answers 503 `quota_exceeded` and caches nothing", async () => {
    h.state.failBuild = Object.assign(new Error("8 RESOURCE_EXHAUSTED: Quota exceeded."), { code: 8 });
    const r = await call("library", "a1");
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("quota_exceeded");
    expect(cacheEntries()).toHaveLength(0);
  });
  it("a rebuild that fails serves the last copy this instance has, marked stale", async () => {
    h.docs.set("libraryMatches/m1", { published: true, eventCode: "e", seasonId: "s", matchType: "qualification", matchNumber: 1 });
    const ok = await call("library", "a1", "program=frc", T0);
    expect(ok.status).toBe(200);
    h.state.failBuild = new Error("boom");
    const stale = await call("library", "a1", "program=frc", T0 + 2_000_000);
    expect(stale.status).toBe(200);
    expect(stale.body.stale).toBe(true);
    expect(stale.headers.get("x-snapshot-stale")).toBe("1");
    expect(stale.body.rows).toEqual(ok.body.rows);
    // and it does not hammer Firestore: the next request inside the backoff does not try again
    const queries = h.state.buildQueries;
    await call("library", "a1", "program=frc", T0 + 2_005_000);
    expect(h.state.buildQueries).toBe(queries);
  });
  it("no stale copy to serve: the failure is reported (500), never an empty success", async () => {
    h.state.failBuild = new Error("boom");
    const r = await call("library", "a1");
    expect(r.status).toBe(500);
  });
});

describe("chunking through the route at 5,000 rows", () => {
  it("5,000 library documents of 4 KB come back as chunks under the target, every cache entry under 2 MB, the rows in order and complete", async () => {
    const pad = "p".repeat(4000);
    for (let i = 0; i < 5_000; i += 1) h.docs.set(`libraryMatches/m${String(i).padStart(5, "0")}`, { published: true, seasonId: "s", eventCode: "e", matchType: "qualification", matchNumber: i, notes: pad });
    const first = await call("library", "a1", "program=frc&chunk=0", T0);
    expect(first.status).toBe(200);
    const chunks = first.body.chunks as number;
    expect(chunks).toBeGreaterThanOrEqual(17);
    expect(first.headers.get("x-snapshot-chunks")).toBe(String(chunks));
    expect(first.headers.get("x-snapshot-oversize")).toBeNull();
    const all: string[] = first.body.rows.map((d: { id: string }) => d.id);
    for (let c = 1; c < chunks; c += 1) {
      const r = await call("library", "a1", `program=frc&chunk=${c}`, T0 + c);
      expect(r.headers.get("x-snapshot-cache")).toBe("HIT");
      expect(r.body.buildId).toBe(first.body.buildId);
      all.push(...r.body.rows.map((d: { id: string }) => d.id));
    }
    expect(all).toHaveLength(5_000);
    expect(all).toEqual([...all].sort());
    expect(new Set(all).size).toBe(5_000);
    for (const e of cacheEntries()) expect(e.bytes).toBeLessThan(2 * 1024 * 1024);
    const biggest = Math.max(...cacheEntries().filter((e) => e.key.includes("chunk")).map((e) => e.bytes));
    expect(biggest).toBeLessThanOrEqual(CHUNK_TARGET_BYTES + 4096);
    expect((await call("library", "a1", `program=frc&chunk=${chunks}`, T0 + 99)).body.code).toBe("bad_chunk");
  }, 60_000);

  it("a chunk that WOULD exceed the cache cap is not left to fail silently: it is reported in the header and the meter, served, and held in this instance's memory", async () => {
    settings({ readMeterEnabled: true });
    await call("library", "a1", "program=frc", T0); // learns the meter is ON (the shared settings snapshot)
    resetServerMeterForTests();
    resetSnapshotCacheForTests();
    resetFakeNextCache();
    h.docs.set("libraryMatches/huge", { published: true, seasonId: "s", eventCode: "e", matchType: "qualification", matchNumber: 1, blob: "z".repeat(2_200_000) });
    const r = await call("library", "a1", "program=frc", T0 + 2_000_000);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-snapshot-oversize")).toBe("1");
    expect(r.body.rows.find((d: { id: string }) => d.id === "huge")).toBeTruthy();
    expect(pendingSnapshotCountsForTests().library?.oversize).toBe(1);
    expect(cacheEntries().filter((e) => e.key.includes("chunk"))).toHaveLength(0); // nothing over the cap was offered to the cache
    // a second request on the same instance is served from memory without reading Firestore again
    const queries = h.state.buildQueries;
    const again = await call("library", "a1", "program=frc", T0 + 2_001_000);
    expect(again.status).toBe(200);
    expect(h.state.buildQueries).toBe(queries);
  }, 60_000);
});

describe("round trip: timestamps and fields survive the JSON, identical to the direct mapping", () => {
  it("roster members equal what the browser's own mapper produces from the same documents (root program)", async () => {
    const r = await call("roster", "a1");
    const direct = ["a1", "a2"].map((uid) => csUserToMember(uid, h.docs.get(`users/${uid}`) as never));
    expect(r.body.rows).toEqual(JSON.parse(JSON.stringify(direct)));
    expect(r.body.rows[0].joinedAtMs).toBe(1_700_000_000_000);
    expect(r.body.rows[0].email).toBe("ana@example.org");
  });
  it("roster members of the other program use that program's own mapper", async () => {
    h.docs.set("programs/ftc/users/f1", { teamId: "FA", displayName: "Fi F", email: "fi@example.org", primaryRole: "lead-scout", createdAt: ts(1_650_000_000_000) });
    h.docs.set("programs/ftc/users/f2", { teamId: "FA", displayName: "Fo F", email: "fo@example.org", primaryRole: "match-scout" });
    h.docs.set("programs/ftc/users/g1", { teamId: "FB", displayName: "Gus G" });
    const r = await call("roster", "f1", "program=ftc");
    const direct = ["f1", "f2"].map((uid) => ftcUserToMember(uid, h.docs.get(`programs/ftc/users/${uid}`) as never));
    expect(r.body.rows).toEqual(JSON.parse(JSON.stringify(direct)));
    expect(r.body.teamId).toBe("FA");
  });
  it("library documents keep every field; a Timestamp becomes the same milliseconds `toEpochMs` already reads", async () => {
    h.docs.set("libraryMatches/m1", { published: true, eventCode: "e", seasonId: "s", matchType: "qualification", matchNumber: 7, red: [254, 971, 118], video: { youtubeUrl: "u", startSec: 3 }, scoreKnown: false, note: null, createdAt: ts(1_711_111_111_111) });
    const r = await call("library", "a1");
    expect(r.body.rows).toEqual([{ id: "m1", data: { published: true, eventCode: "e", seasonId: "s", matchType: "qualification", matchNumber: 7, red: [254, 971, 118], video: { youtubeUrl: "u", startSec: 3 }, scoreKnown: false, note: null, createdAt: 1_711_111_111_111 } }]);
  });
});

describe("the meter: rebuilds count their documents, a hit reads none, and the route counters are kept", () => {
  it("requests, hits, misses, rebuilds, bytes and rows are counted under the dataset; documents under api/snapshot/<dataset>", async () => {
    settings({ readMeterEnabled: true });
    await call("roster", "a1", "program=frc", T0); // the first call loads the settings; counting starts with the next one
    resetServerMeterForTests();
    resetSnapshotCacheForTests();
    resetFakeNextCache();
    await call("roster", "a1", "program=frc", T0 + 1_000); // MISS
    await call("roster", "a1", "program=frc", T0 + 2_000); // HIT
    await call("roster", "a2", "program=frc", T0 + 3_000); // HIT
    await call("roster", "a1", "program=frc", T0 + 130_000); // REBUILD
    const c = pendingSnapshotCountsForTests().roster;
    expect(c).toMatchObject({ requests: 4, hits: 2, misses: 1, rebuilds: 1, rows: 8 });
    expect(c.bytes).toBeGreaterThan(400);
    const docs = pendingServerCountsForTests()["api~snapshot~roster"];
    // 4 pointer reads + 2 builds x 2 members
    expect(Object.values(docs ?? {}).reduce((a, b) => a + b, 0)).toBe(8);
    const throttled = await call("roster", "a1", "program=frc&refresh=1", T0 + 131_000);
    expect(throttled.headers.get("x-snapshot-cache")).toBe("THROTTLED");
    expect(pendingSnapshotCountsForTests().roster.throttled).toBe(1);
  });
  it("while the meter is OFF nothing is counted", async () => {
    await call("roster", "a1");
    expect(pendingSnapshotCountsForTests()).toEqual({});
  });
});

describe("responses are private and never stored by a shared HTTP cache", () => {
  it("success and failure both say private, no-store", async () => {
    expect((await call("roster", "a1")).headers.get("cache-control")).toBe("private, no-store");
    expect((await call("roster", null)).headers.get("cache-control")).toBe("private, no-store");
    expect(cacheCalls.misses).toBeGreaterThan(0);
  });
});

// THE QUERY-COUNT HARNESS, SNAPSHOT PATH (read reduction 2a). The same synthetic team as lib/read-counts.test.ts (20 members, 500 library matches), and the competition-hour
// question: 18 devices open the roster and the library inside one cache window. Direct, every device bills the roster (20, one listener per call site before 2a) and the
// library (500) itself; through the snapshot the team's documents are read ONCE per window however many devices ask, plus the one user-document read each request makes.
describe("harness: 18 devices open the roster and the library inside one window", () => {
  it("Firestore documents read on the server, in total", async () => {
    for (let i = 0; i < 20; i += 1) h.docs.set(`users/m${i}`, { teamId: "TH", displayName: `Member ${i}`, role: "match-scout" });
    for (let i = 0; i < 500; i += 1) h.docs.set(`libraryMatches/m${i}`, { published: true, eventCode: `2026ev${i % 20}`, seasonId: "rebuilt", matchType: "qualification", matchNumber: i });
    h.state.reads = {};
    for (let device = 0; device < 18; device += 1) {
      const uid = `m${device}`;
      const roster = await call("roster", uid, "program=frc", T0 + device * 1000);
      const library = await call("library", uid, "program=frc", T0 + device * 1000);
      expect(roster.body.rows).toHaveLength(20);
      expect(library.body.rows).toHaveLength(500);
    }
    // users: 20 for the one roster build + 18 devices x 2 requests' pointer reads; libraryMatches: 500 once
    expect(h.state.reads["users"]).toBe(20 + 18 * 2);
    expect(h.state.reads["libraryMatches"]).toBe(500);
    const total = (h.state.reads["users"] ?? 0) + (h.state.reads["libraryMatches"] ?? 0);
    console.info(`[read-counts] snapshot path, 18 devices, roster + library: ${total} server reads (direct: 18 x (20 + 500) = ${18 * 520}; direct before 2a with three roster call sites: ${18 * (60 + 500)})`);
    expect(total).toBe(556);
  }, 60_000);
});
