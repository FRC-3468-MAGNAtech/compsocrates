import { beforeEach, describe, expect, it } from "vitest";
import { applyWrite, invalidateFeedCache, listFeed } from "@/lib/server/platform-changelog";

// A fake Admin database: `platformChangelog` with N published entries and one draft; counts the documents each `.get()` returns.
let reads = 0;
const doc = (id: string, status: string) => ({ id, data: () => ({ status, title: id, items: [], programs: ["frc"], publishedAt: 1, version: "1", legacy: false, rev: 1 }) });
const db = {
  collection: () => ({
    get: async () => {
      const docs = [doc("a", "published"), doc("b", "published"), doc("draft", "draft")];
      reads += docs.length;
      return { docs };
    },
    doc: () => ({ id: "new" }),
  }),
  runTransaction: async () => undefined,
} as never;
const viewer = { uid: "u", name: "n", isOwner: false };
const owner = { uid: "o", name: "o", isOwner: true };

beforeEach(() => {
  reads = 0;
  invalidateFeedCache();
});

describe("the published feed's 60 s server copy", () => {
  it("reads once for requests inside a minute, again after it, and gives the same answer", async () => {
    const first = await listFeed(db, viewer, false, 1_000);
    const second = await listFeed(db, viewer, false, 30_000);
    expect(reads).toBe(3);
    expect(second.body).toEqual(first.body);
    expect((first.body.entries as unknown[]).length).toBe(2); // the draft is never in it
    await listFeed(db, viewer, false, 61_001);
    expect(reads).toBe(6);
  });

  it("the owner's draft view is always fresh and never fills the copy", async () => {
    await listFeed(db, owner, true, 1_000);
    await listFeed(db, owner, true, 2_000);
    expect(reads).toBe(6);
    const published = await listFeed(db, viewer, false, 3_000);
    expect((published.body.entries as unknown[]).length).toBe(2);
    expect(reads).toBe(9);
  });

  it("an owner write drops the copy", async () => {
    await listFeed(db, viewer, false, 1_000);
    await applyWrite(db, owner, { kind: "delete", id: "missing", expectedRev: 1 }, 2_000).catch(() => undefined);
    await listFeed(db, viewer, false, 3_000);
    expect(reads).toBe(6);
  });
});
