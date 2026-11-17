import { describe, expect, it } from "vitest";
import {
  buildApprovalUserPatch,
  buildBaseUserDoc,
  buildCreatorUserPatch,
  buildJoinRequestDoc,
  buildNewTeamDoc,
  buildRequestOutcomePatch,
  canRequestToJoin,
  decideJoinRequest,
  deriveJoinRequestName,
  formatTeamLabel,
  generateTeamCode,
  isFallbackCodeLabel,
  isTeamAdminOf,
  isValidTeamCode,
  normalizeTeamCode,
  ownerUidOfTeam,
  pickFreeTeamCode,
  readJoinRequest,
  readJoinRequestStatus,
  TEAM_CODE_ALPHABET,
  type ActorContext,
  type JoinRequest,
} from "@/data/cs/join-requests";

const OWNER = "owner-uid";
const admin = (teamId: string, uid = "admin-1"): ActorContext => ({ uid, user: { teamId, isTeamAdmin: true }, ownerUids: [OWNER] });
const member = (teamId: string, uid = "member-1"): ActorContext => ({ uid, user: { teamId, isTeamAdmin: false }, ownerUids: [OWNER] });
const pending = (over: Partial<JoinRequest> = {}): Pick<JoinRequest, "status" | "userId" | "teamId"> => ({ status: "pending", userId: "u1", teamId: "ABC123", ...over });

describe("team codes", () => {
  it("normalizes to trimmed uppercase", () => {
    expect(normalizeTeamCode("  ab12cd ")).toBe("AB12CD");
    expect(normalizeTeamCode(undefined)).toBe("");
  });
  it("validates doc-id safe codes", () => {
    expect(isValidTeamCode("ABC123")).toBe(true);
    expect(isValidTeamCode("AB")).toBe(false);
    expect(isValidTeamCode("A/B123")).toBe(false);
    expect(isValidTeamCode("ab c")).toBe(false);
  });
  it("generates uppercase codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateTeamCode();
      expect(code).toHaveLength(6);
      expect([...code].every((c) => TEAM_CODE_ALPHABET.includes(c))).toBe(true);
    }
    expect(TEAM_CODE_ALPHABET).not.toMatch(/[01OI]/);
  });
  it("is deterministic with an injected rng", () => {
    expect(generateTeamCode(() => 0)).toBe("AAAAAA");
    expect(generateTeamCode(() => 0.999999)).toBe("999999".replace(/9/g, "9"));
  });
  it("retries on collision and gives up after the attempt limit", async () => {
    const seen: string[] = [];
    let n = 0;
    const code = await pickFreeTeamCode((c) => {
      seen.push(c);
      return ++n < 3; // first two collide
    });
    expect(seen).toHaveLength(3);
    expect(code).toBe(seen[2]);
    expect(await pickFreeTeamCode(() => true, Math.random, 4)).toBeNull();
  });
});

describe("team labels (CS /api/team-label formatLabel)", () => {
  it("prefers the name, then the number, then the code", () => {
    expect(formatTeamLabel("abc", "MAGNAtech", "3468")).toBe("MAGNAtech");
    expect(formatTeamLabel("abc", "", "3468")).toBe("Team 3468");
    expect(formatTeamLabel("abc", "  ", "")).toBe("Team ABC");
    expect(formatTeamLabel("abc", "254", "")).toBe("Team 254");
  });
  it("recognizes the code-only fallback", () => {
    expect(isFallbackCodeLabel("Team ABC123", "abc123")).toBe(true);
    expect(isFallbackCodeLabel("ABC123", "ABC123")).toBe(true);
    expect(isFallbackCodeLabel("Team 254", "ABC123")).toBe(false);
  });
});

