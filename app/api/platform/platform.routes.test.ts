import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";

// Token verification, the owner check and the Admin Firestore are mocked: the routes' own wiring (401, 403, 503), validation, visibility and
// version checks run for real over an in-memory Firestore. No emulator, no network, no real project.
const mocks = vi.hoisted(() => ({ verify: vi.fn(), problem: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/server/require-user", () => ({ verifyBearerToken: mocks.verify, serverSignInProblem: mocks.problem }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminFirestore: mocks.db, getAdminFirestoreRest: () => null }));
vi.mock("@/lib/server/owner-admin", () => ({ isPlatformOwnerToken: (d: { uid?: string }) => d.uid === "owner" }));

import { GET as feedGet, POST as feedPost } from "@/app/api/platform/changelog/route";
import { GET as ownerCreditsGet, POST as creditsPost } from "@/app/api/platform/credits/route";
import { GET as publicCreditsGet } from "@/app/api/public/credits/route";
import { DEFAULT_CREDITS } from "@/lib/credits/seed";

const req = (url: string, method: "GET" | "POST", body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: { authorization: "Bearer x", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const post = (body: unknown) => feedPost(req("/api/platform/changelog", "POST", body));
const entry = (over: Record<string, unknown> = {}) => ({
  title: "Synthetic release",
  version: "v9.9.9",
  date: "2026-01-02",
  programs: ["frc", "ftc"],
  items: [
    { category: "new", text: "A both-programs item" },
    { category: "fixed", text: "An FRC-only item", programs: ["frc"] },
  ],
  ...over,
});
const signIn = (uid: string) => mocks.verify.mockResolvedValue({ uid, name: uid === "owner" ? "The Owner" : "Someone", email: "private@example.test" });

let fake: FakeFirestore;
beforeEach(() => {
  fake = new FakeFirestore();
  mocks.verify.mockReset();
  mocks.problem.mockReset().mockReturnValue(null);
  mocks.db.mockReset().mockImplementation(() => fake.asFirestore());
});

describe("platform changelog routes: access", () => {
  it("401 with no token or a bad token (feed and writes)", async () => {
    mocks.verify.mockResolvedValue(null);
    expect((await feedGet(req("/api/platform/changelog", "GET"))).status).toBe(401);
    expect((await post({ action: "create", entry: entry() })).status).toBe(401);
  });
  it("503 server_not_configured when the Admin SDK is missing, naming variables only", async () => {
    mocks.verify.mockResolvedValue(null);
    mocks.problem.mockReturnValue("Server sign-in is not configured: set FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY.");
    const res = await feedGet(req("/api/platform/changelog", "GET"));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe("server_not_configured");
    expect(JSON.stringify(json)).not.toMatch(/BEGIN|private_key"/);
  });
  it("503 when a valid token has no Admin Firestore (and the public read too)", async () => {
    signIn("owner");
    mocks.db.mockReturnValue(null);
    expect((await post({ action: "create", entry: entry() })).status).toBe(503);
    expect((await publicCreditsGet()).status).toBe(503);
  });
  it("403 for a signed-in account that is not the platform owner (every write), and nothing is written", async () => {
    signIn("team-admin");
    for (const body of [{ action: "create", entry: entry() }, { action: "delete", id: "x", expectedRev: 1 }, { action: "publish", id: "x", expectedRev: 1 }]) {
      expect((await post(body)).status).toBe(403);
    }
    expect((await creditsPost(req("/api/platform/credits", "POST", { sections: [], expectedVersion: 0 }))).status).toBe(403);
    expect((await ownerCreditsGet(req("/api/platform/credits", "GET"))).status).toBe(403);
    expect(fake.ids("platformChangelog")).toEqual([]);
    expect(fake.read("platformCredits/main")).toBeUndefined();
  });
});

describe("platform changelog routes: writes and visibility", () => {
  it("the owner creates a draft, publishes it, edits it; each write has an audit entry and no secret is returned", async () => {
    signIn("owner");
    const created = await (await post({ action: "create", entry: entry() })).json();
    expect(created.ok).toBe(true);
    expect(created.entry).toMatchObject({ status: "draft", rev: 1, legacy: false, publishedAtMs: null, programs: ["frc", "ftc"] });
    expect(JSON.stringify(created)).not.toContain("private@example.test");
    const id = created.entry.id as string;

    const published = await (await post({ action: "publish", id, expectedRev: 1 })).json();
    expect(published.entry).toMatchObject({ status: "published", rev: 2 });
    expect(published.entry.publishedAtMs).toBeGreaterThan(0);
    const firstPublishedAt = published.entry.publishedAtMs;

    const edited = await (await post({ action: "update", id, expectedRev: 2, entry: entry({ title: "Synthetic release, fixed typo" }) })).json();
    expect(edited.entry).toMatchObject({ title: "Synthetic release, fixed typo", status: "published", rev: 3, publishedAtMs: firstPublishedAt });

    const unpublished = await (await post({ action: "unpublish", id, expectedRev: 3 })).json();
    expect(unpublished.entry).toMatchObject({ status: "draft", publishedAtMs: null, rev: 4 });

    const actions = fake.ids("platformAuditLog").map((k) => (fake.read(`platformAuditLog/${k}`) as { action: string }).action);
    expect(actions.sort()).toEqual(["create-platform-changelog-entry", "edit-platform-changelog-entry", "publish-platform-changelog-entry", "unpublish-platform-changelog-entry"].sort());
    expect(JSON.stringify(fake.read(`platformAuditLog/${fake.ids("platformAuditLog")[0]}`))).not.toContain("private@example.test");
  });

  it("saving a draft with status published is ONE write and ONE audit entry (publish from the editor), and legacy entries keep their flag through an edit", async () => {
    signIn("owner");
    const id = (await (await post({ action: "create", entry: entry() })).json()).entry.id as string;
    const res = await (await post({ action: "update", id, expectedRev: 1, status: "published", entry: entry({ title: "Now live" }) })).json();
    expect(res.entry).toMatchObject({ status: "published", title: "Now live", rev: 2 });
    expect(fake.ids("platformAuditLog")).toHaveLength(2); // create + publish
    // an imported entry (written by the importer, legacy: true) stays legacy and below the current ones after the owner edits it
    fake.seed("platformChangelog/cs-legacy-t-a", { title: "Old", version: "", date: "2024-01-01", status: "published", programs: ["frc"], items: [{ category: "new", text: "x", programs: ["frc"] }], legacy: true, createdBy: "cs-legacy-import", createdAt: 1, updatedAt: 1, publishedAt: 1, rev: 1 });
    const edited = await (await post({ action: "update", id: "cs-legacy-t-a", expectedRev: 1, entry: entry({ title: "Old, edited", programs: ["frc"], date: "2024-01-01" }) })).json();
    expect(edited.entry).toMatchObject({ legacy: true, title: "Old, edited", publishedAtMs: 1, status: "published" });
  });

  it("stores only the known fields, with the tags as data, in its own collection", async () => {
    signIn("owner");
    const res = await (await post({ action: "create", status: "published", entry: { ...entry(), createdBy: "forged", legacy: true, rev: 99, extra: "x" } })).json();
    const stored = fake.read(`platformChangelog/${res.entry.id}`) as Record<string, unknown>;
    expect(stored).toMatchObject({ createdBy: "owner", legacy: false, rev: 1, status: "published", programs: ["frc", "ftc"] });
    expect(stored).not.toHaveProperty("extra");
    expect(fake.ids("changelog")).toEqual([]); // the existing collections are never touched
  });

  it("rejects invalid input with 400 and writes nothing", async () => {
    signIn("owner");
    const bad = [
      entry({ title: "" }),
      entry({ date: "2026-13-40" }),
      entry({ programs: ["xyz"] }),
      entry({ programs: [] }),
      entry({ items: [] }),
      entry({ items: [{ category: "bogus", text: "x" }] }),
      entry({ items: [{ category: "new", text: "<script>alert(1)</script>" }] }),
      entry({ items: [{ category: "new", text: "[x](javascript:alert(1))" }] }),
      entry({ items: [{ category: "new", text: "x".repeat(401) }] }),
      entry({ items: [{ category: "new", text: "ok", programs: ["nope"] }] }),
      entry({ items: Array.from({ length: 81 }, (_, i) => ({ category: "new", text: `item ${i}` })) }),
      entry({ title: "t".repeat(121) }),
    ];
    for (const e of bad) {
      const res = await post({ action: "create", entry: e });
      expect(res.status, JSON.stringify(e).slice(0, 80)).toBe(400);
      expect((await res.json()).code).toBe("invalid_input");
    }
    expect((await post({ action: "nope" })).status).toBe(400);
    expect(fake.ids("platformChangelog")).toEqual([]);
  });

  it("drafts are visible to the owner only, and only when asked for; published entries to everyone signed in", async () => {
    signIn("owner");
    await post({ action: "create", status: "published", entry: entry({ title: "Live" }) });
    await post({ action: "create", entry: entry({ title: "Hidden draft" }) });

    const titles = async (url: string) => ((await (await feedGet(req(url, "GET"))).json()).entries as { title: string }[]).map((e) => e.title);
    expect(await titles("/api/platform/changelog")).toEqual(["Live"]);
    expect((await titles("/api/platform/changelog?drafts=1")).sort()).toEqual(["Hidden draft", "Live"]);

    signIn("team-admin");
    expect(await titles("/api/platform/changelog?drafts=1")).toEqual(["Live"]); // asking for drafts does not help a non-owner
    const asOther = await (await feedGet(req("/api/platform/changelog?drafts=1", "GET"))).json();
    expect(asOther.isOwner).toBe(false);
  });

  it("a stale edit is a 409 conflict that returns what is stored, and overwrites nothing; delete needs the current revision", async () => {
    signIn("owner");
    const id = (await (await post({ action: "create", entry: entry() })).json()).entry.id as string;
    await post({ action: "update", id, expectedRev: 1, entry: entry({ title: "First editor wins" }) });

    const stale = await post({ action: "update", id, expectedRev: 1, entry: entry({ title: "Second editor, stale" }) });
    expect(stale.status).toBe(409);
    const json = await stale.json();
    expect(json.code).toBe("conflict");
    expect(json.current).toMatchObject({ title: "First editor wins", rev: 2 });
    expect((fake.read(`platformChangelog/${id}`) as { title: string }).title).toBe("First editor wins");

    expect((await post({ action: "delete", id, expectedRev: 1 })).status).toBe(409);
    expect(fake.read(`platformChangelog/${id}`)).toBeDefined();
    expect((await post({ action: "update", id: "missing", expectedRev: 1, entry: entry() })).status).toBe(404);
    expect((await post({ action: "delete", id, expectedRev: 2 })).status).toBe(200);
    expect(fake.read(`platformChangelog/${id}`)).toBeUndefined();
  });

  it("rate limits writes per owner (429) without writing", async () => {
    signIn("owner");
    fake.seed(`rateLimits/platform-changelog-write:owner_${Math.floor(Date.now() / 3_600_000)}`, { count: 120 });
    expect((await post({ action: "create", entry: entry() })).status).toBe(429);
    expect(fake.ids("platformChangelog")).toEqual([]);
  });
});

describe("platform credits routes", () => {
  const sections = () => [
    { id: "people", title: "People", description: "Who made it", entries: [{ id: "a", name: "Synthetic Person", description: "Role", link: "https://example.test/p", imageUrl: null }] },
  ];
  const save = (body: unknown) => creditsPost(req("/api/platform/credits", "POST", body));

  it("the public read needs no sign-in, says null before anything is saved, then serves the saved document", async () => {
    mocks.verify.mockResolvedValue(null); // signed out
    const empty = await publicCreditsGet();
    expect(empty.status).toBe(200);
    expect((await empty.json()).credits).toBeNull();
    expect(empty.headers.get("cache-control")).toContain("s-maxage");

    signIn("owner");
    expect((await save({ sections: sections(), expectedVersion: 0 })).status).toBe(200);
    mocks.verify.mockResolvedValue(null);
    const read = await (await publicCreditsGet()).json();
    expect(read.credits).toMatchObject({ version: 1, sections: [{ id: "people", title: "People", description: "Who made it" }] });
  });

  it("owner save increments the version and audits; a stale save is a 409 with the stored credits and changes nothing", async () => {
    signIn("owner");
    const first = await (await save({ sections: sections(), expectedVersion: 0 })).json();
    expect(first.credits.version).toBe(1);
    const second = await (await save({ sections: [{ ...sections()[0], title: "People, v2" }], expectedVersion: 1 })).json();
    expect(second.credits.version).toBe(2);

    const stale = await save({ sections: [{ ...sections()[0], title: "Stale" }], expectedVersion: 1 });
    expect(stale.status).toBe(409);
    expect((await stale.json()).current).toMatchObject({ version: 2, sections: [{ title: "People, v2" }] });
    expect((fake.read("platformCredits/main") as { sections: { title: string }[] }).sections[0].title).toBe("People, v2");
    expect(fake.ids("platformAuditLog")).toHaveLength(2);
  });

  it("rejects unsafe or invalid credits with 400 (javascript: links, http links, HTML, repeated ids, missing version)", async () => {
    signIn("owner");
    const withEntry = (e: Record<string, unknown>) => [{ id: "s", title: "S", entries: [{ id: "e", name: "N", description: "", link: null, imageUrl: null, ...e }] }];
    const bad: unknown[] = [
      { sections: withEntry({ link: "javascript:alert(1)" }), expectedVersion: 0 },
      { sections: withEntry({ link: "http://example.test" }), expectedVersion: 0 },
      { sections: withEntry({ imageUrl: "data:text/html,x" }), expectedVersion: 0 },
      { sections: withEntry({ name: "<img src=x onerror=alert(1)>" }), expectedVersion: 0 },
      { sections: withEntry({ description: "[x](javascript:alert(1))" }), expectedVersion: 0 },
      { sections: [{ id: "s", title: "S", entries: [] }, { id: "s", title: "T", entries: [] }], expectedVersion: 0 },
      { sections: "nope", expectedVersion: 0 },
      { sections: withEntry({}) },
    ];
    for (const b of bad) expect((await save(b)).status, JSON.stringify(b).slice(0, 80)).toBe(400);
    expect(fake.read("platformCredits/main")).toBeUndefined();
  });

  it("reset stores the built-in list as the next version (so a stale editor still conflicts)", async () => {
    signIn("owner");
    await save({ sections: sections(), expectedVersion: 0 });
    const reset = await (await save({ reset: true, expectedVersion: 1 })).json();
    expect(reset.credits.version).toBe(2);
    expect(reset.credits.sections).toEqual(DEFAULT_CREDITS);
    const owner = await (await ownerCreditsGet(req("/api/platform/credits", "GET"))).json();
    expect(owner.defaults).toEqual(DEFAULT_CREDITS);
  });
});
