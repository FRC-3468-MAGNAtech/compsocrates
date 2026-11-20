// The browser side of the snapshot routes: the roster and library hooks keep their output when a snapshot serves them, read nothing until the switch is known, fall back to
// the direct reads on any failure but the quota, keep the screen on the quota, never show another team's rows, and join chunks of one build only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ctl = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  configGate: null as Promise<void> | null,
  api: [] as string[],
  handler: ((path: string) => ({ ok: true, path })) as (path: string) => unknown,
  port: null as null | { library: { snapshotRows: (rows: { id: string; data: Record<string, unknown> }[]) => { matches: unknown[]; unreadable: number }; subscribeMatches: () => () => void } },
  profileTeam: null as string | null,
}));

vi.mock("react", async () => (await import("@/test-stubs/hook-runtime")).hookMock(await vi.importActual<typeof import("react")>("react")));
vi.mock("firebase/firestore", async () => (await import("@/test-stubs/fake-firestore")).fakeFirestoreModule);
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, auth: { currentUser: { uid: "u1" } }, isFirebaseConfigured: () => true }));
vi.mock("@/lib/program/data", () => ({ useProgramData: () => ctl.port, programData: () => ctl.port }));
vi.mock("@/lib/program/context", () => ({ useProgram: () => "frc", useProgramConfig: () => ({ connection: { features: { live: true, practice: true } } }) }));
vi.mock("@/lib/team-roster", async (orig) => ({ ...(await orig<typeof import("@/lib/team-roster")>()), loadRosterExtras: async () => ({ members: [], denied: false }), useRosterExtras: () => [] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ profile: ctl.profileTeam ? { teamId: ctl.profileTeam } : null, user: { uid: "u1" } }) }));
vi.mock("@/lib/personal/scope", () => ({ personalScopeUid: () => null }));
vi.mock("@/lib/memberships/client", () => ({
  membershipsEnabled: async () => false,
  useMembershipsEnabled: () => false,
  membershipApi: {},
  publicConfigOnce: async () => {
    if (ctl.configGate) await ctl.configGate;
    return ctl.config;
  },
}));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return {
    ApiError: actual.ApiError,
    authedApi: async (path: string) => {
      ctl.api.push(path);
      const out = ctl.handler(path);
      if (out instanceof Error) throw out;
      return out;
    },
  };
});

import * as fake from "@/test-stubs/fake-firestore";
import * as rt from "@/test-stubs/hook-runtime";
import { ApiError } from "@/lib/api-client";
import { resetRosterFeedsForTests, useTeamMembers } from "@/lib/team-members";
import { useAllLibraryMatches } from "@/lib/match-library";
import { refreshSnapshot, resetSnapshotClientForTests, useSnapshotStatus } from "@/lib/snapshot/client";
import { csUserToMember } from "@/data/cs/users";

const quota = () => new ApiError("over quota", 503, "quota_exceeded", null);
const serverError = () => new ApiError("boom", 500, "server_error", null);
const member = (uid: string, name: string) => ({ uid, name, email: `${uid}@x.org`, primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false });
const meta = (over: Record<string, unknown>) => ({ ok: true, dataset: "roster", program: "frc", teamId: "T1", builtAt: 1_000, buildId: "b1", chunk: 0, chunks: 1, stale: false, refreshWaitMs: null, rows: [], ...over });

let n = 0;
function freshTeam(): string {
  n += 1;
  resetRosterFeedsForTests();
  resetSnapshotClientForTests();
  fake.resetFake();
  ctl.api.length = 0;
  ctl.config = { snapshots: { roster: true, library: true } };
  ctl.configGate = null;
  ctl.port = null;
  ctl.profileTeam = null;
  const team = `CL-${n}`;
  fake.seed("users/d1", { teamId: team, displayName: "Direct One", email: "d1@x.org", role: "match-scout" });
  fake.seed("users/d2", { teamId: team, displayName: "Direct Two", email: "d2@x.org", role: "lead-scout" });
  ctl.handler = (path) => meta({ teamId: team, rows: [member("s1", "Snap One"), member("s2", "Snap Two")], dataset: path.includes("library") ? "library" : "roster" });
  return team;
}
beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => {
  resetRosterFeedsForTests();
  vi.restoreAllMocks();
});

async function members(team: string | null, options?: { live?: boolean }) {
  const h = rt.renderHook(() => useTeamMembers(team, options));
  await rt.settle(12);
  const out = { members: h.result.current.members, loaded: h.result.current.loaded, error: h.result.current.error };
  h.unmount();
  return out;
}
const ids = (xs: { uid: string }[]) => xs.map((m) => m.uid).sort();