describe("join request reading", () => {
  it("reads status, including CS's denied+canceledByUser spelling of cancel", () => {
    expect(readJoinRequestStatus({})).toBe("pending");
    expect(readJoinRequestStatus({ status: "pending" })).toBe("pending");
    expect(readJoinRequestStatus({ status: "approved" })).toBe("approved");
    expect(readJoinRequestStatus({ status: "denied" })).toBe("denied");
    expect(readJoinRequestStatus({ status: "denied", canceledByUser: true })).toBe("canceled");
    expect(readJoinRequestStatus({ status: "canceled" })).toBe("canceled");
    expect(readJoinRequestStatus({ status: "weird" })).toBe("denied");
  });
  it("derives a display name when the row has none", () => {
    expect(deriveJoinRequestName({ userName: "Ada Lovelace" })).toBe("Ada Lovelace");
    expect(deriveJoinRequestName({ userName: "User ab12cd34", userEmail: "ada.lovelace42@x.org" })).toBe("Ada Lovelace");
    expect(deriveJoinRequestName({ userId: "abcdef123456" })).toBe("User abcdef12");
  });
  it("normalizes a minimal legacy row", () => {
    const r = readJoinRequest("r1", { userId: "u1", teamId: "abc123", role: "coach", createdAt: 1000 });
    expect(r).toMatchObject({ id: "r1", userId: "u1", teamId: "ABC123", requestedRole: "team-coach", status: "pending", createdAtMs: 1000 });
  });
  it("builds the full CS payload with epoch-ms createdAt and no code-only label", () => {
    const doc = buildJoinRequestDoc({ userId: "u1", userEmail: "A@B.org", userName: "Ada", requestedRole: "pit-scout", teamId: "abc123", teamDisplayLabel: "Team ABC123" }, 5);
    expect(doc).toEqual({
      userId: "u1",
      userEmail: "A@B.org",
      userEmailLower: "a@b.org",
      userName: "Ada",
      userRole: "pit-scout",
      requestedRole: "pit-scout",
      teamId: "ABC123",
      status: "pending",
      createdAt: 5,
    });
    expect(buildJoinRequestDoc({ userId: "u1", userEmail: "a@b.org", userName: "Ada", requestedRole: "bogus", teamId: "X1Y", teamDisplayLabel: "MAGNAtech" }, 5)).toMatchObject({ requestedRole: "match-scout", teamDisplayLabel: "MAGNAtech" });
  });
});

describe("decideJoinRequest (state machine + permissions)", () => {
  it("lets a team admin approve and deny a pending request for their team", () => {
    expect(decideJoinRequest(pending(), "approve", admin("ABC123"))).toEqual({ ok: true, next: "approved" });
    expect(decideJoinRequest(pending(), "deny", admin("abc123"))).toEqual({ ok: true, next: "denied" });
  });
  it("treats a legacy coach role as an admin", () => {
    const coach: ActorContext = { uid: "c", user: { teamId: "ABC123", role: "coach" }, ownerUids: [OWNER] };
    expect(decideJoinRequest(pending(), "approve", coach)).toEqual({ ok: true, next: "approved" });
  });
  it("lets a platform owner process any team's request", () => {
    expect(decideJoinRequest(pending(), "approve", { uid: OWNER, user: null, ownerUids: [OWNER] })).toEqual({ ok: true, next: "approved" });
  });
  it("refuses a plain member, an admin of another team, and a signed-in nobody", () => {
    expect(decideJoinRequest(pending(), "approve", member("ABC123"))).toMatchObject({ ok: false, code: "not-allowed" });
    expect(decideJoinRequest(pending(), "approve", admin("OTHER1"))).toMatchObject({ ok: false, code: "wrong-team" });
    expect(decideJoinRequest(pending(), "deny", { uid: "x", user: null, ownerUids: [OWNER] })).toMatchObject({ ok: false, code: "not-allowed" });
  });
  it("only the requester can cancel, never an admin", () => {
    expect(decideJoinRequest(pending(), "cancel", { uid: "u1", user: { teamId: "" }, ownerUids: [OWNER] })).toEqual({ ok: true, next: "canceled" });
    expect(decideJoinRequest(pending(), "cancel", admin("ABC123"))).toMatchObject({ ok: false, code: "not-requester" });
    expect(decideJoinRequest(pending(), "cancel", { uid: OWNER, user: null, ownerUids: [OWNER] })).toMatchObject({ ok: false, code: "not-requester" });
  });
  it("only a pending request can move (idempotent double click)", () => {
    for (const status of ["approved", "denied", "canceled"] as const) {
      expect(decideJoinRequest(pending({ status }), "approve", admin("ABC123"))).toMatchObject({ ok: false, code: "not-pending" });
      expect(decideJoinRequest(pending({ status }), "cancel", { uid: "u1", user: null })).toMatchObject({ ok: false, code: "not-pending" });
    }
  });
  it("rejects a request with no user or team", () => {
    expect(decideJoinRequest(pending({ userId: "" }), "approve", admin("ABC123"))).toMatchObject({ ok: false, code: "bad-request" });
    expect(decideJoinRequest(pending({ teamId: "" }), "approve", admin("ABC123"))).toMatchObject({ ok: false, code: "bad-request" });
  });
  it("isTeamAdminOf needs the same team and an admin flag", () => {
    expect(isTeamAdminOf(admin("ABC123"), "abc123")).toBe(true);
    expect(isTeamAdminOf(member("ABC123"), "ABC123")).toBe(false);
    expect(isTeamAdminOf(admin("ABC123"), "")).toBe(false);
  });
});

