import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/server/test-support/fake-firestore";
import type { EventMatch } from "@/lib/events/types";

// Token verification, the Admin Firestore and the events API are all mocked: no real key, no real project, no network.
const mocks = vi.hoisted(() => ({ checkSession: vi.fn(), requireUser: vi.fn(), db: vi.fn(), fetchMatches: vi.fn(), cronSecret: vi.fn(), ftcMissing: vi.fn() }));
vi.mock("@/lib/server/require-user", () => ({ checkSession: mocks.checkSession, requireUser: mocks.requireUser }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminFirestore: mocks.db, getAdminMessaging: () => null, firebaseAdminProblem: () => null }));
vi.mock("@/lib/events/matches-internal", () => ({ fetchMatchesForEventInternal: mocks.fetchMatches }));
vi.mock("@/lib/server/env", async (orig) => ({ ...(await orig<typeof import("@/lib/server/env")>()), cronSecret: mocks.cronSecret, tbaApiKey: () => "tba", ftcApiCredentials: () => ({ username: "u", apiKey: "k" }), ftcApiMissingNames: mocks.ftcMissing }));

import { resolvePendingLiveMatches } from "@/lib/live/resolve-pending";
import { resolveLobbyResults } from "@/lib/lobby/resolve-results";
import { POST as checkScores } from "@/app/api/live/check-scores/route";
import { POST as resolveResults } from "@/app/api/lobby/resolve-results/route";
import { GET as cron } from "@/app/api/cron/poll-live-scores/route";
import { liveProgramStore, programFromBody } from "@/lib/server/live-program";
import { POST as detectEvent } from "@/app/api/live/detect-event/route";

const match = (over: Partial<EventMatch> = {}): EventMatch => ({
  id: "Q7", matchNumber: 7, type: "Qualification", description: null, series: null, played: true,
  redTeams: [100, 200], blueTeams: [300, 400], redScore: 85, blueScore: 70, redPenaltyPoints: 5, bluePenaltyPoints: 0, startTime: null, ...over,
});

const session = (uid: string, robot: number, entryId: string, over: Record<string, unknown> = {}) => ({
  teamId: "T1", uid, kind: "live", status: "completed", accuracy: null, eventCode: "USTXHOU", matchType: "Qualification", matchNumber: 7,
  alliance: "red", allianceTeams: [100, 200], robots: [robot], entryIds: [entryId], scoutName: uid, ...over,
});
const entry = (uid: string, team: number, total: number, over: Record<string, unknown> = {}) => ({
  teamId: "T1", uid, source: "live", eventCode: "USTXHOU", matchType: "Qualification", matchNumber: 7, teamNumber: team, score: { auto: 0, teleop: 0, endgame: 0, total },
  submittedAt: "2026-11-01T10:00:00.000Z", excluded: false, accuracy: null, autoFlags: [], manualFlags: [], formId: "f", formVersion: 1, ...over,
});

let fake: FakeFirestore;
beforeEach(() => {
  fake = new FakeFirestore();
  mocks.checkSession.mockReset().mockResolvedValue({ ok: true, uid: "u1" });
  mocks.requireUser.mockReset().mockResolvedValue({ uid: "u1" });
  mocks.db.mockReset().mockImplementation(() => fake.asFirestore());
  mocks.fetchMatches.mockReset().mockResolvedValue([match()]);
  mocks.cronSecret.mockReset().mockReturnValue("s3cret");
  mocks.ftcMissing.mockReset().mockReturnValue([]);
});

const seedLive = () => {
  fake.seed("programs/ftc/practiceSessions/LV-1", session("u1", 100, "e1"));
  fake.seed("programs/ftc/practiceSessions/LV-2", session("u2", 200, "e2"));
  fake.seed("programs/ftc/scoutEntries/e1", entry("u1", 100, 40));
  fake.seed("programs/ftc/scoutEntries/e2", entry("u2", 200, 42));
};

