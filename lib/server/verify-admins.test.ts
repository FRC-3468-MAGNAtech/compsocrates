import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROGRAMS } from "@/config/programs";
import type { ProgramId } from "@/config/programs/types";
import { programPath } from "@/lib/firebase/paths";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { resetMembershipsEnabledCache } from "@/lib/server/team-settings";
import { confirmNameOf, listAdminsToVerify, verifyAdmins } from "@/lib/server/verify-admins";
import type { Actor } from "@/lib/server/membership-flows";

const NOW = 1_700_000_000_000;
let fake: FakeFirestore;
const db = () => fake.asFirestore();
const owner: Actor = { uid: "boss", name: "Boss", email: null, isPlatformOwner: true };
const notOwner: Actor = { uid: "adm", name: "Adm", email: null, isPlatformOwner: false };

function kit(program: ProgramId) {
  const m = PROGRAMS[program].membership;
  const f = m.userFields;
  const path = (name: string, id: string) => `${programPath(program, name)}/${id}`;
  const user = (teamId: string, over: Record<string, unknown> = {}) => ({ [m.nameFields[0]]: "Person", teamId, [f.role]: "lead-scout", [f.isAdmin]: false, [f.isOwner]: false, ...over });
  const mem = (teamId: string, uid: string, over: Record<string, unknown> = {}) => ({ uid, teamId, role: "match-scout", roles: null, secondaryRoles: [], isAdmin: false, isOwner: false, fieldTeamIds: null, name: "Person", status: "active", origin: "pointer", joinedAt: 1, leftAt: null, endedBy: null, updatedAt: 1, ...over });
  return { program, m, f, path, user, mem };
}

