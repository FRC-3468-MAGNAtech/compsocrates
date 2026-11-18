import { describe, expect, it } from "vitest";
import { COOLDOWN_MS, DELETED_ACCOUNT_NAME, MAX_SWEEP_LOOPS, isDeletedAccountId } from "@/lib/deletion/constants";
import { programPath } from "@/lib/firebase/paths";
import { libraryMatchId } from "@/lib/library/ids";
import { newOpaqueId } from "@/lib/server/account-deletion/admin-adapters";
import { jobPath, listJobs, parseJob, runDeletion, startDeletion, uidForOpaque } from "@/lib/server/account-deletion/job";
import { FakeAuth, FakeBlobs, FakeStore, makeDeps } from "@/lib/server/account-deletion/test-support";

// The account deletion job against in-memory stand-ins for Firestore, Auth and Blob. Program ids are data here (a test may use them).
const UID = "uid-person-1";
const EMAIL = "ada.lovelace@example.org";
const NAME = "Ada Lovelace";
const BIG = { writes: 100_000, reads: 100_000 };
const frc = (name: string) => programPath("frc", name);
const MATCH_KEY = libraryMatchId("2026wabon", "Qualification", 5);
const ftc = (name: string) => programPath("ftc", name);

type World = { store: FakeStore; auth: FakeAuth; blobs: FakeBlobs; clock: { now: number }; deps: ReturnType<typeof makeDeps> };

