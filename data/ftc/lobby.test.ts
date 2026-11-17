import { beforeEach, describe, expect, it, vi } from "vitest";

type Constraint = { field: string; op: string; value: unknown };
type Ref = { kind: "collection" | "doc"; path: string };
type Q = { kind: "query"; ref: Ref; constraints: Constraint[] };
type Watcher = { target: Q | Ref; next: (snap: unknown) => void; error: (err: unknown) => void; unsubscribe: ReturnType<typeof vi.fn> };

const h = vi.hoisted(() => ({
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  tryClaimDoc: vi.fn(),
  watchers: [] as unknown[],
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, p: string, ...s: string[]) => ({ kind: "collection", path: [p, ...s].join("/") }),
  doc: (_db: unknown, p: string, ...s: string[]) => ({ kind: "doc", path: [p, ...s].join("/") }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (ref: unknown, ...constraints: unknown[]) => ({ kind: "query", ref, constraints }),
  serverTimestamp: () => "SERVER_TIME",
  setDoc: (...a: unknown[]) => h.setDoc(...a),
  updateDoc: (...a: unknown[]) => h.updateDoc(...a),
  deleteDoc: (...a: unknown[]) => h.deleteDoc(...a),
  onSnapshot: (target: unknown, next: Watcher["next"], error: Watcher["error"]) => {
    const w: Watcher = { target: target as Q | Ref, next, error, unsubscribe: vi.fn() };
    h.watchers.push(w);
    return w.unsubscribe;
  },
}));
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true } }));
vi.mock("@/lib/claim-doc", () => ({ tryClaimDoc: (...a: unknown[]) => h.tryClaimDoc(...a) }));

import { claimLobby, heartbeatPlayer, joinLobby, leaveLobbyPlayer, markPlayerSubmitted, resetPlayerSubmitted, subscribeLobby, subscribeMyLobby, subscribePlayers, updateLobby } from "@/data/ftc/lobby";
import { clearAllReadFailures } from "@/lib/read-failures";

const watchers = () => h.watchers as Watcher[];
const q = (w: Watcher) => w.target as Q;
const eq = (w: Watcher) => q(w).constraints.map((c) => `${c.field} ${c.op} ${JSON.stringify(c.value)}`);
const lobbySnap = (rows: [string, Record<string, unknown>][]) => ({ docs: rows.map(([id, data]) => ({ id, data: () => data })) });
const playersSnap = (rows: Record<string, unknown>[]) => ({ docs: rows.map((data) => ({ data: () => data })) });
const watcherAt = (path: string) => watchers().find((w) => q(w).ref.path === path)!;

beforeEach(() => {
  h.watchers.length = 0;
  for (const f of [h.setDoc, h.updateDoc, h.deleteDoc, h.tryClaimDoc]) f.mockReset();
  clearAllReadFailures();
});

