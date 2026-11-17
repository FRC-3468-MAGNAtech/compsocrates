import { beforeEach, describe, expect, it, vi } from "vitest";

type Constraint = { field: string; op: string; value: unknown };
type Ref = { kind: "collection" | "doc"; path: string };
type Q = { kind: "query"; ref: Ref; constraints: Constraint[] };
type Watcher = { target: Q | Ref; next: (snap: unknown) => void; error: (err: unknown) => void; unsubscribe: ReturnType<typeof vi.fn> };

const h = vi.hoisted(() => ({
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  watchers: [] as unknown[],
  sessionWatch: null as null | { onData: (s: unknown[]) => void; onError: (f: unknown) => void; unsubscribe: ReturnType<typeof vi.fn>; teamId: string },
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, p: string, ...s: string[]) => ({ kind: "collection", path: [p, ...s].join("/") }),
  doc: (_db: unknown, p: string, ...s: string[]) => ({ kind: "doc", path: [p, ...s].join("/") }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (ref: unknown, ...constraints: unknown[]) => ({ kind: "query", ref, constraints }),
  serverTimestamp: () => "SERVER_TIME",
  setDoc: (...a: unknown[]) => h.setDoc(...a),
  deleteDoc: (...a: unknown[]) => h.deleteDoc(...a),
  onSnapshot: (target: unknown, next: Watcher["next"], error: Watcher["error"]) => {
    const w: Watcher = { target: target as Q | Ref, next, error, unsubscribe: vi.fn() };
    h.watchers.push(w);
    return w.unsubscribe;
  },
}));
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true } }));
vi.mock("@/data/ftc/practice", () => ({
  subscribeTeamLiveSessions: (teamId: string, onData: (s: unknown[]) => void, onError: (f: unknown) => void) => {
    const unsubscribe = vi.fn();
    h.sessionWatch = { onData, onError, unsubscribe, teamId };
    return unsubscribe;
  },
}));

import { removePresence, subscribeMatchScouts, subscribeTeamLiveScouts, upsertPresence } from "@/data/ftc/live";
import { clearAllReadFailures } from "@/lib/read-failures";

const watchers = () => h.watchers as Watcher[];
const q = (w: Watcher) => w.target as Q;
const eq = (w: Watcher) => q(w).constraints.map((c) => `${c.field} ${c.op} ${JSON.stringify(c.value)}`);
const snapOf = (docs: Record<string, unknown>[]) => ({ docs: docs.map((d) => ({ data: () => d })) });
const liveSession = (matchNumber: number, over: Record<string, unknown> = {}) => ({ kind: "live", status: "in-progress", eventCode: "USTXHOU", matchType: "Qualification", matchNumber, ...over });
const presence = (uid: string, over: Record<string, unknown> = {}) => ({ uid, teamId: "T1", name: uid, robot: 1, alliance: "red", sessionId: "LV-X", lastSeen: null, ...over });

beforeEach(() => {
  h.watchers.length = 0;
  h.setDoc.mockReset();
  h.deleteDoc.mockReset();
  h.sessionWatch = null;
  clearAllReadFailures();
});

describe("one match's scouts: by path, with teamId == (what the rules need)", () => {
  it("reads programs/ftc/liveMatches/{key}/scouts where teamId == ours, and nothing else", () => {
    const seen: unknown[][] = [];
    subscribeMatchScouts("USTXHOU_Q7", "T1", (s) => seen.push(s), () => undefined);
    const w = watchers()[0];
    expect(q(w).ref.path).toBe("programs/ftc/liveMatches/USTXHOU_Q7/scouts");
    expect(eq(w)).toEqual(['teamId == "T1"']);
    w.next(snapOf([presence("a"), { teamId: "T1" /* not a presence doc */ }, presence("b")]));
    expect(seen[0].map((s) => (s as { uid: string }).uid)).toEqual(["a", "b"]);
  });

  it("a failed read is reported to the caller, never turned into an empty list", () => {
    const errors: unknown[] = [];
    subscribeMatchScouts("USTXHOU_Q7", "T1", () => undefined, (f) => errors.push(f));
    watchers()[0].error(Object.assign(new Error("denied"), { code: "permission-denied" }));
    expect(errors).toHaveLength(1);
  });
});