function world(opts: { memberships?: boolean; extra?: (s: FakeStore) => void } = {}): World {
  const store = new FakeStore();
  const auth = new FakeAuth().addUser({ uid: UID, email: EMAIL, displayName: NAME });
  const blobs = new FakeBlobs();
  const clock = { now: 1_700_000_000_000 };
  const deps = makeDeps({ store, auth, blobs, nowMs: () => clock.now, memberships: opts.memberships });

  // ---- root program: the person is a plain member of team T1 with another admin; a bystander shares the team.
  store.seed(`${frc("users")}/${UID}`, { email: EMAIL, displayName: NAME, teamId: "T1", role: "match-scout", photoURL: "https://x/y.png", fcmTokens: ["tok1"] });
  store.seed(`${frc("users")}/boss`, { email: "boss@example.org", displayName: "Boss", teamId: "T1", isTeamAdmin: true, role: "coach" });
  store.seed(`${frc("users")}/other`, { email: "other@example.org", displayName: "Grace Hopper", teamId: "T1", role: "match-scout" });
  store.seed(`${frc("profiles")}/${UID}`, { displayName: NAME, bio: "hi" });
  store.seed(`${frc("teams")}/T1`, { ownerUid: "boss", verifiedOwnerId: "boss", eventAttendees: { "2026wabon": [UID, "other"], "2026orore": ["other"] }, judgeBookCards: [{ createdByUid: UID, createdByName: NAME }] });
  store.seed(`${frc("memberships")}/T1_${UID}`, { uid: UID, teamId: "T1", name: NAME, role: "match-scout", status: "active", origin: "verified", joinedAt: 1000, leftAt: null, endedBy: null, updatedAt: 1000, roles: null, secondaryRoles: [], isAdmin: false, isOwner: false, fieldTeamIds: null });
  store.seed(`${frc("scouting")}/s1`, { scoutId: UID, scoutName: NAME, teamId: "T1", teamNumber: 254, score: { total: 10 } });
  store.seed(`${frc("scouting")}/s2`, { scoutId: UID, scoutName: NAME, teamId: "T1", teamNumber: 255 });
  store.seed(`${frc("scouting")}/s3`, { scoutId: "other", scoutName: "Grace Hopper", teamId: "T1", teamNumber: 256 });
  store.seed(`${frc("scouting")}/old1`, { scoutId: "", scoutName: NAME, teamId: "T1", teamNumber: 300 });
  store.seed(`${frc("practiceSessions")}/p1`, { uid: UID, scoutId: UID, scoutName: NAME, teamId: "T1", kind: "live", eventCode: "2026wabon", matchType: "Qualification", matchNumber: 5, lobbyId: "LB-1" });
  store.seed(`${frc("matchAssignments")}/a1`, { scoutId: UID, scoutName: NAME, assignedBy: "boss", teamId: "T1" });
  store.seed(`${frc("matchAssignments")}/a2`, { scoutId: "other", scoutName: "Grace Hopper", assignedBy: UID, teamId: "T1" });
  store.seed(`${frc("auditLog")}/au1`, { uid: UID, actorName: NAME, teamId: "T1", action: "edit-entry", target: {} });
  store.seed(`${frc("auditLog")}/au2`, { uid: "boss", actorName: "Boss", teamId: "T1", action: "remove-member", target: { targetUid: UID, targetName: NAME } });
  store.seed(`${frc("notifications")}/n1`, { uid: UID, teamId: "T1", type: "live-score-ready" });
  store.seed(`${frc("teamJoinRequests")}/r1`, { userId: UID, userName: NAME, userEmail: EMAIL, userEmailLower: EMAIL, teamId: "T1" });
  store.seed(`${frc("teamApplications")}/ap1`, { applicantUid: UID, applicantName: NAME, applicantEmail: EMAIL, emailKey: "k1", status: "approved", teamNumber: "254", decidedBy: "owner" });
  store.seed(`${frc("applicationBlocks")}/email_k1`, { type: "email", value: EMAIL, reason: "abuse", createdBy: "owner" });
  store.seed(`${frc("rateLimits")}/avatar-upload_${UID}_77`, { count: 1, key: `avatar-upload_${UID}` });
  store.seed(`${frc("rateLimits")}/avatar-upload_someone-else_77`, { count: 1, key: "avatar-upload_someone-else" });
  store.seed(`${frc("liveMatches")}/${MATCH_KEY}/scouts/${UID}`, { uid: UID, name: NAME, teamId: "T1" });
  store.seed(`${frc("lobbies")}/LB-1`, { hostUid: "other", hostName: "Grace Hopper", teamId: "T1", pairing: [{ pairId: "x", playerUids: [UID, "other"], robotForUid: { [UID]: 1, other: 2 } }] });
  store.seed(`${frc("lobbies")}/LB-1/players/${UID}`, { uid: UID, name: NAME, teamId: "T1" });
  store.seed(`${frc("personalPractice")}/${UID}/sessions/ps1`, { uid: UID, status: "completed" });

  // ---- the other program: the same account, a member of team F1.
  store.seed(`${ftc("users")}/${UID}`, { name: NAME, email: EMAIL, teamId: "F1", primaryRole: "match-scout", fcmTokens: ["tok2"] });
  store.seed(`${ftc("users")}/boss`, { name: "Boss", teamId: "F1", isAdmin: true, primaryRole: "lead-scout" });
  store.seed(`${ftc("teams")}/F1`, { ownerUid: "boss", name: "Team F1" });
  store.seed(`${ftc("scoutEntries")}/e1`, { uid: UID, scoutName: NAME, teamId: "F1", teamNumber: 1 });
  store.seed(`${ftc("scoutEntries")}/csv_f1_2026-uscalab_q1_100_ada-lovelace-1x2y`, { uid: "boss", scoutName: NAME, teamId: "F1", source: "event" });
  store.seed(`${ftc("eventAttendance")}/F1_2025-USCALAB`, { teamId: "F1", eventCode: "2025-USCALAB", uids: [UID, "boss"] });
  store.seed(`${ftc("assignments")}/F1_2025-USCALAB`, { teamId: "F1", current: { generatedBy: "boss", settings: { scoutUids: [UID, "boss"] }, counts: { [UID]: 2, boss: 1 }, slots: [{ scoutUid: UID, slot: "red1" }] }, previous: null });
  store.seed(`${ftc("joinRequestPointers")}/${UID}`, { entries: [{ teamId: "F2", requestId: UID, status: "denied" }] });
  store.seed(`${ftc("teams")}/F2/joinRequests/${UID}`, { uid: UID, name: NAME, status: "denied" });
  store.seed(`${ftc("personalPractice")}/${UID}/entries/pe1`, { uid: UID, scoutName: NAME });
  store.seed(`${ftc("practiceSessions")}/fp1`, { uid: UID, scoutName: NAME, teamId: "F1", kind: "solo" });
  opts.extra?.(store);
  return { store, auth, blobs, clock, deps };
}

/** Runs the job to the end, moving the clock past the cooldown whenever it waits. Returns the last result and the number of runs. */
async function finish(w: World, budget = BIG, maxRuns = 200) {
  let last = await runDeletion(w.deps, UID, budget);
  let runs = 1;
  while (last.body.done !== true && runs < maxRuns) {
    if (last.body.stoppedBy === "cooldown") w.clock.now += COOLDOWN_MS + 1;
    if (last.body.status === "stalled") break;
    last = await runDeletion(w.deps, UID, budget);
    runs += 1;
  }
  return { last, runs };
}

const actor = { uid: "system", name: "Account deletion" };
const start = (w: World, budget = BIG) => startDeletion(w.deps, { uid: UID, requestedBy: "self", actor, budget });
const survivors = (w: World, needle: string) => [...w.store.docs.entries()].filter(([, v]) => JSON.stringify(v.data).includes(needle)).map(([k]) => k);

