import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { resetMembershipsEnabledCache } from "@/lib/server/team-settings";

// Token verification, the Admin SDK and every outside service are mocked: this is the route's own rules (program, open or closed, the per-program checks).
const mocks = vi.hoisted(() => ({ verify: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/server/require-user", () => ({ verifyBearerToken: mocks.verify, serverSignInProblem: () => null }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminFirestore: mocks.db, getAdminAuth: () => ({ getUser: async () => ({ metadata: { creationTime: new Date(0).toUTCString() } }) }), getAdminFirestoreRest: () => null }));
vi.mock("@/lib/server/rate-limit", () => ({ consumeRateLimit: async () => ({ allowed: true, count: 1 }) }));
vi.mock("@/lib/server/turnstile", () => ({ verifyTurnstile: async () => ({ configured: false, ok: true }) }));
vi.mock("@/lib/server/application-token", () => ({ checkStartToken: () => ({ ok: true, ageMs: 30_000 }) }));
vi.mock("@/lib/server/app-secret", () => ({ hashValue: (_k: string, v: string) => `h-${v.replace(/[^a-z0-9]/gi, "").slice(0, 10)}` }));
vi.mock("@/lib/server/client-ip", () => ({ clientIp: () => "1.2.3.4" }));
const lookups = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/lib/server/first-team", () => ({
  lookupTeamForApplication: async (program: string, n: number) => {
    lookups.calls.push(`${program}:${n}`);
    return { season: 2026, status: "not-found", officialName: null, nameMatches: null, enteredName: "" };
  },
}));
vi.mock("@/lib/server/notify-platform-owners", () => ({ notifyPlatformOwnersOfApplication: async () => {} }));
vi.mock("@/lib/server/email", () => ({ sendEmail: async () => {}, appBaseUrl: () => "http://localhost", platformOwnerEmails: () => [] }));

import { POST as submit } from "@/app/api/applications/route";
import { POST as createTeam } from "@/app/api/team/create/route";

const BODY = { name: "Ada Lovelace", teamNumber: "3468", teamName: "MAGNAtech", role: "lead-scout", verification: "We are the school robotics club, see our page.", link: "", startToken: "t", orgUrl: "" };
const call = (body: unknown) => submit(new Request("http://localhost/api/applications", { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: JSON.stringify(body) }));
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

let fake: FakeFirestore;
beforeEach(() => {
  fake = new FakeFirestore();
  fake.seed("appSettings/global", { teamCreationEnabled: true });
  resetMembershipsEnabledCache();
  lookups.calls.length = 0;
  mocks.verify.mockReset().mockResolvedValue({ uid: "a1", email: "ada@example.org", email_verified: true, firebase: { sign_in_provider: "password" } });
  mocks.db.mockReset().mockImplementation(() => fake.asFirestore());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/applications: the program is REQUIRED", () => {
  it("400 when it is missing or unknown, and nothing is written", async () => {
    for (const program of [undefined, "", "nope", 7]) {
      const res = await call({ ...BODY, ...(program === undefined ? {} : { program }) });
      expect(res.status).toBe(400);
    }
    expect(fake.ids("teamApplications")).toEqual([]);
    expect(fake.ids("programs/ftc/teamApplications")).toEqual([]);
  });

  it.each([
    ["frc", "teamApplications", "applicationPrivate", "platformAuditLog"],
    ["ftc", "programs/ftc/teamApplications", "programs/ftc/applicationPrivate", "programs/ftc/platformAuditLog"],
  ])("%s: files the application, its private signals and the audit entry in THAT program's collections only", async (program, apps, priv, audit) => {
    const res = await call({ ...BODY, program });
    expect(res.status).toBe(200);
    const id = (await json(res)).applicationId as string;
    expect(fake.read(`${apps}/${id}`)).toMatchObject({ program, applicantUid: "a1", status: "pending", teamNumber: 3468 });
    expect(fake.read(`${priv}/${id}`)).toBeDefined();
    expect(fake.ids(audit)).toHaveLength(1);
    const other = program === "frc" ? "programs/ftc/teamApplications" : "teamApplications";
    expect(fake.ids(other)).toEqual([]);
    expect(lookups.calls).toEqual([`${program}:3468`]);
  });
});

