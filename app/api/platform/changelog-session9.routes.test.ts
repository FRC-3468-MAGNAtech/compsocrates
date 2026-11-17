import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";

// Session 9: the date lock, the position of legacy entries, and the posted / edited times. Token verification, the owner check and the Admin
// Firestore are mocked (same set-up as platform.routes.test.ts); the clock is controlled; every document is SYNTHETIC.
const mocks = vi.hoisted(() => ({ verify: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/server/require-user", () => ({ verifyBearerToken: mocks.verify, serverSignInProblem: () => null }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminFirestore: mocks.db, getAdminFirestoreRest: () => null }));
vi.mock("@/lib/server/owner-admin", () => ({ isPlatformOwnerToken: (d: { uid?: string }) => d.uid === "owner" }));

import { GET, POST } from "@/app/api/platform/changelog/route";

const T0 = Date.UTC(2026, 5, 15, 12, 0, 0);
const MIN = 60_000;
let clock = T0;

const req = (method: "GET" | "POST", body?: unknown) =>
  new Request("http://localhost/api/platform/changelog", { method, headers: { authorization: "Bearer x", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const post = async (body: unknown) => {
  const res = await POST(req("POST", body));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: the response bodies are read loosely
  return { status: res.status, json: (await res.json()) as Record<string, any> };
};
const feedIds = async () => ((await (await GET(req("GET", undefined))).json()).entries as { id: string }[]).map((x) => x.id);
const input = (over: Record<string, unknown> = {}) => ({ title: "Synthetic", version: "", date: "2026-02-02", programs: ["frc"], items: [{ category: "new", text: "x", programs: ["frc"] }], ...over });
const doc = (over: Record<string, unknown> = {}) => ({ title: "Synthetic", version: "", date: "2026-02-02", status: "published", programs: ["frc"], items: [{ category: "new", text: "x", programs: ["frc"] }], legacy: false, createdBy: "owner", createdAt: 10, updatedAt: 10, publishedAt: 10, rev: 1, ...over });
const legacyDoc = (over: Record<string, unknown> = {}) => doc({ legacy: true, date: "2024-03-03", createdBy: "cs-legacy-import", createdAt: 5, updatedAt: 7, publishedAt: 5, ...over });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: stored documents are read loosely
const stored = (path: string) => fake.read(path) as Record<string, any>;
const audits = () => fake.ids("platformAuditLog").map((id) => stored(`platformAuditLog/${id}`));

let fake: FakeFirestore;
beforeEach(() => {
  fake = new FakeFirestore();
  clock = T0;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  mocks.verify.mockReset().mockResolvedValue({ uid: "owner", name: "The Owner" });
  mocks.db.mockReset().mockImplementation(() => fake.asFirestore());
});
afterEach(() => vi.restoreAllMocks());

describe("a legacy entry keeps its date, flag and place through every kind of save", () => {
  beforeEach(() => {
    fake.seed("platformChangelog/cs-legacy-t-1", legacyDoc());
    fake.seed("platformChangelog/cs-legacy-t-2", legacyDoc({ date: "2024-03-03", createdAt: 6, publishedAt: 6 }));
    fake.seed("platformChangelog/cs-legacy-t-3", legacyDoc({ date: "2023-01-01", createdAt: 4, publishedAt: 4 }));
    fake.seed("platformChangelog/cur", doc({ date: "2020-01-01" }));
  });
  it("edit, unpublish, republish, a content edit while unpublished: date, legacy and position never change", async () => {
    const order = await feedIds();
    expect(order).toEqual(["cur", "cs-legacy-t-2", "cs-legacy-t-1", "cs-legacy-t-3"]);
    clock += 5 * 24 * 60 * MIN;
    expect((await post({ action: "update", id: "cs-legacy-t-1", expectedRev: 1, entry: input({ title: "Cleaned", date: "2024-03-03" }), recordEdit: false })).status).toBe(200);
    expect(await feedIds()).toEqual(order);
    expect((await post({ action: "unpublish", id: "cs-legacy-t-1", expectedRev: 2 })).status).toBe(200);
    expect(stored("platformChangelog/cs-legacy-t-1").publishedAt).toBeNull();
    clock += 24 * 60 * MIN;
    expect((await post({ action: "publish", id: "cs-legacy-t-1", expectedRev: 3 })).status).toBe(200);
    // the republish stamped a NEW publishedAt (later than its neighbour's), yet it did not move
    expect(stored("platformChangelog/cs-legacy-t-1").publishedAt).toBeGreaterThan(6);
    expect(await feedIds()).toEqual(order);
    const now = stored("platformChangelog/cs-legacy-t-1");
    expect(now).toMatchObject({ legacy: true, date: "2024-03-03", title: "Cleaned", createdAt: 5, rev: 4 });
  });
  it("a different date is refused unless the owner unlocked the field; unlocked, it changes, and only then", async () => {
    const locked = await post({ action: "update", id: "cs-legacy-t-1", expectedRev: 1, entry: input({ date: "2024-03-04" }) });
    expect(locked.status).toBe(400);
    expect(locked.json.code).toBe("date_locked");
    expect(stored("platformChangelog/cs-legacy-t-1")).toMatchObject({ date: "2024-03-03", rev: 1 });
    const ok = await post({ action: "update", id: "cs-legacy-t-1", expectedRev: 1, entry: input({ date: "2024-03-04" }), dateUnlocked: true });
    expect(ok.status).toBe(200);
    expect(ok.json.entry).toMatchObject({ date: "2024-03-04", legacy: true });
    expect(audits().at(-1)?.details.date).toEqual({ before: "2024-03-03", after: "2024-03-04" });
  });
  it("a current entry's date is a normal field (no lock)", async () => {
    expect((await post({ action: "update", id: "cur", expectedRev: 1, entry: input({ date: "2021-05-05" }) })).json.entry.date).toBe("2021-05-05");
  });
  it("saves leave no Session 9 field on a legacy entry that never had them (a cleanup edit with 'Don't record')", async () => {
    await post({ action: "update", id: "cs-legacy-t-1", expectedRev: 1, entry: input({ title: "Cleaned", date: "2024-03-03" }), recordEdit: false });
    const d = stored("platformChangelog/cs-legacy-t-1");
    expect("postedAt" in d || "editedAt" in d || "editedBy" in d).toBe(false);
  });
});

describe("time posted", () => {
  it("is stamped once, by the server clock, when a new entry is published, and an edit never overwrites it", async () => {
    const created = await post({ action: "create", entry: input(), status: "published" });
    const id = created.json.entry.id as string;
    expect(created.json.entry).toMatchObject({ postedAtMs: T0, publishedAtMs: T0 });
    clock += 60 * MIN;
    const edit = await post({ action: "update", id, expectedRev: 1, entry: input({ title: "Edited later" }) });
    expect(edit.json.entry.postedAtMs).toBe(T0);
  });
  it("a draft gets none until it is first published; unpublish and republish keep it", async () => {
    const created = await post({ action: "create", entry: input(), status: "draft" });
    const id = created.json.entry.id as string;
    expect(created.json.entry.postedAtMs).toBeNull();
    clock += 10 * MIN;
    const pub = await post({ action: "update", id, expectedRev: 1, entry: input(), status: "published" });
    expect(pub.json.entry).toMatchObject({ postedAtMs: clock, publishedAtMs: clock });
    const firstPosted = pub.json.entry.postedAtMs as number;
    clock += 10 * MIN;
    expect((await post({ action: "unpublish", id, expectedRev: 2 })).json.entry).toMatchObject({ postedAtMs: firstPosted, publishedAtMs: null });
    clock += 10 * MIN;
    const again = await post({ action: "publish", id, expectedRev: 3 });
    expect(again.json.entry.postedAtMs).toBe(firstPosted);
    expect(again.json.entry.publishedAtMs).toBe(clock); // publishedAt keeps its own meaning (restamped, drives the dot)
  });
  it("an already published current entry with no postedAt gets it from publishedAt on its next save, not from now", async () => {
    fake.seed("platformChangelog/a", doc({ publishedAt: 123_456 }));
    clock += 999 * MIN;
    const res = await post({ action: "update", id: "a", expectedRev: 1, entry: input() });
    expect(res.json.entry).toMatchObject({ postedAtMs: 123_456, publishedAtMs: 123_456 });
  });
  it("a legacy entry never gets one automatically, even when republished", async () => {
    fake.seed("platformChangelog/cs-legacy-t-1", legacyDoc());
    await post({ action: "update", id: "cs-legacy-t-1", expectedRev: 1, entry: input({ date: "2024-03-03" }) });
    await post({ action: "unpublish", id: "cs-legacy-t-1", expectedRev: 2 });
    const res = await post({ action: "publish", id: "cs-legacy-t-1", expectedRev: 3 });
    expect(res.json.entry.postedAtMs).toBeNull();
    expect("postedAt" in stored("platformChangelog/cs-legacy-t-1")).toBe(false);
  });
  it("the owner can set it by hand, and Clear removes it for good (a cleared one is not refilled by the next save)", async () => {
    fake.seed("platformChangelog/cs-legacy-t-1", legacyDoc());
    const hand = T0 - 3 * 24 * 60 * MIN;
    const set = await post({ action: "update", id: "cs-legacy-t-1", expectedRev: 1, entry: input({ date: "2024-03-03" }), times: { postedAt: hand }, recordEdit: false });
    expect(set.json.entry.postedAtMs).toBe(hand);
    const cleared = await post({ action: "update", id: "cs-legacy-t-1", expectedRev: 2, entry: input({ date: "2024-03-03" }), times: { postedAt: null }, recordEdit: false });
    expect(cleared.json.entry.postedAtMs).toBeNull();
    fake.seed("platformChangelog/cur", doc({ postedAt: null }));
    const cur = await post({ action: "update", id: "cur", expectedRev: 1, entry: input() });
    expect(cur.json.entry.postedAtMs).toBeNull();
  });
});

describe("last edited", () => {
  it("is stamped by the server (time and uid) on a content save of a published entry", async () => {
    fake.seed("platformChangelog/a", doc({ postedAt: 10 }));
    const res = await post({ action: "update", id: "a", expectedRev: 1, entry: input({ title: "Changed" }) });
    expect(res.json.entry).toMatchObject({ editedAtMs: T0, editedBy: "owner", postedAtMs: 10 });
  });
  it("is left as it is when 'Don't record this edit' is set", async () => {
    fake.seed("platformChangelog/a", doc({ postedAt: 10, editedAt: 50, editedBy: "someone" }));
    const res = await post({ action: "update", id: "a", expectedRev: 1, entry: input({ title: "Changed" }), recordEdit: false });
    expect(res.json.entry).toMatchObject({ editedAtMs: 50, editedBy: "someone" });
  });
  it("is not stamped by a draft's edits, by publish or unpublish, or by creating", async () => {
    const draft = (await post({ action: "create", entry: input(), status: "draft" })).json.entry.id as string;
    expect((await post({ action: "update", id: draft, expectedRev: 1, entry: input({ title: "More" }) })).json.entry.editedAtMs).toBeNull();
    expect((await post({ action: "publish", id: draft, expectedRev: 2 })).json.entry.editedAtMs).toBeNull();
    expect((await post({ action: "unpublish", id: draft, expectedRev: 3 })).json.entry.editedAtMs).toBeNull();
  });
  it("an owner's hand-set value wins over the stamp, and Clear removes it", async () => {
    fake.seed("platformChangelog/a", doc({ postedAt: 10 }));
    const hand = T0 - 60 * MIN;
    const set = await post({ action: "update", id: "a", expectedRev: 1, entry: input(), times: { editedAt: hand } });
    expect(set.json.entry.editedAtMs).toBe(hand);
    const cleared = await post({ action: "update", id: "a", expectedRev: 2, entry: input(), times: { editedAt: null }, recordEdit: false });
    expect(cleared.json.entry).toMatchObject({ editedAtMs: null, editedBy: "" });
    expect("editedAt" in stored("platformChangelog/a")).toBe(false);
  });
});

describe("validation, access and conflicts", () => {
  beforeEach(() => fake.seed("platformChangelog/a", doc({ postedAt: T0 - 10 * MIN })));
  it("refuses a time more than 5 minutes ahead (and accepts 5), with a clear message, writing nothing", async () => {
    const late = await post({ action: "update", id: "a", expectedRev: 1, entry: input(), times: { editedAt: T0 + 6 * MIN } });
    expect(late.status).toBe(400);
    expect(late.json.error).toBe("Last edited can't be in the future.");
    expect((await post({ action: "update", id: "a", expectedRev: 1, entry: input(), times: { postedAt: T0 + 6 * MIN } })).json.error).toBe("Time posted can't be in the future.");
    expect(stored("platformChangelog/a").rev).toBe(1);
    expect((await post({ action: "update", id: "a", expectedRev: 1, entry: input(), times: { editedAt: T0 + 5 * MIN } })).status).toBe(200);
  });
  it("refuses last edited earlier than posted (against the stored value too) and values that are not numbers", async () => {
    const early = await post({ action: "update", id: "a", expectedRev: 1, entry: input(), times: { editedAt: T0 - 20 * MIN } });
    expect(early.status).toBe(400);
    expect(early.json.error).toBe("Last edited can't be earlier than Time posted.");
    for (const bad of ["2026-06-15", -1, 1.5, "abc"]) {
      const r = await post({ action: "update", id: "a", expectedRev: 1, entry: input(), times: { postedAt: bad } });
      expect(r.status).toBe(400);
      expect(r.json.error).toBe("Time posted isn't a valid date and time.");
    }
    expect(stored("platformChangelog/a").rev).toBe(1);
  });
  it("only the platform owner may send times or any other write (403), and nothing changes", async () => {
    mocks.verify.mockResolvedValue({ uid: "team-admin", name: "Someone" });
    const res = await post({ action: "update", id: "a", expectedRev: 1, entry: input(), times: { postedAt: T0 - MIN } });
    expect(res.status).toBe(403);
    expect(stored("platformChangelog/a")).toMatchObject({ rev: 1, postedAt: T0 - 10 * MIN });
  });
  it("a stale edit is a 409 with the stored entry, times included, and writes nothing", async () => {
    await post({ action: "update", id: "a", expectedRev: 1, entry: input({ title: "First" }) });
    const stale = await post({ action: "update", id: "a", expectedRev: 1, entry: input({ title: "Second" }), times: { postedAt: T0 - 5 * MIN } });
    expect(stale.status).toBe(409);
    expect(stale.json.current).toMatchObject({ title: "First", rev: 2, postedAtMs: T0 - 10 * MIN });
    expect(stored("platformChangelog/a").title).toBe("First");
  });
});

describe("the audit log and the unread dot", () => {
  it("records the before and after of the time fields when a save changes them, and omits them when it does not", async () => {
    fake.seed("platformChangelog/a", doc({ postedAt: 100 }));
    await post({ action: "update", id: "a", expectedRev: 1, entry: input(), times: { postedAt: 200 }, recordEdit: false });
    expect(audits().at(-1)?.details.times).toEqual({ before: { postedAt: 100, editedAt: null }, after: { postedAt: 200, editedAt: null } });
    await post({ action: "update", id: "a", expectedRev: 2, entry: input({ title: "Same times" }), recordEdit: false });
    expect(audits().at(-1)?.details.times).toBeUndefined();
    clock += MIN;
    await post({ action: "update", id: "a", expectedRev: 3, entry: input({ title: "Stamped" }) });
    expect(audits().at(-1)?.details.times).toEqual({ before: { postedAt: 200, editedAt: null }, after: { postedAt: 200, editedAt: clock } });
  });
  it("publishing a new entry records its posting; the audit entry holds no email address", async () => {
    await post({ action: "create", entry: input(), status: "published" });
    const a = audits().at(-1)!;
    expect(a.action).toBe("publish-platform-changelog-entry");
    expect(a.details.times).toEqual({ before: { postedAt: null, editedAt: null }, after: { postedAt: T0, editedAt: null } });
    expect(JSON.stringify(a)).not.toMatch(/@/);
  });
  it("an edit keeps publishedAt (the dot's time) exactly, so it can never relight the dot", async () => {
    fake.seed("platformChangelog/a", doc({ publishedAt: 4242, postedAt: 4242 }));
    clock += 100 * 24 * 60 * MIN;
    const res = await post({ action: "update", id: "a", expectedRev: 1, entry: input({ title: "Edit" }), times: { postedAt: 100 } });
    expect(res.json.entry.publishedAtMs).toBe(4242);
    expect(stored("platformChangelog/a").publishedAt).toBe(4242);
  });
});