describe("the happy path", () => {
  it("disables the account, waits out the cooldown, rewrites, deletes, and removes the Auth user and the job", async () => {
    const w = world();
    const first = await start(w);
    expect(first.body).toMatchObject({ ok: true, done: false, status: "cooldown", step: "cooldown", stoppedBy: "cooldown" });
    expect(w.auth.users.get(UID)?.disabled).toBe(true);
    // Nothing of the person's data has been touched yet: the cooldown is the protection against late writes from a token still valid.
    expect(w.store.read(`${frc("scouting")}/s1`)?.scoutId).toBe(UID);
    expect(w.store.has(`${frc("users")}/${UID}`)).toBe(true);

    const { last } = await finish(w);
    expect(last.body).toMatchObject({ ok: true, done: true, status: "finished" });
    expect(w.auth.users.has(UID)).toBe(false);
    expect(w.store.has(jobPath(UID))).toBe(false);
    expect(w.blobs.removed).toEqual([UID]);
  });

  it("leaves no uid, name or email in any document the person's data was in (both programs), and no mapping from the person to the opaque id", async () => {
    const w = world();
    await start(w);
    await finish(w);
    expect(survivors(w, UID)).toEqual([]);
    expect(survivors(w, EMAIL)).toEqual([]);
    // The only remaining mention of the name is the row the job was told to leave: a namesake-free name-only row is rewritten too, so nothing is left.
    expect(survivors(w, NAME)).toEqual([]);
    expect([...w.store.docs.keys()].some((k) => k.includes(UID))).toBe(false);
  });

  it("keeps the rows (team numbers, accuracy) under the opaque id and the name Deleted Account, and leaves other people's rows alone", async () => {
    const w = world();
    await start(w);
    const jobBefore = parseJob(w.store.read(jobPath(UID)))!;
    const opaque = jobBefore.opaqueId;
    expect(isDeletedAccountId(opaque)).toBe(true);
    await finish(w);
    expect(w.store.read(`${frc("scouting")}/s1`)).toMatchObject({ scoutId: opaque, scoutName: DELETED_ACCOUNT_NAME, teamNumber: 254, score: { total: 10 } });
    expect(w.store.read(`${frc("scouting")}/s3`)).toMatchObject({ scoutId: "other", scoutName: "Grace Hopper" });
    expect(w.store.read(`${frc("scouting")}/old1`)).toMatchObject({ scoutName: DELETED_ACCOUNT_NAME, teamNumber: 300 });
    expect(w.store.read(`${frc("matchAssignments")}/a1`)).toMatchObject({ scoutId: opaque, scoutName: DELETED_ACCOUNT_NAME, assignedBy: "boss" });
    expect(w.store.read(`${frc("matchAssignments")}/a2`)).toMatchObject({ scoutId: "other", assignedBy: opaque });
    expect(w.store.read(`${frc("auditLog")}/au1`)).toMatchObject({ uid: opaque, actorName: DELETED_ACCOUNT_NAME });
    expect(w.store.read(`${frc("auditLog")}/au2`)).toMatchObject({ uid: "boss", actorName: "Boss", target: { targetUid: opaque, targetName: DELETED_ACCOUNT_NAME } });
    expect(w.store.read(`${frc("practiceSessions")}/p1`)).toMatchObject({ uid: opaque, scoutId: opaque, scoutName: DELETED_ACCOUNT_NAME, matchNumber: 5 });
    expect(w.store.read(`${ftc("scoutEntries")}/e1`)).toMatchObject({ uid: opaque, scoutName: DELETED_ACCOUNT_NAME });
    expect(w.store.read(`${ftc("practiceSessions")}/fp1`)).toMatchObject({ uid: opaque, scoutName: DELETED_ACCOUNT_NAME });
  });

  it("attendance stays intact: the uid in each list is the opaque id, everyone else untouched", async () => {
    const w = world();
    await start(w);
    const opaque = parseJob(w.store.read(jobPath(UID)))!.opaqueId;
    await finish(w);
    expect(w.store.read(`${frc("teams")}/T1`)?.eventAttendees).toEqual({ "2026wabon": [opaque, "other"], "2026orore": ["other"] });
    expect(w.store.read(`${ftc("eventAttendance")}/F1_2025-USCALAB`)?.uids).toEqual([opaque, "boss"]);
  });

  it("rewrites an FTC assignment document and a lobby, and the team's embedded judge cards", async () => {
    const w = world();
    await start(w);
    const opaque = parseJob(w.store.read(jobPath(UID)))!.opaqueId;
    await finish(w);
    const a = w.store.read(`${ftc("assignments")}/F1_2025-USCALAB`) as { current: { settings: { scoutUids: string[] }; counts: Record<string, number>; slots: { scoutUid: string }[] } };
    expect(a.current.settings.scoutUids).toEqual([opaque, "boss"]);
    expect(a.current.counts).toEqual({ boss: 1, [opaque]: 2 });
    expect(a.current.slots[0].scoutUid).toBe(opaque);
    const lobby = w.store.read(`${frc("lobbies")}/LB-1`) as { pairing: { playerUids: string[]; robotForUid: Record<string, number> }[] };
    expect(lobby.pairing[0].playerUids).toEqual([opaque, "other"]);
    expect(lobby.pairing[0].robotForUid).toEqual({ other: 2, [opaque]: 1 });
    expect(w.store.read(`${frc("teams")}/T1`)?.judgeBookCards).toEqual([{ createdByUid: opaque, createdByName: DELETED_ACCOUNT_NAME }]);
  });

  it("deletes the account documents, requests, presence, notifications, private practice, pointers and the person's own counters, and only theirs", async () => {
    const w = world();
    await start(w);
    await finish(w);
    for (const path of [
      `${frc("users")}/${UID}`, `${frc("profiles")}/${UID}`, `${frc("notifications")}/n1`, `${frc("teamJoinRequests")}/r1`, `${frc("liveMatches")}/${MATCH_KEY}/scouts/${UID}`,
      `${frc("lobbies")}/LB-1/players/${UID}`, `${frc("personalPractice")}/${UID}/sessions/ps1`, `${frc("rateLimits")}/avatar-upload_${UID}_77`,
      `${ftc("users")}/${UID}`, `${ftc("joinRequestPointers")}/${UID}`, `${ftc("teams")}/F2/joinRequests/${UID}`, `${ftc("personalPractice")}/${UID}/entries/pe1`,
    ]) expect(w.store.has(path), path).toBe(false);
    expect(w.store.has(`${frc("rateLimits")}/avatar-upload_someone-else_77`)).toBe(true);
    expect(w.store.has(`${frc("users")}/other`)).toBe(true);
    expect(w.store.has(`${frc("users")}/boss`)).toBe(true);
  });

  it("an application keeps its status and team number but loses the applicant's name and email; a block keeps its id and loses the email value", async () => {
    const w = world();
    await start(w);
    const opaque = parseJob(w.store.read(jobPath(UID)))!.opaqueId;
    await finish(w);
    expect(w.store.read(`${frc("teamApplications")}/ap1`)).toEqual({ applicantUid: opaque, status: "approved", teamNumber: "254", decidedBy: "owner" });
    expect(w.store.read(`${frc("applicationBlocks")}/email_k1`)).toEqual({ type: "email", reason: "abuse", createdBy: "owner" });
  });

  it("copies each membership to {teamId}_{opaque} as past/deleted with its role and dates, and removes the old document", async () => {
    const w = world();
    await start(w);
    const opaque = parseJob(w.store.read(jobPath(UID)))!.opaqueId;
    await finish(w);
    expect(w.store.has(`${frc("memberships")}/T1_${UID}`)).toBe(false);
    expect(w.store.read(`${frc("memberships")}/T1_${opaque}`)).toMatchObject({ uid: opaque, name: DELETED_ACCOUNT_NAME, status: "past", endedBy: "deleted", role: "match-scout", joinedAt: 1000, teamId: "T1" });
  });

  it("with the memberships switch ON a person with only a pointer gets an ended membership made; with it OFF none is made", async () => {
    const on = world({ memberships: true });
    await start(on);
    const opaqueOn = parseJob(on.store.read(jobPath(UID)))!.opaqueId;
    await finish(on);
    expect(on.store.read(`${ftc("memberships")}/F1_${opaqueOn}`)).toMatchObject({ uid: opaqueOn, name: DELETED_ACCOUNT_NAME, status: "past", endedBy: "deleted", teamId: "F1" });

    const off = world({ memberships: false });
    await start(off);
    await finish(off);
    expect(off.store.ids(ftc("memberships"))).toEqual([]);
    expect(survivors(off, UID)).toEqual([]);
  });

  it("writes audit lines without the person's uid, name or email, and the finish line lists what is left for the owner", async () => {
    const w = world();
    await start(w);
    await finish(w);
    const text = JSON.stringify(w.deps.audits);
    expect(text).not.toContain(UID);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(NAME);
    expect(w.deps.audits.map((a) => a.action)).toEqual(["start-account-deletion", "finish-account-deletion"]);
    const fin = w.deps.audits[1].details as { unprocessed: string[]; rewritten: Record<string, number> };
    expect(fin.unprocessed).toContain("formTemplateSubdocs");
    expect(fin.rewritten["frc:scouting"]).toBeGreaterThan(0);
  });
});