describe("the team's live scouts: match keys derived from the team's open live sessions, each read by path (NO collection group)", () => {
  it("asks for the team's live sessions only, then opens one scouts reader per open match", () => {
    const seen: unknown[][] = [];
    subscribeTeamLiveScouts("T1", (s) => seen.push(s), () => undefined);
    expect(h.sessionWatch?.teamId).toBe("T1");
    expect(watchers()).toHaveLength(0); // nothing is read until a session names a match

    h.sessionWatch!.onData([liveSession(7), liveSession(3), liveSession(7, { status: "paused" }), liveSession(9, { status: "completed" })]);
    expect(watchers().map((w) => q(w).ref.path).sort()).toEqual(["programs/ftc/liveMatches/USTXHOU_Q3/scouts", "programs/ftc/liveMatches/USTXHOU_Q7/scouts"]);
    for (const w of watchers()) expect(eq(w)).toEqual(['teamId == "T1"']);
    for (const w of watchers()) expect(JSON.stringify(w.target)).not.toMatch(/collectionGroup/);
    expect(seen).toHaveLength(0); // waits for every match to answer once
  });

  it("emits once every current match has answered, each scout tagged with its match key", () => {
    const seen: { uid: string; matchKey: string }[][] = [];
    subscribeTeamLiveScouts("T1", (s) => seen.push(s as { uid: string; matchKey: string }[]), () => undefined);
    h.sessionWatch!.onData([liveSession(7), liveSession(3)]);
    const [q3, q7] = [...watchers()].sort((a, b) => q(a).ref.path.localeCompare(q(b).ref.path));
    q7.next(snapOf([presence("a")]));
    expect(seen).toHaveLength(0);
    q3.next(snapOf([presence("b"), presence("c")]));
    expect(seen.at(-1)?.map((s) => `${s.matchKey}:${s.uid}`)).toEqual(["USTXHOU_Q3:b", "USTXHOU_Q3:c", "USTXHOU_Q7:a"]);
  });

  it("no open live session means an empty answer straight away", () => {
    const seen: unknown[][] = [];
    subscribeTeamLiveScouts("T1", (s) => seen.push(s), () => undefined);
    h.sessionWatch!.onData([liveSession(7, { status: "completed" })]);
    expect(seen).toEqual([[]]);
  });

  it("follows the sessions: a match nobody is on any more is dropped, a new one is added, the rest keep their reader", () => {
    subscribeTeamLiveScouts("T1", () => undefined, () => undefined);
    h.sessionWatch!.onData([liveSession(7), liveSession(3)]);
    const byPath = (n: number) => watchers().find((w) => q(w).ref.path.endsWith(`Q${n}/scouts`))!;
    const [w3, w7] = [byPath(3), byPath(7)];
    h.sessionWatch!.onData([liveSession(7), liveSession(5)]);
    expect(w3.unsubscribe).toHaveBeenCalledTimes(1);
    expect(w7.unsubscribe).not.toHaveBeenCalled();
    expect(watchers().filter((w) => q(w).ref.path.endsWith("Q7/scouts"))).toHaveLength(1); // not re-opened
    expect(watchers().some((w) => q(w).ref.path.endsWith("Q5/scouts"))).toBe(true);
  });

  it("stopping tears down the session watch and every match reader", () => {
    const stop = subscribeTeamLiveScouts("T1", () => undefined, () => undefined);
    h.sessionWatch!.onData([liveSession(7), liveSession(3)]);
    stop();
    expect(h.sessionWatch!.unsubscribe).toHaveBeenCalledTimes(1);
    for (const w of watchers()) expect(w.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("one match failing is reported and the others still answer", () => {
    const seen: unknown[][] = [];
    const errors: unknown[] = [];
    subscribeTeamLiveScouts("T1", (s) => seen.push(s), (f) => errors.push(f));
    h.sessionWatch!.onData([liveSession(7), liveSession(3)]);
    const [w3, w7] = [...watchers()].sort((a, b) => q(a).ref.path.localeCompare(q(b).ref.path));
    w3.error(Object.assign(new Error("denied"), { code: "permission-denied" }));
    w7.next(snapOf([presence("a")]));
    expect(errors).toHaveLength(1);
    expect(seen.at(-1)).toHaveLength(1);
  });
});

describe("presence writes: the caller's own doc under programs/ftc", () => {
  it("upsert writes liveMatches/{key}/scouts/{uid} with the team and a server lastSeen", async () => {
    await upsertPresence("USTXHOU_Q7", { uid: "u1", teamId: "T1", name: "Ana", robot: 8120, alliance: "blue", sessionId: "LV-X" });
    const [ref, data] = h.setDoc.mock.calls[0];
    expect(ref.path).toBe("programs/ftc/liveMatches/USTXHOU_Q7/scouts/u1");
    expect(data).toMatchObject({ uid: "u1", teamId: "T1", lastSeen: "SERVER_TIME" });
  });

  it("remove deletes that doc; a failure is rethrown", async () => {
    await removePresence("USTXHOU_Q7", "u1");
    expect(h.deleteDoc.mock.calls[0][0].path).toBe("programs/ftc/liveMatches/USTXHOU_Q7/scouts/u1");
    h.deleteDoc.mockRejectedValueOnce(new Error("offline"));
    await expect(removePresence("USTXHOU_Q7", "u1")).rejects.toThrow("offline");
  });
});
