import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";

// Session 9, Task 1: what the owner routes do TODAY to an edited entry. Token verification, the owner check and the Admin Firestore are mocked
// (same set-up as platform.routes.test.ts); the data is SYNTHETIC. These must keep passing unchanged.
const mocks = vi.hoisted(() => ({ verify: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/server/require-user", () => ({ verifyBearerToken: mocks.verify, serverSignInProblem: () => null }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminFirestore: mocks.db, getAdminFirestoreRest: () => null }));
vi.mock("@/lib/server/owner-admin", () => ({ isPlatformOwnerToken: (d: { uid?: string }) => d.uid === "owner" }));

import { GET, POST } from "@/app/api/platform/changelog/route";

const req = (method: "GET" | "POST", body?: unknown) =>
  new Request("http://localhost/api/platform/changelog", { method, headers: { authorization: "Bearer x", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const post = (body: unknown) => POST(req("POST", body));
const feedIds = async () => ((await (await GET(req("GET"))).json()).entries as { id: string }[]).map((x) => x.id);
const doc = (over: Record<string, unknown> = {}) => ({ title: "Synthetic", version: "", date: "2026-02-02", status: "published", programs: ["frc"], items: [{ category: "new", text: "x", programs: ["frc"] }], legacy: false, createdBy: "owner", createdAt: 10, updatedAt: 10, publishedAt: 10, rev: 1, ...over });
const input = (over: Record<string, unknown> = {}) => ({ title: "Synthetic", version: "", date: "2026-02-02", programs: ["frc"], items: [{ category: "new", text: "x", programs: ["frc"] }], ...over });

let fake: FakeFirestore;
beforeEach(() => {
  fake = new FakeFirestore();
  mocks.verify.mockReset().mockResolvedValue({ uid: "owner", name: "The Owner" });
  mocks.db.mockReset().mockImplementation(() => fake.asFirestore());
});

describe("editing today", () => {
  it("an edit of a published entry keeps its publish time and creation time, raises rev, and moves updatedAt only", async () => {
    fake.seed("platformChangelog/a", doc());
    const res = await (await post({ action: "update", id: "a", expectedRev: 1, entry: input({ title: "Typo fixed" }) })).json();
    expect(res.entry).toMatchObject({ title: "Typo fixed", date: "2026-02-02", rev: 2, publishedAtMs: 10, createdAtMs: 10, legacy: false });
    expect(res.entry.updatedAtMs).toBeGreaterThan(10);
  });
  it("an edit of a legacy entry that submits the same date keeps its date, flag and publish time, and its place in the list", async () => {
    fake.seed("platformChangelog/cs-legacy-t-1", doc({ legacy: true, date: "2024-03-03", createdBy: "cs-legacy-import", createdAt: 5, updatedAt: 5, publishedAt: 5 }));
    fake.seed("platformChangelog/cs-legacy-t-2", doc({ legacy: true, date: "2024-01-01", createdAt: 6, publishedAt: 6 }));
    fake.seed("platformChangelog/cur", doc({ date: "2020-01-01" }));
    const before = await feedIds();
    expect(before).toEqual(["cur", "cs-legacy-t-1", "cs-legacy-t-2"]);
    const res = await (await post({ action: "update", id: "cs-legacy-t-1", expectedRev: 1, entry: input({ title: "Cleaned up", date: "2024-03-03" }) })).json();
    expect(res.entry).toMatchObject({ legacy: true, date: "2024-03-03", publishedAtMs: 5, createdAtMs: 5 });
    expect(await feedIds()).toEqual(before);
  });
  it("unpublish clears the publish time and republish stamps a new one (a current entry)", async () => {
    fake.seed("platformChangelog/a", doc());
    await post({ action: "unpublish", id: "a", expectedRev: 1 });
    expect(fake.read("platformChangelog/a")).toMatchObject({ status: "draft", publishedAt: null });
    await post({ action: "publish", id: "a", expectedRev: 2 });
    const stored = fake.read("platformChangelog/a") as { publishedAt: number };
    expect(stored.publishedAt).toBeGreaterThan(10);
  });
});
