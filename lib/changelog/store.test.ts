import { beforeEach, describe, expect, it, vi } from "vitest";

// The changelog store against a mocked Firestore: which PATHS each program reads and writes. No emulator and no network (the emulator tests pin the rules).
type Ref = { path: string };
const h = vi.hoisted(() => {
  const sets: { path: string; data: Record<string, unknown> }[] = [];
  const updates: { path: string; data: Record<string, unknown> }[] = [];
  const state = { seeded: false, exists: true };
  let auto = 0;
  return {
    sets,
    updates,
    state,
    where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
    query: vi.fn((base: { path: string }, ...clauses: unknown[]) => ({ base: base.path, clauses })),
    collection: vi.fn((_db: unknown, path: string) => ({ path })),
    doc: vi.fn((a: unknown, ...segs: string[]) => {
      if (a && typeof a === "object" && "path" in a && segs.length === 0) return { path: `${(a as { path: string }).path}/auto${++auto}` };
      return { path: (a && typeof a === "object" && "path" in a ? [(a as { path: string }).path, ...segs] : segs).join("/") };
    }),
    updateDoc: vi.fn(),
    serverTimestamp: vi.fn(() => "SERVER_TIME"),
    runTransaction: vi.fn(async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: async () => ({ exists: () => state.exists, id: "x", data: () => ({ changelogSeeded: state.seeded }) }),
        set: (ref: Ref, data: Record<string, unknown>) => sets.push({ path: ref.path, data }),
        update: (ref: Ref, data: Record<string, unknown>) => updates.push({ path: ref.path, data }),
        delete: () => {},
      })
    ),
  };
});
vi.mock("firebase/firestore", () => ({ where: h.where, query: h.query, collection: h.collection, doc: h.doc, updateDoc: h.updateDoc, serverTimestamp: h.serverTimestamp, runTransaction: h.runTransaction, onSnapshot: vi.fn() }));
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, isFirebaseConfigured: () => true }));
vi.mock("@/lib/program/context", () => ({ useProgram: () => "frc" }));

import { changelogQuery, markChangelogSeen, saveEntry, seedChangelogIfNeeded } from "@/lib/changelog/store";
import { STARTER_ENTRIES, starterDocId, starterEntriesFor } from "@/lib/changelog/seed";
import { FTC_STARTER_ENTRIES } from "@/lib/ftc/changelog-seed";
import type { ProgramData } from "@/lib/program/data";

const actor = { teamId: "T1", uid: "admin1", name: "Admin" };

beforeEach(() => {
  h.sets.length = 0;
  h.updates.length = 0;
  h.state.seeded = false;
  h.state.exists = true;
  h.updateDoc.mockReset();
  h.query.mockClear();
  h.where.mockClear();
});

describe("reads", () => {
  it("the default program reads the root `changelog`, exactly as before", () => {
    changelogQuery("frc", "T1", false);
    expect(h.query).toHaveBeenCalledWith({ path: "changelog" }, { field: "teamId", op: "==", value: "T1" }, { field: "status", op: "==", value: "published" });
    changelogQuery("frc", "T1", true);
    expect(h.query).toHaveBeenLastCalledWith({ path: "changelog" }, { field: "teamId", op: "==", value: "T1" });
  });
  it("the FTC program reads `programs/ftc/changelog` with equality-only clauses (teamId, and status for a member)", () => {
    changelogQuery("ftc", "T1", false);
    expect(h.query).toHaveBeenCalledWith({ path: "programs/ftc/changelog" }, { field: "teamId", op: "==", value: "T1" }, { field: "status", op: "==", value: "published" });
    for (const call of h.where.mock.calls) expect(call[1]).toBe("==");
  });
});

describe("writes", () => {
  const draft = { version: "v1", title: "T", date: "2026-11-15", summary: "", changes: [{ type: "new" as const, text: "x" }], status: "draft" as const, pinned: false };
  it("a new entry and its audit entry go under the program's own paths", async () => {
    await saveEntry(actor, null, draft, "ftc");
    expect(h.sets.map((s) => s.path.split("/auto")[0])).toEqual(["programs/ftc/changelog", "programs/ftc/auditLog"]);
    h.sets.length = 0;
    await saveEntry(actor, null, draft);
    expect(h.sets.map((s) => s.path.split("/auto")[0])).toEqual(["changelog", "auditLog"]);
  });
});