describe("the live-score poller for the second program: its own collections, its own readers, its own match source", () => {
  it("resolves a fully scouted alliance once the official score is posted: sessions and entries are written under programs/ftc, a notification is created", async () => {
    seedLive();
    const out = await resolvePendingLiveMatches(fake.asFirestore(), null, undefined, "ftc");
    expect(out).toEqual({ checked: 2, resolved: 1 });
    expect(mocks.fetchMatches).toHaveBeenCalledWith("USTXHOU", "Qualification", undefined, "ftc");
    for (const id of ["LV-1", "LV-2"]) {
      const s = fake.read(`programs/ftc/practiceSessions/${id}`)!;
      expect(s.officialScore).toBe(85);
      expect(s.penaltyPoints).toBe(5);
      expect(s.scoutedTotal).toBe(87); // the robots' 40 + 42 plus the alliance's 5 foul points: what the official 85 is compared with
      expect(s.accuracy).not.toBeNull();
    }
    for (const id of ["e1", "e2"]) {
      const e = fake.read(`programs/ftc/scoutEntries/${id}`)!;
      expect(e.accuracy).toMatchObject({ status: "complete", officialScore: 85 }); // stored on the entry (no flag-state collection)
      expect(Array.isArray(e.autoFlags)).toBe(true);
    }
    expect(fake.read("programs/ftc/notifications/LV-1")).toMatchObject({ teamId: "T1", uid: "u1", type: "live-score-ready" });
    expect(fake.read("programs/ftc/notifications/LV-2")).toMatchObject({ uid: "u2" });
  });

  it("writes NOTHING outside programs/ftc, and never reads the default program's sessions", async () => {
    seedLive();
    fake.seed("practiceSessions/LV-ROOT", session("u9", 100, "r1")); // a default-program session that is also pending
    fake.seed("scouting/r1", entry("u9", 100, 10));
    await resolvePendingLiveMatches(fake.asFirestore(), null, undefined, "ftc");
    expect(fake.read("practiceSessions/LV-ROOT")?.accuracy).toBeNull();
    expect(fake.read("scouting/r1")?.accuracy).toBeNull();
    expect(fake.ids("notifications")).toEqual([]);
    const written = [...fake.store.keys()].filter((k) => !k.startsWith("programs/ftc/") && k !== "practiceSessions/LV-ROOT" && k !== "scouting/r1");
    expect(written).toEqual([]);
  });

  it("waits while the alliance is not covered: one robot of two scouted resolves nothing", async () => {
    fake.seed("programs/ftc/practiceSessions/LV-1", session("u1", 100, "e1"));
    fake.seed("programs/ftc/scoutEntries/e1", entry("u1", 100, 40));
    expect(await resolvePendingLiveMatches(fake.asFirestore(), null, undefined, "ftc")).toEqual({ checked: 1, resolved: 0 });
    expect(fake.read("programs/ftc/practiceSessions/LV-1")?.accuracy).toBeNull();
  });

  it("waits while the official score has not posted; nothing is written", async () => {
    seedLive();
    mocks.fetchMatches.mockResolvedValue([match({ redScore: null, played: false })]);
    expect(await resolvePendingLiveMatches(fake.asFirestore(), null, undefined, "ftc")).toEqual({ checked: 2, resolved: 0 });
    expect(fake.read("programs/ftc/practiceSessions/LV-1")?.accuracy).toBeNull();
    expect(fake.read("programs/ftc/scoutEntries/e1")?.accuracy).toBeNull();
  });

  it("a pending score is retried, never marked 0: it resolves on a later run once the score posts", async () => {
    seedLive();
    mocks.fetchMatches.mockResolvedValue([match({ redScore: null, played: false })]);
    await resolvePendingLiveMatches(fake.asFirestore(), null, undefined, "ftc");
    expect(fake.read("programs/ftc/practiceSessions/LV-1")?.accuracy).toBeNull(); // not 0
    mocks.fetchMatches.mockResolvedValue([match()]);
    expect(await resolvePendingLiveMatches(fake.asFirestore(), null, undefined, "ftc")).toEqual({ checked: 2, resolved: 1 });
    expect(fake.read("programs/ftc/practiceSessions/LV-1")?.officialScore).toBe(85);
  });

  it("idempotent: the poller and a client check at once resolve the alliance ONCE, and a later run finds nothing pending", async () => {
    seedLive();
    const writes: string[] = [];
    const realRef = fake.docRef.bind(fake);
    fake.docRef = ((path: string) => {
      const ref = realRef(path);
      const update = ref.update;
      ref.update = async (data: Record<string, unknown>) => {
        if (path.startsWith("programs/ftc/practiceSessions/") && "accuracy" in data) writes.push(path);
        return update(data);
      };
      return ref;
    }) as typeof fake.docRef;
    const [poller, client] = await Promise.all([
      resolvePendingLiveMatches(fake.asFirestore(), null, undefined, "ftc"),
      resolvePendingLiveMatches(fake.asFirestore(), null, "u1", "ftc"),
    ]);
    expect(poller.resolved + client.resolved).toBe(1);
    expect(writes.sort()).toEqual(["programs/ftc/practiceSessions/LV-1", "programs/ftc/practiceSessions/LV-2"]); // each session's accuracy written once
    expect(await resolvePendingLiveMatches(fake.asFirestore(), null, undefined, "ftc")).toEqual({ checked: 0, resolved: 0 });
  });

  it("an existing notification is never overwritten or re-sent (create is atomic)", async () => {
    seedLive();
    fake.seed("programs/ftc/notifications/LV-1", { marker: "first run" });
    await expect(resolvePendingLiveMatches(fake.asFirestore(), null, undefined, "ftc")).resolves.toEqual({ checked: 2, resolved: 1 });
    expect(fake.read("programs/ftc/notifications/LV-1")).toEqual({ marker: "first run" });
    expect(fake.read("programs/ftc/notifications/LV-2")).toMatchObject({ uid: "u2" });
  });

  it("a failed schedule fetch (missing keys) skips the alliance and does not throw", async () => {
    seedLive();
    mocks.fetchMatches.mockRejectedValue(new Error("missing credentials"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await resolvePendingLiveMatches(fake.asFirestore(), null, undefined, "ftc")).toEqual({ checked: 2, resolved: 0 });
  });

  it("scoped to one scout (the client check): only that scout's sessions are looked at", async () => {
    seedLive();
    expect((await resolvePendingLiveMatches(fake.asFirestore(), null, "u1", "ftc")).checked).toBe(1);
  });

  it("an alliance with no recorded roster is covered by the program's own alliance size (2), not 3", async () => {
    fake.seed("programs/ftc/practiceSessions/LV-1", session("u1", 100, "e1", { allianceTeams: null }));
    fake.seed("programs/ftc/practiceSessions/LV-2", session("u2", 200, "e2", { allianceTeams: null }));
    fake.seed("programs/ftc/scoutEntries/e1", entry("u1", 100, 40));
    fake.seed("programs/ftc/scoutEntries/e2", entry("u2", 200, 42));
    expect((await resolvePendingLiveMatches(fake.asFirestore(), null, undefined, "ftc")).resolved).toBe(1);
  });

  it("the default program is untouched: the same call with no program reads the root collections and writes CS's entry fields", async () => {
    fake.seed("practiceSessions/LV-1", session("u1", 100, "e1", { allianceTeams: [100, 200, 300] }));
    fake.seed("practiceSessions/LV-2", session("u2", 200, "e2", { allianceTeams: [100, 200, 300] }));
    fake.seed("practiceSessions/LV-3", session("u3", 300, "e3", { allianceTeams: [100, 200, 300] }));
    for (const [id, uid, team] of [["e1", "u1", 100], ["e2", "u2", 200], ["e3", "u3", 300]] as const) {
      fake.seed(`scouting/${id}`, { teamId: "T1", scoutId: uid, scoutName: uid, isLivePracticeScouting: true, teamNumber: team, eventKey: "2026txhou", matchLabel: "Q7", timestamp: 1, totalScore: 30 });
    }
    mocks.fetchMatches.mockResolvedValue([match({ redTeams: [100, 200, 300] })]);
    const out = await resolvePendingLiveMatches(fake.asFirestore(), null);
    expect(out.checked).toBe(3);
    expect(mocks.fetchMatches).toHaveBeenCalledWith("USTXHOU", "Qualification", undefined, "frc");
    expect(fake.ids("programs/ftc/practiceSessions")).toEqual([]);
  });
});

describe("the lobby resolver for the second program", () => {
  const seedLobby = (libraryAlliance: Record<string, unknown> = { teams: [100, 200], score: 85, penaltyPoints: 5 }) => {
    fake.seed("programs/ftc/lobbies/LB-AAAAAA", {
      teamId: "T1", hostUid: "h", status: "scouting", mode: "trial", libraryMatchId: "USTXHOU_Q7",
      pairing: [{ pairId: "pair-1", playerUids: ["u1", "u2"], alliance: "red", robotForUid: { u1: 100, u2: 200 } }],
    });
    fake.seed("programs/ftc/libraryMatches/USTXHOU_Q7", {
      seasonId: "biobuzz", eventCode: "USTXHOU", eventName: "Houston", matchType: "Qualification", matchNumber: 7, published: true, origin: "manual",
      alliances: { red: libraryAlliance, blue: { teams: [300, 400], score: 70, penaltyPoints: 0 } },
    });
    const s = (uid: string, entryId: string) => ({ teamId: "T1", uid, kind: "lobby", status: "completed", lobbyId: "LB-AAAAAA", pairId: "pair-1", alliance: "red", entryIds: [entryId], accuracy: null });
    fake.seed("programs/ftc/practiceSessions/LB-S1", s("u1", "e1"));
    fake.seed("programs/ftc/practiceSessions/LB-S2", s("u2", "e2"));
    fake.seed("programs/ftc/scoutEntries/e1", entry("u1", 100, 40, { source: "practice" }));
    fake.seed("programs/ftc/scoutEntries/e2", entry("u2", 200, 42, { source: "practice" }));
  };

  it("writes the pair's accuracy on both sessions (programs/ftc) and flips the lobby to results", async () => {
    seedLobby();
    expect(await resolveLobbyResults(fake.asFirestore(), "LB-AAAAAA", "ftc")).toEqual({ resolved: 1, totalPairs: 1 });
    for (const id of ["LB-S1", "LB-S2"]) expect(fake.read(`programs/ftc/practiceSessions/${id}`)).toMatchObject({ officialScore: 85, penaltyPoints: 5, scoutedTotal: 87 });
    expect(fake.read("programs/ftc/practiceSessions/LB-S1")?.accuracy).toEqual(expect.any(Number));
    expect(fake.read("programs/ftc/lobbies/LB-AAAAAA")?.status).toBe("results");
  });

  it("an alliance with no official score yet keeps the total and has no accuracy (null, never 0)", async () => {
    seedLobby({ teams: [100, 200] });
    await resolveLobbyResults(fake.asFirestore(), "LB-AAAAAA", "ftc");
    expect(fake.read("programs/ftc/practiceSessions/LB-S1")).toMatchObject({ accuracy: null, scoutedTotal: 82, officialScore: null });
  });

  it("is idempotent: a second call is a no-op", async () => {
    seedLobby();
    await resolveLobbyResults(fake.asFirestore(), "LB-AAAAAA", "ftc");
    expect(await resolveLobbyResults(fake.asFirestore(), "LB-AAAAAA", "ftc")).toEqual({ resolved: 0, totalPairs: 1 });
  });

  it("an incomplete group (one of two players finished) is left as 'did not finish'", async () => {
    seedLobby();
    fake.store.delete("programs/ftc/practiceSessions/LB-S2");
    expect((await resolveLobbyResults(fake.asFirestore(), "LB-AAAAAA", "ftc")).resolved).toBe(0);
  });
});

const post = (url: string, body?: unknown) => new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("/api/live/check-scores", () => {
  const seedAccounts = () => {
    fake.seed("programs/ftc/users/u1", { teamId: "T1" });
    fake.seed("programs/ftc/users/u2", { teamId: "T1" });
    fake.seed("programs/ftc/users/rate-1", { teamId: "T1" });
    fake.seed("users/rate-1", { teamId: "T1" });
    fake.seed("users/u-root", { teamId: "T1" });
  };
  const call = (body?: unknown) => checkScores(post("/api/live/check-scores", body));

  it("401 when not signed in, 503 when the server cannot verify anyone", async () => {
    mocks.checkSession.mockResolvedValueOnce({ ok: false, reason: "not-signed-in", message: "Sign in." });
    expect((await call({ program: "ftc" })).status).toBe(401);
    mocks.checkSession.mockResolvedValueOnce({ ok: false, reason: "not-configured", message: "Set FIREBASE_ADMIN_*." });
    expect((await call({ program: "ftc" })).status).toBe(503);
  });

  it("polls only the caller's own sessions in the program named in the body", async () => {
    seedAccounts();
    seedLive();
    mocks.checkSession.mockResolvedValue({ ok: true, uid: "u2" });
    const res = await call({ program: "ftc" });
    expect(await res.json()).toMatchObject({ ok: true, checked: 1, resolved: 0 }); // u2 only: the alliance needs u1's session too, which is not the caller's
  });

  it("program is REQUIRED: no body, no program, an empty one and an unknown one are all a 400 and touch nothing", async () => {
    seedAccounts();
    seedLive();
    for (const body of [undefined, {}, { program: "" }, { program: null }, { program: "../../etc" }, { program: "FTC" }, { program: 7 }]) {
      const res = await call(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false, code: expect.stringMatching(/^(program_required|unknown_program)$/) });
    }
    expect(fake.read("programs/ftc/practiceSessions/LV-1")?.accuracy).toBeNull();
  });

  it("the program is never taken from a cookie or a header", async () => {
    seedAccounts();
    const req = new Request("http://localhost/api/live/check-scores", { method: "POST", headers: { "content-type": "application/json", cookie: "program=ftc", "x-program": "ftc" }, body: "{}" });
    expect((await checkScores(req)).status).toBe(400);
  });

  it("403 for a person with no account in THAT program (an account in the other program does not count), and for an account with no team", async () => {
    seedAccounts();
    fake.seed("programs/ftc/users/no-team", {});
    mocks.checkSession.mockResolvedValue({ ok: true, uid: "u-root" });
    expect((await call({ program: "ftc" })).status).toBe(403);
    mocks.checkSession.mockResolvedValue({ ok: true, uid: "no-team" });
    expect((await call({ program: "ftc" })).status).toBe(403);
    mocks.checkSession.mockResolvedValue({ ok: true, uid: "nobody" });
    expect((await call({ program: "frc" })).status).toBe(403);
  });

  it("the default program still answers for its own members when it names itself", async () => {
    seedAccounts();
    mocks.checkSession.mockResolvedValue({ ok: true, uid: "u-root" });
    expect(await (await call({ program: "frc" })).json()).toMatchObject({ ok: true, checked: 0 });
  });

  it("missing keys come back as a warning that names both variables", async () => {
    seedAccounts();
    mocks.checkSession.mockResolvedValue({ ok: true, uid: "u1" });
    mocks.ftcMissing.mockReturnValue(["FTC_API_USERNAME", "FTC_API_KEY"]);
    const body = await (await call({ program: "ftc" })).json();
    expect(body.warnings?.join(" ")).toMatch(/FTC_API_USERNAME/);
    expect(body.warnings?.join(" ")).toMatch(/FTC_API_KEY/);
  });

  it("is rate limited per person and per program", async () => {
    seedAccounts();
    mocks.checkSession.mockResolvedValue({ ok: true, uid: "rate-1" });
    expect(await (await call({ program: "ftc" })).json()).not.toHaveProperty("rateLimited");
    expect(await (await call({ program: "ftc" })).json()).toMatchObject({ rateLimited: true });
    expect(await (await call({ program: "frc" })).json()).not.toHaveProperty("rateLimited");
  });
});