describe("useTeamMembers with the roster snapshot ON", () => {
  it("serves the snapshot's rows: the same output shape, no Firestore read, one request", async () => {
    const team = freshTeam();
    const out = await members(team);
    expect(out.loaded).toBe(true);
    expect(out.error).toBeNull();
    expect(ids(out.members)).toEqual(["s1", "s2"]);
    expect(out.members[0]).toEqual(member("s1", "Snap One"));
    expect(fake.billing.total).toBe(0);
    expect(ctl.api).toEqual(["/api/snapshot/roster?program=frc&chunk=0"]);
  });

  it("the team is never sent: the request carries the program and the chunk only", async () => {
    const team = freshTeam();
    await members(team);
    expect(ctl.api.join()).not.toContain(team);
    expect(ctl.api[0]).not.toMatch(/team/i);
  });

  it("three call sites share one request and one feed", async () => {
    const team = freshTeam();
    const hooks = [0, 1, 2].map(() => rt.renderHook(() => useTeamMembers(team)));
    await rt.settle(12);
    expect(ctl.api).toHaveLength(1);
    for (const h of hooks) expect(ids(h.result.current.members)).toEqual(["s1", "s2"]);
    hooks.forEach((h) => h.unmount());
  });

  it("reads NOTHING until the switch is known (no direct listener, no request while the config is pending)", async () => {
    const team = freshTeam();
    let open: () => void = () => {};
    ctl.configGate = new Promise<void>((resolve) => (open = resolve));
    const h = rt.renderHook(() => useTeamMembers(team));
    await rt.settle(6);
    expect(fake.billing.total).toBe(0);
    expect(ctl.api).toHaveLength(0);
    expect(h.result.current.loaded).toBe(false);
    open();
    await rt.settle(12);
    expect(h.result.current.loaded).toBe(true);
    expect(ctl.api).toHaveLength(1);
    expect(fake.billing.total).toBe(0);
    h.unmount();
  });

  it("a screen where an admin edits the roster (`live`) reads Firestore directly even with the switch on", async () => {
    const team = freshTeam();
    const out = await members(team, { live: true });
    expect(ids(out.members)).toEqual(["d1", "d2"]);
    expect(ctl.api).toHaveLength(0);
    expect(out.members[0]).toEqual(csUserToMember("d1", { teamId: team, displayName: "Direct One", email: "d1@x.org", role: "match-scout" } as never));
  });

  it("a snapshot for ANOTHER team than the one asked about is never shown: it reads Firestore for the right team instead", async () => {
    const team = freshTeam();
    ctl.handler = () => meta({ teamId: "SOMEONE-ELSE", rows: [member("x", "Leaked")] });
    const out = await members(team);
    expect(ids(out.members)).toEqual(["d1", "d2"]);
    expect(JSON.stringify(out.members)).not.toContain("Leaked");
  });

  it("any failure but the quota falls back to the direct read", async () => {
    const team = freshTeam();
    ctl.handler = () => serverError();
    const out = await members(team);
    expect(ids(out.members)).toEqual(["d1", "d2"]);
    expect(out.error).toBeNull();
  });

  it("an unreadable answer (not an API error) falls back too", async () => {
    const team = freshTeam();
    ctl.handler = () => new Error("Failed to fetch");
    expect(ids((await members(team)).members)).toEqual(["d1", "d2"]);
  });

  it("the daily quota does NOT fall back (a second read would only fail again): the screen shows the error and keeps its data", async () => {
    const team = freshTeam();
    ctl.handler = () => quota();
    const out = await members(team);
    expect(fake.billing.total).toBe(0);
    expect(out.loaded).toBe(true);
    expect(out.error).not.toBeNull();
  });

  it("a team switch asks again for the new team (the browser's team is only the cache key)", async () => {
    const a = freshTeam();
    const b = `${a}-B`;
    ctl.handler = () => meta({ teamId: a, rows: [member("s1", "Snap One")] });
    await members(a);
    ctl.handler = () => meta({ teamId: b, rows: [member("t9", "Team B")] });
    const out = await members(b);
    expect(ids(out.members)).toEqual(["t9"]);
    expect(ctl.api).toHaveLength(2);
  });
});

describe("useTeamMembers with the snapshot OFF or unknown", () => {
  it("OFF: exactly the direct read, no request", async () => {
    const team = freshTeam();
    ctl.config = { snapshots: { roster: false, library: false } };
    const out = await members(team);
    expect(ids(out.members)).toEqual(["d1", "d2"]);
    expect(ctl.api).toHaveLength(0);
    expect(fake.billing.byCollection.users).toBe(2);
  });
  it("the public config unreachable: the direct read", async () => {
    const team = freshTeam();
    ctl.config = null;
    expect(ids((await members(team)).members)).toEqual(["d1", "d2"]);
    expect(ctl.api).toHaveLength(0);
  });
  it("a config with no `snapshots` at all (an older server): the direct read", async () => {
    const team = freshTeam();
    ctl.config = { membershipsEnabled: false };
    expect(ids((await members(team)).members)).toEqual(["d1", "d2"]);
  });
});