describe("the lobby itself", () => {
  it("claims a fresh LB- code under programs/ftc/lobbies, as a waiting lobby the host owns; a taken code retries with a new one", async () => {
    h.tryClaimDoc.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const id = await claimLobby("T1", "host", "Hal", "biobuzz", "trial");
    expect(id).toMatch(/^LB-[A-Z0-9]{6}$/);
    expect(h.tryClaimDoc).toHaveBeenCalledTimes(2);
    const [, path, claimedId, data] = h.tryClaimDoc.mock.calls[1];
    expect(path).toBe("programs/ftc/lobbies");
    expect(claimedId).toBe(id);
    expect(data).toMatchObject({ teamId: "T1", hostUid: "host", status: "waiting", seasonId: "biobuzz", mode: "trial", pairing: null });
  });

  it("gives up after the attempts with a message to show", async () => {
    h.tryClaimDoc.mockResolvedValue(false);
    await expect(claimLobby("T1", "host", "Hal", "biobuzz", "trial", 2)).rejects.toThrow(/unique lobby code/);
  });

  it("host updates go to the lobby doc; a failure is rethrown", async () => {
    await updateLobby("LB-AAAAAA", { status: "scouting" });
    expect(h.updateDoc.mock.calls[0][0].path).toBe("programs/ftc/lobbies/LB-AAAAAA");
    h.updateDoc.mockRejectedValueOnce(new Error("denied"));
    await expect(updateLobby("LB-AAAAAA", { status: "closed" })).rejects.toThrow("denied");
  });

  it("subscribes to one lobby by path (null while it does not exist)", () => {
    const seen: unknown[] = [];
    subscribeLobby("LB-AAAAAA", (l) => seen.push(l), () => undefined);
    const w = watchers()[0];
    expect((w.target as Ref).path).toBe("programs/ftc/lobbies/LB-AAAAAA");
    w.next({ id: "LB-AAAAAA", exists: () => false, data: () => undefined });
    w.next({ id: "LB-AAAAAA", exists: () => true, data: () => ({ teamId: "T1", hostUid: "h", status: "waiting" }) });
    expect(seen[0]).toBeNull();
    expect(seen[1]).toMatchObject({ id: "LB-AAAAAA", teamId: "T1" });
  });
});

describe("the roster: a player only ever touches their own doc, and a list carries teamId ==", () => {
  it("join, heartbeat, submitted, reset and leave are all on players/{uid} under the lobby", async () => {
    await joinLobby("LB-AAAAAA", "T1", "u1", "Ana");
    expect(h.setDoc.mock.calls[0][0].path).toBe("programs/ftc/lobbies/LB-AAAAAA/players/u1");
    expect(h.setDoc.mock.calls[0][1]).toMatchObject({ uid: "u1", teamId: "T1", name: "Ana", submitted: false });
    await heartbeatPlayer("LB-AAAAAA", "u1");
    await markPlayerSubmitted("LB-AAAAAA", "u1");
    await resetPlayerSubmitted("LB-AAAAAA", "u1");
    expect(h.updateDoc.mock.calls.map((c) => [c[0].path, c[1]])).toEqual([
      ["programs/ftc/lobbies/LB-AAAAAA/players/u1", { lastSeen: "SERVER_TIME" }],
      ["programs/ftc/lobbies/LB-AAAAAA/players/u1", { submitted: true }],
      ["programs/ftc/lobbies/LB-AAAAAA/players/u1", { submitted: false }],
    ]);
    await leaveLobbyPlayer("LB-AAAAAA", "u1");
    expect(h.deleteDoc.mock.calls[0][0].path).toBe("programs/ftc/lobbies/LB-AAAAAA/players/u1");
  });

  it("the roster read is players where teamId == ours", () => {
    subscribePlayers("LB-AAAAAA", "T1", () => undefined, () => undefined);
    expect(q(watchers()[0]).ref.path).toBe("programs/ftc/lobbies/LB-AAAAAA/players");
    expect(eq(watchers()[0])).toEqual(['teamId == "T1"']);
  });
});

