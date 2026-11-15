import { beforeEach, describe, expect, it, vi } from "vitest";

type Constraint = { field?: string; op?: string; value?: unknown; limit?: number };
type Ref = { kind: "collection" | "doc"; path: string };
type Q = { kind: "query"; ref: Ref; constraints: Constraint[] };
type Watcher = { target: Q | Ref; next: (snap: unknown) => void; error: (err: unknown) => void; unsubscribe: ReturnType<typeof vi.fn> };

const h = vi.hoisted(() => ({
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  tryClaimDoc: vi.fn(),
  watchers: [] as unknown[],
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, p: string, ...s: string[]) => ({ kind: "collection", path: [p, ...s].join("/") }),
  doc: (_db: unknown, p: string, ...s: string[]) => ({ kind: "doc", path: [p, ...s].join("/") }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  limit: (n: number) => ({ limit: n }),
  query: (ref: unknown, ...constraints: unknown[]) => ({ kind: "query", ref, constraints }),
  serverTimestamp: () => "SERVER_TIME",
  getDocs: (...a: unknown[]) => h.getDocs(...a),
  getDoc: (...a: unknown[]) => h.getDoc(...a),
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

import { claimSession, deleteSession, getSession, hasCompletedAttempt, subscribeOwnPausedSession, subscribeOwnSessions, subscribeSession, subscribeTeamSessions, updateSession } from "@/data/ftc/practice";
import { clearAllReadFailures, currentReadFailures } from "@/lib/read-failures";

const watcher = () => h.watchers[h.watchers.length - 1] as Watcher;
const q = () => watcher().target as Q;
const eq = (query: Q) => query.constraints.filter((c) => c.op).map((c) => `${c.field} ${c.op} ${JSON.stringify(c.value)}`);
const docSnap = (id: string, data: Record<string, unknown>) => ({ id, data: () => data, exists: () => true });
const full = { teamId: "T1", uid: "u1", kind: "solo", status: "completed", libraryMatchId: "EV_Q1", alliance: "red", robots: [1, 2] };

beforeEach(() => {
  h.watchers.length = 0;
  h.getDocs.mockReset();
  h.getDoc.mockReset();
  h.updateDoc.mockReset();
  h.deleteDoc.mockReset();
  h.tryClaimDoc.mockReset();
  clearAllReadFailures();
});

describe("the queries the FTC practice flow makes (all under programs/ftc, equality-only, teamId == on every list)", () => {
  it("the team's sessions: teamId == only, team-wide (no event, no kind, no orderBy)", () => {
    subscribeTeamSessions("T1", () => undefined, () => undefined);
    expect(q().ref.path).toBe("programs/ftc/practiceSessions");
    expect(eq(q())).toEqual(['teamId == "T1"']);
    expect(q().constraints).toHaveLength(1);
  });

  it("a scout's own sessions: teamId == and uid ==", () => {
    subscribeOwnSessions("T1", "u1", () => undefined, () => undefined);
    expect(eq(q())).toEqual(['teamId == "T1"', 'uid == "u1"']);
  });

  it("a scout's paused session: teamId ==, uid ==, status == paused", () => {
    subscribeOwnPausedSession("T1", "u1", () => undefined, () => undefined);
    expect(eq(q())).toEqual(['teamId == "T1"', 'uid == "u1"', 'status == "paused"']);
  });

  it("one session by document id", () => {
    subscribeSession("PS-AAAAAA", () => undefined, () => undefined);
    expect(watcher().target).toEqual({ kind: "doc", path: "programs/ftc/practiceSessions/PS-AAAAAA" });
  });

  it("the completed-attempt check: five equalities and limit 1, as CE writes it", async () => {
    h.getDocs.mockResolvedValue({ empty: false });
    expect(await hasCompletedAttempt("T1", "u1", "EV_Q1", "red")).toBe(true);
    const query = h.getDocs.mock.calls[0][0] as Q;
    expect(eq(query)).toEqual(['teamId == "T1"', 'uid == "u1"', 'libraryMatchId == "EV_Q1"', 'alliance == "red"', 'status == "completed"']);
    expect(query.constraints.at(-1)).toEqual({ limit: 1 });
    h.getDocs.mockResolvedValue({ empty: true });
    expect(await hasCompletedAttempt("T1", "u1", "EV_Q1", "red")).toBe(false);
  });
});

describe("reads hand the app sessions, never an empty list in place of an error", () => {
  it("delivers the sessions of a snapshot, a malformed one kept and flagged", () => {
    const got: unknown[] = [];
    subscribeTeamSessions("T1", (s) => got.push(...s), () => undefined);
    watcher().next({ docs: [docSnap("PS-OK", full), docSnap("PS-BAD", { ...full, teamId: "" })] });
    expect(got).toHaveLength(2);
    expect((got[0] as { id: string; malformed?: string }).malformed).toBeUndefined();
    expect((got[1] as { malformed?: string }).malformed).toContain("no team id");
  });

  it("a failed subscription calls onError with the failure, delivers nothing, and is recorded for the shell banner", () => {
    const onData = vi.fn();
    const onError = vi.fn();
    subscribeTeamSessions("T1", onData, onError);
    watcher().error(Object.assign(new Error("denied"), { code: "permission-denied" }));
    expect(onData).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ code: "permission-denied" });
    expect(currentReadFailures()).toHaveLength(1);
  });

  it("the paused session is the first of the query, or null", () => {
    const got: unknown[] = [];
    subscribeOwnPausedSession("T1", "u1", (s) => got.push(s), () => undefined);
    watcher().next({ docs: [] });
    watcher().next({ docs: [docSnap("PS-P", { ...full, status: "paused" })] });
    expect(got[0]).toBeNull();
    expect(got[1]).toMatchObject({ id: "PS-P", status: "paused" });
  });

  it("getSession is null for a missing doc and rethrows a failed read", async () => {
    h.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    expect(await getSession("PS-NONE")).toBeNull();
    h.getDoc.mockRejectedValue(Object.assign(new Error("x"), { code: "unavailable" }));
    await expect(getSession("PS-X")).rejects.toThrow();
    h.getDocs.mockRejectedValue(new Error("down"));
    await expect(hasCompletedAttempt("T1", "u1", "m", "red")).rejects.toThrow();
  });
});

describe("the session lifecycle writes", () => {
  it("start: reserves a PS- id in programs/ftc/practiceSessions with the stub, then fills it in", async () => {
    h.tryClaimDoc.mockResolvedValue(true);
    const id = await claimSession("T1", "u1", "solo");
    expect(id).toMatch(/^PS-[A-Z2-9]{6}$/);
    const [, path, claimed, stub] = h.tryClaimDoc.mock.calls[0];
    expect(path).toBe("programs/ftc/practiceSessions");
    expect(claimed).toBe(id);
    expect(stub).toMatchObject({ teamId: "T1", uid: "u1", kind: "solo", status: "in-progress", createdAt: "SERVER_TIME" });
    expect(stub).not.toHaveProperty("scoutId");
  });

  it("a clash on the id retries with a fresh one, and gives up after five", async () => {
    h.tryClaimDoc.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await claimSession("T1", "u1", "solo");
    expect(h.tryClaimDoc).toHaveBeenCalledTimes(2);
    h.tryClaimDoc.mockReset();
    h.tryClaimDoc.mockResolvedValue(false);
    await expect(claimSession("T1", "u1", "solo")).rejects.toThrow(/unique/);
    expect(h.tryClaimDoc).toHaveBeenCalledTimes(5);
  });

  it("pause, resume and complete are merge updates of the app-shaped fields only (no identity fields, no CS twins)", async () => {
    h.updateDoc.mockResolvedValue(undefined);
    await updateSession("PS-A", { status: "paused", completedRobots: [111] });
    await updateSession("PS-A", { status: "in-progress" });
    await updateSession("PS-A", { status: "completed", accuracy: null, scoutedTotal: 85, officialScore: null, penaltyPoints: null, finishedAt: "2026-02-01T11:00:00.000Z", teamId: "ignored", uid: "ignored" });
    expect(h.updateDoc.mock.calls.map((c) => [(c[0] as Ref).path, c[1]])).toEqual([
      ["programs/ftc/practiceSessions/PS-A", { status: "paused", completedRobots: [111] }],
      ["programs/ftc/practiceSessions/PS-A", { status: "in-progress" }],
      ["programs/ftc/practiceSessions/PS-A", { status: "completed", accuracy: null, scoutedTotal: 85, officialScore: null, penaltyPoints: null, finishedAt: "2026-02-01T11:00:00.000Z" }],
    ]);
    await updateSession("PS-A", {});
    expect(h.updateDoc).toHaveBeenCalledTimes(3);
  });

  it("a failed write is reported and rethrown (the screen shows it)", async () => {
    h.updateDoc.mockRejectedValue(Object.assign(new Error("denied"), { code: "permission-denied" }));
    await expect(updateSession("PS-A", { status: "paused" })).rejects.toThrow();
    h.deleteDoc.mockRejectedValue(new Error("x"));
    await expect(deleteSession("PS-A")).rejects.toThrow();
  });

  it("discarding deletes the session document", async () => {
    h.deleteDoc.mockResolvedValue(undefined);
    await deleteSession("PS-A");
    expect((h.deleteDoc.mock.calls[0][0] as Ref).path).toBe("programs/ftc/practiceSessions/PS-A");
  });
});