describe("canRequestToJoin", () => {
  it("blocks users who already have a team", () => {
    expect(canRequestToJoin({ user: { teamId: "ABC123" }, teamId: "XYZ", existing: [] })).toMatchObject({ ok: false, code: "already-member" });
  });
  it("blocks a duplicate pending request but allows one after a decision", () => {
    expect(canRequestToJoin({ user: { teamId: "" }, teamId: "abc123", existing: [{ teamId: "ABC123", status: "pending" }] })).toMatchObject({ ok: false, code: "duplicate" });
    expect(canRequestToJoin({ user: { teamId: "" }, teamId: "ABC123", existing: [{ teamId: "ABC123", status: "denied" }] })).toEqual({ ok: true });
    expect(canRequestToJoin({ user: null, teamId: "ABC123", existing: [] })).toEqual({ ok: true });
  });
});

describe("documents written by the server", () => {
  it("base user doc is CS-shaped (teamId empty, profileComplete)", () => {
    const doc = buildBaseUserDoc({ uid: "u1", email: "a@b.org", displayName: "Ada" }, 9);
    expect(doc).toMatchObject({ uid: "u1", displayName: "Ada", role: "match-scout", roles: ["match-scout"], secondaryRoles: [], teamId: "", isTeamAdmin: false, profileComplete: true, createdAt: 9 });
    expect(doc).not.toHaveProperty("encryptedUserData");
  });
  it("approval patch sets team and roles and nothing else unknown", () => {
    const patch = buildApprovalUserPatch({ teamId: "ABC123", requestedRole: "pit-scout" });
    expect(patch).toEqual({ teamId: "ABC123", role: "pit-scout", roles: ["pit-scout"], secondaryRoles: [], specialRole: null, specialRoles: [], isTeamAdmin: false });
    expect(Object.keys(patch)).not.toContain("encryptedUserData");
  });
  it("outcome patches mirror CS (epoch ms, canceledByUser, profileSyncPending)", () => {
    expect(buildRequestOutcomePatch("approved", "adm", 7, { userName: "Ada" })).toEqual({ status: "approved", processedAt: 7, processedBy: "adm", profileSyncPending: false, profileSyncedAt: 7, userName: "Ada" });
    expect(buildRequestOutcomePatch("approved", "adm", 7, { profileSyncPending: true })).toEqual({ status: "approved", processedAt: 7, processedBy: "adm", profileSyncPending: true });
    expect(buildRequestOutcomePatch("canceled", "u1", 7)).toEqual({ status: "canceled", processedAt: 7, processedBy: "u1", canceledByUser: true });
    expect(buildRequestOutcomePatch("denied", "adm", 7)).toEqual({ status: "denied", processedAt: 7, processedBy: "adm" });
  });
  it("new team doc: string teamNumber, verifiedOwnerId, empty selectedEvents", () => {
    const team = buildNewTeamDoc({ teamNumber: 3468, teamName: " MAGNAtech ", ownerUid: "u1" }, 11);
    expect(team).toEqual({ teamName: "MAGNAtech", teamNumber: "3468", verifiedOwnerId: "u1", selectedEvents: [], createdAt: 11 });
    expect(team).not.toHaveProperty("number");
    expect(team).not.toHaveProperty("ownerUid");
  });
  it("creator patch is a team admin with consistent roles", () => {
    expect(buildCreatorUserPatch({ teamId: "abc123" })).toMatchObject({ teamId: "ABC123", role: "match-scout", roles: ["match-scout"], secondaryRoles: [], isTeamAdmin: true, isOwner: true });
    expect(buildCreatorUserPatch({ teamId: "ABC123", role: "team-coach" })).toMatchObject({ role: "team-coach", roles: ["team-coach"] });
  });
  it("owner uid prefers verifiedOwnerId", () => {
    expect(ownerUidOfTeam({ verifiedOwnerId: "a", ownerUid: "b" })).toBe("a");
    expect(ownerUidOfTeam({ ownerUid: "b" })).toBe("b");
    expect(ownerUidOfTeam(null)).toBe("");
  });
});
