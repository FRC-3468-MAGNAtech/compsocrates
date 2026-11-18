import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.RELEASE_OWNER_UIDS = "owner-uid";
});

import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { claimFreeTeamCode } from "@/lib/server/team-create";
import { syncRolesForCaller, type SyncRolesInput } from "@/lib/server/sync-roles";

let fake: FakeFirestore;
const db = () => fake.asFirestore();

beforeEach(() => {
  fake = new FakeFirestore();
});

describe("claimFreeTeamCode (a new team's join code, per program)", () => {
  it("picks a free code of the program's own length inside the transaction", async () => {
    for (const [program, length] of [["frc", 6], ["ftc", 8]] as const) {
      const code = await db().runTransaction((txn) => claimFreeTeamCode(db(), txn as never, Math.random, program));
      expect(code).toMatch(new RegExp(`^[A-Z2-9]{${length}}$`));
    }
  });

  it("skips a code that is already taken in THAT program (collision check)", async () => {
    // rng that yields "AAAAAA" for the first candidate, then distinct codes: AAAAAA is taken in the root program only.
    fake.seed("teams/AAAAAA", { teamName: "taken" });
    let calls = 0;
    const rng = () => (calls++ < 6 ? 0 : (calls % 20) / 20);
    const root = await db().runTransaction((txn) => claimFreeTeamCode(db(), txn as never, rng, "frc"));
    expect(root).not.toBe("AAAAAA");
    calls = 0;
    const other = await db().runTransaction((txn) => claimFreeTeamCode(db(), txn as never, rng, "ftc"));
    // The other program's collection is its own: the root team "AAAAAA" does not block its first candidate.
    expect(other).toMatch(/^AAAAAA[A-Z2-9]{2}$/);
  });

  it("reports a collision when every candidate is taken", async () => {
    for (const c of ["AAAAAA"]) fake.seed(`teams/${c}`, { teamName: "taken" });
    expect(await db().runTransaction((txn) => claimFreeTeamCode(db(), txn as never, () => 0, "frc"))).toBeNull();
  });
});

