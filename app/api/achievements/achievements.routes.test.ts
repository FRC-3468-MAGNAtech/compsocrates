import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";

// Token verification, the owner check and the Admin Firestore are mocked: the route wiring (401, 403, 503), validation, the version check and the
// audit entry run for real over an in-memory Firestore. No emulator, no network, no real project.
const mocks = vi.hoisted(() => ({ verify: vi.fn(), problem: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/server/require-user", () => ({ verifyBearerToken: mocks.verify, serverSignInProblem: mocks.problem }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminFirestore: mocks.db, getAdminFirestoreRest: () => null }));
vi.mock("@/lib/server/owner-admin", () => ({ isPlatformOwnerToken: (d: { uid?: string }) => d.uid === "owner" }));

import { GET, PUT } from "@/app/api/achievements/config/route";

const get = (program: string | null) => GET(new Request(`http://localhost/api/achievements/config${program ? `?program=${program}` : ""}`, { headers: { authorization: "Bearer x" } }));
const put = (body: unknown, raw?: string) => PUT(new Request("http://localhost/api/achievements/config", { method: "PUT", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: raw ?? JSON.stringify(body) }));
const signIn = (uid: string) => mocks.verify.mockResolvedValue({ uid, name: `Name ${uid}`, email: "private@example.test" });

const practicePro = (over: Record<string, unknown> = {}) => ({ id: "practice-pro", name: "Practice Pro", description: "Five practice sessions.", icon: "Trophy", metric: "practice-sessions", threshold: 5, scope: "all", hidden: false, ...over });
const save = (over: Record<string, unknown> = {}) => ({ program: "frc", expectedVersion: 0, overrides: {}, custom: [practicePro()], ...over });

let fake: FakeFirestore;
beforeEach(() => {
  fake = new FakeFirestore();
  // FRC (root, CS-shaped) users: an admin and a member of team ALPHA, an admin of team BETA, and an FTC admin of team ZED.
  fake.seed("users/admin1", { displayName: "Alpha Admin", teamId: "ALPHA", isTeamAdmin: true });
  fake.seed("users/member1", { displayName: "Alpha Member", teamId: "ALPHA" });
  fake.seed("users/admin2", { displayName: "Beta Admin", teamId: "BETA", isTeamAdmin: true });
  fake.seed("users/noteam", { displayName: "No Team", teamId: "" });
  fake.seed("programs/ftc/users/ftcadmin", { name: "Zed Admin", teamId: "ZED", isAdmin: true, primaryRole: "match-scout", secondaryRoles: [] });
  fake.seed("programs/ftc/users/ftcmember", { name: "Zed Member", teamId: "ZED", isAdmin: false, primaryRole: "match-scout", secondaryRoles: [] });
  mocks.verify.mockReset();
  mocks.problem.mockReset().mockReturnValue(null);
  mocks.db.mockReset().mockImplementation(() => fake.asFirestore());
});

describe("access", () => {
  it("401 with no token or a bad token, on read and write", async () => {
    mocks.verify.mockResolvedValue(null);
    expect((await get("frc")).status).toBe(401);
    expect((await put(save())).status).toBe(401);
  });
  it("503 server_not_configured when credentials are missing", async () => {
    mocks.verify.mockResolvedValue(null);
    mocks.problem.mockReturnValue("Server sign-in is not configured: set FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY.");
    const res = await get("frc");
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("server_not_configured");
    signIn("admin1");
    mocks.problem.mockReturnValue(null);
    mocks.db.mockReturnValue(null);
    expect((await put(save())).status).toBe(503);
  });
  it("a non-admin member cannot write", async () => {
    signIn("member1");
    const res = await put(save());
    expect(res.status).toBe(403);
    expect(fake.read("teams/ALPHA/achievementConfig/main")).toBeUndefined();
  });
  it("an account with no team cannot write", async () => {
    signIn("noteam");
    expect((await put(save())).status).toBe(403);
  });
  it("an admin of another team cannot write this team, even naming it", async () => {
    signIn("admin2");
    const res = await put(save({ teamId: "ALPHA" }));
    expect(res.status).toBe(403);
    expect(fake.read("teams/ALPHA/achievementConfig/main")).toBeUndefined();
  });
  it("the program is required and must be known", async () => {
    signIn("admin1");
    expect((await put(save({ program: undefined }))).status).toBe(400);
    expect((await put(save({ program: "nope" }))).status).toBe(400);
    expect((await get(null)).status).toBe(400);
  });
});

describe("read", () => {
  it("a no-team account gets the built-ins only (the empty config), not an error", async () => {
    signIn("noteam");
    const res = await get("frc");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.teamId).toBeNull();
    expect(json.config.custom).toEqual([]);
    expect(json.canEdit).toBe(false);
  });
  it("a member reads their own team's effective config, and cannot edit", async () => {
    fake.seed("teams/ALPHA/achievementConfig/main", { version: 2, overrides: { streak: { name: "Hot streak" } }, custom: [practicePro()], order: [], updatedAt: 1, updatedBy: "admin1" });
    fake.seed("teams/BETA/achievementConfig/main", { version: 1, overrides: { streak: { name: "Beta streak" } }, custom: [], order: [] });
    signIn("member1");
    const json = await (await get("frc")).json();
    expect(json.teamId).toBe("ALPHA");
    expect(json.config.overrides.streak.name).toBe("Hot streak");
    expect(json.canEdit).toBe(false);
  });
  it("a request cannot choose the team it reads (there is no such input)", async () => {
    fake.seed("teams/BETA/achievementConfig/main", { version: 1, overrides: { streak: { name: "Beta streak" } }, custom: [], order: [] });
    signIn("member1");
    const res = await GET(new Request("http://localhost/api/achievements/config?program=frc&teamId=BETA", { headers: { authorization: "Bearer x" } }));
    expect((await res.json()).teamId).toBe("ALPHA");
  });
});

describe("write", () => {
  it("an admin saves; the version goes up, the audit entry is written, and nothing else is touched", async () => {
    signIn("admin1");
    const res = await put(save({ overrides: { "first-session": { name: "Rookie" } } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.config.version).toBe(1);
    const stored = fake.read("teams/ALPHA/achievementConfig/main") as { version: number; updatedBy: string; custom: { name: string }[]; overrides: Record<string, { name: string }> };
    expect(stored.version).toBe(1);
    expect(stored.updatedBy).toBe("admin1");
    expect(stored.custom[0].name).toBe("Practice Pro");
    expect(stored.overrides["first-session"].name).toBe("Rookie");
    const auditIds = fake.ids("auditLog");
    expect(auditIds).toHaveLength(1);
    expect(fake.read(`auditLog/${auditIds[0]}`)).toMatchObject({ teamId: "ALPHA", uid: "admin1", action: "edit-achievements" });
    // Only the config document, the audit entry and the rate-limit counter exist besides the seed.
    const written = [...fake.store.keys()].filter((k) => !k.startsWith("users/") && !k.startsWith("programs/ftc/users/"));
    expect(written.every((k) => k === "teams/ALPHA/achievementConfig/main" || k.startsWith("auditLog/") || k.startsWith("rateLimits/"))).toBe(true);
  });
  it("the FTC program writes only under its own path and its own audit collection", async () => {
    signIn("ftcadmin");
    const res = await put(save({ program: "ftc" }));
    expect(res.status).toBe(200);
    expect(fake.read("programs/ftc/teams/ZED/achievementConfig/main")).toBeDefined();
    expect(fake.read("teams/ZED/achievementConfig/main")).toBeUndefined();
    expect(fake.ids("programs/ftc/auditLog")).toHaveLength(1);
    expect(fake.ids("auditLog")).toHaveLength(0);
  });
  it("an FTC member is refused; an FRC admin is not an FTC admin", async () => {
    signIn("ftcmember");
    expect((await put(save({ program: "ftc" }))).status).toBe(403);
    signIn("admin1");
    expect((await put(save({ program: "ftc" }))).status).toBe(403);
  });
  it("the platform owner can write any team", async () => {
    signIn("owner");
    const res = await put(save({ teamId: "BETA" }));
    expect(res.status).toBe(200);
    expect(fake.read("teams/BETA/achievementConfig/main")).toBeDefined();
  });
  it("a stale version is a 409 with the latest, and nothing is overwritten", async () => {
    signIn("admin1");
    expect((await put(save())).status).toBe(200);
    const stale = await put(save({ expectedVersion: 0, custom: [practicePro({ name: "Other" })] }));
    expect(stale.status).toBe(409);
    const json = await stale.json();
    expect(json.code).toBe("conflict");
    expect(json.config.version).toBe(1);
    expect((fake.read("teams/ALPHA/achievementConfig/main") as { custom: { name: string }[] }).custom[0].name).toBe("Practice Pro");
    expect((await put(save({ expectedVersion: 1, custom: [practicePro({ name: "Other" })] }))).status).toBe(200);
  });
  it("invalid input is refused with a 400 and writes nothing", async () => {
    signIn("admin1");
    const bad: Record<string, unknown>[] = [
      { custom: [practicePro({ name: "x".repeat(41) })] },
      { custom: [practicePro({ description: "y".repeat(141) })] },
      { custom: [practicePro({ metric: "not-a-metric" })] },
      { custom: [practicePro({ threshold: 0 })] },
      { custom: [practicePro({ threshold: 100001 })] },
      { custom: [practicePro({ threshold: 2.5 })] },
      { custom: [practicePro({ name: "<b>Bold</b>" })] },
      { custom: [practicePro({ description: "<img src=x onerror=alert(1)>" })] },
      { custom: [practicePro({ icon: "not-an-icon" })] },
      { custom: Array.from({ length: 41 }, (_, i) => practicePro({ id: `c-${i + 10}` })) },
      { overrides: { streak: { threshold: 1 } } },
    ];
    for (const over of bad) expect((await put(save(over))).status).toBe(400);
    expect(fake.read("teams/ALPHA/achievementConfig/main")).toBeUndefined();
    expect(fake.ids("auditLog")).toHaveLength(0);
  });
  it("a missing version, unreadable JSON and an oversized body are refused", async () => {
    signIn("admin1");
    expect((await put(save({ expectedVersion: undefined }))).status).toBe(400);
    expect((await put(null, "{not json")).status).toBe(400);
    expect((await put(null, JSON.stringify({ pad: "x".repeat(70 * 1024) }))).status).toBe(413);
  });
  it("is rate limited per person", async () => {
    signIn("admin1");
    let version = 0;
    for (let i = 0; i < 30; i++) {
      const res = await put(save({ expectedVersion: version }));
      expect(res.status).toBe(200);
      version += 1;
    }
    expect((await put(save({ expectedVersion: version }))).status).toBe(429);
  });
});