describe("the job document", () => {
  it("holds no uid, name or email in any of its fields, only the opaque id, steps, counters and team ids", async () => {
    const w = world();
    await start(w);
    const raw = JSON.stringify(w.store.read(jobPath(UID)));
    for (const needle of [UID, NAME, EMAIL, "ada", "lovelace"]) expect(raw.toLowerCase()).not.toContain(needle.toLowerCase());
    expect(Object.keys(w.store.read(jobPath(UID))!).sort()).toEqual(["counters", "derived", "lastError", "notBeforeMs", "opaqueId", "passDone", "programs", "requestedBy", "runs", "startedAt", "status", "step", "sweepLoops", "teamIds", "updatedAt"].sort());
  });

  it("the owner's list shows opaque ids and statuses only", async () => {
    const w = world();
    await start(w);
    const list = await listJobs(w.deps);
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(UID);
    expect(Object.keys(list[0]).sort()).toEqual(["lastError", "notBeforeMs", "opaqueId", "requestedBy", "runs", "startedAt", "status", "step", "sweepLoops", "updatedAt"]);
    expect(await uidForOpaque(w.deps, list[0].opaqueId)).toBe(UID);
    expect(await uidForOpaque(w.deps, "deleted-nothing")).toBeNull();
  });

  it("the opaque id is 128 random bits, never derived from the uid, never reused", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newOpaqueId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(isDeletedAccountId(id)).toBe(true);
      expect(id).not.toContain(UID);
    }
  });
});

