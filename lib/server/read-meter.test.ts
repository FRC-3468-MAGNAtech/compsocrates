import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake Admin SDK: documents by path, with counters for gets and sets. Reads that return documents expose `ref.parent.path` like the real snapshots.
const h = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const state = { gets: 0, sets: [] as { path: string; data: Record<string, unknown> }[], token: { uid: "u1", platformOwner: false } as Record<string, unknown> | null };
  const snapOf = (path: string) => ({ id: path.split("/").pop(), exists: docs.has(path), data: () => docs.get(path), ref: { parent: { path: path.split("/").slice(0, -1).join("/") } }, get: () => undefined });
  const docRef = (path: string): Record<string, unknown> => ({
    firestore: {},
    _path: path,
    get: async () => ((state.gets += 1), snapOf(path)),
    set: async (data: Record<string, unknown>) => void state.sets.push({ path, data }),
  });
  const query = (collectionPath: string): Record<string, unknown> => ({
    firestore: {},
    where: () => query(collectionPath),
    get: async () => {
      const rows = [...docs.keys()].filter((p) => p.startsWith(collectionPath + "/") && p.split("/").length === collectionPath.split("/").length + 1);
      state.gets += rows.length;
      return { docs: rows.map(snapOf), size: rows.length };
    },
  });
  const db = {
    firestore: {},
    doc: (path: string) => docRef(path),
    collection: (path: string) => ({ ...query(path), doc: (id: string) => docRef(path + "/" + id) }),
    getAll: async (...refs: { _path: string }[]) => refs.map((r) => ((state.gets += 1), snapOf(r._path))),
    runTransaction: async (fn: (tx: unknown) => unknown) => fn({ get: async (ref: { _path: string }) => ((state.gets += 1), snapOf(ref._path)) }),
  };
  return { docs, state, db };
});

vi.mock("@/lib/firebase/admin", () => ({ getAdminFirestore: () => h.db }));
vi.mock("@/lib/server/owner-admin", () => ({ isPlatformOwnerToken: (d: { platformOwner?: unknown }) => d.platformOwner === true }));
vi.mock("@/lib/server/require-user", () => ({ verifyBearerToken: async () => h.state.token, serverSignInProblem: () => null }));

import { applyClientFlush, flushServerMeter, meterDb, pendingServerCountsForTests, readUsageDays, resetServerMeterForTests } from "@/lib/server/read-meter";
import { invalidateAppSettingsCache, isReadMeterOnSync, readAppSettings } from "@/lib/server/team-settings";
import { pacificDayKey } from "@/lib/read-meter/model";

const operand = (v: unknown) => (v as { operand?: number }).operand;
const rawDb = h.db as never;

beforeEach(() => {
  h.docs.clear();
  h.state.gets = 0;
  h.state.sets.length = 0;
  h.state.token = { uid: "u1", platformOwner: false };
  resetServerMeterForTests();
  invalidateAppSettingsCache();
});

async function setMeter(on: boolean | undefined) {
  h.docs.set("appSettings/global", on === undefined ? {} : { readMeterEnabled: on });
  invalidateAppSettingsCache();
  await readAppSettings(rawDb); // what any route that reads the shared snapshot does
}

describe("meterDb", () => {
  it("OFF (missing or false): hands back the very same database and counts nothing", async () => {
    await setMeter(undefined);
    expect(isReadMeterOnSync()).toBe(false);
    expect(meterDb(rawDb, "api/x")).toBe(rawDb);
    await setMeter(false);
    expect(meterDb(rawDb, "api/x")).toBe(rawDb);
    expect(pendingServerCountsForTests()).toEqual({});
  });

  it("ON: counts documents by route and collection for get, query, getAll and transaction reads, without changing the answers", async () => {
    h.docs.set("platformChangelog/a", {});
    h.docs.set("platformChangelog/b", {});
    h.docs.set("users/u1", {});
    await setMeter(true);
    await flushServerMeter(rawDb); // the first counted read of an instance triggers a flush; take it out of the way so the counts below stay put
    const db = meterDb(rawDb, "api/platform/changelog") as unknown as {
      collection: (p: string) => { get: () => Promise<{ docs: unknown[] }>; where: () => { get: () => Promise<{ docs: unknown[] }> } };
      doc: (p: string) => { get: () => Promise<{ exists: boolean }> };
      getAll: (...r: unknown[]) => Promise<unknown[]>;
      runTransaction: (fn: (tx: { get: (r: unknown) => Promise<{ exists: boolean }> }) => Promise<unknown>) => Promise<unknown>;
    };
    expect((await db.collection("platformChangelog").get()).docs).toHaveLength(2);
    expect((await db.collection("platformChangelog").where().get()).docs).toHaveLength(2);
    expect((await db.doc("users/u1").get()).exists).toBe(true);
    expect(await db.getAll(db.doc("users/u1"), db.doc("users/zz"))).toHaveLength(2);
    await db.runTransaction((tx) => tx.get(db.doc("users/u1")));
    await Promise.resolve();
    expect(pendingServerCountsForTests()).toEqual({ "api~platform~changelog": { platformChangelog: 4, users: 4 } });
  });
});