describe("chunks and builds", () => {
  it("every chunk of one build is joined in order", async () => {
    const team = freshTeam();
    ctl.handler = (path) => {
      const chunk = Number(/chunk=(\d+)/.exec(path)?.[1]);
      return meta({ teamId: team, chunks: 3, chunk, buildId: "same", rows: [member(`c${chunk}a`, "A"), member(`c${chunk}b`, "B")] });
    };
    const out = await members(team);
    expect(out.members.map((m) => m.uid)).toEqual(["c0a", "c0b", "c1a", "c1b", "c2a", "c2b"]);
    expect(ctl.api).toHaveLength(3);
  });

  it("chunks from two different builds are never mixed: it asks again once, then uses the consistent set", async () => {
    const team = freshTeam();
    let call = 0;
    ctl.handler = (path) => {
      call += 1;
      const chunk = Number(/chunk=(\d+)/.exec(path)?.[1]);
      // first attempt: chunk 1 comes from a newer build; second attempt: all from one
      const buildId = call <= 2 ? (chunk === 0 ? "old" : "new") : "new";
      return meta({ teamId: team, chunks: 2, chunk, buildId, rows: [member(`${buildId}${chunk}`, "X")] });
    };
    const out = await members(team);
    expect(out.members.map((m) => m.uid)).toEqual(["new0", "new1"]);
  });

  it("builds that never agree fall back to the direct read rather than show a mix", async () => {
    const team = freshTeam();
    let call = 0;
    ctl.handler = (path) => {
      call += 1;
      const chunk = Number(/chunk=(\d+)/.exec(path)?.[1]);
      return meta({ teamId: team, chunks: 2, chunk, buildId: `b${call}`, rows: [member(`m${call}`, "Mixed")] });
    };
    const out = await members(team);
    expect(ids(out.members)).toEqual(["d1", "d2"]);
  });
});

describe("Refresh and the status", () => {
  it("a Refresh asks the server to rebuild, hands every mounted hook the new rows, and starts the 2-minute wait", async () => {
    const team = freshTeam();
    const h = rt.renderHook(() => ({ m: useTeamMembers(team), s: useSnapshotStatus(["roster"]) }));
    await rt.settle(12);
    expect(ids(h.result.current.m.members)).toEqual(["s1", "s2"]);
    expect(h.result.current.s?.builtAt).toBe(1_000);
    ctl.handler = (path) => meta({ teamId: team, builtAt: 9_000_000, buildId: "fresh", rows: [member("s1", "Snap One"), member("s3", "Snap Three")], refreshWaitMs: null, dataset: "roster", chunk: Number(/chunk=(\d+)/.exec(path)?.[1]) });
    const result = await refreshSnapshot("roster", "frc");
    await rt.settle(6);
    expect(result).toEqual({ ok: true, waitMs: null });
    expect(ctl.api[ctl.api.length - 1]).toContain("refresh=1");
    expect(ids(h.result.current.m.members)).toEqual(["s1", "s3"]);
    expect(h.result.current.s?.builtAt).toBe(9_000_000);
    expect(h.result.current.s?.refreshAvailableAt).toBe(9_000_000 + 120_000);
    h.unmount();
  });

  it("a throttled Refresh still carries the data, and the button's wait is the server's remaining wait", async () => {
    const team = freshTeam();
    const h = rt.renderHook(() => useSnapshotStatus(["roster"]));
    const now = vi.spyOn(Date, "now").mockReturnValue(5_000_000);
    ctl.handler = () => meta({ teamId: team, builtAt: 4_950_000, refreshWaitMs: 70_000, rows: [member("s1", "Snap One")] });
    const result = await refreshSnapshot("roster", "frc");
    await rt.settle(6);
    expect(result).toEqual({ ok: true, waitMs: 70_000 });
    expect(h.result.current?.refreshAvailableAt).toBe(5_070_000);
    now.mockRestore();
    h.unmount();
  });

  it("a failed Refresh never throws and leaves the screen as it is (the quota too)", async () => {
    const team = freshTeam();
    const h = rt.renderHook(() => useTeamMembers(team));
    await rt.settle(12);
    ctl.handler = () => quota();
    expect(await refreshSnapshot("roster", "frc")).toEqual({ ok: false, waitMs: null });
    ctl.handler = () => serverError();
    expect(await refreshSnapshot("roster", "frc")).toEqual({ ok: false, waitMs: null });
    expect(ids(h.result.current.members)).toEqual(["s1", "s2"]);
    h.unmount();
  });

  it("no status while the datasets come straight from Firestore (the freshness line is not shown)", async () => {
    freshTeam();
    ctl.config = { snapshots: { roster: false } };
    const h = rt.renderHook(() => useSnapshotStatus(["roster", "library"]));
    await rt.settle(6);
    expect(h.result.current).toBeNull();
    h.unmount();
  });
});