beforeEach(() => {
  fake = new FakeFirestore();
  fake.seed("appSettings/global", { membershipsEnabled: true });
  resetMembershipsEnabledCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe.each(["frc", "ftc"] as const)("verify admins (%s)", (program) => {
  const k = kit(program);
  const seedTeam = () => fake.seed(k.path("teams", "TEAMA1"), { name: "Robo Team", teamName: "Robo Team", [k.m.flows.ownerFields[0]]: "own" });
  const seed = () => {
    seedTeam();
    fake.seed(k.path("users", "own"), k.user("TEAMA1", { [k.f.isAdmin]: true, [k.f.isOwner]: true }));
    fake.seed(k.path("users", "adm"), k.user("TEAMA1", { [k.f.isAdmin]: true }));
    fake.seed(k.path("users", "plain"), k.user("TEAMA1"));
    fake.seed(k.path("users", "other"), k.user("TEAMB2", { [k.f.isAdmin]: true }));
    fake.seed(k.path("memberships", "TEAMA1_adm"), k.mem("TEAMA1", "adm", { isAdmin: true }));
  };
  const verify = (uids: unknown, confirmName: unknown = "Robo Team", actor: Actor = owner) => verifyAdmins(db(), actor, { program, teamId: "TEAMA1", uids, confirmName }, NOW);

  it("lists active admins and owners with an evidence note and the membership origin, writes nothing", async () => {
    seed();
    const before = JSON.stringify([...fake.store.entries()].filter(([p]) => !p.startsWith("rateLimits/")));
    const res = await listAdminsToVerify(db(), owner, { program, teamId: "TEAMA1" }, NOW);
    expect(res.status).toBe(200);
    const admins = res.body.admins as { uid: string; membership: string; evidence: string; isOwner: boolean }[];
    expect(admins.map((a) => a.uid).sort()).toEqual(["adm", "own"]);
    expect(admins.find((a) => a.uid === "adm")?.membership).toBe("pointer");
    expect(admins.find((a) => a.uid === "own")?.membership).toBe("none");
    expect(admins[0].isOwner).toBe(true);
    expect(res.body.confirmName).toBe("Robo Team");
    for (const a of admins) {
      expect(a.evidence).toMatch(k.m.flows.adminFlagLocked ? /locked by the rules/ : /edited by the user themself/);
      if (k.m.flows.adminFlagLocked) expect(a.evidence).toMatch(/only if the current rules are deployed|holds only if/);
    }
    expect(JSON.stringify(res.body)).not.toContain("@");
    expect(JSON.stringify([...fake.store.entries()].filter(([p]) => !p.startsWith("rateLimits/")))).toBe(before);
  });

  it("refuses everyone but the platform owner, and everything while the kill switch is off", async () => {
    seed();
    expect((await listAdminsToVerify(db(), notOwner, { program, teamId: "TEAMA1" }, NOW)).status).toBe(403);
    expect((await verify(["adm"], "Robo Team", notOwner)).status).toBe(403);
    fake.seed("appSettings/global", { membershipsEnabled: false });
    resetMembershipsEnabledCache();
    expect((await verify(["adm"])).body.code).toBe("memberships_disabled");
    expect(fake.read(k.path("memberships", "TEAMA1_adm"))?.origin).toBe("pointer");
  });

  it("changes nothing without the team name, and says why; the name is matched without case", async () => {
    seed();
    for (const bad of ["", "robo", "Other Team", null, 7]) {
      const res = await verify(["adm", "own"], bad);
      expect(res.status, String(bad)).toBe(400);
      expect(res.body.code).toBe("confirmation_mismatch");
    }
    expect(fake.read(k.path("memberships", "TEAMA1_adm"))?.origin).toBe("pointer");
    expect(fake.read(k.path("memberships", "TEAMA1_own"))).toBeUndefined();
    expect((await verify(["adm"], "  robo TEAM ")).status).toBe(200);
  });

  it("verifies exactly the ticked uids: upgrades an existing membership, creates a missing one, with verifiedBy and verifiedAt, and one platform audit entry", async () => {
    seed();
    const res = await verify(["adm", "own"]);
    expect(res.body).toMatchObject({ ok: true, verified: ["adm", "own"], alreadyVerified: [], skipped: [] });
    expect(fake.read(k.path("memberships", "TEAMA1_adm"))).toMatchObject({ origin: "verified", verifiedBy: "boss", verifiedAt: NOW, isAdmin: true, joinedAt: 1 });
    expect(fake.read(k.path("memberships", "TEAMA1_own"))).toMatchObject({ origin: "verified", verifiedBy: "boss", verifiedAt: NOW, isAdmin: true, isOwner: true, status: "active", role: "lead-scout" });
    const audits = fake.ids("platformAuditLog").map((id) => fake.read(`platformAuditLog/${id}`));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "verify-team-admins", actorUid: "boss" });
  });

  it("does not touch anyone who was not ticked (no one is pre-selected)", async () => {
    seed();
    await verify(["adm"]);
    expect(fake.read(k.path("memberships", "TEAMA1_own"))).toBeUndefined();
    expect(fake.read(k.path("memberships", "TEAMA1_plain"))).toBeUndefined();
  });

  it("skips and reports a person whose admin flag was removed since the list, someone on another team, and someone unknown", async () => {
    seed();
    fake.seed(k.path("users", "adm"), k.user("TEAMA1", { [k.f.isAdmin]: false })); // demoted after the owner opened the list
    const res = await verify(["adm", "plain", "other", "ghost"]);
    expect(res.body.verified).toEqual([]);
    expect(res.body.skipped).toEqual([
      { uid: "adm", reason: "not_admin_anymore" },
      { uid: "plain", reason: "not_admin_anymore" },
      { uid: "other", reason: "wrong_team" },
      { uid: "ghost", reason: "not_found" },
    ]);
    expect(fake.read(k.path("memberships", "TEAMA1_adm"))?.origin).toBe("pointer");
    expect(fake.ids("platformAuditLog")).toEqual([]);
  });

  it("is idempotent: a second run reports alreadyVerified and writes nothing", async () => {
    seed();
    await verify(["adm", "own"]);
    const writes = () => fake.commits.filter((c) => c.length > 0 && c.every((w) => !w.includes("rateLimits"))).length;
    const commits = writes();
    const again = await verify(["adm", "own"]);
    expect(again.body).toMatchObject({ verified: [], alreadyVerified: ["adm", "own"] });
    expect(writes()).toBe(commits);
    expect(fake.read(k.path("memberships", "TEAMA1_adm"))?.verifiedAt).toBe(NOW);
  });

  it("verifies an admin whose active team is elsewhere only from an active membership that records them as admin", async () => {
    seed();
    fake.seed(k.path("users", "away"), k.user("TEAMZ9"));
    fake.seed(k.path("memberships", "TEAMA1_away"), k.mem("TEAMA1", "away", { isAdmin: true }));
    fake.seed(k.path("users", "away2"), k.user("TEAMZ9"));
    fake.seed(k.path("memberships", "TEAMA1_away2"), k.mem("TEAMA1", "away2", { isAdmin: false }));
    const res = await verify(["away", "away2"]);
    expect(res.body.verified).toEqual(["away"]);
    expect(res.body.skipped).toEqual([{ uid: "away2", reason: "not_admin_anymore" }]);
  });

  it("rejects an empty or oversized selection and an unknown team", async () => {
    seed();
    expect((await verify([])).body.code).toBe("invalid_uids");
    expect((await verify(Array.from({ length: 101 }, (_, i) => `u${i}`))).body.code).toBe("invalid_uids");
    expect((await verifyAdmins(db(), owner, { program, teamId: "NOPE", uids: ["adm"], confirmName: "x" }, NOW)).status).toBe(404);
  });

  it("rolls back when the commit fails", async () => {
    seed();
    const before = JSON.stringify([...fake.store.entries()].filter(([p]) => !p.startsWith("rateLimits/")));
    fake.injectCommitFailure({ afterWrites: 1 });
    await expect(verify(["adm", "own"])).rejects.toThrow();
    expect(JSON.stringify([...fake.store.entries()].filter(([p]) => !p.startsWith("rateLimits/")))).toBe(before);
  });
});

describe("confirmNameOf", () => {
  it("uses the name, else Team <number>, else the id", () => {
    expect(confirmNameOf({ teamName: " Robo ", teamNumber: "3468" }, "T")).toBe("Robo");
    expect(confirmNameOf({ number: 35792 }, "T")).toBe("Team 35792");
    expect(confirmNameOf({}, "T")).toBe("T");
  });
});
