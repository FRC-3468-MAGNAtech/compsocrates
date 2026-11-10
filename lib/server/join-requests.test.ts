import { beforeEach, describe, expect, it, vi } from "vitest";

// config/cs.ts reads the owner uids at import time.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CS_OWNER_UIDS = "owner-uid";
});

import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { applyPendingApprovalForUser, deleteAccountData, processJoinRequest, requestToJoinTeam, teamLabelFor } from "@/lib/server/join-requests";

const NOW = 1_700_000_000_000;
let fake: FakeFirestore;
const db = () => fake.asFirestore();

beforeEach(() => {
  fake = new FakeFirestore();
  fake.seed("teams/ABC123", { teamName: "MAGNAtech", teamNumber: "3468", verifiedOwnerId: "owner-1", selectedEvents: ["2026arli"] });
  fake.seed("teams/XYZ789", { teamName: "", teamNumber: "254" });
  fake.seed("users/admin-1", { uid: "admin-1", displayName: "Admin", teamId: "ABC123", isTeamAdmin: true, role: "team-coach", roles: ["team-coach"] });
  fake.seed("users/member-1", { uid: "member-1", displayName: "Mem", teamId: "ABC123", isTeamAdmin: false });
  fake.seed("users/other-admin", { uid: "other-admin", displayName: "Other", teamId: "XYZ789", isTeamAdmin: true });
});

const asUser = (uid: string, over: Record<string, unknown> = {}) => ({ uid, email: `${uid}@x.org`, name: uid, ...over });

describe("requestToJoinTeam", () => {
  it("creates a CS-shaped user doc (teamId empty) and one pending request, without joining the team", async () => {
    const res = await requestToJoinTeam(db(), asUser("new-1"), { teamCode: "abc123", role: "pit-scout", name: "Ada Lovelace" }, NOW);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, alreadyPending: false, status: "pending", teamId: "ABC123", teamLabel: "MAGNAtech" });

    const user = fake.read("users/new-1");
    expect(user).toMatchObject({ uid: "new-1", displayName: "Ada Lovelace", role: "pit-scout", roles: ["pit-scout"], teamId: "", isTeamAdmin: false, profileComplete: true });
    const requestId = (res.body as { requestId: string }).requestId;
    expect(fake.read(`teamJoinRequests/${requestId}`)).toEqual({
      userId: "new-1",
      userEmail: "new-1@x.org",
      userEmailLower: "new-1@x.org",
      userName: "Ada Lovelace",
      userRole: "pit-scout",
      requestedRole: "pit-scout",
      teamId: "ABC123",
      status: "pending",
      createdAt: NOW,
      teamDisplayLabel: "MAGNAtech",
    });
  });

  it("answers 404 for an unknown code and 400 for junk, and counts every try", async () => {
    expect((await requestToJoinTeam(db(), asUser("n"), { teamCode: "NOPE99" }, NOW)).status).toBe(404);
    expect((await requestToJoinTeam(db(), asUser("n"), { teamCode: "a/b" }, NOW)).status).toBe(400);
    expect(fake.ids("rateLimits").length).toBeGreaterThan(0);
  });

  it("rate limits repeated tries", async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await requestToJoinTeam(db(), asUser("spam"), { teamCode: "NOPE99" }, NOW)).status;
    expect(last).toBe(429);
  });

  it("refuses someone who already has a team", async () => {
    const res = await requestToJoinTeam(db(), asUser("member-1"), { teamCode: "XYZ789" }, NOW);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("already-member");
    expect(fake.ids("teamJoinRequests")).toHaveLength(0);
  });

  it("is idempotent for a repeat request to the same team", async () => {
    const first = await requestToJoinTeam(db(), asUser("new-1"), { teamCode: "ABC123" }, NOW);
    const again = await requestToJoinTeam(db(), asUser("new-1"), { teamCode: "ABC123" }, NOW + 1);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ alreadyPending: true, requestId: (first.body as { requestId: string }).requestId });
    expect(fake.ids("teamJoinRequests")).toHaveLength(1);
  });

  it("keeps an existing team-less CS user doc untouched (unknown fields survive)", async () => {
    fake.seed("users/old-1", { uid: "old-1", displayName: "Old", role: "pit-team", teamId: "", encryptedUserData: "blob" });
    await requestToJoinTeam(db(), asUser("old-1"), { teamCode: "ABC123" }, NOW);
    expect(fake.read("users/old-1")).toEqual({ uid: "old-1", displayName: "Old", role: "pit-team", teamId: "", encryptedUserData: "blob" });
    const id = fake.ids("teamJoinRequests")[0];
    expect(fake.read(`teamJoinRequests/${id}`)).toMatchObject({ userName: "Old", requestedRole: "pit-team" });
  });
});