describe('"the lobby I am in": lists the team\'s lobbies, then asks each OPEN one for MY player doc by path (NO collection group)', () => {
  const mine = (ms: number) => playersSnap([{ uid: "u1", teamId: "T1", joinedAt: { toMillis: () => ms } }]);

  it("lists lobbies where teamId == ours and, for each open lobby, players where teamId == ours and uid == me", () => {
    subscribeMyLobby("T1", "u1", () => undefined, () => undefined);
    const lobbies = watchers()[0];
    expect(q(lobbies).ref.path).toBe("programs/ftc/lobbies");
    expect(eq(lobbies)).toEqual(['teamId == "T1"']);
    lobbies.next(lobbySnap([["LB-AAAAAA", { status: "waiting" }], ["LB-BBBBBB", { status: "closed" }], ["LB-CCCCCC", { status: "results" }]]));
    const asked = watchers().slice(1);
    expect(asked.map((w) => q(w).ref.path).sort()).toEqual(["programs/ftc/lobbies/LB-AAAAAA/players", "programs/ftc/lobbies/LB-CCCCCC/players"]);
    for (const w of asked) expect(eq(w)).toEqual(['teamId == "T1"', 'uid == "u1"']);
    for (const w of watchers()) expect(JSON.stringify(w.target)).not.toMatch(/collectionGroup/);
  });

  it("answers null at once when the team has no open lobby", () => {
    const seen: unknown[] = [];
    subscribeMyLobby("T1", "u1", (id) => seen.push(id), () => undefined);
    watchers()[0].next(lobbySnap([["LB-BBBBBB", { status: "closed" }]]));
    expect(seen).toEqual([null]);
  });

  it("waits until every open lobby has answered, then offers the one joined most recently", () => {
    const seen: (string | null)[] = [];
    subscribeMyLobby("T1", "u1", (id) => seen.push(id), () => undefined);
    watchers()[0].next(lobbySnap([["LB-AAAAAA", { status: "waiting" }], ["LB-CCCCCC", { status: "scouting" }]]));
    watcherAt("programs/ftc/lobbies/LB-AAAAAA/players").next(mine(100));
    expect(seen).toEqual([]);
    watcherAt("programs/ftc/lobbies/LB-CCCCCC/players").next(mine(500));
    expect(seen).toEqual(["LB-CCCCCC"]);
  });

  it("being in no open lobby (no player doc anywhere) answers null", () => {
    const seen: (string | null)[] = [];
    subscribeMyLobby("T1", "u1", (id) => seen.push(id), () => undefined);
    watchers()[0].next(lobbySnap([["LB-AAAAAA", { status: "waiting" }]]));
    watcherAt("programs/ftc/lobbies/LB-AAAAAA/players").next(playersSnap([]));
    expect(seen).toEqual([null]);
  });

  it("a lobby that closes drops its reader and stops being offered; leaving a lobby stops it too", () => {
    const seen: (string | null)[] = [];
    subscribeMyLobby("T1", "u1", (id) => seen.push(id), () => undefined);
    watchers()[0].next(lobbySnap([["LB-AAAAAA", { status: "waiting" }]]));
    const w = watcherAt("programs/ftc/lobbies/LB-AAAAAA/players");
    w.next(mine(100));
    expect(seen.at(-1)).toBe("LB-AAAAAA");
    w.next(playersSnap([])); // I left
    expect(seen.at(-1)).toBeNull();
    w.next(mine(200)); // joined again
    watchers()[0].next(lobbySnap([["LB-AAAAAA", { status: "closed" }]]));
    expect(w.unsubscribe).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)).toBeNull();
  });

  it("one lobby failing is reported and the others still answer; a failed list is reported", () => {
    const seen: (string | null)[] = [];
    const errors: unknown[] = [];
    subscribeMyLobby("T1", "u1", (id) => seen.push(id), (f) => errors.push(f));
    watchers()[0].next(lobbySnap([["LB-AAAAAA", { status: "waiting" }], ["LB-CCCCCC", { status: "waiting" }]]));
    watcherAt("programs/ftc/lobbies/LB-AAAAAA/players").error(Object.assign(new Error("denied"), { code: "permission-denied" }));
    watcherAt("programs/ftc/lobbies/LB-CCCCCC/players").next(mine(9));
    expect(errors).toHaveLength(1);
    expect(seen.at(-1)).toBe("LB-CCCCCC");
    watchers()[0].error(Object.assign(new Error("denied"), { code: "permission-denied" }));
    expect(errors).toHaveLength(2);
  });

  it("stopping tears down the list and every reader", () => {
    const stop = subscribeMyLobby("T1", "u1", () => undefined, () => undefined);
    watchers()[0].next(lobbySnap([["LB-AAAAAA", { status: "waiting" }], ["LB-CCCCCC", { status: "waiting" }]]));
    stop();
    for (const w of watchers()) expect(w.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