describe("guards", () => {
  it("refuses while an open job exists (409 deletion_in_progress), and creates no second job", async () => {
    const w = world();
    await start(w);
    const again = await start(w);
    expect(again).toMatchObject({ status: 409, body: { code: "deletion_in_progress" } });
  });

  it("refuses a platform owner (403 platform_owner) and changes nothing", async () => {
    const w = world();
    w.auth.addUser({ uid: UID, email: EMAIL, emailVerified: true, platformOwnerClaim: true });
    process.env.RELEASE_OWNER_UIDS = UID;
    try {
      const r = await start(w);
      expect(r).toMatchObject({ status: 403, body: { code: "platform_owner" } });
    } finally {
      delete process.env.RELEASE_OWNER_UIDS;
    }
    expect(w.auth.users.get(UID)?.disabled).toBe(false);
    expect(w.store.has(jobPath(UID))).toBe(false);
  });

  it("refuses the only admin of a team that still has other members (409 last_admin), and the sole member may go", async () => {
    const w = world({
      extra: (s) => {
        s.seed(`${frc("users")}/${UID}`, { email: EMAIL, displayName: NAME, teamId: "T9", isTeamAdmin: true, role: "coach" });
        s.seed(`${frc("users")}/mate`, { displayName: "Mate", teamId: "T9", role: "match-scout" });
        s.seed(`${frc("teams")}/T9`, { ownerUid: UID });
      },
    });
    expect(await start(w)).toMatchObject({ status: 409, body: { code: "last_admin" } });
    expect(w.auth.users.get(UID)?.disabled).toBe(false);

    const solo = world({
      extra: (s) => {
        s.seed(`${frc("users")}/${UID}`, { email: EMAIL, displayName: NAME, teamId: "T9", isTeamAdmin: true, role: "coach" });
        s.seed(`${frc("teams")}/T9`, { ownerUid: UID, verifiedOwnerId: UID });
      },
    });
    expect((await start(solo)).status).toBe(200);
    await finish(solo);
    // A team is never deleted: it stays, ownerless, with the owner fields rewritten.
    const team = solo.store.read(`${frc("teams")}/T9`) as { ownerUid: string; verifiedOwnerId: string };
    expect(isDeletedAccountId(team.ownerUid)).toBe(true);
    expect(isDeletedAccountId(team.verifiedOwnerId)).toBe(true);
  });

  it("an owner with other members is refused even when another admin exists (the owner must transfer first)", async () => {
    const w = world({
      extra: (s) => {
        s.seed(`${frc("users")}/${UID}`, { displayName: NAME, teamId: "T9", isTeamAdmin: true, role: "coach" });
        s.seed(`${frc("users")}/co`, { displayName: "Co", teamId: "T9", isTeamAdmin: true, role: "coach" });
        s.seed(`${frc("teams")}/T9`, { ownerUid: UID });
      },
    });
    expect(await start(w)).toMatchObject({ status: 409, body: { code: "last_admin" } });
  });
});

describe("cooldown", () => {
  it("does not rewrite or delete anything before the cooldown ends, however often it is resumed", async () => {
    const w = world();
    await start(w);
    const snapshot = w.store.dump();
    for (let i = 0; i < 3; i++) {
      w.clock.now += 60_000;
      const r = await runDeletion(w.deps, UID, BIG);
      expect(r.body).toMatchObject({ stoppedBy: "cooldown" });
    }
    const withoutJob = (s: string) => JSON.stringify((JSON.parse(s) as [string, unknown][]).filter(([k]) => k !== jobPath(UID)).map(([k, v]) => [k, (v as { data: unknown }).data]));
    expect(withoutJob(w.store.dump())).toEqual(withoutJob(snapshot));
    // A resume while waiting costs the job document read and one write, nothing else.
    expect(w.auth.users.get(UID)?.disabled).toBe(true);
  });
});

