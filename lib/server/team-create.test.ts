import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CS_OWNER_UIDS = "owner-uid";
});

import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { createTeamForCaller } from "@/lib/server/team-create";
import { syncRolesForCaller, type SyncRolesInput } from "@/lib/server/sync-roles";

const NOW = 1_700_000_000_000;
let fake: FakeFirestore;
const db = () => fake.asFirestore();
const caller = (uid: string) => ({ uid, email: `${uid}@x.org`, name: uid });

beforeEach(() => {
  fake = new FakeFirestore();
});

describe("createTeamForCaller", () => {
  beforeEach(() => {
    fake.seed("appSettings/global", { teamCreationEnabled: true });
  });

  it("writes a CS-shaped team doc under an uppercase code and makes the caller owner and admin", async () => {
    const res = await createTeamForCaller(db(), caller("u1"), { teamNumber: "3468", teamName: " MAGNAtech ", name: "Ada" }, NOW);
    expect(res.status).toBe(200);
    const code = (res.body as { joinCode: string }).joinCode;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);

    expect(fake.read(`teams/${code}`)).toEqual({
      teamName: "MAGNAtech",
      teamNumber: "3468",
      verifiedOwnerId: "u1",
      selectedEvents: [],
      createdAt: NOW,
      fieldTeams: [{ id: "ft-3468", number: 3468, name: "MAGNAtech" }],
      fieldTeamIdList: ["ft-3468"],
      fieldTeamNumbers: [3468],
    });
    expect(fake.read("users/u1")).toMatchObject({ uid: "u1", displayName: "Ada", teamId: code, role: "match-scout", roles: ["match-scout"], secondaryRoles: [], isTeamAdmin: true, isOwner: true, fieldTeamIds: ["ft-3468"], profileComplete: true });
    expect(fake.read("appSettings/global")).toEqual({ teamCreationEnabled: false });
  });

  it("merges into an existing team-less CS user doc and keeps its other fields", async () => {
    fake.seed("users/u1", { uid: "u1", displayName: "Ada", teamId: "", role: "lead-scout", roles: ["lead-scout"], encryptedUserData: "blob", bio: "hi" });
    const res = await createTeamForCaller(db(), caller("u1"), { teamNumber: 254 }, NOW);
    const code = (res.body as { joinCode: string }).joinCode;
    expect(fake.read("users/u1")).toMatchObject({ displayName: "Ada", encryptedUserData: "blob", bio: "hi", teamId: code, role: "lead-scout", isTeamAdmin: true });
  });

  it("rejects when disabled, when already on a team, and on a bad number", async () => {
    expect((await createTeamForCaller(db(), caller("u1"), { teamNumber: "abc" }, NOW)).status).toBe(400);
    fake.seed("users/member", { uid: "member", teamId: "ABC123" });
    expect((await createTeamForCaller(db(), caller("member"), { teamNumber: 1 }, NOW)).status).toBe(409);
    fake.seed("appSettings/global", { teamCreationEnabled: false });
    expect((await createTeamForCaller(db(), caller("u2"), { teamNumber: 1 }, NOW)).status).toBe(403);
    expect(fake.ids("teams")).toHaveLength(0);
  });

  it("skips a code that is already taken (collision check)", async () => {
    // rng that yields "AAAAAA" for the first candidate, then distinct codes: seed AAAAAA as taken.
    fake.seed("teams/AAAAAA", { teamName: "taken" });
    let n = 0;
    const random = () => (n++ < 6 ? 0 : 0.5); // first candidate AAAAAA (taken); the rest are a different code
    const res = await createTeamForCaller(db(), caller("u1"), { teamNumber: 7 }, NOW, random);
    expect(res.status).toBe(200);
    const code = (res.body as { joinCode: string }).joinCode;
    expect(code).not.toBe("AAAAAA");
    expect(fake.read("teams/AAAAAA")).toEqual({ teamName: "taken" });
  });

  it("reports a collision when every candidate is taken", async () => {
    fake.seed("teams/AAAAAA", { teamName: "taken" });
    const res = await createTeamForCaller(db(), caller("u1"), { teamNumber: 7 }, NOW, () => 0);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("code-collision");
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
    isAdminEmail: false,
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

  it("ADMIN_EMAILS grants isTeamAdmin (never isAdmin) and keeps the other fields", async () => {
    const res = await syncRolesForCaller(db(), base({ isAdminEmail: true }));
    expect(res.changed).toBe(true);
    expect(fake.read("users/u1")).toMatchObject({ isTeamAdmin: true, encryptedUserData: "blob", role: "pit-scout" });
    expect(fake.read("users/u1")).not.toHaveProperty("isAdmin");
    expect(claims).toEqual([{ platformOwner: false, admin: true }]);
  });

  it("an unverified email gets nothing, and an unverified owner email is told to verify", async () => {
    const res = await syncRolesForCaller(db(), base({ emailVerified: false, isOwnerEmail: true, isAdminEmail: true }));
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
  const input = (uid: string): SyncRolesInput => ({ uid, email: `${uid}@x.org`, emailVerified: true, name: uid, isOwnerEmail: false, isAdminEmail: false, claims: { admin: true }, setClaims: noop, ownerUids: [] });

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
