import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";

// Token verification and the Admin Firestore are mocked: the route's own auth wiring (401, bad token, 503) and one admin success.
const mocks = vi.hoisted(() => ({ verify: vi.fn(), problem: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/server/require-user", () => ({ verifyBearerToken: mocks.verify, serverSignInProblem: mocks.problem }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminFirestore: mocks.db, getAdminFirestoreRest: () => null }));

import { POST } from "@/app/api/ftc/team/sync-field-teams/route";

const call = (body: unknown) => POST(new Request("http://localhost/api/ftc/team/sync-field-teams", { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: JSON.stringify(body) }));

let fake: FakeFirestore;
beforeEach(() => {
  fake = new FakeFirestore();
  fake.seed("programs/ftc/teams/T1", { number: 35792, name: "Alpha" });
  fake.seed("programs/ftc/users/admin-1", { teamId: "T1", isAdmin: true });
  mocks.verify.mockReset();
  mocks.problem.mockReset().mockReturnValue(null);
  mocks.db.mockReset().mockImplementation(() => fake.asFirestore());
});

describe("sync-field-teams route", () => {
  it("401 without a valid token (none, or a bad one)", async () => {
    mocks.verify.mockResolvedValue(null);
    const res = await call({ program: "ftc", action: "sync", teamId: "T1" });
    expect(res.status).toBe(401);
  });
  it("503 server_not_configured style answer when the Admin SDK is missing, naming the problem", async () => {
    mocks.verify.mockResolvedValue(null);
    mocks.problem.mockReturnValue("Server sign-in is not configured: set FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY.");
    const res = await call({ program: "ftc", action: "sync", teamId: "T1" });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).toContain("FIREBASE_ADMIN_CLIENT_EMAIL");
  });
  it("503 when a valid token has no Admin Firestore", async () => {
    mocks.verify.mockResolvedValue({ uid: "admin-1" });
    mocks.db.mockReturnValue(null);
    expect((await call({ program: "ftc", action: "sync", teamId: "T1" })).status).toBe(503);
  });
  it("403 for a signed-in non-admin, 200 for the team's admin", async () => {
    fake.seed("programs/ftc/users/m1", { teamId: "T1", isAdmin: false });
    mocks.verify.mockResolvedValue({ uid: "m1" });
    expect((await call({ program: "ftc", action: "sync", teamId: "T1" })).status).toBe(403);
    mocks.verify.mockResolvedValue({ uid: "admin-1" });
    const ok = await call({ program: "ftc", action: "sync", teamId: "T1" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, teamMigrated: true });
  });
});
