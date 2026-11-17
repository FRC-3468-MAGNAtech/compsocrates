import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { resetMembershipsEnabledCache } from "@/lib/server/team-settings";

// Token verification and the Admin Firestore are mocked: the shared wiring of every build 2 route (auth, configuration, deadline, error mapping).
const mocks = vi.hoisted(() => ({ verify: vi.fn(), problem: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/server/require-user", () => ({ verifyBearerToken: mocks.verify, serverSignInProblem: mocks.problem }));
// The platform-owner check is covered in verify-admins.test.ts; here every caller counts as the owner so the program rule is reached on that route too.
vi.mock("@/lib/server/owner-admin", () => ({ isPlatformOwnerToken: () => true }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminFirestore: mocks.db, getAdminFirestoreRest: () => null }));

import { membershipRoute } from "@/lib/server/membership-route";
import { withDeadline, DeadlineError } from "@/lib/server/deadline";
import { POST as joinLookup } from "@/app/api/team/join-lookup/route";
import { POST as requestJoin } from "@/app/api/team/membership/request-join/route";
import { POST as decide } from "@/app/api/team/membership/decide/route";
import { POST as leave } from "@/app/api/team/leave/route";
import { POST as remove } from "@/app/api/team/member/remove/route";
import { POST as access } from "@/app/api/team/member/access/route";
import { POST as verifyAdmins } from "@/app/api/platform/verify-admins/route";

const req = (body: unknown) => new Request("http://localhost/api/x", { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: JSON.stringify(body) });
const ROUTES = { joinLookup, requestJoin, decide, leave, remove, access, verifyAdmins };

let fake: FakeFirestore;
beforeEach(() => {
  fake = new FakeFirestore();
  fake.seed("appSettings/global", { membershipsEnabled: true });
  resetMembershipsEnabledCache();
  mocks.verify.mockReset().mockResolvedValue({ uid: "u1", name: "Ann", email: "ann@example.com" });
  mocks.problem.mockReset().mockReturnValue(null);
  mocks.db.mockReset().mockReturnValue(fake.asFirestore());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe.each(Object.entries(ROUTES))("route %s", (_name, POST) => {
  it("answers 401 with no token or a bad token", async () => {
    mocks.verify.mockResolvedValue(null);
    const res = await POST(req({ program: "frc" }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("not_signed_in");
  });

  it("answers 503 server_not_configured when the credentials are missing, with no secret in the message", async () => {
    mocks.verify.mockResolvedValue(null);
    mocks.problem.mockReturnValue("Server sign-in is not configured: set FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY.");
    const res = await POST(req({ program: "frc" }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("server_not_configured");
    mocks.problem.mockReturnValue(null);
    mocks.verify.mockResolvedValue({ uid: "u1" });
    mocks.db.mockReturnValue(null);
    expect((await POST(req({ program: "frc" }))).status).toBe(503);
  });

  it("answers 404 memberships_disabled while the switch is off", async () => {
    fake.seed("appSettings/global", { membershipsEnabled: false });
    const res = await POST(req({ program: "frc", teamId: "T1", code: "ABC", uid: "u2", requestId: "r", action: "list" }));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("memberships_disabled");
  });

  it("requires the program in the body (a missing or unknown one is a 400, never a default)", async () => {
    const missing = await POST(req({ teamId: "T1", code: "ABC", uid: "u2", requestId: "r", action: "list" }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).code).toBe("program_required");
    const unknown = await POST(req({ program: "nope", teamId: "T1", code: "ABC", uid: "u2", requestId: "r", action: "list" }));
    expect((await unknown.json()).code).toBe("unknown_program");
  });
});

describe("the request deadline", () => {
  it("maps a stalled handler to 504 timeout with a clear message", async () => {
    const res = await membershipRoute(req({}), () => new Promise(() => {}), 25);
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.code).toBe("timeout");
    expect(body.error).toMatch(/too long/);
  });

  it("withDeadline passes a result through and rejects a late one", async () => {
    await expect(withDeadline(Promise.resolve(3), 50)).resolves.toBe(3);
    await expect(withDeadline(new Promise(() => {}), 10)).rejects.toBeInstanceOf(DeadlineError);
  });

  it("a thrown error is a generic 500 and never leaks its message", async () => {
    const res = await membershipRoute(req({}), async () => {
      throw new Error("secret detail");
    });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