describe("the daily document", () => {
  it("a client flush is ONE write to readMeter/{Pacific day}, as increments", async () => {
    const at = new Date("2026-03-10T07:30:00Z"); // 12:30 AM Pacific on the 10th
    await applyClientFlush(rawDb, { dashboard: { scouting: 40, users: 2 } }, at);
    expect(h.state.sets).toHaveLength(1);
    const { path, data } = h.state.sets[0];
    expect(path).toBe(`readMeter/${pacificDayKey(at)}`);
    expect(path).toBe("readMeter/2026-03-10");
    expect(operand(data.total)).toBe(42);
    expect(operand((data.client as { total: unknown }).total)).toBe(42);
    expect(operand((data.client as { pages: Record<string, Record<string, unknown>> }).pages.dashboard.scouting)).toBe(40);
  });

  it("an empty flush writes nothing; a server flush writes once and clears its counts", async () => {
    await applyClientFlush(rawDb, {});
    expect(h.state.sets).toHaveLength(0);
    h.docs.set("users/u1", {});
    await setMeter(true);
    const db = meterDb(rawDb, "api/admin/teams") as unknown as { doc: (p: string) => { get: () => Promise<unknown> } };
    await db.doc("users/u1").get();
    await flushServerMeter(rawDb);
    await flushServerMeter(rawDb);
    expect(h.state.sets.filter((s) => s.path.startsWith("readMeter/"))).toHaveLength(1);
    expect(pendingServerCountsForTests()).toEqual({});
  });

  it("reading the usage is one getAll of at most 15 days", async () => {
    h.docs.set("readMeter/2026-03-10", { total: 5 });
    h.state.gets = 0;
    const days = await readUsageDays(rawDb, new Date("2026-03-10T20:00:00Z"));
    expect(days).toHaveLength(15);
    expect(days[0]).toEqual({ day: "2026-03-10", data: { total: 5 } });
    expect(h.state.gets).toBe(15);
  });
});

describe("the flush route", () => {
  const post = async (body: unknown) => {
    const { POST } = await import("@/app/api/read-meter/route");
    return POST(new Request("http://x/api/read-meter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  };

  it("OFF: answers ignored and writes NOTHING", async () => {
    await setMeter(undefined);
    const res = await post({ counts: { dashboard: { scouting: 5 } } });
    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect(h.state.sets).toHaveLength(0);
  });

  it("ON: one write; bad bodies are refused", async () => {
    await setMeter(true);
    const bad = await post({ counts: { p: { c: -3 } } });
    expect(bad.status).toBe(400);
    const res = await post({ counts: { dashboard: { scouting: 5 } } });
    expect(res.status).toBe(200);
    expect(h.state.sets.filter((s) => s.path.startsWith("readMeter/"))).toHaveLength(1);
  });

  it("not signed in: 401", async () => {
    h.state.token = null;
    expect((await post({ counts: {} })).status).toBe(401);
  });
});

describe("the owner's usage route", () => {
  it("is for the platform owner only (checked on the server), and reads 15 days", async () => {
    const { GET } = await import("@/app/api/platform/read-meter/route");
    h.state.token = { uid: "u1", platformOwner: false };
    expect((await GET(new Request("http://x/api/platform/read-meter"))).status).toBe(403);
    h.state.token = { uid: "o1", platformOwner: true };
    await setMeter(true);
    h.state.gets = 0;
    const res = await GET(new Request("http://x/api/platform/read-meter"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; days: unknown[] };
    expect(body.enabled).toBe(true);
    expect(body.days).toHaveLength(15);
    expect(h.state.gets).toBeLessThanOrEqual(16); // 15 days, plus the shared settings snapshot when it is not cached
  });
});

describe("the shared settings snapshot", () => {
  it("serves every flag from one read", async () => {
    h.docs.set("appSettings/global", { membershipsEnabled: true, accountDeletionEnabled: true, readMeterEnabled: true, teamCreationEnabled: true });
    const { getPublicSettings, getMembershipsEnabled, getAccountDeletionEnabled, getReadMeterEnabled } = await import("@/lib/server/team-settings");
    invalidateAppSettingsCache();
    h.state.gets = 0;
    expect(await getPublicSettings(rawDb)).toMatchObject({ membershipsEnabled: true, accountDeletionEnabled: true, readMeterEnabled: true, teamCreationEnabled: true, adminsSeeAllProfiles: true, avatarUploadsEnabled: false });
    await getMembershipsEnabled(rawDb);
    await getAccountDeletionEnabled(rawDb);
    await getReadMeterEnabled(rawDb);
    expect(h.state.gets).toBe(1);
  });
});
