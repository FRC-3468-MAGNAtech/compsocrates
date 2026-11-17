import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROGRAMS } from "@/config/programs";
import type { ProgramId } from "@/config/programs/types";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { resetMembershipsEnabledCache } from "@/lib/server/team-settings";
import { decideJoin, editMemberAccess, joinLookup, leaveTeam, removeMember, requestJoin, type Actor } from "@/lib/server/membership-flows";
import { programPath } from "@/lib/firebase/paths";

// One suite for BOTH programs: the fixtures are built from the program's own config (field names, paths), the assertions are the same. A fake Admin Firestore with
// atomic transactions (no emulator, no network).

const NOW = 1_700_000_000_000;
let fake: FakeFirestore;
const db = () => fake.asFirestore();

const actor = (uid: string, over: Partial<Actor> = {}): Actor => ({ uid, name: `Name ${uid}`, email: `${uid}@example.com`, isPlatformOwner: false, ...over });

function kit(program: ProgramId) {
  const m = PROGRAMS[program].membership;
  const f = m.userFields;
  const r = m.flows.requests;
  const path = (name: string, id: string) => `${programPath(program, name)}/${id}`;
  const userDoc = (teamId: string, over: Record<string, unknown> = {}) => ({
    [m.nameFields[0]]: "Person",
    teamId,
    [f.role]: "match-scout",
    ...(f.roles ? { [f.roles]: ["match-scout"] } : {}),
    [f.secondaryRoles]: [],
    [f.isAdmin]: false,
    [f.isOwner]: false,
    ...over,
  });
  const adminDoc = (teamId: string, over: Record<string, unknown> = {}) => userDoc(teamId, { [f.isAdmin]: true, ...over });
  const membership = (teamId: string, uid: string, over: Record<string, unknown> = {}) => ({
    uid,
    teamId,
    role: "match-scout",
    roles: f.roles ? ["match-scout"] : null,
    secondaryRoles: [],
    isAdmin: false,
    isOwner: false,
    fieldTeamIds: null,
    name: "Person",
    status: "active",
    origin: "pointer",
    joinedAt: 1,
    leftAt: null,
    endedBy: null,
    updatedAt: 1,
    ...over,
  });
  const seedTeam = (id: string, over: Record<string, unknown> = {}) => fake.seed(path("teams", id), { name: `T ${id}`, teamName: `T ${id}`, ...(m.flows.ownerFields[0] ? { [m.flows.ownerFields[0]]: "owner" } : {}), ...over });
  const seedUser = (uid: string, doc: Record<string, unknown>) => fake.seed(path("users", uid), doc);
  const seedMem = (teamId: string, uid: string, over: Record<string, unknown> = {}) => fake.seed(path("memberships", `${teamId}_${uid}`), membership(teamId, uid, over));
  const user = (uid: string) => fake.read(path("users", uid));
  const mem = (teamId: string, uid: string) => fake.read(path("memberships", `${teamId}_${uid}`));
  const reqPath = (teamId: string, id: string) => (r.layout === "flat" ? path(r.collection, id) : `${programPath(program, "teams")}/${teamId}/${r.collection}/${id}`);
  const seedRequest = (teamId: string, uid: string, over: Record<string, unknown> = {}, id = r.layout === "flat" ? `req_${uid}` : uid) => {
    const doc: Record<string, unknown> = { [r.userId]: uid, [r.name]: "Requester", status: "pending", createdAt: 5, [r.role]: "pit-scout", ...(r.teamId ? { [r.teamId]: teamId } : {}), ...over };
    fake.seed(reqPath(teamId, id), doc);
    return id;
  };
  const audits = () => fake.ids(programPath(program, "auditLog")).map((id) => fake.read(path("auditLog", id)));
  return { program, m, f, r, path, userDoc, adminDoc, membership, seedTeam, seedUser, seedMem, user, mem, reqPath, seedRequest, audits };
}

