import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { MembershipError, ensureMembership, ensureMembershipsOnSignIn, resetEnsureCaches, switchActiveTeam } from "@/lib/server/memberships";
import { getMembershipsEnabled, resetMembershipsEnabledCache } from "@/lib/server/team-settings";

// A fake Admin Firestore (atomic transactions, failure injection): no emulator, no network. Root = FRC paths, programs/ftc = FTC paths.

let fake: FakeFirestore;
const db = () => fake.asFirestore();
const NOW = 1_700_000_000_000;

const rootUser = (over: Record<string, unknown> = {}) => ({ displayName: "Ann", email: "ann@example.com", teamId: "AAA111", role: "coach", roles: ["coach"], secondaryRoles: ["pit-scout"], isTeamAdmin: true, isOwner: false, isPlatformOwner: true, ...over });
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

/** Wraps `docRef` so every document read is recorded; `onGet` may replace a read. */
function watchReads(f: FakeFirestore, onGet?: (path: string) => Promise<unknown> | undefined): string[] {
  const reads: string[] = [];
  const real = f.docRef.bind(f);
  f.docRef = ((path: string) => {
    const ref = real(path);
    const get = ref.get;
    ref.get = (async () => {
      reads.push(path);
      const replaced = onGet?.(path);
      return replaced !== undefined ? replaced : get();
    }) as typeof ref.get;
    return ref;
  }) as typeof f.docRef;
  return reads;
}