describe("useAllLibraryMatches with the library snapshot ON", () => {
  const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, data: { eventCode: "2026arli", seasonId: "rebuilt", matchType: "qualification", matchNumber: 1, published: true, ...extra } });
  const library = async (enabled: boolean, options?: { includeUnpublished?: boolean }) => {
    const h = rt.renderHook(() => useAllLibraryMatches(enabled, options));
    await rt.settle(12);
    const out = { matches: h.result.current.matches, loaded: h.result.current.loaded, error: h.result.current.error };
    h.unmount();
    return out;
  };
  const seedDirect = () => {
    fake.seed("libraryMatches/direct1", { eventCode: "2026arli", seasonId: "rebuilt", matchType: "qualification", matchNumber: 9, published: true });
    fake.seed("libraryMatches/draft1", { eventCode: "2026arli", seasonId: "rebuilt", matchType: "qualification", matchNumber: 10, published: false });
  };

  it("converts the rows exactly like the direct read ({ id, ...data }) and reads no library documents", async () => {
    freshTeam();
    seedDirect();
    ctl.handler = () => meta({ dataset: "library", teamId: null, rows: [row("m1"), row("m2", { video: { youtubeUrl: "u" } })] });
    const out = await library(true);
    expect(out.loaded).toBe(true);
    expect(out.matches).toEqual([{ id: "m1", ...row("m1").data }, { id: "m2", ...row("m2", { video: { youtubeUrl: "u" } }).data }]);
    expect(fake.billing.byCollection.libraryMatches ?? 0).toBe(0);
  });

  it("an admin screen that asks for drafts reads Firestore directly, drafts included", async () => {
    freshTeam();
    seedDirect();
    const out = await library(true, { includeUnpublished: true });
    expect(out.matches.map((m) => m.id).sort()).toEqual(["direct1", "draft1"]);
    expect(ctl.api).toHaveLength(0);
  });

  it("any failure but the quota reads Firestore directly", async () => {
    freshTeam();
    seedDirect();
    ctl.handler = () => serverError();
    expect((await library(true)).matches.map((m) => m.id)).toEqual(["direct1"]);
  });

  it("the quota keeps the screen (loaded, nothing invented) and reads nothing", async () => {
    freshTeam();
    seedDirect();
    ctl.handler = () => quota();
    const out = await library(true);
    expect(out.loaded).toBe(true);
    expect(fake.billing.total).toBe(0);
  });

  it("disabled: nothing is read at all", async () => {
    freshTeam();
    seedDirect();
    const out = await library(false);
    expect(out).toEqual({ matches: [], loaded: true, error: null });
    expect(ctl.api).toHaveLength(0);
    expect(fake.billing.total).toBe(0);
  });

  it("reads nothing until the switch is known", async () => {
    freshTeam();
    seedDirect();
    let open: () => void = () => {};
    ctl.configGate = new Promise<void>((resolve) => (open = resolve));
    const h = rt.renderHook(() => useAllLibraryMatches(true));
    await rt.settle(6);
    expect(fake.billing.total).toBe(0);
    expect(h.result.current.loaded).toBe(false);
    open();
    await rt.settle(12);
    h.unmount();
  });

  it("a program with its own library converter uses it on the snapshot's documents, de-duplicated by id across the two parts", async () => {
    freshTeam();
    ctl.profileTeam = "FA";
    ctl.port = { library: { subscribeMatches: () => () => {}, snapshotRows: (rows) => ({ matches: rows.map((r) => ({ id: r.id, converted: true })), unreadable: 0 }) } };
    ctl.handler = () => meta({ dataset: "library", teamId: "FA", rows: [row("a"), row("b"), row("a")] });
    const out = await library(true);
    expect(out.matches).toEqual([{ id: "a", converted: true }, { id: "b", converted: true }]);
  });

  it("a library snapshot answered for another team than this profile's is not used", async () => {
    freshTeam();
    ctl.profileTeam = "FA";
    ctl.port = { library: { subscribeMatches: () => () => {}, snapshotRows: (rows) => ({ matches: rows.map((r) => ({ id: r.id })), unreadable: 0 }) } };
    ctl.handler = () => meta({ dataset: "library", teamId: "FB", rows: [row("leak")] });
    const out = await library(true);
    expect(JSON.stringify(out.matches)).not.toContain("leak");
  });
});
