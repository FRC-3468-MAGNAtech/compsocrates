import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import { handleFtcFieldTeams } from "@/lib/ftc/server-field-teams";

// Mocked fetch and a fake Admin Firestore: no network, no emulator. The token check is in route.test.ts.

let fake: FakeFirestore;
const db = () => fake.asFirestore();
const admin = { uid: "admin-1" };
const body = (over: Record<string, unknown> = {}) => ({ program: "ftc", action: "sync", teamId: "T1", ...over });

beforeEach(() => {
  fake = new FakeFirestore();
  fake.seed("programs/ftc/teams/T1", { number: 35792, name: "Alpha" });
  fake.seed("programs/ftc/teams/T2", { number: 100, name: "Other" });
  fake.seed("programs/ftc/users/admin-1", { teamId: "T1", isAdmin: true, isOwner: false });
  fake.seed("programs/ftc/users/owner-1", { teamId: "T1", isAdmin: true, isOwner: true });
  fake.seed("programs/ftc/users/member-1", { teamId: "T1", isAdmin: false, isOwner: false });
  fake.seed("programs/ftc/users/member-2", { teamId: "T1", fieldTeamIds: ["ft-35792"] });
  fake.seed("programs/ftc/users/other-admin", { teamId: "T2", isAdmin: true });
  vi.stubEnv("FTC_API_USERNAME", "test-user");
  vi.stubEnv("FTC_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("who may ask", () => {
  it("refuses a plain member, an admin of another team, an unknown caller, and a team that is not the caller's", async () => {
    expect((await handleFtcFieldTeams(db(), { uid: "member-1" }, body())).status).toBe(403);
    expect((await handleFtcFieldTeams(db(), { uid: "other-admin" }, body())).status).toBe(403);
    expect((await handleFtcFieldTeams(db(), { uid: "nobody" }, body())).status).toBe(403);
    expect((await handleFtcFieldTeams(db(), admin, body({ teamId: "T2" }))).status).toBe(403);
    // nothing was written
    expect(fake.read("programs/ftc/teams/T1")).toEqual({ number: 35792, name: "Alpha" });
  });
  it("accepts an admin and an owner", async () => {
    expect((await handleFtcFieldTeams(db(), admin, body())).status).toBe(200);
    expect((await handleFtcFieldTeams(db(), { uid: "owner-1" }, body())).status).toBe(200);
  });
});

describe("input", () => {
  it("requires the program in the body and refuses frc and anything else", async () => {
    expect((await handleFtcFieldTeams(db(), admin, body({ program: undefined }))).body).toMatchObject({ code: "invalid_program" });
    expect((await handleFtcFieldTeams(db(), admin, body({ program: "frc" }))).body).toMatchObject({ code: "program_not_supported" });
    expect((await handleFtcFieldTeams(db(), admin, body({ program: "xyz" }))).body).toMatchObject({ code: "invalid_program" });
  });
  it("rejects a bad action, team id and team number", async () => {
    expect((await handleFtcFieldTeams(db(), admin, body({ action: "delete" }))).body).toMatchObject({ code: "invalid_action" });
    expect((await handleFtcFieldTeams(db(), admin, body({ teamId: "a/b" }))).body).toMatchObject({ code: "invalid_team" });
    expect((await handleFtcFieldTeams(db(), admin, body({ teamId: 5 }))).body).toMatchObject({ code: "invalid_team" });
    for (const number of ["", "abc", "123456", "-4", "0", "12.5", null, {}]) {
      expect((await handleFtcFieldTeams(db(), admin, body({ action: "lookup", number }))).body).toMatchObject({ code: "invalid_number" });
    }
  });
});

describe("lookup", () => {
  it("fills the name from the FTC API, cleaned and limited, with the key in a Basic header the response never repeats", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ teams: [{ teamNumber: 11111, nameShort: `  Robo\u0000Tigers  ${"x".repeat(100)}` }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleFtcFieldTeams(db(), admin, body({ action: "lookup", number: "11111" }));
    expect(res.status).toBe(200);
    const out = res.body as { found: boolean; name: string };
    expect(out.found).toBe(true);
    expect(out.name.startsWith("Robo Tigers")).toBe(true);
    expect(out.name.length).toBeLessThanOrEqual(60);
    expect(JSON.stringify(res.body)).not.toContain("test-key");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("reports an unknown team as not found (a 404 from FIRST), not as a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    expect((await handleFtcFieldTeams(db(), admin, body({ action: "lookup", number: 22222 }))).body).toMatchObject({ ok: true, found: false });
  });
  it("names the missing variables (503) and never prints their values", async () => {
    vi.stubEnv("FTC_API_KEY", "");
    const res = await handleFtcFieldTeams(db(), admin, body({ action: "lookup", number: 33333 }));
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: "missing_credentials", missing: ["FTC_API_KEY"] });
    expect(JSON.stringify(res.body)).not.toContain("test-user");
  });
  it("answers a rejected key with the typed error naming both variables", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    const res = await handleFtcFieldTeams(db(), admin, body({ action: "lookup", number: 44444 }));
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "unauthorized" });
    expect(String(res.body.error)).toContain("FTC_API_USERNAME");
    expect(JSON.stringify(res.body)).not.toContain("test-key");
  });
});

describe("sync", () => {
  it("writes fieldTeams from the legacy number/name, gives members without a list every team, leaves existing lists alone, and touches only FTC paths", async () => {
    const res = await handleFtcFieldTeams(db(), admin, body());
    expect(res.body).toMatchObject({ ok: true, teamMigrated: true });
    expect(fake.read("programs/ftc/teams/T1")).toMatchObject({ fieldTeams: [{ id: "ft-35792", number: 35792, name: "Alpha" }], fieldTeamIdList: ["ft-35792"], fieldTeamNumbers: [35792] });
    expect(fake.read("programs/ftc/users/member-1")?.fieldTeamIds).toEqual(["ft-35792"]);
    expect(fake.read("programs/ftc/users/member-2")?.fieldTeamIds).toEqual(["ft-35792"]);
    // another team's documents are untouched, and no root `teams` / `users` document exists
    expect(fake.read("programs/ftc/teams/T2")).toEqual({ number: 100, name: "Other" });
    expect(fake.read("programs/ftc/users/other-admin")).toEqual({ teamId: "T2", isAdmin: true });
    expect(fake.ids("teams")).toEqual([]);
    expect(fake.ids("users")).toEqual([]);
  });
  it("is idempotent, and keeps an admin's later assignment", async () => {
    await handleFtcFieldTeams(db(), admin, body());
    fake.seed("programs/ftc/users/member-1", { teamId: "T1", isAdmin: false, fieldTeamIds: [] });
    const again = await handleFtcFieldTeams(db(), admin, body());
    expect(again.body).toMatchObject({ ok: true, teamMigrated: false, membersMigrated: 0 });
    expect(fake.read("programs/ftc/users/member-1")?.fieldTeamIds).toEqual([]);
  });
  it("answers 404 for a missing team doc of the caller's own team id", async () => {
    fake.seed("programs/ftc/users/ghost-admin", { teamId: "GONE", isAdmin: true });
    expect((await handleFtcFieldTeams(db(), { uid: "ghost-admin" }, body({ teamId: "GONE" }))).status).toBe(404);
  });
});