describe("idempotency, resume after a crash, and the budget", () => {
  const dumpOf = (w: World) => JSON.stringify([...w.store.docs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.data]));

  it("runs to the same final data whether it is interrupted at every possible commit or not", async () => {
    const clean = world();
    await start(clean);
    await finish(clean);
    const expected = dumpOf(clean);
    expect(survivors(clean, UID)).toEqual([]);

    // Fail the Nth commit (every N from 1 to the number of commits a clean run makes), then resume.
    const total = clean.store.commits.length;
    for (let n = 1; n <= total; n += 1) {
      const w = world();
      let seen = 0;
      w.store.failCommit(() => ++seen === n, new Error("injected"), 1);
      let first: unknown = null;
      try {
        first = await start(w);
      } catch {
        // the failure may surface from the first run
      }
      void first;
      // Resume until done (a failed commit throws out of the run; the next run continues).
      for (let i = 0; i < 400; i += 1) {
        const exists = w.store.has(jobPath(UID));
        if (!exists && !w.auth.users.has(UID)) break;
        if (!exists) {
          // the failure hit the job document's creation: start again
          try { await start(w); } catch { /* next loop */ }
          continue;
        }
        try {
          const r = await runDeletion(w.deps, UID, BIG);
          if (r.body.stoppedBy === "cooldown") w.clock.now += COOLDOWN_MS + 1;
          if (r.body.done === true) break;
        } catch {
          /* injected failure: resume */
        }
      }
      expect(w.auth.users.has(UID), `commit ${n}: auth user removed`).toBe(false);
      expect(w.store.has(jobPath(UID)), `commit ${n}: job removed`).toBe(false);
      expect(survivors(w, UID), `commit ${n}: leftovers`).toEqual([]);
      // Same rewritten rows as a clean run (the opaque id differs between worlds only by its counter: compare shapes).
      const normalize = (s: string) => s.replace(/deleted-[0-9a-f]{32}/g, "OPAQUE");
      expect(normalize(dumpOf(w)), `commit ${n}: same data as a clean run`).toBe(normalize(expected));
    }
  }, 120_000);

  it("a Firestore failure in a step surfaces, records only a code on the job, and the next run continues", async () => {
    const w = world();
    await start(w);
    w.clock.now += COOLDOWN_MS + 1;
    w.store.failQuery((q) => q.path === frc("scouting"), Object.assign(new Error("boom"), { code: 14 }));
    await expect(runDeletion(w.deps, UID, BIG)).rejects.toThrow("boom");
    const job = parseJob(w.store.read(jobPath(UID)))!;
    expect(job.lastError).toBe("code 14");
    const { last } = await finish(w);
    expect(last.body.done).toBe(true);
  });

  it("an Auth failure at disable leaves the job at disable and nothing touched; a retry disables", async () => {
    const w = world();
    w.auth.fail("disable", new Error("auth down"));
    await expect(start(w)).rejects.toThrow("auth down");
    expect(w.store.read(`${frc("scouting")}/s1`)?.scoutId).toBe(UID);
    const r = await runDeletion(w.deps, UID, BIG);
    expect(r.body.status).toBe("cooldown");
    expect(w.auth.users.get(UID)?.disabled).toBe(true);
  });

  it("a blob failure stops at avatars; the next run removes the avatars and finishes", async () => {
    const w = world();
    w.blobs.failTimes = 1;
    await start(w);
    w.clock.now += COOLDOWN_MS + 1;
    await expect(runDeletion(w.deps, UID, BIG)).rejects.toThrow("blob");
    expect(parseJob(w.store.read(jobPath(UID)))?.step).toBe("avatars");
    const { last } = await finish(w);
    expect(last.body.done).toBe(true);
    expect(w.blobs.removed).toEqual([UID]);
  });

  it("a user already gone from Auth is a success at the end (and the audit and job removal still happen)", async () => {
    const w = world();
    await start(w);
    w.clock.now += COOLDOWN_MS + 1;
    w.auth.users.delete(UID);
    const { last } = await finish(w);
    expect(last.body.done).toBe(true);
    expect(w.store.has(jobPath(UID))).toBe(false);
  });

  it("a run never writes more than its write budget and the job continues on the next run until done", async () => {
    const w = world();
    await start(w, { writes: 12, reads: BIG.reads });
    w.clock.now += COOLDOWN_MS + 1;
    let runs = 0;
    let last = await runDeletion(w.deps, UID, { writes: 12, reads: BIG.reads });
    while (last.body.done !== true && runs++ < 300) {
      const before = w.store.writes;
      last = await runDeletion(w.deps, UID, { writes: 12, reads: BIG.reads });
      // Documents written by one run: the budget plus the job document's own progress saves (one per entry that wrote, a few per step).
      expect(w.store.writes - before).toBeLessThanOrEqual(12 + 40);
    }
    expect(last.body.done).toBe(true);
    expect(survivors(w, UID)).toEqual([]);
    expect(runs).toBeGreaterThan(1);
  }, 60_000);

  it("a run stops at its read budget and the job continues on the next run", async () => {
    const w = world();
    await start(w, { writes: BIG.writes, reads: 40 });
    w.clock.now += COOLDOWN_MS + 1;
    const first = await runDeletion(w.deps, UID, { writes: BIG.writes, reads: 40 });
    expect(first.body).toMatchObject({ done: false, stoppedBy: "budget" });
    const { last, runs } = await finish(w, { writes: BIG.writes, reads: 40 }, 400);
    expect(runs).toBeGreaterThan(2);
    expect(last.body.done).toBe(true);
    expect(survivors(w, UID)).toEqual([]);
  }, 60_000);

  it("a run that is out of time stops cleanly and the next run continues", async () => {
    const w = world();
    await start(w);
    w.clock.now += COOLDOWN_MS + 1;
    const r = await runDeletion(w.deps, UID, BIG, { deadlineMs: -1 });
    expect(r.body).toMatchObject({ done: false, stoppedBy: "time" });
    const { last } = await finish(w);
    expect(last.body.done).toBe(true);
  });
});