describe("POST /api/applications: open and closed", () => {
  it("closed (false, missing field, missing document) answers 403 applications_closed in BOTH programs, and writes nothing", async () => {
    for (const settings of [{ teamCreationEnabled: false }, {}, null]) {
      fake = new FakeFirestore();
      if (settings) fake.seed("appSettings/global", settings);
      mocks.db.mockImplementation(() => fake.asFirestore());
      for (const program of ["frc", "ftc"]) {
        const res = await call({ ...BODY, program });
        expect(res.status).toBe(403);
        expect(await json(res)).toMatchObject({ ok: false, code: "applications_closed" });
      }
      expect(fake.ids("teamApplications")).toEqual([]);
      expect(fake.ids("programs/ftc/teamApplications")).toEqual([]);
    }
  });

  it("a rejected application (validation, duplicate, taken number, already a member, blocked) writes nothing", async () => {
    expect((await call({ ...BODY, program: "ftc", name: "" })).status).toBe(400);
    expect((await call({ ...BODY, program: "ftc" })).status).toBe(200);
    expect((await call({ ...BODY, program: "ftc" })).status).toBe(409); // one pending per applicant and number
    expect(fake.ids("programs/ftc/teamApplications")).toHaveLength(1);
  });
});

describe("POST /api/applications: the checks are per program", () => {
  it("a team number some account has IN THAT PROGRAM answers 409 account-exists; the other program's team does not block", async () => {
    fake.seed("programs/ftc/teams/EXIST123", { number: 3468, name: "x" });
    const ftc = await call({ ...BODY, program: "ftc" });
    expect(ftc.status).toBe(409);
    expect(await json(ftc)).toMatchObject({ code: "account-exists" });
    const frc = await call({ ...BODY, program: "frc" });
    expect(frc.status).toBe(200);
  });

  it("the FRC number is matched as the string the root teams store", async () => {
    fake.seed("teams/EXIST1", { teamNumber: "3468", teamName: "x" });
    expect((await call({ ...BODY, program: "frc" })).status).toBe(409);
    expect((await call({ ...BODY, program: "ftc" })).status).toBe(200);
  });

  it("blocks are per program: a block in one does not stop an application in the other", async () => {
    fake.seed("applicationBlocks/team_3468", { type: "team" });
    expect((await call({ ...BODY, program: "frc" })).status).toBe(403);
    expect((await call({ ...BODY, program: "ftc" })).status).toBe(200);
  });

  it("memberships OFF: an account that already has a team in the program is refused (409 already-member); the other program is not affected", async () => {
    fake.seed("users/a1", { teamId: "ROOT01" });
    expect((await call({ ...BODY, program: "frc" })).status).toBe(409);
    expect((await call({ ...BODY, program: "ftc" })).status).toBe(200);
  });

  it("memberships ON: an account that already has a team may apply for another", async () => {
    fake.seed("appSettings/global", { teamCreationEnabled: true, membershipsEnabled: true });
    fake.seed("users/a1", { teamId: "ROOT01" });
    expect((await call({ ...BODY, program: "frc" })).status).toBe(200);
  });

  it("a person with an EMPTY team id here is not 'on a team'", async () => {
    fake.seed("programs/ftc/users/a1", { name: "Ada", teamId: "" });
    expect((await call({ ...BODY, program: "ftc" })).status).toBe(200);
  });

  it("needs a signed-in person with a verified email", async () => {
    mocks.verify.mockResolvedValue(null);
    expect((await call({ ...BODY, program: "frc" })).status).toBe(401);
    mocks.verify.mockResolvedValue({ uid: "a1", email: "a@x.org", email_verified: false });
    expect((await call({ ...BODY, program: "frc" })).status).toBe(403);
  });
});

describe("POST /api/team/create is retired", () => {
  it("answers 410 for everyone, in both programs, and writes nothing (no team, no user, and no switch change)", async () => {
    for (const program of [undefined, "frc", "ftc"]) {
      const res = await createTeam(new Request("http://localhost/api/team/create", { method: "POST", headers: { authorization: "Bearer x" }, body: JSON.stringify({ teamNumber: 1, program }) }));
      expect(res.status).toBe(410);
      expect(await json(res)).toMatchObject({ ok: false, code: "gone" });
    }
    expect(fake.ids("teams")).toEqual([]);
    expect(fake.ids("users")).toEqual([]);
    expect(fake.read("appSettings/global")).toEqual({ teamCreationEnabled: true });
  });
});