async function pendingRequestFor(uid: string, role = "pit-scout") {
  const res = await requestToJoinTeam(db(), asUser(uid), { teamCode: "ABC123", role, name: uid }, NOW);
  return (res.body as { requestId: string }).requestId;
}

describe("processJoinRequest", () => {
  it("a team admin approves: the user's teamId/role/roles are merged and the request is approved", async () => {
    fake.seed("users/new-1", { uid: "new-1", displayName: "New", teamId: "", role: "match-scout", roles: ["match-scout"], encryptedUserData: "blob", bio: "hi" });
    const id = await pendingRequestFor("new-1");
    const res = await processJoinRequest(db(), asUser("admin-1"), "approve", id, NOW + 10);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "approved", approvedUserId: "new-1", profileSyncPending: false });
    expect(fake.read("users/new-1")).toEqual({
      uid: "new-1",
      displayName: "New",
      teamId: "ABC123",
      role: "pit-scout",
      roles: ["pit-scout"],
      secondaryRoles: [],
      specialRole: null,
      specialRoles: [],
      isTeamAdmin: false,
      fieldTeamIds: ["ft-3468"], // P19: a new member starts on the account's FTC teams (CS teamNumber "3468")
      encryptedUserData: "blob",
      bio: "hi",
    });
    expect(fake.read(`teamJoinRequests/${id}`)).toMatchObject({ status: "approved", processedAt: NOW + 10, processedBy: "admin-1", profileSyncPending: false, profileSyncedAt: NOW + 10 });
  });

  it("a second approve is a 409, not a second write", async () => {
    const id = await pendingRequestFor("new-1");
    await processJoinRequest(db(), asUser("admin-1"), "approve", id, NOW);
    const again = await processJoinRequest(db(), asUser("admin-1"), "approve", id, NOW + 5);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("not-pending");
  });

  it("a platform owner can approve any team's request", async () => {
    const id = await pendingRequestFor("new-1");
    expect((await processJoinRequest(db(), asUser("owner-uid"), "approve", id, NOW)).status).toBe(200);
    expect(fake.read("users/new-1")).toMatchObject({ teamId: "ABC123" });
  });

  it("refuses members, other teams' admins and strangers, and changes nothing", async () => {
    const id = await pendingRequestFor("new-1");
    for (const uid of ["member-1", "other-admin", "stranger"]) {
      const res = await processJoinRequest(db(), asUser(uid), "approve", id, NOW);
      expect(res.status).toBe(403);
    }
    expect(fake.read(`teamJoinRequests/${id}`)).toMatchObject({ status: "pending" });
    expect(fake.read("users/new-1")).toMatchObject({ teamId: "" });
  });

  it("denies and cancels", async () => {
    const a = await pendingRequestFor("new-1");
    expect((await processJoinRequest(db(), asUser("admin-1"), "deny", a, NOW)).body).toMatchObject({ status: "denied" });
    expect(fake.read(`teamJoinRequests/${a}`)).toMatchObject({ status: "denied", processedBy: "admin-1" });

    const b = await pendingRequestFor("new-2");
    expect((await processJoinRequest(db(), asUser("admin-1"), "cancel", b, NOW)).status).toBe(403); // an admin denies, only the requester cancels
    const res = await processJoinRequest(db(), asUser("new-2"), "cancel", b, NOW + 2);
    expect(res.body).toMatchObject({ ok: true, status: "canceled" });
    expect(fake.read(`teamJoinRequests/${b}`)).toMatchObject({ status: "canceled", canceledByUser: true, processedBy: "new-2" });
    expect(fake.read("users/new-2")).toMatchObject({ teamId: "" });
  });

  it("a requester cannot cancel someone else's request", async () => {
    const id = await pendingRequestFor("new-1");
    expect((await processJoinRequest(db(), asUser("new-2"), "cancel", id, NOW)).status).toBe(403);
  });

  it("404s a missing request and 400s a missing id", async () => {
    expect((await processJoinRequest(db(), asUser("admin-1"), "approve", "nope", NOW)).status).toBe(404);
    expect((await processJoinRequest(db(), asUser("admin-1"), "approve", "", NOW)).status).toBe(400);
    expect((await processJoinRequest(db(), asUser("admin-1"), "approve", "a/b", NOW)).status).toBe(400);
  });

  it("will not move someone who has since joined another team", async () => {
    const id = await pendingRequestFor("new-1");
    fake.seed("users/new-1", { uid: "new-1", teamId: "XYZ789" });
    const res = await processJoinRequest(db(), asUser("admin-1"), "approve", id, NOW);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("already-on-team");
    expect(fake.read(`teamJoinRequests/${id}`)).toMatchObject({ status: "pending" });
  });

  it("recreates a missing requester doc on approval, with the approved team", async () => {
    fake.seed("teamJoinRequests/legacy1", { userId: "ghost", userEmail: "ghost.user@x.org", teamId: "abc123", status: "pending", createdAt: 5, role: "coach" });
    const res = await processJoinRequest(db(), asUser("admin-1"), "approve", "legacy1", NOW);
    expect(res.status).toBe(200);
    expect(fake.read("users/ghost")).toMatchObject({ uid: "ghost", email: "ghost.user@x.org", displayName: "Ghost User", teamId: "ABC123", role: "team-coach", roles: ["team-coach"], isTeamAdmin: false });
  });

  it("refuses to approve into a team that no longer exists", async () => {
    const id = await pendingRequestFor("new-1");
    fake.store.delete("teams/ABC123");
    expect((await processJoinRequest(db(), asUser("owner-uid"), "approve", id, NOW)).status).toBe(404);
  });
});

