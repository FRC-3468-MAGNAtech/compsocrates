import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { resetMembershipsEnabledCache } from "@/lib/server/team-settings";
import { approveApplication, decideApplication, RouteError, teamNumberTaken } from "@/lib/server/application-decisions";

vi.mock("@/lib/server/rate-limit", () => ({ consumeRateLimit: async () => ({ allowed: true, count: 1 }) }));

const NOW = 1_700_000_000_000;
let fake: FakeFirestore;
const db = () => fake.asFirestore();
const ACTOR = { uid: "owner-1", name: "Owner" };

const COLLECTIONS = { frc: { apps: "teamApplications", teams: "teams", users: "users", memberships: "memberships", audit: "platformAuditLog", teamAudit: "auditLog" }, ftc: { apps: "programs/ftc/teamApplications", teams: "programs/ftc/teams", users: "programs/ftc/users", memberships: "programs/ftc/memberships", audit: "programs/ftc/platformAuditLog", teamAudit: "programs/ftc/auditLog" } } as const;

function application(program: "frc" | "ftc", over: Record<string, unknown> = {}) {
  fake.seed(`${COLLECTIONS[program].apps}/app1`, { program, applicantUid: "a1", applicantName: "Ada", applicantEmail: "ada@x.org", emailKey: "k", teamNumber: 3468, teamName: "MAGNAtech", role: "lead-scout", status: "pending", expiresAt: { toMillis: () => NOW + 1e9 }, ...over });
}

beforeEach(() => {
  fake = new FakeFirestore();
  resetMembershipsEnabledCache();
});

