import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Constraint = { field: string; op: string; value: unknown };
type Ref = { kind: "collection" | "doc"; path: string };
type Q = { kind: "query"; ref: Ref; constraints: Constraint[] };
type Handlers = { next: (snap: unknown) => void; error: (err: unknown) => void; options?: unknown; unsubscribe: ReturnType<typeof vi.fn> };

const h = vi.hoisted(() => ({
  refs: [] as { kind: string; path: string }[],
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  watchers: [] as unknown[],
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, p: string, ...segments: string[]) => {
    const ref = { kind: "collection", path: [p, ...segments].join("/") };
    h.refs.push(ref);
    return ref;
  },
  doc: (_db: unknown, p: string, ...segments: string[]) => {
    const ref = { kind: "doc", path: [p, ...segments].join("/") };
    h.refs.push(ref);
    return ref;
  },
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (ref: unknown, ...constraints: unknown[]) => ({ kind: "query", ref, constraints }),
  getDocs: (...args: unknown[]) => h.getDocs(...args),
  getDoc: (...args: unknown[]) => h.getDoc(...args),
  onSnapshot: (_target: unknown, ...rest: unknown[]) => {
    const options = typeof rest[0] === "function" ? undefined : rest[0];
    const [next, error] = (typeof rest[0] === "function" ? rest : rest.slice(1)) as [Handlers["next"], Handlers["error"]];
    const watcher: Handlers = { next, error, options, unsubscribe: vi.fn() };
    (watcher as Handlers & { target: unknown }).target = _target;
    h.watchers.push(watcher);
    return watcher.unsubscribe;
  },
}));
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true } }));

import {
  getFormDoc,
  getFormDocs,
  getFormEntries,
  getFormVersion,
  getFormVersions,
  getScoutEntries,
  getScoutEntriesForEvent,
  getScoutEntriesForSession,
  getTeamDoc,
  getTeamMembers,
  getUserProfile,
  subscribeFormDocs,
  subscribeFormEntries,
  subscribeScoutEntries,
  subscribeScoutEntriesForMatch,
  subscribeTeamDoc,
  subscribeTeamMembers,
  subscribeTeamScoutEntries,
  subscribeUserProfile,
} from "@/data/ftc/read";

const docSnap = (id: string, data: Record<string, unknown>, pending = false) => ({ id, data: () => data, metadata: { hasPendingWrites: pending } });
const querySnap = (docs: ReturnType<typeof docSnap>[]) => ({ docs });
const lastWatcher = () => h.watchers[h.watchers.length - 1] as Handlers & { target: Q | Ref };
const lastQuery = () => lastWatcher().target as Q;

/** What the last `getDocs` call was asked for. */
const askedQuery = () => h.getDocs.mock.calls[h.getDocs.mock.calls.length - 1][0] as Q;
const filters = (q: Q) => q.constraints.map((c) => `${c.field} ${c.op} ${JSON.stringify(c.value)}`);

const entryBody = (over: Record<string, unknown> = {}) => ({ teamId: "team1", uid: "u1", source: "event", eventCode: "EV1", matchType: "Qualification", matchNumber: 4, teamNumber: 100, formId: "f", ...over });