describe("late writes: the sweep must find nothing", () => {
  const lateRow = (w: World, n: number) => w.store.seed(`${frc("scouting")}/late${n}`, { scoutId: UID, scoutName: NAME, teamId: "T1", teamNumber: 999 });

  it("a row written after the rewrite step sends the job back to rewrite and delete, then it finishes", async () => {
    const w = world();
    await start(w);
    w.clock.now += COOLDOWN_MS + 1;
    let n = 0;
    // The person's old token writes once, just before the avatars step.
    const original = w.blobs.deleteAvatars.bind(w.blobs);
    w.blobs.deleteAvatars = async (uid) => {
      if (n === 0) lateRow(w, n++);
      return original(uid);
    };
    const { last } = await finish(w);
    expect(last.body).toMatchObject({ done: true });
    expect(w.store.read(`${frc("scouting")}/late0`)).toMatchObject({ scoutName: DELETED_ACCOUNT_NAME });
    expect(isDeletedAccountId(w.store.read(`${frc("scouting")}/late0`)?.scoutId)).toBe(true);
    expect(survivors(w, UID)).toEqual([]);
  });

  it("a writer that keeps writing makes the job loop back up to 3 times, then it is marked stalled and does NOT finish", async () => {
    const w = world();
    await start(w);
    w.clock.now += COOLDOWN_MS + 1;
    let n = 0;
    const original = w.blobs.deleteAvatars.bind(w.blobs);
    w.blobs.deleteAvatars = async (uid) => {
      lateRow(w, n++);
      return original(uid);
    };
    const { last } = await finish(w);
    expect(last.body).toMatchObject({ done: false, status: "stalled" });
    const job = parseJob(w.store.read(jobPath(UID)))!;
    expect(job.status).toBe("stalled");
    expect(job.sweepLoops).toBe(MAX_SWEEP_LOOPS);
    expect(n).toBe(MAX_SWEEP_LOOPS + 1);
    expect(w.auth.users.has(UID)).toBe(true); // not deleted: the job did not finish
    expect(w.deps.audits.map((a) => a.action)).toContain("stall-account-deletion");
    // A plain resume does not move a stalled job; the owner's resume (resumeStalled) does, and with the writer gone it finishes.
    expect((await runDeletion(w.deps, UID, BIG)).body.status).toBe("stalled");
    w.blobs.deleteAvatars = original;
    const done = await runDeletion(w.deps, UID, BIG, { resumeStalled: true });
    expect(done.body.done).toBe(true);
    expect(w.auth.users.has(UID)).toBe(false);
    expect(survivors(w, UID)).toEqual([]);
    expect(w.deps.audits.map((a) => a.action)).toContain("resume-account-deletion");
  });

  it("a membership written late (a sign-in sync) and presence written late at a known match are found by the sweep", async () => {
    const w = world();
    await start(w);
    w.clock.now += COOLDOWN_MS + 1;
    let done = false;
    const original = w.blobs.deleteAvatars.bind(w.blobs);
    w.blobs.deleteAvatars = async (uid) => {
      if (!done) {
        done = true;
        w.store.seed(`${frc("memberships")}/T1_${UID}`, { uid: UID, teamId: "T1", name: NAME, status: "active", origin: "pointer", role: "match-scout", roles: null, secondaryRoles: [], isAdmin: false, isOwner: false, fieldTeamIds: null, joinedAt: 5, leftAt: null, endedBy: null, updatedAt: 5 });
        w.store.seed(`${frc("liveMatches")}/${MATCH_KEY}/scouts/${UID}`, { uid: UID, name: NAME, teamId: "T1" });
      }
      return original(uid);
    };
    const { last } = await finish(w);
    expect(last.body.done).toBe(true);
    expect(survivors(w, UID)).toEqual([]);
    expect([...w.store.docs.keys()].some((k) => k.includes(UID))).toBe(false);
  });
});