describe.each(["frc", "ftc"] as const)("approving an application (%s)", (program) => {
  const c = COLLECTIONS[program];

  it("creates the team and the applicant as its owner and admin, marks the application approved, audits both ways, and never writes isPlatformOwner", async () => {
    application(program);
    const res = await approveApplication(db(), program, "app1", ACTOR, NOW);
    expect(res).toMatchObject({ email: "ada@x.org", name: "Ada", teamNumber: 3468 });
    const team = fake.read(`${c.teams}/${res.teamId}`);
    expect(team).toBeDefined();
    expect(team?.applicationId).toBe("app1");
    expect(res.teamId).toMatch(program === "frc" ? /^[A-Z2-9]{6}$/ : /^[A-Z2-9]{8}$/);
    const user = fake.read(`${c.users}/a1`);
    expect(user).toMatchObject({ teamId: res.teamId, isOwner: true });
    expect(user).not.toHaveProperty("isPlatformOwner");
    expect(fake.read(`${c.apps}/app1`)).toMatchObject({ status: "approved", decidedBy: "owner-1", teamId: res.teamId });
    expect(fake.ids(c.audit)).toHaveLength(1);
    expect(fake.ids(c.teamAudit)).toHaveLength(1);
    // Switch OFF (default): no membership document is written.
    expect(fake.ids(c.memberships)).toEqual([]);
  });

  it("switch ON: the applicant also gets a VERIFIED, admin, owner membership in the same transaction", async () => {
    fake.seed("appSettings/global", { membershipsEnabled: true });
    application(program);
    const res = await approveApplication(db(), program, "app1", ACTOR, NOW);
    expect(fake.read(`${c.memberships}/${res.teamId}_a1`)).toMatchObject({ uid: "a1", teamId: res.teamId, origin: "verified", isAdmin: true, isOwner: true, status: "active" });
  });

  it("sets the pointer only for an account with no active team here: an existing profile with an EMPTY team id is updated, its other fields kept", async () => {
    fake.seed(`${c.users}/a1`, { name: "Ada", teamId: "", themeId: "midnight", bio: "hi" });
    application(program);
    const res = await approveApplication(db(), program, "app1", ACTOR, NOW);
    expect(fake.read(`${c.users}/a1`)).toMatchObject({ teamId: res.teamId, themeId: "midnight", bio: "hi", isOwner: true });
  });

  it("switch OFF: an applicant who already has a team is refused with 409 already-member, and nothing is written", async () => {
    fake.seed(`${c.users}/a1`, { teamId: "OTHER1" });
    application(program);
    await expect(approveApplication(db(), program, "app1", ACTOR, NOW)).rejects.toMatchObject({ status: 409, code: "already-member" });
    expect(fake.ids(c.teams)).toEqual([]);
    expect(fake.read(`${c.apps}/app1`)?.status).toBe("pending");
  });

  it("switch ON: an applicant who already has a team gets the new team as a verified membership and KEEPS the pointer", async () => {
    fake.seed("appSettings/global", { membershipsEnabled: true });
    fake.seed(`${c.users}/a1`, { teamId: "OTHER1", ...(program === "frc" ? { role: "match-scout" } : { primaryRole: "match-scout" }) });
    application(program);
    const res = await approveApplication(db(), program, "app1", ACTOR, NOW);
    expect(fake.read(`${c.users}/a1`)?.teamId).toBe("OTHER1");
    expect(fake.read(`${c.memberships}/${res.teamId}_a1`)).toMatchObject({ origin: "verified", isOwner: true });
  });

  it("switch ON at five active teams: 409 membership_limit and nothing is created", async () => {
    fake.seed("appSettings/global", { membershipsEnabled: true });
    for (const t of ["A1", "B1", "C1", "D1", "E1"]) fake.seed(`memberships/${t}_a1`, { uid: "a1", teamId: t, status: "active", role: "match-scout", name: "A", origin: "pointer", joinedAt: 1, updatedAt: 1, leftAt: null, endedBy: null, isAdmin: false, isOwner: false, roles: null, secondaryRoles: [], fieldTeamIds: null });
    application(program);
    await expect(approveApplication(db(), program, "app1", ACTOR, NOW)).rejects.toMatchObject({ status: 409, code: "membership_limit" });
    expect(fake.ids(c.teams)).toEqual([]);
  });

  it("refuses a team number THIS program already has (409 account-exists), and a decided application (expiry is covered by effectiveStatus)", async () => {
    fake.seed(`${c.teams}/EXIST1`, program === "frc" ? { teamNumber: "3468", teamName: "x" } : { number: 3468, name: "x" });
    application(program);
    await expect(approveApplication(db(), program, "app1", ACTOR, NOW)).rejects.toMatchObject({ status: 409, code: "account-exists" });
    application(program, { status: "approved" });
    await expect(approveApplication(db(), program, "app1", ACTOR, NOW)).rejects.toMatchObject({ code: "already-decided" });
    await expect(approveApplication(db(), program, "nope", ACTOR, NOW)).rejects.toBeInstanceOf(RouteError);
  });

  it("a number the OTHER program has does not block this one", async () => {
    const other = program === "frc" ? COLLECTIONS.ftc : COLLECTIONS.frc;
    fake.seed(`${other.teams}/EXIST1`, program === "frc" ? { number: 3468, name: "x" } : { teamNumber: "3468", teamName: "x" });
    expect(await teamNumberTaken(db(), program, 3468)).toBe(false);
    application(program);
    await expect(approveApplication(db(), program, "app1", ACTOR, NOW)).resolves.toMatchObject({ teamNumber: 3468 });
  });
});

describe.each(["frc", "ftc"] as const)("rejecting and blocking (%s)", (program) => {
  const c = COLLECTIONS[program];
  it("a rejection changes only the application and the audit log: no team, no user, no membership", async () => {
    application(program);
    await decideApplication(db(), program, "app1", ACTOR, "rejected", "Please link your team page.");
    expect(fake.read(`${c.apps}/app1`)).toMatchObject({ status: "rejected", rejectionReason: "Please link your team page." });
    expect(fake.ids(c.teams)).toEqual([]);
    expect(fake.ids(c.users)).toEqual([]);
    expect(fake.ids(c.memberships)).toEqual([]);
  });

  it("a block is written in THIS program's block collection only", async () => {
    application(program);
    await decideApplication(db(), program, "app1", ACTOR, "blocked", "", { blockEmail: true, blockTeam: true });
    const blocks = program === "frc" ? "applicationBlocks" : "programs/ftc/applicationBlocks";
    const otherBlocks = program === "frc" ? "programs/ftc/applicationBlocks" : "applicationBlocks";
    expect(fake.ids(blocks).sort()).toEqual(["email_k", "team_3468"]);
    expect(fake.ids(otherBlocks)).toEqual([]);
  });
});
