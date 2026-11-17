import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { resetMembershipsEnabledCache } from "@/lib/server/team-settings";

// Token verification and the Admin Firestore are mocked: the route's auth wiring, the kill switch, the program rule and the switch itself.
const mocks = vi.hoisted(() => ({ verify: vi.fn(), problem: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/server/require-user", () => ({ verifyBearerToken: mocks.verify, serverSignInProblem: mocks.problem }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminFirestore: mocks.db, getAdminFirestoreRest: () => null }));

import { POST } from "@/app/api/team/switch/route";

const call = (body: unknown) => POST(new Request("http://localhost/api/team/switch", { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: JSON.stringify(body) }));

const member = (teamId: string, uid: string, over: Record<string, unknown> = {}) => ({
  uid,
  teamId,
  role: "match-scout",
  roles: null,
  secondaryRoles: [],
  isAdmin: false,
  isOwner: false,
  fieldTeamIds: null,
  name: "Ann",
  status: "active",
  origin: "pointer",
  joinedAt: 1,
  leftAt: null,
  endedBy: null,
  updatedAt: 1,
  ...over,
});

let fake: FakeFirestore;
beforeEach(() => {
  fake = new FakeFirestore();
  fake.seed("appSettings/global", { membershipsEnabled: true });
  fake.seed("users/u1", { displayName: "Ann", teamId: "AAA111", role: "coach", roles: ["coach"], secondaryRoles: [], isTeamAdmin: true });
  fake.seed("memberships/BBB222_u1", member("BBB222", "u1", { role: "drive-team", roles: ["drive-team"] }));
  fake.seed("programs/ftc/users/u1", { name: "Fay", teamId: "T1", primaryRole: "drive-team", secondaryRoles: [], isAdmin: false, isOwner: false, fieldTeamIds: ["a"] });
  fake.seed("programs/ftc/memberships/T2_u1", member("T2", "u1", { role: "pit-scout", isAdmin: true, fieldTeamIds: ["x"] }));
  resetMembershipsEnabledCache();
  mocks.verify.mockReset().mockResolvedValue({ uid: "u1", name: "Ann" });
  mocks.problem.mockReset().mockReturnValue(null);
  mocks.db.mockReset().mockImplementation(() => fake.asFirestore());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("auth wiring", () => {
  it("401 with no token or a bad one", async () => {
    mocks.verify.mockResolvedValue(null);
    const res = await call({ program: "frc", teamId: "BBB222" });
    expect(res.status).toBe(401);
    expect(fake.read("users/u1")?.teamId).toBe("AAA111");
  });
  it("503 server_not_configured when the Admin SDK is not configured, naming the problem", async () => {
    mocks.verify.mockResolvedValue(null);
    mocks.problem.mockReturnValue("Server sign-in is not configured: set FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY.");
    const res = await call({ program: "frc", teamId: "BBB222" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "server_not_configured" });
  });
  it("503 server_not_configured when a valid token has no Admin Firestore", async () => {
    mocks.db.mockReturnValue(null);
    const res = await call({ program: "frc", teamId: "BBB222" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "server_not_configured" });
  });
});

describe("the kill switch", () => {
  it("404 memberships_disabled while it is off or missing, and nothing is written", async () => {
    fake.seed("appSettings/global", { teamCreationEnabled: true });
    const res = await call({ program: "frc", teamId: "BBB222" });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "memberships_disabled" });
    expect(fake.commits).toEqual([]);
    expect(fake.read("users/u1")?.teamId).toBe("AAA111");
  });
  it("404 when the settings document is missing altogether", async () => {
    fake.store.delete("appSettings/global");
    expect((await call({ program: "frc", teamId: "BBB222" })).status).toBe(404);
  });
});

describe("the program is REQUIRED in the body", () => {
  it("400 program_required when missing (a cookie is never used)", async () => {
    const res = await POST(new Request("http://localhost/api/team/switch", { method: "POST", headers: { authorization: "Bearer x", cookie: "program=ftc", "content-type": "application/json" }, body: JSON.stringify({ teamId: "BBB222" }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "program_required" });
  });
  it("400 unknown_program for an unknown or wrongly cased program", async () => {
    for (const program of ["nba", "FRC", 7, {}]) {
      const res = await call({ program, teamId: "BBB222" });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "unknown_program" });
    }
  });
  it("400 for a missing team", async () => {
    expect((await call({ program: "frc" })).status).toBe(400);
  });
});

describe("the switch", () => {
  it("403 not_a_member without a membership", async () => {
    const res = await call({ program: "frc", teamId: "NOPE99" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "not_a_member" });
  });
  it("403 membership_ended for a past membership", async () => {
    fake.seed("memberships/BBB222_u1", member("BBB222", "u1", { status: "past", endedBy: "self", leftAt: 5 }));
    const res = await call({ program: "frc", teamId: "BBB222" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "membership_ended" });
  });
  it("200: saves the outgoing role fields, restores the incoming ones, answers with the new active team, and writes an audit entry", async () => {
    const res = await call({ program: "frc", teamId: "BBB222" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, program: "frc", activeTeamId: "BBB222", previousTeamId: "AAA111" });
    expect(fake.read("users/u1")).toMatchObject({ teamId: "BBB222", role: "drive-team", roles: ["drive-team"], isTeamAdmin: false });
    expect(fake.read("memberships/AAA111_u1")).toMatchObject({ role: "coach", isAdmin: true, origin: "pointer" });
    const logIds = fake.ids("auditLog");
    expect(logIds).toHaveLength(1);
    expect(fake.read(`auditLog/${logIds[0]}`)).toMatchObject({ teamId: "BBB222", uid: "u1", actorName: "Ann", action: "switch-team" });
  });
  it("FTC: the same route, the program's own paths, field teams follow, the audit entry is under programs/ftc", async () => {
    const res = await call({ program: "ftc", teamId: "T2" });
    expect(res.status).toBe(200);
    expect(fake.read("programs/ftc/users/u1")).toMatchObject({ teamId: "T2", primaryRole: "pit-scout", isAdmin: true, fieldTeamIds: ["x"] });
    expect(fake.read("users/u1")?.teamId).toBe("AAA111"); // the other program is untouched
    expect(fake.ids("programs/ftc/auditLog")).toHaveLength(1);
    expect(fake.ids("auditLog")).toHaveLength(0);
  });
  it("only ever acts for the verified caller: a uid in the body is ignored", async () => {
    fake.seed("users/u2", { displayName: "Bo", teamId: "AAA111", role: "coach" });
    fake.seed("memberships/BBB222_u2", member("BBB222", "u2"));
    const res = await call({ program: "frc", teamId: "BBB222", uid: "u2" });
    expect(res.status).toBe(200);
    expect(fake.read("users/u2")?.teamId).toBe("AAA111");
    expect(fake.read("users/u1")?.teamId).toBe("BBB222");
  });
  it("409 no_profile for a program where the account has no user document", async () => {
    fake.store.delete("programs/ftc/users/u1");
    const res = await call({ program: "ftc", teamId: "T2" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "no_profile" });
    expect(fake.read("programs/ftc/users/u1")).toBeUndefined();
  });
  it("409 membership_limit at 5 active teams when the current team has no membership yet", async () => {
    fake.seed("users/u1", { displayName: "Ann", teamId: "ZZZ999", role: "coach" });
    for (const t of ["BBB222", "A2", "A3", "A4", "A5"]) fake.seed(`memberships/${t}_u1`, member(t, "u1"));
    const res = await call({ program: "frc", teamId: "BBB222" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "membership_limit" });
  });
  it("a failed audit write does not undo or fail the switch", async () => {
    const real = fake.docRef.bind(fake);
    fake.docRef = ((path: string) => {
      const ref = real(path);
      if (path.startsWith("auditLog/")) ref.set = async () => Promise.reject(new Error("audit down"));
      return ref;
    }) as typeof fake.docRef;
    expect((await call({ program: "frc", teamId: "BBB222" })).status).toBe(200);
    expect(fake.read("users/u1")?.teamId).toBe("BBB222");
  });
  it("429 when the caller switches too often", async () => {
    let last = 200;
    for (let i = 0; i < 62; i++) last = (await call({ program: "frc", teamId: "BBB222" })).status;
    expect(last).toBe(429);
  });
});

describe("quota and failures", () => {
  it("a Firestore quota error (code 8) answers 503 quota_exceeded with a clear message, never a blank 500", async () => {
    fake.injectCommitFailure({ when: (paths) => paths.includes("users/u1"), error: Object.assign(new Error("8 RESOURCE_EXHAUSTED: Quota exceeded."), { code: 8 }) });
    const res = await call({ program: "frc", teamId: "BBB222" });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: "quota_exceeded" });
    expect(String(body.error)).toMatch(/usage limit|try again/i);
    expect(fake.read("users/u1")?.teamId).toBe("AAA111");
  });
  it("any other failure is a generic 500 that does not leak the message, and nothing is half-written", async () => {
    fake.injectCommitFailure({ when: (paths) => paths.includes("users/u1"), afterWrites: 1, error: new Error("secret internal detail") });
    const res = await call({ program: "frc", teamId: "BBB222" });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    expect(fake.read("users/u1")?.teamId).toBe("AAA111");
    expect(fake.read("memberships/AAA111_u1")).toBeUndefined();
  });
});
