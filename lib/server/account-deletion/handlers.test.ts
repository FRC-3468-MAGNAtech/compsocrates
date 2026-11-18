import { describe, expect, it } from "vitest";
import { COOLDOWN_MS, DELETED_ACCOUNT_NAME } from "@/lib/deletion/constants";
import { programPath } from "@/lib/firebase/paths";
import { DISABLED, handleCron, handleOwnerAction, handleSelfDelete, type Caller, type HandlerEnv } from "@/lib/server/account-deletion/handlers";
import { jobPath, parseJob } from "@/lib/server/account-deletion/job";
import { FakeAuth, FakeStore, makeDeps } from "@/lib/server/account-deletion/test-support";

const UID = "uid-person-1";
const frc = (n: string) => programPath("frc", n);
const NOW = 1_700_000_000_000;

function setup(over: { enabled?: boolean; runWrites?: number; rate?: boolean; extra?: (s: FakeStore) => void } = {}) {
  const store = new FakeStore();
  const auth = new FakeAuth().addUser({ uid: UID, email: "ada@example.org", displayName: "Ada Lovelace" }).addUser({ uid: "owner", email: "owner@example.org" });
  const clock = { now: NOW };
  const deps = makeDeps({ store, auth, nowMs: () => clock.now });
  store.seed(`${frc("users")}/${UID}`, { displayName: "Ada Lovelace", teamId: "T1", role: "match-scout" });
  store.seed(`${frc("users")}/boss`, { displayName: "Boss", teamId: "T1", isTeamAdmin: true, role: "coach" });
  store.seed(`${frc("teams")}/T1`, { ownerUid: "boss" });
  store.seed(`${frc("scouting")}/s1`, { scoutId: UID, scoutName: "Ada Lovelace", teamId: "T1", teamNumber: 254 });
  over.extra?.(store);
  const limited = new Map<string, number>();
  const env = (): HandlerEnv => ({
    deps,
    settings: { enabled: over.enabled ?? true, runWrites: over.runWrites ?? 3000 },
    nowMs: clock.now,
    rateLimit: async (key, limit) => {
      const n = (limited.get(key) ?? 0) + 1;
      limited.set(key, n);
      return over.rate === false ? false : n <= limit;
    },
  });
  return { store, auth, deps, clock, env };
}

const me = (over: Partial<Caller> = {}): Caller => ({ uid: UID, name: "Ada Lovelace", authTimeSeconds: Math.floor(NOW / 1000) - 30, isPlatformOwner: false, ...over });
const owner = (over: Partial<Caller> = {}): Caller => ({ uid: "owner", name: "Owner", authTimeSeconds: Math.floor(NOW / 1000), isPlatformOwner: true, ...over });

describe("kill switch OFF: every route answers 404 deletion_disabled and does nothing", () => {
  it("self, owner and cron", async () => {
    const s = setup({ enabled: false });
    const before = s.store.dump();
    expect(await handleSelfDelete(s.env(), me(), { confirm: "DELETE" })).toEqual(DISABLED);
    expect(await handleOwnerAction(s.env(), owner(), { action: "list" })).toEqual(DISABLED);
    expect(await handleCron(s.env())).toEqual(DISABLED);
    expect(DISABLED.status).toBe(404);
    expect(DISABLED.body.code).toBe("deletion_disabled");
    expect(s.store.dump()).toBe(before);
    expect(s.auth.users.get(UID)?.disabled).toBe(false);
  });
});