describe("syncRolesForCaller", () => {
  const claims: { platformOwner?: boolean; admin?: boolean }[] = [];
  const base = (over: Partial<SyncRolesInput> = {}): SyncRolesInput => ({
    uid: "u1",
    email: "u1@x.org",
    emailVerified: true,
    name: "U One",
    isOwnerEmail: false,
    claims: {},
    setClaims: async (c) => void claims.push(c),
    ownerUids: ["owner-uid"],
    ...over,
  });
  beforeEach(() => {
    claims.length = 0;
    fake.seed("teams/ABC123", { teamName: "T", teamNumber: "1", verifiedOwnerId: "boss" });
    fake.seed("users/u1", { uid: "u1", displayName: "U One", teamId: "ABC123", role: "pit-scout", roles: ["pit-scout"], encryptedUserData: "blob" });
  });

  it("changes nothing for an ordinary member", async () => {
    expect(await syncRolesForCaller(db(), base())).toEqual({ changed: false });
    expect(fake.read("users/u1")).toEqual({ uid: "u1", displayName: "U One", teamId: "ABC123", role: "pit-scout", roles: ["pit-scout"], encryptedUserData: "blob" });
  });

  it("a verified RELEASE_OWNER_EMAILS owner gets isPlatformOwner and isTeamAdmin (never isAdmin) and keeps the other fields", async () => {
    const res = await syncRolesForCaller(db(), base({ isOwnerEmail: true }));
    expect(res.changed).toBe(true);
    expect(fake.read("users/u1")).toMatchObject({ isPlatformOwner: true, isTeamAdmin: true, encryptedUserData: "blob", role: "pit-scout" });
    expect(fake.read("users/u1")).not.toHaveProperty("isAdmin");
    expect(claims).toEqual([{ platformOwner: true, admin: true }]);
  });

  it("an unverified email gets nothing, and an unverified owner email is told to verify", async () => {
    const res = await syncRolesForCaller(db(), base({ emailVerified: false, isOwnerEmail: true }));
    expect(res).toEqual({ changed: false, ownerPendingVerification: true });
    expect(fake.read("users/u1")).not.toHaveProperty("isTeamAdmin");
  });

  it("a CS owner uid is a platform owner and an admin without any email check", async () => {
    fake.seed("users/owner-uid", { uid: "owner-uid", teamId: "ABC123" });
    await syncRolesForCaller(db(), base({ uid: "owner-uid", emailVerified: false, email: null }));
    expect(fake.read("users/owner-uid")).toMatchObject({ isPlatformOwner: true, isTeamAdmin: true });
  });

  it("never revokes an admin", async () => {
    fake.seed("users/u1", { uid: "u1", teamId: "ABC123", isTeamAdmin: true });
    expect(await syncRolesForCaller(db(), base({ claims: { admin: true } }))).toEqual({ changed: false });
    expect(fake.read("users/u1")).toMatchObject({ isTeamAdmin: true });
  });

  it("applies a pending approval at sign-in", async () => {
    fake.seed("users/late", { uid: "late", teamId: "" });
    fake.seed("teamJoinRequests/r1", { userId: "late", teamId: "ABC123", requestedRole: "media", status: "approved", profileSyncPending: true });
    const res = await syncRolesForCaller(db(), base({ uid: "late" }));
    expect(res.changed).toBe(true);
    expect(fake.read("users/late")).toMatchObject({ teamId: "ABC123", role: "media" });
  });

  it("bootstraps verifiedOwnerId only for an ownerless team, for a platform owner member", async () => {
    fake.seed("teams/NOOWNR", { teamName: "No owner" });
    fake.seed("users/owner-uid", { uid: "owner-uid", teamId: "NOOWNR" });
    await syncRolesForCaller(db(), base({ uid: "owner-uid" }));
    expect(fake.read("teams/NOOWNR")).toMatchObject({ verifiedOwnerId: "owner-uid" });
    // a team that has an owner is never reassigned
    fake.seed("users/owner-uid", { uid: "owner-uid", teamId: "ABC123" });
    await syncRolesForCaller(db(), base({ uid: "owner-uid" }));
    expect(fake.read("teams/ABC123")).toMatchObject({ verifiedOwnerId: "boss" });
  });

  it("attaches a platform owner with no profile to the only team, CS-shaped", async () => {
    const solo = new FakeFirestore().seed("teams/ONLY11", { teamName: "Only", teamNumber: "9" });
    const res = await syncRolesForCaller(solo.asFirestore(), base({ uid: "owner-uid", email: "o@x.org", name: "Owner" }));
    expect(res).toEqual({ changed: true, attached: true });
    expect(solo.read("users/owner-uid")).toMatchObject({ uid: "owner-uid", displayName: "Owner", teamId: "ONLY11", isTeamAdmin: true, isPlatformOwner: true });
  });
});

describe("syncRolesForCaller owner mirror", () => {
  const noop: SyncRolesInput["setClaims"] = async () => {};
  const input = (uid: string): SyncRolesInput => ({ uid, email: `${uid}@x.org`, emailVerified: true, name: uid, isOwnerEmail: false, claims: { admin: true }, setClaims: noop, ownerUids: [] });

  it("sets the owner mirror for the team's verifiedOwnerId and clears a stale one", async () => {
    fake.seed("teams/ABC123", { teamName: "T", verifiedOwnerId: "boss" });
    fake.seed("users/boss", { uid: "boss", teamId: "ABC123", role: "team-coach" });
    fake.seed("users/old", { uid: "old", teamId: "ABC123", isOwner: true, isTeamAdmin: true });
    await syncRolesForCaller(db(), { ...input("boss"), claims: { admin: false } });
    await syncRolesForCaller(db(), input("old"));
    expect(fake.read("users/boss")).toMatchObject({ isOwner: true, isTeamAdmin: true });
    expect(fake.read("users/old")).toMatchObject({ isOwner: false, isTeamAdmin: true });
  });
});