describe("programFromBody: which program a live or lobby route acts for", () => {
  it("accepts a known program with the feature on; 400 codes for missing, unknown and unsupported", () => {
    expect(programFromBody("ftc", "live")).toEqual({ ok: true, program: "ftc" });
    expect(programFromBody("frc", "lobby")).toEqual({ ok: true, program: "frc" });
    expect(programFromBody(undefined, "live")).toMatchObject({ ok: false, code: "program_required" });
    expect(programFromBody("nope", "live")).toMatchObject({ ok: false, code: "unknown_program" });
    const off = (p: string) => (p === "ftc" ? { live: false, lobby: true } : { live: true, lobby: true });
    expect(programFromBody("ftc", "live", off)).toMatchObject({ ok: false, code: "program_not_supported" });
    expect(programFromBody("ftc", "lobby", off)).toEqual({ ok: true, program: "ftc" });
  });
});

describe("/api/live/detect-event", () => {
  it("program is required: 400 before any network call", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    for (const body of [{ url: "https://youtu.be/abc" }, { url: "https://youtu.be/abc", program: "zzz" }]) {
      expect((await detectEvent(post("/api/live/detect-event", body))).status).toBe(400);
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("/api/lobby/resolve-results", () => {
  const seedTeams = () => {
    fake.seed("programs/ftc/users/u1", { teamId: "T1" });
    fake.seed("programs/ftc/users/u-other", { teamId: "T2" });
    fake.seed("users/u-root", { teamId: "T1" });
    fake.seed("programs/ftc/lobbies/LB-AAAAAA", { teamId: "T1", hostUid: "h", status: "scouting", libraryMatchId: null, pairing: null });
  };

  it("401 when not signed in; 400 without a lobby id; 404 for an unknown lobby", async () => {
    seedTeams();
    mocks.requireUser.mockResolvedValueOnce(null);
    expect((await resolveResults(post("/api/lobby/resolve-results", { lobbyId: "LB-AAAAAA", program: "ftc" }))).status).toBe(401);
    expect((await resolveResults(post("/api/lobby/resolve-results", { program: "ftc" }))).status).toBe(400);
    expect((await resolveResults(post("/api/lobby/resolve-results", { lobbyId: "LB-NOPE", program: "ftc" }))).status).toBe(404);
  });

  it("403 for a person of another team in that program, and for a person who only has an account in the OTHER program", async () => {
    seedTeams();
    mocks.requireUser.mockResolvedValue({ uid: "u-other" });
    expect((await resolveResults(post("/api/lobby/resolve-results", { lobbyId: "LB-AAAAAA", program: "ftc" }))).status).toBe(403);
    mocks.requireUser.mockResolvedValue({ uid: "u-root" }); // same team id, but a default-program account: not a member of the FTC team
    expect((await resolveResults(post("/api/lobby/resolve-results", { lobbyId: "LB-AAAAAA", program: "ftc" }))).status).toBe(403);
  });

  it("200 for a member of the lobby's team in that program", async () => {
    seedTeams();
    const res = await resolveResults(post("/api/lobby/resolve-results", { lobbyId: "LB-AAAAAA", program: "ftc" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("program is REQUIRED: missing or unknown is a 400 (never the default program), and nothing is read", async () => {
    seedTeams();
    for (const body of [{ lobbyId: "LB-AAAAAA" }, { lobbyId: "LB-AAAAAA", program: "" }, { lobbyId: "LB-AAAAAA", program: "../x" }]) {
      expect((await resolveResults(post("/api/lobby/resolve-results", body))).status).toBe(400);
    }
    expect(fake.read("programs/ftc/lobbies/LB-AAAAAA")?.status).toBe("scouting");
  });

  it("naming the default program looks in its own collections only", async () => {
    seedTeams();
    expect((await resolveResults(post("/api/lobby/resolve-results", { lobbyId: "LB-AAAAAA", program: "frc" }))).status).toBe(404); // the lobby is the FTC one
  });
});

describe("/api/cron/poll-live-scores", () => {
  const get = (auth?: string) => cron(new Request("http://localhost/api/cron/poll-live-scores", { headers: auth ? { authorization: auth } : {} }));

  it("503 naming CRON_SECRET when it is not set, 401 with a wrong secret", async () => {
    mocks.cronSecret.mockReturnValueOnce(null);
    expect((await get("Bearer s3cret")).status).toBe(503);
    expect((await get("Bearer wrong")).status).toBe(401);
    expect((await get()).status).toBe(401);
  });

  it("sweeps BOTH programs and reports each", async () => {
    seedLive();
    const res = await get("Bearer s3cret");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, checked: 2, resolved: 1, programs: { frc: { checked: 0, resolved: 0 }, ftc: { checked: 2, resolved: 1 } } });
    expect(fake.read("programs/ftc/practiceSessions/LV-1")?.accuracy).not.toBeNull();
  });

  it("one program failing does not stop the other; the default program failing is still a 500, as before", async () => {
    seedLive();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const realCollection = fake.collection.bind(fake);
    fake.collection = ((name: string) => {
      if (name === "practiceSessions") throw new Error("boom");
      return realCollection(name);
    }) as typeof fake.collection;
    const res = await get("Bearer s3cret");
    expect(res.status).toBe(500);
    expect(fake.read("programs/ftc/practiceSessions/LV-1")?.accuracy).not.toBeNull(); // the other program's sweep still ran
  });
});

describe("the store each program resolves with", () => {
  it("the default program keeps CS's collections and the legacy push path; the other is namespaced and routes to its own page", () => {
    expect(liveProgramStore().paths).toMatchObject({ sessions: "practiceSessions", entries: "scouting", notifications: "notifications", users: "users", libraryMatches: "libraryMatches", lobbies: "lobbies" });
    expect(liveProgramStore().practiceUrl).toBe("/practice-scouting");
    expect(liveProgramStore("ftc").paths).toEqual({
      sessions: "programs/ftc/practiceSessions", entries: "programs/ftc/scoutEntries", notifications: "programs/ftc/notifications",
      users: "programs/ftc/users", libraryMatches: "programs/ftc/libraryMatches", lobbies: "programs/ftc/lobbies",
    });
    expect(liveProgramStore("ftc").practiceUrl).toBe("/ftc/practice-scouting");
    expect(liveProgramStore("ftc").allianceSize).toBe(2);
    expect(liveProgramStore().allianceSize).toBe(3);
  });
});
