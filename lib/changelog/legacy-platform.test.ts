import { describe, expect, it } from "vitest";
import { IMPORT_BATCH_SIZE, applyPlatformImport, planPlatformImport, type ImportDb } from "@/lib/changelog/legacy-platform";

// ALL FIXTURES ARE SYNTHETIC: invented notes, not the real old release notes (which are not in the repository).
const T0 = Date.UTC(2024, 2, 2, 12, 0, 0);
const note = (id: string, over: Record<string, unknown> = {}) => ({ id, title: "Synthetic note", body: "Added a synthetic thing\nFixed a synthetic bug\nSomething unmarked", createdAt: T0, updatedAt: T0 + 1000, ...over });

describe("converting the old notes into platform entries", () => {
  const plan = planPlatformImport({ team1: [note("rel-1"), note("rel-2", { title: "v2.1 - Synthetic form", createdAt: T0 + 86_400_000 })], global: [note("g-1")] });

  it("keeps the wording, maps markers to categories, flags the unmarked line, and uses stable ids", () => {
    const first = plan.entries.find((e) => e.id === "cs-legacy-team1-rel-1")!;
    expect(first.doc.items.map((i) => [i.category, i.text])).toEqual([
      ["new", "Added a synthetic thing"],
      ["fixed", "Fixed a synthetic bug"],
      ["improved", "Something unmarked"],
    ]);
    expect(first.warnings.join(" ")).toContain("no marker word");
    expect(plan.entries.map((e) => e.id).sort()).toEqual(["cs-legacy-global-g-1", "cs-legacy-team1-rel-1", "cs-legacy-team1-rel-2"]);
  });

  it("tags every entry and every item for the default program only, published and legacy, with the old times", () => {
    for (const e of plan.entries) {
      expect(e.doc).toMatchObject({ status: "published", legacy: true, programs: ["frc"], rev: 1, createdBy: "cs-legacy-import", createdAt: expect.any(Number) });
      for (const item of e.doc.items) expect(item.programs).toEqual(["frc"]);
      expect(e.doc.publishedAt).toBe(e.doc.createdAt);
    }
    expect(plan.entries[0].doc.createdAt).toBe(T0); // oldest first
  });

  it("uses a version from the title when there is one, and no version when it would only repeat the date", () => {
    expect(plan.entries.find((e) => e.id.endsWith("rel-2"))!.doc.version).toBe("v2.1");
    expect(plan.entries.find((e) => e.id.endsWith("rel-1"))!.doc.version).toBe("");
  });

  it("never imports a starter draft, and lists a note it cannot store as skipped instead of editing it", () => {
    const p = planPlatformImport({ team1: [note("starter-team1-v0-1"), note("bad", { body: "Added <script>alert(1)</script> thing" }), note("empty", { body: "  " }), note("ok")] });
    expect(p.entries.map((e) => e.id)).toEqual(["cs-legacy-team1-ok"]);
    const reasons = Object.fromEntries(p.skipped.map((s) => [s.id.replace(/^cs-legacy-team1-/, ""), s.reason]));
    expect(reasons["starter-team1-v0-1"]).toContain("starter");
    expect(reasons.bad).toContain("not valid as a platform entry");
    expect(reasons.empty).toContain("no body");
  });
});

/** An in-memory stand-in for the slice of the Admin SDK the importer uses; counts writes and refuses to overwrite like `create` does. */
function mockDb(existing: string[] = []) {
  const store = new Map<string, unknown>(existing.map((p) => [p, { old: true }]));
  const log = { batches: [] as number[], sets: 0 };
  const db: ImportDb = {
    doc: (path) => ({ path }),
    getAll: async (...refs) => refs.map((ref) => ({ exists: store.has(ref.path), ref })),
    batch: () => {
      const ops: { path: string; data: unknown }[] = [];
      return {
        create: (ref, data) => void ops.push({ path: ref.path, data }),
        commit: async () => {
          for (const op of ops) if (store.has(op.path)) throw new Error(`ALREADY_EXISTS ${op.path}`);
          for (const op of ops) store.set(op.path, op.data);
          log.batches.push(ops.length);
        },
      };
    },
  };
  return { db, store, log };
}

describe("applying the import", () => {
  const many = (n: number) => planPlatformImport({ t: Array.from({ length: n }, (_, i) => note(`n${i}`)) });

  it("creates in batches of 400, and a second run creates nothing (idempotent)", async () => {
    const { db, store, log } = mockDb();
    const plan = many(900);
    expect(await applyPlatformImport(db, plan, IMPORT_BATCH_SIZE)).toEqual({ created: 900, existing: 0 });
    expect(log.batches).toEqual([400, 400, 100]);
    expect(store.size).toBe(900);
    expect(await applyPlatformImport(db, plan)).toEqual({ created: 0, existing: 900 });
    expect(log.batches).toEqual([400, 400, 100]);
  });

  it("is create-only: an id that already exists is left exactly as it was", async () => {
    const { db, store } = mockDb(["platformChangelog/cs-legacy-t-n1"]);
    expect(await applyPlatformImport(db, many(3))).toEqual({ created: 2, existing: 1 });
    expect(store.get("platformChangelog/cs-legacy-t-n1")).toEqual({ old: true });
  });

  it("writes only to platformChangelog", async () => {
    const { db, store } = mockDb();
    await applyPlatformImport(db, many(2));
    expect([...store.keys()].every((k) => k.startsWith("platformChangelog/"))).toBe(true);
  });
});