describe("rows that carry only a name", () => {
  it("are rewritten when the stored name is the person's and no one else on the teams has it; otherwise counted and left", async () => {
    const w = world({
      extra: (s) => {
        // A second Ada Lovelace on team T2 (where the person also has an old row), but not on T1.
        s.seed(`${frc("scouting")}/old2`, { scoutId: "", scoutName: NAME, teamId: "T2", teamNumber: 301 });
        s.seed(`${frc("users")}/ada2`, { displayName: NAME, teamId: "T2" });
        s.seed(`${frc("memberships")}/T2_${UID}`, { uid: UID, teamId: "T2", name: NAME, status: "past", origin: "pointer", role: "match-scout", roles: null, secondaryRoles: [], isAdmin: false, isOwner: false, fieldTeamIds: null, joinedAt: 1, leftAt: 2, endedBy: "self", updatedAt: 2 });
      },
    });
    await start(w);
    await finish(w);
    expect(w.store.read(`${frc("scouting")}/old1`)?.scoutName).toBe(DELETED_ACCOUNT_NAME);
    // T2 has a namesake: never guess.
    expect(w.store.read(`${frc("scouting")}/old2`)?.scoutName).toBe(NAME);
    const fin = w.deps.audits.find((a) => a.action === "finish-account-deletion")!.details as { skippedNamesakes: Record<string, number> };
    expect(fin.skippedNamesakes).toEqual({ scouting: 1 });
    expect(JSON.stringify(w.deps.audits)).not.toContain(NAME);
  });

  it("an imported FTC row of the person's name is copied to a new id without the name, matched by name only", async () => {
    const w = world();
    await start(w);
    await finish(w);
    const id = `${ftc("scoutEntries")}/csv_f1_2026-uscalab_q1_100_ada-lovelace-1x2y`;
    expect(w.store.has(id)).toBe(false);
    const moved = `${ftc("scoutEntries")}/csv_f1_2026-uscalab_q1_100_deleted-account-1x2y`;
    expect(w.store.read(moved)).toMatchObject({ uid: "boss", scoutName: DELETED_ACCOUNT_NAME, source: "event" });
  });
});

describe("presence is found without a collection-group query", () => {
  it("through the match key and lobby id of the person's own sessions", async () => {
    const w = world();
    await start(w);
    await finish(w);
    expect(w.store.has(`${frc("liveMatches")}/${MATCH_KEY}/scouts/${UID}`)).toBe(false);
    expect(w.store.has(`${frc("lobbies")}/LB-1/players/${UID}`)).toBe(false);
  });
});

describe("startDeletion input", () => {
  it("rejects an empty or path-like uid", async () => {
    const w = world();
    expect((await startDeletion(w.deps, { uid: "", requestedBy: "self", actor, budget: BIG })).status).toBe(400);
    expect((await startDeletion(w.deps, { uid: "a/b", requestedBy: "owner", actor, budget: BIG })).status).toBe(400);
  });
});

describe("memberships OFF: the user document pointer is the only membership", () => {
  it("a stale membership row of another person does not block the guard (the roster is the pointer roster)", async () => {
    const w = world({
      memberships: false,
      extra: (s) => {
        s.seed(`${frc("users")}/${UID}`, { email: EMAIL, displayName: NAME, teamId: "T7", isTeamAdmin: true, role: "coach" });
        s.seed(`${frc("teams")}/T7`, { ownerUid: UID });
        // A membership of someone who is no longer there (stale): with the switch OFF it must not count as "other active members".
        s.seed(`${frc("memberships")}/T7_ghost`, { uid: "ghost", teamId: "T7", name: "Ghost", status: "active", origin: "pointer", role: "match-scout", roles: null, secondaryRoles: [], isAdmin: false, isOwner: false, fieldTeamIds: null, joinedAt: 1, leftAt: null, endedBy: null, updatedAt: 1 });
      },
    });
    expect((await start(w)).status).toBe(200);
    const on = world({
      memberships: true,
      extra: (s) => {
        s.seed(`${frc("users")}/${UID}`, { email: EMAIL, displayName: NAME, teamId: "T7", isTeamAdmin: true, role: "coach" });
        s.seed(`${frc("teams")}/T7`, { ownerUid: UID });
        s.seed(`${frc("memberships")}/T7_ghost`, { uid: "ghost", teamId: "T7", name: "Ghost", status: "active", origin: "pointer", role: "match-scout", roles: null, secondaryRoles: [], isAdmin: false, isOwner: false, fieldTeamIds: null, joinedAt: 1, leftAt: null, endedBy: null, updatedAt: 1 });
      },
    });
    expect(await start(on)).toMatchObject({ status: 409, body: { code: "last_admin" } });
  });
});
