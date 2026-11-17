import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { buildTemplateContent } from "@/lib/templates/build";
import { SAMPLE_FORM } from "@/lib/forms/test-fixtures";

// Token verification and the Admin Firestore are mocked: the route's own auth wiring (401, bad token, 503) and one admin success. No real keys.
const mocks = vi.hoisted(() => ({ verify: vi.fn(), problem: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/server/require-user", () => ({ verifyBearerToken: mocks.verify, serverSignInProblem: mocks.problem }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminFirestore: mocks.db, getAdminFirestoreRest: () => null }));

import { POST } from "@/app/api/ftc/templates/route";

const call = (body: unknown, raw?: string) => POST(new Request("http://localhost/api/ftc/templates", { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: raw ?? JSON.stringify(body) }));
const good = { program: "ftc", action: "import", teamId: "T1", id: "tpl1" };

const built = buildTemplateContent({ form: SAMPLE_FORM, name: "Our template" });
if (!built.ok) throw new Error("fixture template must build");

let fake: FakeFirestore;
beforeEach(() => {
  fake = new FakeFirestore();
  fake.seed("programs/ftc/users/admin-1", { teamId: "T1", isAdmin: true });
  fake.seed("programs/ftc/users/m1", { teamId: "T1", isAdmin: false });
  fake.seed("programs/ftc/users/other-admin", { teamId: "T2", isAdmin: true });
  fake.seed("programs/ftc/formTemplates/tpl1", { ...built.content, ownerTeamId: "T1", visibility: "private", version: 1 });
  mocks.verify.mockReset();
  mocks.problem.mockReset().mockReturnValue(null);
  mocks.db.mockReset().mockImplementation(() => fake.asFirestore());
});

describe("/api/ftc/templates", () => {
  it("401 without a token or with a bad one", async () => {
    mocks.verify.mockResolvedValue(null);
    expect((await call(good)).status).toBe(401);
  });

  it("503 server_not_configured when the Admin SDK has no credentials (naming the variables, never their values), and when a valid token has no Admin Firestore", async () => {
    mocks.verify.mockResolvedValue(null);
    mocks.problem.mockReturnValue("Server sign-in is not configured: set FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY.");
    const res = await call(good);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false, code: "server_not_configured" });
    expect(JSON.stringify(json)).toContain("FIREBASE_ADMIN_CLIENT_EMAIL");
    mocks.problem.mockReturnValue(null);
    mocks.verify.mockResolvedValue({ uid: "admin-1" });
    mocks.db.mockReturnValue(null);
    const none = await call(good);
    expect(none.status).toBe(503);
    expect(await none.json()).toMatchObject({ code: "server_not_configured" });
  });

  it("403 for a plain member and for an admin of another team", async () => {
    mocks.verify.mockResolvedValue({ uid: "m1" });
    expect((await call(good)).status).toBe(403);
    mocks.verify.mockResolvedValue({ uid: "other-admin" });
    expect((await call(good)).status).toBe(403);
  });

  it("400 for the wrong program, a missing program (never a cookie), bad input and an unreadable body", async () => {
    mocks.verify.mockResolvedValue({ uid: "admin-1" });
    expect((await call({ ...good, program: "frc" })).status).toBe(400);
    expect((await call({ ...good, program: undefined })).status).toBe(400);
    expect((await call({ ...good, action: "approve" })).status).toBe(400);
    expect((await call({ ...good, id: "a/b" })).status).toBe(400);
    expect((await call(null, "not json")).status).toBe(400);
  });

  it("200 for the team's admin, and nothing is written outside programs/ftc", async () => {
    mocks.verify.mockResolvedValue({ uid: "admin-1" });
    const res = await call(good);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, template: { id: "tpl1", name: "Our template" } });
    expect(fake.ids("formTemplates")).toEqual([]);
    expect(fake.ids("users")).toEqual([]);
  });
});