describe("teamLabelFor", () => {
  it("returns the CS label and needs no client rule", async () => {
    expect((await teamLabelFor(db(), asUser("u"), "abc123")).body).toEqual({ ok: true, exists: true, verified: true, label: "MAGNAtech" });
    expect((await teamLabelFor(db(), asUser("u"), "xyz789")).body).toMatchObject({ label: "Team 254" });
    expect((await teamLabelFor(db(), asUser("u"), "nope99")).body).toMatchObject({ exists: false, label: "Team NOPE99" });
    expect((await teamLabelFor(db(), asUser("u"), "")).status).toBe(400);
  });
});

describe("applyPendingApprovalForUser", () => {
  it("applies an approved request still marked profileSyncPending, and only that", async () => {
    fake.seed("users/late", { uid: "late", displayName: "Late", teamId: "", role: "match-scout", encryptedUserData: "x" });
    fake.seed("teamJoinRequests/r1", { userId: "late", teamId: "ABC123", requestedRole: "media", status: "approved", profileSyncPending: true, processedAt: 5 });
    expect(await applyPendingApprovalForUser(db(), "late", NOW)).toBe(true);
    expect(fake.read("users/late")).toMatchObject({ teamId: "ABC123", role: "media", roles: ["media"], encryptedUserData: "x" });
    expect(fake.read("teamJoinRequests/r1")).toMatchObject({ profileSyncPending: false, profileSyncedAt: NOW });
    expect(await applyPendingApprovalForUser(db(), "late", NOW)).toBe(false);
  });

  it("never re-adds someone whose approval was already synced (an admin removed them since)", async () => {
    fake.seed("users/removed", { uid: "removed", teamId: "" });
    fake.seed("teamJoinRequests/r1", { userId: "removed", teamId: "ABC123", status: "approved", profileSyncPending: false });
    expect(await applyPendingApprovalForUser(db(), "removed", NOW)).toBe(false);
    expect(fake.read("users/removed")).toMatchObject({ teamId: "" });
  });
});

describe("deleteAccountData", () => {
  it("removes the user's join requests and doc", async () => {
    await pendingRequestFor("new-1");
    await pendingRequestFor("new-2");
    expect((await deleteAccountData(db(), asUser("new-1"))).status).toBe(200);
    expect(fake.read("users/new-1")).toBeUndefined();
    const left = fake.ids("teamJoinRequests").map((id) => fake.read(`teamJoinRequests/${id}`)?.userId);
    expect(left).toEqual(["new-2"]);
    expect(fake.read("users/new-2")).toBeDefined();
  });

  it("will not orphan a team: its owner can't delete while members remain", async () => {
    fake.seed("users/owner-1", { uid: "owner-1", teamId: "ABC123", isTeamAdmin: true });
    const res = await deleteAccountData(db(), asUser("owner-1"));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("owns-team");
    expect(fake.read("users/owner-1")).toBeDefined();
  });

  it("lets a sole owner delete", async () => {
    fake.seed("users/solo", { uid: "solo", teamId: "SOLO11" });
    fake.seed("teams/SOLO11", { teamName: "Solo", verifiedOwnerId: "solo" });
    expect((await deleteAccountData(db(), asUser("solo"))).status).toBe(200);
    expect(fake.read("users/solo")).toBeUndefined();
  });
});