let errorSpy: { mock: { calls: unknown[][] }; mockRestore: () => void };
beforeEach(() => {
  h.refs.length = 0;
  h.watchers.length = 0;
  h.getDocs.mockReset();
  h.getDoc.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe("scout entries", () => {
  it("getScoutEntries reads the team's whole collection under the program prefix, all sources", async () => {
    h.getDocs.mockResolvedValue(querySnap([docSnap("a", entryBody()), docSnap("b", entryBody({ source: "practice", sessionId: "s1" }))]));
    const entries = await getScoutEntries("team1");
    const q = askedQuery();
    expect(q.ref).toEqual({ kind: "collection", path: "programs/ftc/scoutEntries" });
    expect(filters(q)).toEqual(['teamId == "team1"']);
    expect(entries.map((e) => [e.id, e.source])).toEqual([
      ["a", "event"],
      ["b", "practice"],
    ]);
  });

  it("getScoutEntriesForEvent filters by event code and keeps only event-sourced entries", async () => {
    h.getDocs.mockResolvedValue(querySnap([docSnap("a", entryBody()), docSnap("b", entryBody({ source: "practice" })), docSnap("c", entryBody({ source: undefined }))]));
    const entries = await getScoutEntriesForEvent("team1", "EV1");
    expect(filters(askedQuery())).toEqual(['teamId == "team1"', 'eventCode == "EV1"']);
    expect(entries.map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("getScoutEntriesForSession filters by session", async () => {
    h.getDocs.mockResolvedValue(querySnap([docSnap("a", entryBody({ source: "practice", sessionId: "s1" }))]));
    expect(await getScoutEntriesForSession("team1", "s1")).toHaveLength(1);
    expect(filters(askedQuery())).toEqual(['teamId == "team1"', 'sessionId == "s1"']);
  });

  it("subscribeScoutEntries watches the event with metadata changes, drops practice rows and counts pending writes", () => {
    const onData = vi.fn();
    const stop = subscribeScoutEntries("team1", "EV1", onData, vi.fn());
    const w = lastWatcher();
    expect(filters(lastQuery())).toEqual(['teamId == "team1"', 'eventCode == "EV1"']);
    expect(w.options).toEqual({ includeMetadataChanges: true });
    w.next(querySnap([docSnap("a", entryBody(), true), docSnap("b", entryBody({ source: "practice" })), docSnap("c", entryBody())]));
    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData.mock.calls[0][0].map((e: { id: string }) => e.id)).toEqual(["a", "c"]);
    expect(onData.mock.calls[0][1]).toBe(1);
    stop();
    expect(w.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("subscribeTeamScoutEntries is team-wide: no event filter", () => {
    const onData = vi.fn();
    subscribeTeamScoutEntries("team1", onData, vi.fn());
    expect(filters(lastQuery())).toEqual(['teamId == "team1"']);
    lastWatcher().next(querySnap([docSnap("a", entryBody({ eventCode: "EV1" })), docSnap("b", entryBody({ eventCode: "EV2", source: "live" }))]));
    expect(onData.mock.calls[0][0].map((e: { id: string }) => e.id)).toEqual(["a", "b"]);
  });

  it("subscribeScoutEntriesForMatch queries the match by its identity", () => {
    subscribeScoutEntriesForMatch("team1", "EV1", "Qualification", 4, vi.fn(), vi.fn());
    expect(filters(lastQuery())).toEqual(['teamId == "team1"', 'eventCode == "EV1"', 'matchType == "Qualification"', "matchNumber == 4"]);
  });
});

describe("form entries", () => {
  it("getFormEntries reads the program's collection, newest first, with optional filters", async () => {
    h.getDocs.mockResolvedValue(
      querySnap([docSnap("old", { teamId: "team1", formType: "pit-scout", createdAt: 1000 }), docSnap("new", { teamId: "team1", formType: "pit-scout", createdAt: 9000 })])
    );
    const entries = await getFormEntries("team1", { formId: "pit-scout", eventCode: "EV1" });
    const q = askedQuery();
    expect(q.ref.path).toBe("programs/ftc/formEntries");
    expect(filters(q)).toEqual(['teamId == "team1"', 'formId == "pit-scout"', 'eventCode == "EV1"']);
    expect(entries.map((e) => e.id)).toEqual(["new", "old"]);
    await getFormEntries("team1");
    expect(filters(askedQuery())).toEqual(['teamId == "team1"']);
  });

  it("filters by form type (the scout page reads this event's pit entries)", async () => {
    h.getDocs.mockResolvedValue(querySnap([]));
    await getFormEntries("team1", { formType: "pit-scout", eventCode: "EV1" });
    expect(filters(askedQuery())).toEqual(['teamId == "team1"', 'formType == "pit-scout"', 'eventCode == "EV1"']);
  });

  it("subscribeFormEntries converts snapshots", () => {
    const onData = vi.fn();
    subscribeFormEntries("team1", { formId: "lead-scout" }, onData, vi.fn());
    expect(filters(lastQuery())).toEqual(['teamId == "team1"', 'formId == "lead-scout"']);
    lastWatcher().next(querySnap([docSnap("x", { teamId: "team1", formType: "lead-scout" })]));
    expect(onData.mock.calls[0][0][0]).toMatchObject({ id: "x", formType: "lead-scout" });
  });
});

describe("forms", () => {
  it("getFormDocs / subscribeFormDocs key the docs by form id", async () => {
    h.getDocs.mockResolvedValue(querySnap([docSnap("team1_pit-scout", { teamId: "team1", formId: "pit-scout", name: "Pit" })]));
    const docs = await getFormDocs("team1");
    expect(askedQuery().ref.path).toBe("programs/ftc/forms");
    expect([...docs.keys()]).toEqual(["pit-scout"]);

    const onData = vi.fn();
    subscribeFormDocs("team1", onData, vi.fn());
    expect(filters(lastQuery())).toEqual(['teamId == "team1"']);
    lastWatcher().next(querySnap([docSnap("team1_pit-scout", { name: "Pit" })]));
    expect([...onData.mock.calls[0][0].keys()]).toEqual(["pit-scout"]);
  });

  it("getFormDoc reads the doc by its team-and-form id, null when absent", async () => {
    h.getDoc.mockResolvedValueOnce({ exists: () => true, id: "team1_pit-scout", data: () => ({ name: "Pit", formId: "pit-scout", teamId: "team1" }) });
    expect(await getFormDoc("team1", "pit-scout")).toMatchObject({ formId: "pit-scout", name: "Pit" });
    expect(h.getDoc.mock.calls[0][0]).toEqual({ kind: "doc", path: "programs/ftc/forms/team1_pit-scout" });
    h.getDoc.mockResolvedValueOnce({ exists: () => false, id: "x", data: () => undefined });
    expect(await getFormDoc("team1", "nope")).toBeNull();
  });

  it("getFormVersion reads versions/{n} and returns the form, or null", async () => {
    const form = { id: "pit-scout", name: "Pit" };
    h.getDoc.mockResolvedValueOnce({ exists: () => true, id: "3", data: () => ({ version: 3, form }) });
    expect(await getFormVersion("team1", "pit-scout", 3)).toEqual(form);
    expect(h.getDoc.mock.calls[0][0]).toEqual({ kind: "doc", path: "programs/ftc/forms/team1_pit-scout/versions/3" });
    h.getDoc.mockResolvedValueOnce({ exists: () => false, id: "9", data: () => undefined });
    expect(await getFormVersion("team1", "pit-scout", 9)).toBeNull();
  });

  it("getFormVersions lists the versions subcollection, newest first, skipping unusable ones", async () => {
    const form = { id: "pit-scout" };
    h.getDocs.mockResolvedValue(
      querySnap([docSnap("1", { version: 1, form }), docSnap("3", { version: 3, form }), docSnap("bad", { version: 2 }), docSnap("2", { version: 2, form })])
    );
    const versions = await getFormVersions("team1", "pit-scout");
    expect(h.getDocs.mock.calls[0][0]).toEqual({ kind: "collection", path: "programs/ftc/forms/team1_pit-scout/versions" });
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
  });
});

describe("teams and users", () => {
  it("getTeamDoc reads teams/{id} by id (teams cannot be listed), null when absent", async () => {
    h.getDoc.mockResolvedValueOnce({ exists: () => true, id: "team1", data: () => ({ number: 4242, name: "Robots", joinCode: "J1" }) });
    expect(await getTeamDoc("team1")).toMatchObject({ number: 4242, joinCode: "J1" });
    expect(h.getDoc.mock.calls[0][0]).toEqual({ kind: "doc", path: "programs/ftc/teams/team1" });
    h.getDoc.mockResolvedValueOnce({ exists: () => false, id: "x", data: () => undefined });
    expect(await getTeamDoc("x")).toBeNull();
  });

  it("subscribeTeamDoc delivers the converted team, then null when it disappears", () => {
    const onData = vi.fn();
    subscribeTeamDoc("team1", onData, vi.fn());
    expect((lastWatcher().target as Ref).path).toBe("programs/ftc/teams/team1");
    lastWatcher().next({ exists: () => true, id: "team1", data: () => ({ number: 7 }) });
    lastWatcher().next({ exists: () => false, id: "team1", data: () => undefined });
    expect(onData.mock.calls[0][0]).toMatchObject({ number: 7, joinCode: "team1" });
    expect(onData.mock.calls[1][0]).toBeNull();
  });

  it("getTeamMembers / subscribeTeamMembers query the users of the team", async () => {
    h.getDocs.mockResolvedValue(querySnap([docSnap("u1", { name: "Ada", email: "a@x.org", teamId: "team1", primaryRole: "lead-scout", isAdmin: true })]));
    const members = await getTeamMembers("team1");
    expect(askedQuery().ref.path).toBe("programs/ftc/users");
    expect(filters(askedQuery())).toEqual(['teamId == "team1"']);
    expect(members[0]).toMatchObject({ uid: "u1", name: "Ada", primaryRole: "lead-scout", isAdmin: true });

    const onData = vi.fn();
    subscribeTeamMembers("team1", onData, vi.fn());
    lastWatcher().next(querySnap([docSnap("u2", { name: "Grace", teamId: "team1" })]));
    expect(onData.mock.calls[0][0][0]).toMatchObject({ uid: "u2", name: "Grace" });
  });

  it("getUserProfile / subscribeUserProfile read users/{uid}", async () => {
    h.getDoc.mockResolvedValueOnce({ exists: () => true, id: "u1", data: () => ({ name: "Ada", teamId: "team1", isAdmin: true }) });
    expect(await getUserProfile("u1")).toMatchObject({ name: "Ada", teamId: "team1", isAdmin: true });
    expect(h.getDoc.mock.calls[0][0]).toEqual({ kind: "doc", path: "programs/ftc/users/u1" });

    const onData = vi.fn();
    subscribeUserProfile("u1", onData, vi.fn());
    lastWatcher().next({ exists: () => false, id: "u1", data: () => undefined });
    expect(onData).toHaveBeenCalledWith(null);
  });
});

describe("a failed read says so", () => {
  const denied = Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });

  it("get* reports the failure with its path and rethrows it (no empty list)", async () => {
    h.getDocs.mockRejectedValue(denied);
    await expect(getScoutEntries("team1")).rejects.toBe(denied);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("permission-denied");
    expect(String(errorSpy.mock.calls[0][0])).toContain('programs/ftc/scoutEntries where teamId == "team1"');

    h.getDoc.mockRejectedValue(denied);
    await expect(getTeamDoc("team1")).rejects.toBe(denied);
    await expect(getFormVersion("team1", "f", 1)).rejects.toBe(denied);
  });

  it("subscribe* calls onError with the failure and delivers no data", () => {
    const onData = vi.fn();
    const onError = vi.fn();
    subscribeTeamScoutEntries("team1", onData, onError);
    lastWatcher().error(denied);
    expect(onData).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ code: "permission-denied", message: "Missing or insufficient permissions.", path: 'programs/ftc/scoutEntries where teamId == "team1"' });

    const onProfile = vi.fn();
    const onProfileError = vi.fn();
    subscribeUserProfile("u1", onProfile, onProfileError);
    lastWatcher().error(denied);
    expect(onProfile).not.toHaveBeenCalled();
    expect(onProfileError.mock.calls[0][0]).toMatchObject({ code: "permission-denied", path: "programs/ftc/users/u1" });
  });
});

describe("scope", () => {
  it("every path this module built is under programs/ftc/", async () => {
    h.getDocs.mockResolvedValue(querySnap([]));
    h.getDoc.mockResolvedValue({ exists: () => false, id: "x", data: () => undefined });
    await getScoutEntries("t");
    await getFormEntries("t");
    await getFormDocs("t");
    await getFormDoc("t", "f");
    await getFormVersion("t", "f", 1);
    await getFormVersions("t", "f");
    await getTeamDoc("t");
    await getTeamMembers("t");
    await getUserProfile("u");
    expect(h.refs.length).toBeGreaterThan(8);
    for (const ref of h.refs) expect(ref.path.startsWith("programs/ftc/"), ref.path).toBe(true);
  });

  it("the source has no collection-group read and never builds a path by hand", () => {
    const source = readFileSync(path.resolve(__dirname, "read.ts"), "utf8");
    expect(source).not.toMatch(/collectionGroup/);
    // collection()/doc() are only called through the program path helpers
    expect(source).not.toMatch(/\bdoc\(db,/);
    expect(source).not.toMatch(/collection\(db, "/);
  });
});