describe("POST /api/account/delete (the person)", () => {
  it("starts the deletion and answers only `started`", async () => {
    const s = setup();
    const r = await handleSelfDelete(s.env(), me(), { confirm: "DELETE" });
    expect(r).toEqual({ status: 200, body: { ok: true, status: "started" } });
    expect(s.auth.users.get(UID)?.disabled).toBe(true);
    expect(s.store.has(jobPath(UID))).toBe(true);
    expect(parseJob(s.store.read(jobPath(UID)))?.requestedBy).toBe("self");
  });

  it("401 when nobody is signed in", async () => {
    const s = setup();
    expect(await handleSelfDelete(s.env(), null, { confirm: "DELETE" })).toMatchObject({ status: 401, body: { code: "not_signed_in" } });
  });

  it("403 not_self when the body names another account", async () => {
    const s = setup();
    expect(await handleSelfDelete(s.env(), me(), { confirm: "DELETE", uid: "someone-else" })).toMatchObject({ status: 403, body: { code: "not_self" } });
    expect(s.auth.users.get(UID)?.disabled).toBe(false);
  });

  it("403 platform_owner through the self route", async () => {
    const s = setup();
    expect(await handleSelfDelete(s.env(), me({ isPlatformOwner: true }), { confirm: "DELETE" })).toMatchObject({ status: 403, body: { code: "platform_owner" } });
  });

  it("400 not_confirmed unless the typed word is exactly DELETE", async () => {
    const s = setup();
    for (const confirm of [undefined, "", "delete", "DELETE ME", "yes"]) {
      expect(await handleSelfDelete(s.env(), me(), { confirm })).toMatchObject({ status: 400, body: { code: "not_confirmed" } });
    }
    expect(s.store.has(jobPath(UID))).toBe(false);
  });

  it("401 reauth_required without a recent sign-in (older than 5 minutes, missing, or in the future)", async () => {
    const s = setup();
    for (const authTimeSeconds of [Math.floor(NOW / 1000) - 3600, undefined, Math.floor(NOW / 1000) + 3600]) {
      expect(await handleSelfDelete(s.env(), me({ authTimeSeconds }), { confirm: "DELETE" })).toMatchObject({ status: 401, body: { code: "reauth_required" } });
    }
    expect(s.auth.users.get(UID)?.disabled).toBe(false);
  });

  it("409 deletion_in_progress when a job is already open", async () => {
    const s = setup();
    await handleSelfDelete(s.env(), me(), { confirm: "DELETE" });
    expect(await handleSelfDelete(s.env(), me(), { confirm: "DELETE" })).toMatchObject({ status: 409, body: { code: "deletion_in_progress" } });
  });

  it("409 last_admin for the only admin of a team that still has other members", async () => {
    const s = setup({
      extra: (st) => {
        st.seed(`${frc("users")}/${UID}`, { displayName: "Ada Lovelace", teamId: "T1", isTeamAdmin: true, role: "coach" });
        st.seed(`${frc("users")}/boss`, { displayName: "Boss", teamId: "T1", role: "match-scout" });
      },
    });
    expect(await handleSelfDelete(s.env(), me(), { confirm: "DELETE" })).toMatchObject({ status: 409, body: { code: "last_admin" } });
    expect(s.auth.users.get(UID)?.disabled).toBe(false);
    expect(s.store.has(jobPath(UID))).toBe(false);
  });

  it("429 when the person is over the rate limit", async () => {
    const s = setup({ rate: false });
    expect(await handleSelfDelete(s.env(), me(), { confirm: "DELETE" })).toMatchObject({ status: 429, body: { code: "rate_limited" } });
  });

  it("the audit lines hold no personal data", async () => {
    const s = setup();
    await handleSelfDelete(s.env(), me(), { confirm: "DELETE" });
    const text = JSON.stringify(s.deps.audits);
    expect(text).not.toContain(UID);
    expect(text).not.toContain("Ada");
    expect(s.deps.audits[0].actor).toEqual({ uid: "system", name: "Account deletion" });
  });
});

describe("POST /api/platform/account-deletions (the platform owner)", () => {
  it("403 for anyone who is not a platform owner, 401 for nobody", async () => {
    const s = setup();
    expect(await handleOwnerAction(s.env(), me(), { action: "list" })).toMatchObject({ status: 403, body: { code: "not_platform_owner" } });
    expect(await handleOwnerAction(s.env(), null, { action: "list" })).toMatchObject({ status: 401 });
  });

  it("start for a uid, list (opaque ids only), and resume by opaque id", async () => {
    const s = setup();
    const started = await handleOwnerAction(s.env(), owner(), { action: "start", uid: UID });
    expect(started.status).toBe(200);
    expect(parseJob(s.store.read(jobPath(UID)))?.requestedBy).toBe("owner");
    const list = await handleOwnerAction(s.env(), owner(), { action: "list" });
    const jobs = list.body.jobs as { opaqueId: string }[];
    expect(jobs).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(UID);
    s.clock.now += COOLDOWN_MS + 1;
    const resumed = await handleOwnerAction(s.env(), owner(), { action: "resume", opaqueId: jobs[0].opaqueId });
    expect(resumed.body).toMatchObject({ ok: true, done: true });
    expect(s.store.read(`${frc("scouting")}/s1`)).toMatchObject({ scoutName: DELETED_ACCOUNT_NAME });
    expect(s.auth.users.has(UID)).toBe(false);
  });

  it("refuses to start for a platform owner's uid, an empty uid, an unknown opaque id and an unknown action", async () => {
    const s = setup();
    process.env.RELEASE_OWNER_UIDS = "owner";
    try {
      expect(await handleOwnerAction(s.env(), owner(), { action: "start", uid: "owner" })).toMatchObject({ status: 403, body: { code: "platform_owner" } });
    } finally {
      delete process.env.RELEASE_OWNER_UIDS;
    }
    expect(await handleOwnerAction(s.env(), owner(), { action: "start", uid: "" })).toMatchObject({ status: 400 });
    expect(await handleOwnerAction(s.env(), owner(), { action: "resume", opaqueId: "deleted-" + "0".repeat(32) })).toMatchObject({ status: 404 });
    expect(await handleOwnerAction(s.env(), owner(), { action: "nope" })).toMatchObject({ status: 400 });
  });
});

describe("GET /api/cron/account-deletions", () => {
  it("resumes every open job within the shared budget and skips stalled ones", async () => {
    const s = setup();
    await handleSelfDelete(s.env(), me(), { confirm: "DELETE" });
    s.clock.now += COOLDOWN_MS + 1;
    const r = await handleCron(s.env());
    expect(r).toEqual({ status: 200, body: { ok: true, jobs: 1, finished: 1 } });
    expect(s.store.has(jobPath(UID))).toBe(false);
  });

  it("with nothing open it does nothing", async () => {
    const s = setup();
    expect((await handleCron(s.env())).body).toEqual({ ok: true, jobs: 0, finished: 0 });
  });

  it("a stalled job is left for the owner", async () => {
    const s = setup();
    await handleSelfDelete(s.env(), me(), { confirm: "DELETE" });
    s.store.seed(jobPath(UID), { ...(s.store.read(jobPath(UID)) ?? {}), status: "stalled" });
    expect((await handleCron(s.env())).body).toMatchObject({ jobs: 0 });
  });
});
