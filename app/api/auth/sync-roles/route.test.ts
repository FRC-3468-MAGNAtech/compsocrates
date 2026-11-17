import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { resetMembershipsEnabledCache } from "@/lib/server/team-settings";
import { resetEnsureCaches } from "@/lib/server/memberships";

// The sign-in sync with the membership hook: OFF creates nothing, ON creates, and a failure of the hook never changes the sign-in answer.
const mocks = vi.hoisted(() => ({ verify: vi.fn(), db: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/server/require-user", () => ({ verifyBearerToken: mocks.verify, serverSignInProblem: () => null }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminFirestore: mocks.db, getAdminAuth: mocks.auth, getAdminFirestoreRest: () => null }));

import { POST } from "@/app/api/auth/sync-roles/route";

const call = () => POST(new Request("http://localhost/api/auth/sync-roles", { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: "{}" }));

let fake: FakeFirestore;
beforeEach(() => {
  fake = new FakeFirestore();
  fake.seed("teams/AAA111", { teamName: "Alpha", verifiedOwnerId: "someone-else" });
  fake.seed("users/u1", { displayName: "Ann", email: "ann@example.com", teamId: "AAA111", role: "match-scout", isTeamAdmin: false });
  fake.seed("programs/ftc/users/u1", { name: "Ann", teamId: "k3j9xq2m", primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false });
  resetMembershipsEnabledCache();
  resetEnsureCaches();
  mocks.verify.mockReset().mockResolvedValue({ uid: "u1", email: "ann@example.com", email_verified: true, name: "Ann" });
  mocks.auth.mockReset().mockReturnValue({ setCustomUserClaims: vi.fn().mockResolvedValue(undefined) });
  mocks.db.mockReset().mockImplementation(() => fake.asFirestore());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sign-in sync and memberships", () => {
  it("OFF (no settings document): the sync answers as before and no membership is created", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, changed: false });
    expect(fake.ids("memberships")).toEqual([]);
    expect(fake.ids("programs/ftc/memberships")).toEqual([]);
  });

  it("OFF (field false): the same", async () => {
    fake.seed("appSettings/global", { membershipsEnabled: false });
    await call();
    expect(fake.ids("memberships")).toEqual([]);
  });

  it("ON: a membership is created for each program where the account has a team, and the user documents are untouched", async () => {
    fake.seed("appSettings/global", { membershipsEnabled: true });
    const usersBefore = { root: fake.read("users/u1"), ftc: fake.read("programs/ftc/users/u1") };
    const res = await call();
    expect(res.status).toBe(200);
    expect(fake.read("memberships/AAA111_u1")).toMatchObject({ uid: "u1", teamId: "AAA111", origin: "pointer", status: "active", role: "match-scout" });
    expect(fake.read("programs/ftc/memberships/k3j9xq2m_u1")).toMatchObject({ uid: "u1", role: "match-scout", origin: "pointer" });
    expect({ root: fake.read("users/u1"), ftc: fake.read("programs/ftc/users/u1") }).toEqual(usersBefore);
  });

  it("ON: signing in again creates nothing new and changes nothing", async () => {
    fake.seed("appSettings/global", { membershipsEnabled: true });
    await call();
    const once = fake.read("memberships/AAA111_u1");
    resetEnsureCaches();
    await call();
    expect(fake.read("memberships/AAA111_u1")).toEqual(once);
  });

  it("ON, but the hook fails (the membership write is refused): sign-in still answers 200 with the same body", async () => {
    fake.seed("appSettings/global", { membershipsEnabled: true });
    fake.injectCommitFailure({ when: (paths) => paths.some((p) => p.includes("memberships/")), times: 5, error: Object.assign(new Error("8 RESOURCE_EXHAUSTED"), { code: 8 }) });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, changed: false });
    expect(fake.ids("memberships")).toEqual([]);
  });

  it("a pointer-less account is left alone", async () => {
    fake.seed("appSettings/global", { membershipsEnabled: true });
    fake.seed("users/u1", { displayName: "Ann", email: "ann@example.com", teamId: "", role: "match-scout" });
    fake.store.delete("programs/ftc/users/u1");
    expect((await call()).status).toBe(200);
    expect(fake.ids("memberships")).toEqual([]);
  });
});