describe("seed", () => {
  it("FRC: seeds the default program's drafts into root changelog/ and marks root teams/{id}, as before", async () => {
    expect(await seedChangelogIfNeeded(actor)).toBe(true);
    const paths = h.sets.map((s) => s.path);
    expect(paths.filter((p) => p.startsWith("changelog/")).sort()).toEqual(STARTER_ENTRIES.map((e) => `changelog/${starterDocId("T1", e.key)}`).sort());
    expect(h.updates).toEqual([{ path: "teams/T1", data: { changelogSeeded: true } }]);
    expect(paths.some((p) => p.startsWith("programs/"))).toBe(false);
  });
  it("FTC: seeds ITS drafts into programs/ftc/changelog, marks programs/ftc/teams/{id}, and writes nothing at the root", async () => {
    expect(await seedChangelogIfNeeded(actor, "ftc")).toBe(true);
    const paths = h.sets.map((s) => s.path);
    expect(paths.filter((p) => p.startsWith("programs/ftc/changelog/")).sort()).toEqual(FTC_STARTER_ENTRIES.map((e) => `programs/ftc/changelog/${starterDocId("T1", e.key)}`).sort());
    expect(h.updates).toEqual([{ path: "programs/ftc/teams/T1", data: { changelogSeeded: true } }]);
    for (const p of [...paths, ...h.updates.map((u) => u.path)]) expect(p.startsWith("programs/ftc/")).toBe(true);
  });
  it("all seeded entries are drafts, so nobody gets an unread badge until an admin publishes", async () => {
    await seedChangelogIfNeeded(actor, "ftc");
    const entries = h.sets.filter((s) => s.path.includes("/changelog/"));
    expect(entries.length).toBe(FTC_STARTER_ENTRIES.length);
    for (const e of entries) expect(e.data).toMatchObject({ status: "draft", publishedAt: null, teamId: "T1" });
  });
  it("seeding twice never duplicates: the second run sees changelogSeeded and writes nothing; ids are stable", async () => {
    await seedChangelogIfNeeded(actor, "ftc");
    const firstIds = h.sets.map((s) => s.path).filter((p) => p.includes("/changelog/"));
    h.sets.length = 0;
    h.updates.length = 0;
    h.state.seeded = true;
    expect(await seedChangelogIfNeeded(actor, "ftc")).toBe(false);
    expect(h.sets).toEqual([]);
    expect(h.updates).toEqual([]);
    expect(new Set(firstIds).size).toBe(firstIds.length);
    // a team doc that lost the flag would rewrite the SAME ids, not new ones
    h.state.seeded = false;
    await seedChangelogIfNeeded(actor, "ftc");
    expect(h.sets.map((s) => s.path).filter((p) => p.includes("/changelog/"))).toEqual(firstIds);
  });
  it("does nothing for a team that does not exist", async () => {
    h.state.exists = false;
    expect(await seedChangelogIfNeeded(actor, "ftc")).toBe(false);
    expect(h.sets).toEqual([]);
  });
});

describe("seed text", () => {
  it("each program has its own list; neither carries the old app's `legacy` entries", () => {
    expect(starterEntriesFor("frc")).toBe(STARTER_ENTRIES);
    expect(starterEntriesFor("ftc")).toBe(FTC_STARTER_ENTRIES);
    for (const list of [STARTER_ENTRIES, FTC_STARTER_ENTRIES]) for (const e of list) expect("legacy" in e).toBe(false);
  });
  it("the FTC list is well formed: unique keys, real dates, within the rule limits, oldest first", () => {
    expect(new Set(FTC_STARTER_ENTRIES.map((e) => e.key)).size).toBe(FTC_STARTER_ENTRIES.length);
    for (const e of FTC_STARTER_ENTRIES) {
      expect(e.date).toMatch(/^2026-11-1[3-5]$/);
      expect(e.version.length).toBeLessThanOrEqual(40);
      expect(e.title.length).toBeLessThanOrEqual(120);
      expect(e.summary.length).toBeLessThanOrEqual(1000);
      expect(e.changes.length).toBeGreaterThanOrEqual(1);
      for (const c of e.changes) expect(c.text.length).toBeLessThanOrEqual(400);
    }
    const dates = FTC_STARTER_ENTRIES.map((e) => e.date);
    expect([...dates].sort()).toEqual(dates);
  });
  it("the FTC text never mentions the other program's pages, data sources or games", () => {
    const text = JSON.stringify(FTC_STARTER_ENTRIES);
    for (const word of ["FRC", "EPA", "Statbotics", "Blue Alliance", "TBA", "REBUILT", "REEFSCAPE", "CHARGED UP", "Live Practice", "Lobby", "Sub-in", "Announcements"]) expect(text).not.toContain(word);
  });
});

describe("mark seen", () => {
  it("FTC goes through the port's profile update and never writes the root users document", async () => {
    const updateFields = vi.fn().mockResolvedValue(undefined);
    const port = { profile: { subscribe: vi.fn(), update: vi.fn(), updateFields } } as unknown as Pick<ProgramData, "profile">;
    await markChangelogSeen("u1", port);
    expect(updateFields).toHaveBeenCalledWith("u1", { lastSeenChangelogAt: "SERVER_TIME" });
    expect(h.updateDoc).not.toHaveBeenCalled();
  });
  it("FRC (no port) writes the root users/{uid}, as before", async () => {
    h.updateDoc.mockResolvedValue(undefined);
    await markChangelogSeen("u1", null);
    expect(h.updateDoc).toHaveBeenCalledWith({ path: "users/u1" }, { lastSeenChangelogAt: "SERVER_TIME" });
  });
});