beforeEach(() => {
  fake = new FakeFirestore();
  resetMembershipsEnabledCache();
  resetEnsureCaches();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("ensureMembership", () => {
  it("creates the membership from the user document (raw fields, origin pointer, never the email or the platform-owner flag)", async () => {
    fake.seed("users/u1", rootUser());
    expect(await ensureMembership(db(), "frc", "u1", NOW)).toBe("created");
    const m = fake.read("memberships/AAA111_u1");
    expect(m).toMatchObject({ uid: "u1", teamId: "AAA111", role: "coach", roles: ["coach"], secondaryRoles: ["pit-scout"], isAdmin: true, isOwner: false, fieldTeamIds: null, name: "Ann", status: "active", origin: "pointer", joinedAt: NOW, leftAt: null, endedBy: null });
    expect(JSON.stringify(m)).not.toMatch(/example\.com|isPlatformOwner/);
  });

  it("FTC: reads programs/ftc/users and writes programs/ftc/memberships with field teams", async () => {
    fake.seed("programs/ftc/users/u1", { name: "Fay", teamId: "k3j9xq2m", primaryRole: "drive-team", secondaryRoles: [], isAdmin: false, isOwner: true, fieldTeamIds: ["a", "b"] });
    expect(await ensureMembership(db(), "ftc", "u1", NOW)).toBe("created");
    expect(fake.read("programs/ftc/memberships/k3j9xq2m_u1")).toMatchObject({ role: "drive-team", roles: null, isOwner: true, fieldTeamIds: ["a", "b"], origin: "pointer" });
    expect(fake.ids("memberships")).toEqual([]);
  });

  it("is idempotent: a second call creates nothing and changes nothing", async () => {
    fake.seed("users/u1", rootUser());
    await ensureMembership(db(), "frc", "u1", NOW);
    const before = fake.read("memberships/AAA111_u1");
    fake.seed("users/u1", rootUser({ role: "lead-scout", isTeamAdmin: false }));
    expect(await ensureMembership(db(), "frc", "u1", NOW + 5000)).toBe("exists");
    expect(fake.read("memberships/AAA111_u1")).toEqual(before);
  });

  it("never overwrites an existing membership (a verified one, or a past one)", async () => {
    fake.seed("users/u1", rootUser());
    fake.seed("memberships/AAA111_u1", member("AAA111", "u1", { origin: "verified", role: "lead-scout", isAdmin: false }));
    expect(await ensureMembership(db(), "frc", "u1", NOW)).toBe("exists");
    expect(fake.read("memberships/AAA111_u1")).toMatchObject({ origin: "verified", role: "lead-scout", isAdmin: false });
    fake.seed("users/u2", rootUser());
    fake.seed("memberships/AAA111_u2", member("AAA111", "u2", { status: "past", endedBy: "admin", leftAt: 9 }));
    expect(await ensureMembership(db(), "frc", "u2", NOW)).toBe("exists");
    expect(fake.read("memberships/AAA111_u2")).toMatchObject({ status: "past", endedBy: "admin" });
  });

  it("does nothing for no user document, an empty pointer, or an id that cannot make a key", async () => {
    expect(await ensureMembership(db(), "frc", "ghost", NOW)).toBe("no-pointer");
    fake.seed("users/u1", rootUser({ teamId: "" }));
    expect(await ensureMembership(db(), "frc", "u1", NOW)).toBe("no-pointer");
    fake.seed("users/u2", rootUser({ teamId: "A_B" }));
    expect(await ensureMembership(db(), "frc", "u2", NOW)).toBe("invalid");
    expect(fake.ids("memberships")).toEqual([]);
  });

  it("refuses at the limit of 5 ACTIVE memberships across both programs, but a past one does not count", async () => {
    fake.seed("users/u1", rootUser({ teamId: "NEW111" }));
    for (const t of ["A1", "A2", "A3"]) fake.seed(`memberships/${t}_u1`, member(t, "u1"));
    fake.seed("programs/ftc/memberships/F1_u1", member("F1", "u1"));
    fake.seed("programs/ftc/memberships/F2_u1", member("F2", "u1", { status: "past" }));
    expect(await ensureMembership(db(), "frc", "u1", NOW)).toBe("created"); // 4 active -> the 5th is allowed
    fake.seed("users/u1", rootUser({ teamId: "SIXTH1" }));
    expect(await ensureMembership(db(), "frc", "u1", NOW)).toBe("limit");
    expect(fake.read("memberships/SIXTH1_u1")).toBeUndefined();
  });
});

describe("switchActiveTeam", () => {
  const seedTwoTeams = () => {
    fake.seed("users/u1", rootUser({ teamId: "AAA111", role: "coach", roles: ["coach"], secondaryRoles: ["pit-scout"], isTeamAdmin: true }));
    fake.seed("memberships/AAA111_u1", member("AAA111", "u1", { role: "coach", isAdmin: true }));
    fake.seed("memberships/BBB222_u1", member("BBB222", "u1", { role: "drive-team", roles: ["drive-team"], secondaryRoles: ["media"], isAdmin: false, isOwner: false }));
  };

  it("saves the outgoing role fields from the user document and restores the incoming ones (roles differ per team)", async () => {
    seedTwoTeams();
    // the user document moved on since the membership was written (live CS edited it): the switch snapshots what is there NOW
    fake.seed("users/u1", rootUser({ teamId: "AAA111", role: "lead-scout", roles: ["lead-scout"], secondaryRoles: [], isTeamAdmin: false }));
    const state = await switchActiveTeam(db(), "frc", "u1", "BBB222", NOW);
    expect(state).toMatchObject({ teamId: "BBB222", previousTeamId: "AAA111", role: "drive-team", changed: true });
    expect(fake.read("memberships/AAA111_u1")).toMatchObject({ role: "lead-scout", roles: ["lead-scout"], secondaryRoles: [], isAdmin: false, updatedAt: NOW });
    expect(fake.read("users/u1")).toMatchObject({ teamId: "BBB222", role: "drive-team", roles: ["drive-team"], secondaryRoles: ["media"], isTeamAdmin: false, isOwner: false });
    // and back again: team A's role comes back
    await switchActiveTeam(db(), "frc", "u1", "AAA111", NOW + 1);
    expect(fake.read("users/u1")).toMatchObject({ teamId: "AAA111", role: "lead-scout", roles: ["lead-scout"], isTeamAdmin: false });
  });

  it("never touches isPlatformOwner, the email or the name", async () => {
    seedTwoTeams();
    await switchActiveTeam(db(), "frc", "u1", "BBB222", NOW);
    expect(fake.read("users/u1")).toMatchObject({ isPlatformOwner: true, email: "ann@example.com", displayName: "Ann" });
  });

  it("a field absent on the membership is DELETED from the user document, not defaulted (legacy roles are not rewritten)", async () => {
    fake.seed("users/u1", rootUser({ teamId: "AAA111" }));
    fake.seed("memberships/AAA111_u1", member("AAA111", "u1"));
    fake.seed("memberships/BBB222_u1", member("BBB222", "u1", { role: null, roles: null, secondaryRoles: null, isAdmin: null, isOwner: null }));
    await switchActiveTeam(db(), "frc", "u1", "BBB222", NOW);
    const u = fake.read("users/u1") ?? {};
    for (const k of ["role", "roles", "secondaryRoles", "isTeamAdmin", "isOwner"]) expect(k in u).toBe(false);
    expect(u.teamId).toBe("BBB222");
  });

  it("stores a legacy role raw and restores it raw", async () => {
    fake.seed("users/u1", rootUser({ teamId: "AAA111", role: "scout" }));
    fake.seed("memberships/AAA111_u1", member("AAA111", "u1"));
    fake.seed("memberships/BBB222_u1", member("BBB222", "u1", { role: "coach" }));
    await switchActiveTeam(db(), "frc", "u1", "BBB222", NOW);
    expect(fake.read("memberships/AAA111_u1")?.role).toBe("scout");
    expect(fake.read("users/u1")?.role).toBe("coach");
  });

  it("FTC: fieldTeamIds follow the membership, and the program's own field names are used", async () => {
    fake.seed("programs/ftc/users/u1", { name: "Fay", teamId: "T1", primaryRole: "drive-team", secondaryRoles: [], isAdmin: false, isOwner: false, fieldTeamIds: ["a"], isPlatformOwner: false });
    fake.seed("programs/ftc/memberships/T1_u1", member("T1", "u1", { role: "drive-team", fieldTeamIds: ["a"] }));
    fake.seed("programs/ftc/memberships/T2_u1", member("T2", "u1", { role: "pit-scout", secondaryRoles: ["media"], isAdmin: true, fieldTeamIds: ["x", "y"] }));
    await switchActiveTeam(db(), "ftc", "u1", "T2", NOW);
    expect(fake.read("programs/ftc/users/u1")).toMatchObject({ teamId: "T2", primaryRole: "pit-scout", secondaryRoles: ["media"], isAdmin: true, fieldTeamIds: ["x", "y"] });
    expect(fake.read("programs/ftc/memberships/T1_u1")?.fieldTeamIds).toEqual(["a"]);
    expect("roles" in (fake.read("programs/ftc/users/u1") ?? {})).toBe(false);
  });

  it("creates the outgoing membership in the same transaction when the pointer has none (origin pointer)", async () => {
    fake.seed("users/u1", rootUser({ teamId: "AAA111" }));
    fake.seed("memberships/BBB222_u1", member("BBB222", "u1"));
    await switchActiveTeam(db(), "frc", "u1", "BBB222", NOW);
    expect(fake.read("memberships/AAA111_u1")).toMatchObject({ origin: "pointer", status: "active", role: "coach", isAdmin: true });
    expect(fake.commits).toHaveLength(1);
    expect(fake.commits[0]).toEqual(["create memberships/AAA111_u1", "update users/u1"]);
  });

  it("a forged pointer plus an admin flag only ever yields a pointer-origin membership, never a verified one", async () => {
    fake.seed("users/u1", rootUser({ teamId: "EVIL99", isTeamAdmin: true }));
    fake.seed("memberships/BBB222_u1", member("BBB222", "u1"));
    await switchActiveTeam(db(), "frc", "u1", "BBB222", NOW);
    expect(fake.read("memberships/EVIL99_u1")).toMatchObject({ origin: "pointer", isAdmin: true });
  });

  it("a PAST outgoing membership is left alone", async () => {
    seedTwoTeams();
    fake.seed("memberships/AAA111_u1", member("AAA111", "u1", { status: "past", role: "old-role", endedBy: "admin", leftAt: 3 }));
    await switchActiveTeam(db(), "frc", "u1", "BBB222", NOW);
    expect(fake.read("memberships/AAA111_u1")).toMatchObject({ status: "past", role: "old-role", endedBy: "admin" });
  });

  it("switching to the team that is already active writes nothing", async () => {
    seedTwoTeams();
    const state = await switchActiveTeam(db(), "frc", "u1", "AAA111", NOW);
    expect(state.changed).toBe(false);
    expect(fake.commits.flat()).toEqual([]);
  });

  it("403 not_a_member without a membership (a pointer-only account included)", async () => {
    fake.seed("users/u1", rootUser());
    await expect(switchActiveTeam(db(), "frc", "u1", "BBB222", NOW)).rejects.toMatchObject({ status: 403, code: "not_a_member" });
    expect(fake.read("users/u1")?.teamId).toBe("AAA111");
  });

  it("403 membership_ended for a past membership", async () => {
    fake.seed("users/u1", rootUser());
    fake.seed("memberships/BBB222_u1", member("BBB222", "u1", { status: "past", endedBy: "self", leftAt: 5 }));
    await expect(switchActiveTeam(db(), "frc", "u1", "BBB222", NOW)).rejects.toMatchObject({ status: 403, code: "membership_ended" });
  });

  it("403 for someone else's membership document (the stored uid must match)", async () => {
    fake.seed("users/u1", rootUser());
    fake.seed("memberships/BBB222_u1", member("BBB222", "someone-else"));
    await expect(switchActiveTeam(db(), "frc", "u1", "BBB222", NOW)).rejects.toMatchObject({ status: 403 });
  });

  it("409 no_profile when the program has no user document (it is not created)", async () => {
    fake.seed("programs/ftc/memberships/T2_u1", member("T2", "u1"));
    await expect(switchActiveTeam(db(), "ftc", "u1", "T2", NOW)).rejects.toMatchObject({ status: 409, code: "no_profile" });
    expect(fake.read("programs/ftc/users/u1")).toBeUndefined();
  });

  it("400 invalid_team for a team id that cannot make a key", async () => {
    fake.seed("users/u1", rootUser());
    for (const bad of ["", "A_B", "A/B"]) await expect(switchActiveTeam(db(), "frc", "u1", bad, NOW)).rejects.toMatchObject({ status: 400, code: "invalid_team" });
  });

  it("409 membership_limit when creating the outgoing membership would pass 5, and nothing changes", async () => {
    fake.seed("users/u1", rootUser({ teamId: "ZZZ999" }));
    for (const t of ["A1", "A2", "A3", "A4", "A5"]) fake.seed(`memberships/${t}_u1`, member(t, "u1"));
    await expect(switchActiveTeam(db(), "frc", "u1", "A1", NOW)).rejects.toMatchObject({ status: 409, code: "membership_limit" });
    expect(fake.read("users/u1")?.teamId).toBe("ZZZ999");
  });

  it("409 invalid_pointer when the stored pointer cannot be saved (nothing is overwritten)", async () => {
    fake.seed("users/u1", rootUser({ teamId: "A_B" }));
    fake.seed("memberships/BBB222_u1", member("BBB222", "u1"));
    await expect(switchActiveTeam(db(), "frc", "u1", "BBB222", NOW)).rejects.toMatchObject({ status: 409, code: "invalid_pointer" });
    expect(fake.read("users/u1")?.teamId).toBe("A_B");
  });

  it("a failure part-way through leaves BOTH documents exactly as they were (atomic)", async () => {
    seedTwoTeams();
    fake.seed("users/u1", rootUser({ teamId: "AAA111", role: "lead-scout" }));
    const snapshot = () => ({ user: fake.read("users/u1"), a: fake.read("memberships/AAA111_u1"), b: fake.read("memberships/BBB222_u1") });
    const before = snapshot();
    fake.injectCommitFailure({ afterWrites: 1, error: new Error("disk on fire") }); // the outgoing write is applied, the user write never is
    await expect(switchActiveTeam(db(), "frc", "u1", "BBB222", NOW)).rejects.toThrow("disk on fire");
    expect(snapshot()).toEqual(before);
    // a retry works
    await switchActiveTeam(db(), "frc", "u1", "BBB222", NOW);
    expect(fake.read("users/u1")?.teamId).toBe("BBB222");
  });

  it("refusals are MembershipError instances", async () => {
    fake.seed("users/u1", rootUser());
    await expect(switchActiveTeam(db(), "frc", "u1", "BBB222", NOW)).rejects.toBeInstanceOf(MembershipError);
  });
});

describe("the kill switch and the sign-in hook", () => {
  const seedUsers = () => {
    fake.seed("users/u1", rootUser());
    fake.seed("programs/ftc/users/u1", { name: "Fay", teamId: "k3j9xq2m", primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false });
  };

  it("missing document or field means OFF; only true is ON", async () => {
    expect(await getMembershipsEnabled(db(), NOW)).toBe(false);
    resetMembershipsEnabledCache();
    fake.seed("appSettings/global", { teamCreationEnabled: true });
    expect(await getMembershipsEnabled(db(), NOW)).toBe(false);
    resetMembershipsEnabledCache();
    fake.seed("appSettings/global", { membershipsEnabled: "true" });
    expect(await getMembershipsEnabled(db(), NOW)).toBe(false);
    resetMembershipsEnabledCache();
    fake.seed("appSettings/global", { membershipsEnabled: true });
    expect(await getMembershipsEnabled(db(), NOW)).toBe(true);
  });

  it("the switch is read once per ~30 s, then again", async () => {
    const reads = watchReads(fake);
    fake.seed("appSettings/global", { membershipsEnabled: true });
    await getMembershipsEnabled(db(), NOW);
    await getMembershipsEnabled(db(), NOW + 29_000);
    expect(reads).toEqual(["appSettings/global"]);
    fake.seed("appSettings/global", { membershipsEnabled: false });
    expect(await getMembershipsEnabled(db(), NOW + 31_000)).toBe(false);
    expect(reads).toHaveLength(2);
  });

  it("a failed switch read is not cached", async () => {
    let boom = true;
    watchReads(fake, () => (boom ? Promise.reject(new Error("unavailable")) : undefined));
    await expect(getMembershipsEnabled(db(), NOW)).rejects.toThrow("unavailable");
    boom = false;
    fake.seed("appSettings/global", { membershipsEnabled: true });
    expect(await getMembershipsEnabled(db(), NOW)).toBe(true);
  });

  it("OFF: no membership is created and the only read is the (cached) switch", async () => {
    seedUsers();
    const reads = watchReads(fake);
    expect(await ensureMembershipsOnSignIn(db(), "u1", NOW)).toEqual({});
    await ensureMembershipsOnSignIn(db(), "u1", NOW + 1000);
    expect(reads).toEqual(["appSettings/global"]);
    expect(fake.ids("memberships")).toEqual([]);
    expect(fake.ids("programs/ftc/memberships")).toEqual([]);
  });

  it("ON: creates a membership for each program with a pointer; the second sign-in reads nothing more", async () => {
    seedUsers();
    fake.seed("appSettings/global", { membershipsEnabled: true });
    const reads = watchReads(fake);
    expect(await ensureMembershipsOnSignIn(db(), "u1", NOW)).toEqual({ frc: "created", ftc: "created" });
    expect(fake.read("memberships/AAA111_u1")).toBeDefined();
    expect(fake.read("programs/ftc/memberships/k3j9xq2m_u1")).toBeDefined();
    const n = reads.length;
    await ensureMembershipsOnSignIn(db(), "u1", NOW + 20_000);
    expect(reads).toHaveLength(n);
    // after ~10 minutes it looks again, finds the memberships, and creates nothing
    expect(await ensureMembershipsOnSignIn(db(), "u1", NOW + 11 * 60_000)).toEqual({ frc: "exists", ftc: "exists" });
  });

  it("ON: a program where the account has no pointer is skipped (no membership read)", async () => {
    fake.seed("users/u1", rootUser({ teamId: "" }));
    fake.seed("appSettings/global", { membershipsEnabled: true });
    const reads = watchReads(fake);
    expect(await ensureMembershipsOnSignIn(db(), "u1", NOW)).toEqual({});
    expect(reads.some((p) => p.includes("memberships"))).toBe(false);
  });

  it("never throws: a failing program is logged and the next one still runs; a quota error is logged ONCE with its code", async () => {
    seedUsers();
    fake.seed("appSettings/global", { membershipsEnabled: true });
    watchReads(fake, (path) => (path === "users/u1" ? Promise.reject(Object.assign(new Error("8 RESOURCE_EXHAUSTED: Quota exceeded"), { code: 8 })) : undefined));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await ensureMembershipsOnSignIn(db(), "u1", NOW)).toEqual({ ftc: "created" });
    await ensureMembershipsOnSignIn(db(), "u1", NOW + 11 * 60_000);
    await ensureMembershipsOnSignIn(db(), "u2", NOW);
    expect(spy.mock.calls.filter((c) => String(c[0]).includes("code 8"))).toHaveLength(1);
  });

  it("never throws when the switch itself cannot be read", async () => {
    watchReads(fake, () => Promise.reject(new Error("down")));
    await expect(ensureMembershipsOnSignIn(db(), "u1", NOW)).resolves.toEqual({});
  });
});