beforeEach(() => {
  fake = new FakeFirestore();
  fake.seed("appSettings/global", { membershipsEnabled: true });
  resetMembershipsEnabledCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe.each(["frc", "ftc"] as const)("membership flows (%s)", (program) => {
  const k = kit(program);

  describe("the kill switch and the program", () => {
    it("answers 404 memberships_disabled while the switch is off or missing, and writes nothing", async () => {
      fake.seed("appSettings/global", { membershipsEnabled: false });
      k.seedTeam("TEAMA1");
      for (const run of [
        () => requestJoin(db(), actor("u1"), { program, code: "TEAMA1" }, NOW),
        () => decideJoin(db(), actor("u1"), { program, teamId: "TEAMA1", requestId: "x", action: "approve" }, NOW),
        () => leaveTeam(db(), actor("u1"), { program, teamId: "TEAMA1" }, NOW),
        () => removeMember(db(), actor("u1"), { program, teamId: "TEAMA1", uid: "u2" }, NOW),
        () => editMemberAccess(db(), actor("u1"), { program, teamId: "TEAMA1", uid: "u2", changes: { isAdmin: true } }, NOW),
        () => joinLookup(db(), actor("u1"), { program, code: "TEAMA1" }, NOW),
      ]) {
        resetMembershipsEnabledCache();
        const res = await run();
        expect(res.status).toBe(404);
        expect(res.body.code).toBe("memberships_disabled");
      }
      fake.store.delete("appSettings/global");
      resetMembershipsEnabledCache();
      expect((await leaveTeam(db(), actor("u1"), { program, teamId: "TEAMA1" }, NOW)).status).toBe(404);
      expect(fake.commits.filter((c) => c.some((w) => w.includes("memberships")))).toEqual([]);
    });

    it("needs the program: a missing or unknown one is a 400", async () => {
      expect((await leaveTeam(db(), actor("u1"), { teamId: "TEAMA1" }, NOW)).body.code).toBe("program_required");
      expect((await leaveTeam(db(), actor("u1"), { program: "xyz", teamId: "TEAMA1" }, NOW)).body.code).toBe("unknown_program");
      const other = (["frc", "ftc"] as const).find((p) => p !== program) as ProgramId;
      k.seedTeam("TEAMA1");
      k.seedUser("u1", k.userDoc("TEAMA1"));
      // The caller's membership in THIS program is untouched when the body names the other one.
      expect((await leaveTeam(db(), actor("u1"), { program: other, teamId: "TEAMA1" }, NOW)).status).toBe(403);
      expect(k.user("u1")?.teamId).toBe("TEAMA1");
    });
  });

  describe("join lookup", () => {
    it("returns only the four booleans, and an unknown code looks like any miss", async () => {
      k.seedTeam("TEAMA1", { allowMemberRoleChoice: true });
      const hit = await joinLookup(db(), actor("u1"), { program, code: "teama1" }, NOW);
      const miss = await joinLookup(db(), actor("u1"), { program, code: "NOSUCH" }, NOW);
      const junk = await joinLookup(db(), actor("u1"), { program, code: "bad code/!" }, NOW);
      expect(Object.keys(hit.body).sort()).toEqual(["allowsRoleChoice", "alreadyMember", "atLimit", "exists", "ok"]);
      expect(hit.body).toMatchObject({ exists: true, allowsRoleChoice: true, alreadyMember: false, atLimit: false });
      expect(miss.status).toBe(200);
      expect(junk.status).toBe(200);
      expect(Object.keys(miss.body).sort()).toEqual(Object.keys(hit.body).sort());
      expect(miss.body).toEqual(junk.body);
      expect(miss.body).toMatchObject({ exists: false, allowsRoleChoice: false });
    });

    it("says alreadyMember for the person's own team and atLimit at five active teams", async () => {
      k.seedTeam("TEAMA1");
      k.seedUser("u1", k.userDoc("TEAMA1"));
      expect((await joinLookup(db(), actor("u1"), { program, code: "TEAMA1" }, NOW)).body.alreadyMember).toBe(true);
      for (const t of ["B1", "C1", "D1", "E1", "F1"]) k.seedMem(t, "u1");
      expect((await joinLookup(db(), actor("u1"), { program, code: "TEAMA1" }, NOW)).body.atLimit).toBe(true);
    });

    it("is rate limited to 30 an hour per account", async () => {
      let last = 200;
      for (let i = 0; i < 31; i += 1) last = (await joinLookup(db(), actor("u1"), { program, code: "NOSUCH" }, NOW)).status;
      expect(last).toBe(429);
    });
  });

  describe("request to join", () => {
    it("lets an account that already has a team ask for another, and stores the default role as a request field", async () => {
      k.seedTeam("TEAMB2");
      k.seedUser("u1", k.userDoc("TEAMA1"));
      const res = await requestJoin(db(), actor("u1"), { program, code: "TEAMB2", name: "Ann", requestedRole: "pit-scout" }, NOW);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ alreadyPending: false, status: "pending", teamId: "TEAMB2" });
      const stored = fake.read(k.reqPath("TEAMB2", String(res.body.requestId)));
      expect(stored).toMatchObject({ [k.r.userId]: "u1", [k.r.name]: "Ann", status: "pending", [k.r.role]: k.m.defaultJoinRole });
      expect(k.user("u1")?.teamId).toBe("TEAMA1");
    });

    it("stores the asked-for role only when the team lets joiners choose, and never an admin or coach role", async () => {
      k.seedTeam("TEAMB2", { allowMemberRoleChoice: true });
      k.seedTeam("TEAMC3");
      const ok = await requestJoin(db(), actor("u1"), { program, code: "TEAMB2", name: "Ann", requestedRole: "pit-scout" }, NOW);
      expect(fake.read(k.reqPath("TEAMB2", String(ok.body.requestId)))?.[k.r.role]).toBe("pit-scout");
      for (const bad of ["team-coach", "admin", "owner", "coach", { x: 1 }]) {
        const res = await requestJoin(db(), actor(`bad${String(bad)}`.slice(0, 20)), { program, code: "TEAMB2", name: "Bo", requestedRole: bad }, NOW);
        expect(fake.read(k.reqPath("TEAMB2", String(res.body.requestId)))?.[k.r.role]).toBe(k.m.defaultJoinRole);
      }
      const off = await requestJoin(db(), actor("u9"), { program, code: "TEAMC3", name: "Cy", requestedRole: "pit-scout" }, NOW);
      expect(fake.read(k.reqPath("TEAMC3", String(off.body.requestId)))?.[k.r.role]).toBe(k.m.defaultJoinRole);
    });

    it("refuses an active member of that team, a person at the limit, and answers a repeat with the pending one", async () => {
      k.seedTeam("TEAMA1");
      k.seedUser("u1", k.userDoc("TEAMA1"));
      expect((await requestJoin(db(), actor("u1"), { program, code: "TEAMA1", name: "A" }, NOW)).body.code).toBe("already_member");
      k.seedTeam("TEAMB2");
      k.seedMem("TEAMB2", "u2");
      expect((await requestJoin(db(), actor("u2"), { program, code: "TEAMB2", name: "B" }, NOW)).body.code).toBe("already_member");
      k.seedTeam("TEAMC3");
      for (const t of ["P1", "P2", "P3", "P4", "P5"]) k.seedMem(t, "u3");
      const limited = await requestJoin(db(), actor("u3"), { program, code: "TEAMC3", name: "C" }, NOW);
      expect(limited.status).toBe(409);
      expect(limited.body.code).toBe("membership_limit");
      const first = await requestJoin(db(), actor("u4"), { program, code: "TEAMC3", name: "D" }, NOW);
      const again = await requestJoin(db(), actor("u4"), { program, code: "TEAMC3", name: "D" }, NOW);
      expect(again.body).toMatchObject({ alreadyPending: true, requestId: first.body.requestId });
    });

    it("404s an unknown code and 400s a malformed one", async () => {
      expect((await requestJoin(db(), actor("u1"), { program, code: "NOSUCH", name: "A" }, NOW)).status).toBe(404);
      expect((await requestJoin(db(), actor("u1"), { program, code: "no/slash", name: "A" }, NOW)).status).toBe(400);
    });
  });

  describe("approve and deny", () => {
    const setup = (over: { allow?: boolean } = {}) => {
      k.seedTeam("TEAMB2", over.allow ? { allowMemberRoleChoice: true } : {});
      k.seedUser("admin", k.adminDoc("TEAMB2"));
    };

    it("refuses a non-admin, an admin of another team and a request for another team", async () => {
      setup();
      k.seedUser("plain", k.userDoc("TEAMB2"));
      k.seedUser("other", k.adminDoc("ZZZZZ9"));
      const id = k.seedRequest("TEAMB2", "u1");
      for (const who of ["plain", "other", "nobody"]) {
        const res = await decideJoin(db(), actor(who), { program, teamId: "TEAMB2", requestId: id, action: "approve" }, NOW);
        expect(res.status, who).toBe(403);
      }
      expect(k.mem("TEAMB2", "u1")).toBeUndefined();
    });

    it("approves: a verified membership, the pointer moves only when the person has no active team, and the decision fields are stored", async () => {
      setup();
      k.seedUser("u1", k.userDoc("TEAMA1")); // already on a team: the pointer stays
      const id = k.seedRequest("TEAMB2", "u1");
      const res = await decideJoin(db(), actor("admin"), { program, teamId: "TEAMB2", requestId: id, action: "approve" }, NOW);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "approved", role: k.m.defaultJoinRole, pointerSet: false, restored: false });
      expect(k.mem("TEAMB2", "u1")).toMatchObject({ origin: "verified", status: "active", role: k.m.defaultJoinRole, isAdmin: false, isOwner: false, joinedAt: NOW });
      expect(k.user("u1")?.teamId).toBe("TEAMA1");
      expect(fake.read(k.reqPath("TEAMB2", id))).toMatchObject({ status: "approved", decidedRole: k.m.defaultJoinRole, decidedBy: "admin" });
      expect(fake.read(k.reqPath("TEAMB2", id))?.decidedAt).toBeDefined();
      expect(k.audits().some((a) => a?.action === "approve-join-request")).toBe(true);
    });

    it("sets the pointer and the role fields for an account with no active team, and creates the profile when there is none", async () => {
      setup();
      k.seedUser("u1", k.userDoc("", { [k.f.isAdmin]: true }));
      const a = k.seedRequest("TEAMB2", "u1");
      const res1 = await decideJoin(db(), actor("admin"), { program, teamId: "TEAMB2", requestId: a, action: "approve" }, NOW);
      expect(res1.body.pointerSet).toBe(true);
      expect(k.user("u1")).toMatchObject({ teamId: "TEAMB2", [k.f.role]: k.m.defaultJoinRole, [k.f.isAdmin]: false });
      const b = k.seedRequest("TEAMB2", "u2");
      const res2 = await decideJoin(db(), actor("admin"), { program, teamId: "TEAMB2", requestId: b, action: "approve" }, NOW);
      expect(res2.body.pointerSet).toBe(true);
      expect(k.user("u2")).toMatchObject({ teamId: "TEAMB2", [k.f.role]: k.m.defaultJoinRole, [k.f.isAdmin]: false, [k.f.isOwner]: false });
    });

    it("honors the requested role only when the toggle is ON, and never an admin role", async () => {
      setup({ allow: true });
      const a = k.seedRequest("TEAMB2", "u1", { [k.r.role]: "lead-scout" });
      expect((await decideJoin(db(), actor("admin"), { program, teamId: "TEAMB2", requestId: a, action: "approve" }, NOW)).body.role).toBe("lead-scout");
      const b = k.seedRequest("TEAMB2", "u2", { [k.r.role]: "team-coach" });
      expect((await decideJoin(db(), actor("admin"), { program, teamId: "TEAMB2", requestId: b, action: "approve" }, NOW)).body.role).toBe(k.m.defaultJoinRole);
      // The approver may change it (toggle ON), but never to an admin value.
      const c = k.seedRequest("TEAMB2", "u3", { [k.r.role]: "lead-scout" });
      expect((await decideJoin(db(), actor("admin"), { program, teamId: "TEAMB2", requestId: c, action: "approve", role: "pit-team" }, NOW)).body.role).toBe("pit-team");
      const d = k.seedRequest("TEAMB2", "u4", { [k.r.role]: "lead-scout" });
      expect((await decideJoin(db(), actor("admin"), { program, teamId: "TEAMB2", requestId: d, action: "approve", role: "admin" }, NOW)).body.role).toBe(k.m.defaultJoinRole);
      expect(k.mem("TEAMB2", "u4")?.isAdmin).toBe(false);
    });

    it("ignores the requested role when the toggle is OFF", async () => {
      setup();
      const a = k.seedRequest("TEAMB2", "u1", { [k.r.role]: "lead-scout" });
      expect((await decideJoin(db(), actor("admin"), { program, teamId: "TEAMB2", requestId: a, action: "approve", role: "pit-team" }, NOW)).body.role).toBe(k.m.defaultJoinRole);
    });

    it("restores the SAME membership document on a rejoin, keeping joinedAt", async () => {
      setup();
      k.seedMem("TEAMB2", "u1", { status: "past", leftAt: 50, endedBy: "self", joinedAt: 7, role: "drive-team", isAdmin: true });
      const id = k.seedRequest("TEAMB2", "u1");
      const res = await decideJoin(db(), actor("admin"), { program, teamId: "TEAMB2", requestId: id, action: "approve" }, NOW);
      expect(res.body.restored).toBe(true);
      expect(fake.ids(programPath(program, "memberships")).filter((x) => x.endsWith("_u1"))).toEqual(["TEAMB2_u1"]);
      expect(k.mem("TEAMB2", "u1")).toMatchObject({ status: "active", joinedAt: 7, rejoinedAt: NOW, leftAt: null, endedBy: null, origin: "verified", role: k.m.defaultJoinRole, isAdmin: false });
    });

    it("refuses at the limit of five and when the person is already on the team; a decided request cannot be decided again", async () => {
      setup();
      for (const t of ["P1", "P2", "P3", "P4", "P5"]) k.seedMem(t, "u1");
      const a = k.seedRequest("TEAMB2", "u1");
      expect((await decideJoin(db(), actor("admin"), { program, teamId: "TEAMB2", requestId: a, action: "approve" }, NOW)).body.code).toBe("membership_limit");
      k.seedMem("TEAMB2", "u2");
      const b = k.seedRequest("TEAMB2", "u2");
      expect((await decideJoin(db(), actor("admin"), { program, teamId: "TEAMB2", requestId: b, action: "approve" }, NOW)).body.code).toBe("already_member");
      const c = k.seedRequest("TEAMB2", "u3");
      expect((await decideJoin(db(), actor("admin"), { program, teamId: "TEAMB2", requestId: c, action: "deny" }, NOW)).body).toMatchObject({ ok: true, status: "denied" });
      expect((await decideJoin(db(), actor("admin"), { program, teamId: "TEAMB2", requestId: c, action: "approve" }, NOW)).body.code).toBe("not_pending");
      expect(k.mem("TEAMB2", "u3")).toBeUndefined();
    });

    it("rolls everything back when the commit fails", async () => {
      setup();
      k.seedUser("u1", k.userDoc(""));
      const id = k.seedRequest("TEAMB2", "u1");
      const before = JSON.stringify([...fake.store.entries()].filter(([p]) => !p.startsWith("rateLimits/")));
      fake.injectCommitFailure({ when: (paths) => paths.some((p) => p.includes("memberships")), afterWrites: 2 });
      await expect(decideJoin(db(), actor("admin"), { program, teamId: "TEAMB2", requestId: id, action: "approve" }, NOW)).rejects.toThrow();
      expect(JSON.stringify([...fake.store.entries()].filter(([p]) => !p.startsWith("rateLimits/")))).toBe(before);
    });

    it("lets the platform owner approve for any team", async () => {
      k.seedTeam("TEAMB2");
      const id = k.seedRequest("TEAMB2", "u1");
      expect((await decideJoin(db(), actor("boss", { isPlatformOwner: true }), { program, teamId: "TEAMB2", requestId: id, action: "approve" }, NOW)).status).toBe(200);
    });
  });

  describe("leave", () => {
    it("refuses someone who is not a member", async () => {
      k.seedTeam("TEAMA1");
      k.seedUser("u1", k.userDoc("TEAMB2"));
      const res = await leaveTeam(db(), actor("u1"), { program, teamId: "TEAMA1" }, NOW);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("not_a_member");
    });

    it("moves the pointer to the most recently active OTHER membership and keeps the old one as past", async () => {
      k.seedTeam("TEAMA1");
      k.seedUser("u1", k.userDoc("TEAMA1", { [k.f.role]: "pit-scout", [k.m.nameFields[0]]: "Ann" }));
      k.seedMem("TEAMA1", "u1");
      k.seedMem("TEAMB2", "u1", { updatedAt: 10, role: "drive-team", roles: k.f.roles ? ["drive-team"] : null });
      k.seedMem("TEAMC3", "u1", { updatedAt: 99, role: "lead-scout", roles: k.f.roles ? ["lead-scout"] : null, isAdmin: true });
      const res = await leaveTeam(db(), actor("u1"), { program, teamId: "TEAMA1" }, NOW);
      expect(res.body).toMatchObject({ ok: true, status: "past", activeTeamId: "TEAMC3" });
      expect(k.user("u1")).toMatchObject({ teamId: "TEAMC3", [k.f.role]: "lead-scout", [k.f.isAdmin]: true });
      expect(k.mem("TEAMA1", "u1")).toMatchObject({ status: "past", leftAt: NOW, endedBy: "self", role: "pit-scout", name: "Ann" });
    });

    it("clears the pointer and the team fields when there is no other team, and keeps the profile and its preferences", async () => {
      k.seedTeam("TEAMA1");
      k.seedUser("u1", k.adminDoc("TEAMA1", { [k.f.role]: "lead-scout", themeId: "midnight", [k.f.isOwner]: false, ...(k.f.fieldTeamIds ? { [k.f.fieldTeamIds]: ["x"] } : {}) }));
      k.seedUser("u2", k.adminDoc("TEAMA1"));
      const res = await leaveTeam(db(), actor("u1"), { program, teamId: "TEAMA1" }, NOW);
      expect(res.body.activeTeamId).toBe("");
      const after = k.user("u1") as Record<string, unknown>;
      expect(after).toMatchObject({ teamId: "", [k.f.role]: k.m.defaultJoinRole, [k.f.isAdmin]: false, [k.f.isOwner]: false, themeId: "midnight" });
      if (k.f.fieldTeamIds) expect(after[k.f.fieldTeamIds]).toBeUndefined();
      expect(k.mem("TEAMA1", "u1")).toMatchObject({ status: "past", endedBy: "self", isAdmin: true, role: "lead-scout" });
    });

    it("blocks the only admin of a team that still has other members, and the owner until they transfer", async () => {
      k.seedTeam("TEAMA1", { [k.m.flows.ownerFields[0]]: "own" });
      k.seedUser("adm", k.adminDoc("TEAMA1"));
      k.seedUser("m1", k.userDoc("TEAMA1"));
      const last = await leaveTeam(db(), actor("adm"), { program, teamId: "TEAMA1" }, NOW);
      expect(last.status).toBe(409);
      expect(last.body.code).toBe("last_admin");
      // Another admin exists: the admin may leave, the owner may not.
      k.seedUser("adm2", k.adminDoc("TEAMA1"));
      k.seedUser("own", k.adminDoc("TEAMA1", { [k.f.isOwner]: true }));
      expect((await leaveTeam(db(), actor("own"), { program, teamId: "TEAMA1" }, NOW)).body.code).toBe("owner_must_transfer");
      expect((await leaveTeam(db(), actor("adm"), { program, teamId: "TEAMA1" }, NOW)).status).toBe(200);
    });

    it("lets the sole remaining member leave, even as the owner and only admin", async () => {
      k.seedTeam("TEAMA1", { [k.m.flows.ownerFields[0]]: "solo" });
      k.seedUser("solo", k.adminDoc("TEAMA1", { [k.f.isOwner]: true }));
      expect((await leaveTeam(db(), actor("solo"), { program, teamId: "TEAMA1" }, NOW)).status).toBe(200);
      expect(k.user("solo")?.teamId).toBe("");
    });

    it("sees an admin who is a member only through a membership (another team is active) when it counts the others", async () => {
      k.seedTeam("TEAMA1");
      k.seedUser("away", k.userDoc("TEAMZ9"));
      k.seedMem("TEAMA1", "away", { isAdmin: true });
      k.seedUser("m1", k.userDoc("TEAMA1"));
      expect((await leaveTeam(db(), actor("away"), { program, teamId: "TEAMA1" }, NOW)).body.code).toBe("last_admin");
    });

    it("leaving an INACTIVE team touches the membership only, never the user document", async () => {
      k.seedTeam("TEAMB2");
      k.seedUser("u1", k.userDoc("TEAMA1", { [k.f.isAdmin]: true }));
      k.seedMem("TEAMB2", "u1");
      const before = JSON.stringify(k.user("u1"));
      const res = await leaveTeam(db(), actor("u1"), { program, teamId: "TEAMB2" }, NOW);
      expect(res.body.activeTeamId).toBeNull();
      expect(JSON.stringify(k.user("u1"))).toBe(before);
      expect(k.mem("TEAMB2", "u1")?.status).toBe("past");
    });

    it("rolls back on a failed commit and never writes isPlatformOwner", async () => {
      k.seedTeam("TEAMA1");
      k.seedUser("u1", k.userDoc("TEAMA1", { isPlatformOwner: true }));
      k.seedUser("u2", k.userDoc("TEAMA1"));
      fake.injectCommitFailure({ afterWrites: 1 });
      await expect(leaveTeam(db(), actor("u1"), { program, teamId: "TEAMA1" }, NOW)).rejects.toThrow();
      expect(k.user("u1")?.teamId).toBe("TEAMA1");
      expect(k.mem("TEAMA1", "u1")).toBeUndefined();
      await leaveTeam(db(), actor("u1"), { program, teamId: "TEAMA1" }, NOW);
      expect(k.user("u1")?.isPlatformOwner).toBe(true);
      for (const c of fake.commits) expect(JSON.stringify(c)).not.toContain("isPlatformOwner");
    });
  });

  describe("remove", () => {
    it("refuses a non-admin and an admin of another team, then removes with endedBy admin", async () => {
      k.seedTeam("TEAMA1");
      k.seedUser("adm", k.adminDoc("TEAMA1"));
      k.seedUser("adm2", k.adminDoc("TEAMA1"));
      k.seedUser("plain", k.userDoc("TEAMA1"));
      k.seedUser("stranger", k.adminDoc("ZZZZZ9"));
      for (const who of ["plain", "stranger"]) expect((await removeMember(db(), actor(who), { program, teamId: "TEAMA1", uid: "adm2" }, NOW)).status, who).toBe(403);
      const res = await removeMember(db(), actor("adm"), { program, teamId: "TEAMA1", uid: "plain" }, NOW);
      expect(res.status).toBe(200);
      expect(k.mem("TEAMA1", "plain")).toMatchObject({ status: "past", endedBy: "admin", leftAt: NOW });
      expect(k.user("plain")?.teamId).toBe("");
    });

    it("keeps the team's data: nothing but the person's membership and pointer is written", async () => {
      k.seedTeam("TEAMA1");
      k.seedUser("adm", k.adminDoc("TEAMA1"));
      k.seedUser("plain", k.userDoc("TEAMA1"));
      fake.seed("scouting/e1", { teamId: "TEAMA1", scoutId: "plain", scoutName: "Person" });
      fake.seed("programs/ftc/scoutEntries/e1", { teamId: "TEAMA1", uid: "plain", scoutName: "Person" });
      fake.seed("teams/TEAMA1_att", { eventAttendees: ["plain"] });
      await removeMember(db(), actor("adm"), { program, teamId: "TEAMA1", uid: "plain" }, NOW);
      expect(fake.read("scouting/e1")).toEqual({ teamId: "TEAMA1", scoutId: "plain", scoutName: "Person" });
      expect(fake.read("programs/ftc/scoutEntries/e1")).toEqual({ teamId: "TEAMA1", uid: "plain", scoutName: "Person" });
      expect(fake.read("teams/TEAMA1_att")).toEqual({ eventAttendees: ["plain"] });
    });

    it("blocks removing the owner, but a platform owner may force it; nobody removes themself this way", async () => {
      k.seedTeam("TEAMA1", { [k.m.flows.ownerFields[0]]: "own" });
      k.seedUser("own", k.adminDoc("TEAMA1", { [k.f.isOwner]: true }));
      k.seedUser("adm", k.adminDoc("TEAMA1"));
      expect((await removeMember(db(), actor("adm"), { program, teamId: "TEAMA1", uid: "own" }, NOW)).body.code).toBe("owner_must_transfer");
      expect((await removeMember(db(), actor("adm"), { program, teamId: "TEAMA1", uid: "adm" }, NOW)).body.code).toBe("use_leave");
      expect((await removeMember(db(), actor("boss", { isPlatformOwner: true }), { program, teamId: "TEAMA1", uid: "own", force: true }, NOW)).status).toBe(200);
      // `force` from anyone else does nothing.
      k.seedUser("own2", k.adminDoc("TEAMA1", { [k.f.isOwner]: true }));
      expect((await removeMember(db(), actor("adm"), { program, teamId: "TEAMA1", uid: "own2", force: true }, NOW)).body.code).toBe("owner_must_transfer");
    });

    it("creates the past membership of a pointer-only person (no membership document yet)", async () => {
      k.seedTeam("TEAMA1");
      k.seedUser("adm", k.adminDoc("TEAMA1"));
      k.seedUser("plain", k.userDoc("TEAMA1", { [k.m.nameFields[0]]: "Pat", createdAt: 1234 }));
      await removeMember(db(), actor("adm"), { program, teamId: "TEAMA1", uid: "plain" }, NOW);
      expect(k.mem("TEAMA1", "plain")).toMatchObject({ status: "past", origin: "pointer", name: "Pat", joinedAt: 1234 });
    });
  });

  describe("role and admin edits", () => {
    it("writes the user document when this is the person's active team, and only the membership when it is not", async () => {
      k.seedTeam("TEAMA1");
      k.seedUser("adm", k.adminDoc("TEAMA1"));
      k.seedUser("act", k.userDoc("TEAMA1", { isPlatformOwner: true }));
      k.seedUser("away", k.userDoc("TEAMZ9"));
      k.seedMem("TEAMA1", "away");
      const a = await editMemberAccess(db(), actor("adm"), { program, teamId: "TEAMA1", uid: "act", changes: { primaryRole: "drive-team", isAdmin: true } }, NOW);
      expect(a.body.wrote).toBe("user");
      expect(k.user("act")).toMatchObject({ [k.f.role]: "drive-team", [k.f.isAdmin]: true, isPlatformOwner: true });
      expect(k.mem("TEAMA1", "act")).toBeUndefined();
      const awayBefore = JSON.stringify(k.user("away"));
      const b = await editMemberAccess(db(), actor("adm"), { program, teamId: "TEAMA1", uid: "away", changes: { primaryRole: "lead-scout", secondaryRoles: ["pit-scout"] } }, NOW);
      expect(b.body.wrote).toBe("membership");
      expect(JSON.stringify(k.user("away"))).toBe(awayBefore);
      expect(k.mem("TEAMA1", "away")).toMatchObject({ role: "lead-scout", secondaryRoles: ["pit-scout"] });
      expect(k.audits().filter((x) => x?.action === "edit-member-roles")).toHaveLength(2);
    });

    it("never accepts owner or platform-owner fields, bad roles, or an edit by a non-admin or an admin of another team", async () => {
      k.seedTeam("TEAMA1");
      k.seedUser("adm", k.adminDoc("TEAMA1"));
      k.seedUser("plain", k.userDoc("TEAMA1"));
      k.seedUser("stranger", k.adminDoc("ZZZZZ9"));
      for (const changes of [{ isOwner: true }, { isPlatformOwner: true }, { primaryRole: "admin" }, { secondaryRoles: ["nope"] }, { isAdmin: "yes" }, {}, null]) {
        expect((await editMemberAccess(db(), actor("adm"), { program, teamId: "TEAMA1", uid: "plain", changes }, NOW)).status, JSON.stringify(changes)).toBe(400);
      }
      for (const who of ["plain", "stranger"]) expect((await editMemberAccess(db(), actor(who), { program, teamId: "TEAMA1", uid: "plain", changes: { isAdmin: true } }, NOW)).status, who).toBe(403);
      expect(k.user("plain")?.[k.f.isAdmin]).toBe(false);
      // A platform owner who is not a team admin cannot edit roles either.
      expect((await editMemberAccess(db(), actor("boss", { isPlatformOwner: true }), { program, teamId: "TEAMA1", uid: "plain", changes: { isAdmin: true } }, NOW)).status).toBe(403);
    });

    it("keeps an owner's row to that owner, and the owner stays admin", async () => {
      k.seedTeam("TEAMA1", { [k.m.flows.ownerFields[0]]: "own" });
      k.seedUser("own", k.adminDoc("TEAMA1", { [k.f.isOwner]: true }));
      k.seedUser("adm", k.adminDoc("TEAMA1"));
      expect((await editMemberAccess(db(), actor("adm"), { program, teamId: "TEAMA1", uid: "own", changes: { primaryRole: "pit-scout" } }, NOW)).status).toBe(403);
      expect((await editMemberAccess(db(), actor("own"), { program, teamId: "TEAMA1", uid: "own", changes: { isAdmin: false } }, NOW)).body.code).toBe("owner_admin_locked");
      expect((await editMemberAccess(db(), actor("own"), { program, teamId: "TEAMA1", uid: "own", changes: { primaryRole: "pit-scout" } }, NOW)).status).toBe(200);
    });

    it("blocks an admin who is the only admin from removing their own admin flag", async () => {
      k.seedTeam("TEAMA1");
      k.seedUser("adm", k.adminDoc("TEAMA1"));
      k.seedUser("m1", k.userDoc("TEAMA1"));
      expect((await editMemberAccess(db(), actor("adm"), { program, teamId: "TEAMA1", uid: "adm", changes: { isAdmin: false } }, NOW)).body.code).toBe("last_admin");
      k.seedUser("adm2", k.adminDoc("TEAMA1"));
      expect((await editMemberAccess(db(), actor("adm"), { program, teamId: "TEAMA1", uid: "adm", changes: { isAdmin: false } }, NOW)).status).toBe(200);
    });

    it("404s a person who is not a member", async () => {
      k.seedTeam("TEAMA1");
      k.seedUser("adm", k.adminDoc("TEAMA1"));
      k.seedUser("gone", k.userDoc("TEAMZ9"));
      k.seedMem("TEAMA1", "gone", { status: "past" });
      expect((await editMemberAccess(db(), actor("adm"), { program, teamId: "TEAMA1", uid: "gone", changes: { isAdmin: true } }, NOW)).status).toBe(404);
    });
  });

  describe("quota", () => {
    it("maps a Firestore quota error (gRPC code 8) to 503 quota_exceeded", async () => {
      k.seedTeam("TEAMA1");
      k.seedUser("u1", k.userDoc("TEAMA1"));
      const real = fake.docRef.bind(fake);
      fake.docRef = ((p: string) => {
        const ref = real(p);
        if (p.includes("users/")) ref.get = (async () => Promise.reject(Object.assign(new Error("8 RESOURCE_EXHAUSTED: Quota exceeded."), { code: 8 }))) as typeof ref.get;
        return ref;
      }) as typeof fake.docRef;
      const res = await requestJoin(db(), actor("u1"), { program, code: "TEAMA1", name: "A" }, NOW);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("quota_exceeded");
    });
  });
});
