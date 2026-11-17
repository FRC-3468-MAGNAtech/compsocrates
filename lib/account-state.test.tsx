import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserDoc } from "@/lib/auth";
import type { MembershipDoc } from "@/lib/memberships/model";

// `useAccountState()` (memberships build 1): states, the permission-denied and empty fallbacks, both programs' shapes, the 5-membership list, and ONE read per
// (program, uid) however many components mount it. The auth and program contexts are mocked; Firestore is a mock (no emulator).

const mocks = vi.hoisted(() => ({
  auth: { user: { uid: "u1" } as { uid: string } | null, profile: null as unknown, loading: false },
  program: "frc" as "frc" | "ftc",
  getDocs: vi.fn(),
  report: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/program/context", () => ({ useProgram: () => mocks.program }));
vi.mock("@/lib/firebase/client", () => ({ db: {} }));
vi.mock("@/lib/firestore-errors", () => ({ reportFirestoreError: mocks.report }));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, path: string) => ({ path }),
  query: (c: { path: string }, ...c2: unknown[]) => ({ path: c.path, constraints: c2 }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  getDocs: mocks.getDocs,
}));

import { deriveAccountState, fetchMyMemberships, loadAccountMemberships, refreshAccountState, resetAccountStateForTests, useAccountState } from "@/lib/account-state";

const profile = (over: Partial<UserDoc> = {}): UserDoc => ({ name: "Ann", email: "a@example.com", teamId: "AAA111", primaryRole: "drive-team", secondaryRoles: ["media"], isAdmin: true, isOwner: false, themeId: "t", ...over }) as UserDoc;
const stored = (teamId: string, over: Record<string, unknown> = {}): MembershipDoc => ({
  uid: "u1",
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
const snapshot = (docs: MembershipDoc[]) => ({ docs: docs.map((d) => ({ data: () => d })) });

beforeEach(() => {
  resetAccountStateForTests();
  mocks.auth = { user: { uid: "u1" }, profile: profile(), loading: false };
  mocks.program = "frc";
  mocks.getDocs.mockReset().mockResolvedValue(snapshot([]));
  mocks.report.mockReset();
});

/** Mount the hook once (static render: no effects run) and return what it answered. */
function render(): ReturnType<typeof useAccountState> {
  let out: ReturnType<typeof useAccountState> | null = null;
  function Probe() {
    out = useAccountState();
    return createElement("span");
  }
  renderToStaticMarkup(createElement(Probe));
  return out!;
}

describe("deriveAccountState", () => {
  const done = (memberships: MembershipDoc[], error: string | null = null) => ({ state: "done" as const, memberships, error });

  it("loading while auth loads, and while the membership read is missing or pending", () => {
    for (const input of [
      { authLoading: true, entry: done([]) },
      { authLoading: false, entry: undefined },
      { authLoading: false, entry: { state: "pending" as const } },
    ]) {
      expect(deriveAccountState({ program: "frc", uid: "u1", profile: profile(), ...input })).toEqual({ status: "loading", activeTeamId: null, memberships: [], program: "frc" });
    }
  });

  it("team: the pointer is the active team, the stored memberships are listed and not implicit", () => {
    const s = deriveAccountState({ program: "frc", uid: "u1", authLoading: false, profile: profile({ teamId: "AAA111" }), entry: done([stored("AAA111"), stored("BBB222")]) });
    expect(s.status).toBe("team");
    expect(s.activeTeamId).toBe("AAA111");
    expect(s.memberships.map((m) => [m.teamId, m.implicit])).toEqual([["AAA111", false], ["BBB222", false]]);
  });

  it("no-team: an empty pointer (or no profile) after the read has answered", () => {
    expect(deriveAccountState({ program: "frc", uid: "u1", authLoading: false, profile: profile({ teamId: "" }), entry: done([]) })).toMatchObject({ status: "no-team", activeTeamId: null, memberships: [] });
    expect(deriveAccountState({ program: "ftc", uid: "u1", authLoading: false, profile: null, entry: done([stored("T1")]) })).toMatchObject({ status: "no-team", activeTeamId: null, program: "ftc" });
    expect(deriveAccountState({ program: "ftc", uid: "u1", authLoading: false, profile: null, entry: done([stored("T1")]) }).memberships).toHaveLength(1);
  });

  it("FALLBACK on an empty read: ONE implicit membership built from the profile pointer", () => {
    const s = deriveAccountState({ program: "frc", uid: "u1", authLoading: false, profile: profile(), entry: done([]) });
    expect(s.status).toBe("team");
    expect(s.memberships).toHaveLength(1);
    expect(s.memberships[0]).toMatchObject({ implicit: true, teamId: "AAA111", role: "drive-team", secondaryRoles: ["media"], isAdmin: true, origin: "pointer", status: "active", name: "Ann" });
  });

  it("FALLBACK on permission-denied (rules not deployed): the same one implicit membership", () => {
    const s = deriveAccountState({ program: "frc", uid: "u1", authLoading: false, profile: profile(), entry: done([], "permission-denied") });
    expect(s).toMatchObject({ status: "team", activeTeamId: "AAA111" });
    expect(s.memberships.map((m) => m.implicit)).toEqual([true]);
  });

  it("a stored membership for the active team is used as it is (no implicit duplicate)", () => {
    const s = deriveAccountState({ program: "frc", uid: "u1", authLoading: false, profile: profile(), entry: done([stored("AAA111", { role: "lead-scout" })]) });
    expect(s.memberships).toHaveLength(1);
    expect(s.memberships[0]).toMatchObject({ implicit: false, role: "lead-scout" });
  });

  it("the 5-membership list comes back whole, in both program shapes", () => {
    const five = ["T1", "T2", "T3", "T4", "T5"].map((t) => stored(t, t === "T3" ? { fieldTeamIds: ["a", "b"], roles: null } : {}));
    const frc = deriveAccountState({ program: "frc", uid: "u1", authLoading: false, profile: profile({ teamId: "T2" }), entry: done(five) });
    expect(frc.memberships).toHaveLength(5);
    expect(frc.memberships.every((m) => !m.implicit)).toBe(true);
    const ftc = deriveAccountState({ program: "ftc", uid: "u1", authLoading: false, profile: profile({ teamId: "T3" }), entry: done(five) });
    expect(ftc.program).toBe("ftc");
    expect(ftc.memberships.find((m) => m.teamId === "T3")?.fieldTeamIds).toEqual(["a", "b"]);
  });

  it("a signed-out visitor is no-team, not loading forever", () => {
    expect(deriveAccountState({ program: "frc", uid: null, authLoading: false, profile: null, entry: undefined })).toMatchObject({ status: "no-team", memberships: [] });
  });
});

describe("the one-time read", () => {
  it("reads memberships with `uid ==` through the program path (FRC at the root, FTC under programs/ftc)", async () => {
    mocks.getDocs.mockResolvedValue(snapshot([stored("AAA111")]));
    expect(await fetchMyMemberships("frc", "u1")).toHaveLength(1);
    await fetchMyMemberships("ftc", "u1");
    const queries = mocks.getDocs.mock.calls.map((c) => c[0] as { path: string; constraints: unknown[] });
    expect(queries.map((q) => q.path)).toEqual(["memberships", "programs/ftc/memberships"]);
    expect(queries[0].constraints).toEqual([{ field: "uid", op: "==", value: "u1" }]);
  });

  it("drops a document that has no usable uid or team", async () => {
    mocks.getDocs.mockResolvedValue({ docs: [{ data: () => ({ nope: 1 }) }, { data: () => stored("AAA111") }] });
    expect(await fetchMyMemberships("frc", "u1")).toHaveLength(1);
  });

  it("two mounts read once: the second sees the pending mark", async () => {
    const fetcher = vi.fn().mockResolvedValue([stored("AAA111")]);
    await Promise.all([loadAccountMemberships("frc", "u1", fetcher), loadAccountMemberships("frc", "u1", fetcher)]);
    await loadAccountMemberships("frc", "u1", fetcher); // a later remount, long after
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("each program and each account has its own read", async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    await loadAccountMemberships("frc", "u1", fetcher);
    await loadAccountMemberships("ftc", "u1", fetcher);
    await loadAccountMemberships("frc", "u2", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("is refetched only after refreshAccountState()", async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    await loadAccountMemberships("frc", "u1", fetcher);
    refreshAccountState("u1");
    await loadAccountMemberships("frc", "u1", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("a refused read is remembered (no retry storm), is not reported when it is permission-denied, and is reported otherwise", async () => {
    const denied = vi.fn().mockRejectedValue(Object.assign(new Error("denied"), { code: "permission-denied" }));
    await loadAccountMemberships("frc", "u1", denied);
    await loadAccountMemberships("frc", "u1", denied);
    expect(denied).toHaveBeenCalledTimes(1);
    expect(mocks.report).not.toHaveBeenCalled();
    const broken = vi.fn().mockRejectedValue(Object.assign(new Error("down"), { code: "unavailable" }));
    await loadAccountMemberships("frc", "u2", broken);
    expect(mocks.report).toHaveBeenCalledTimes(1);
  });
});

describe("the hook", () => {
  it("answers loading on the first render and reads nothing while rendering", () => {
    expect(render()).toEqual({ status: "loading", activeTeamId: null, memberships: [], program: "frc" });
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });

  it("loading while the auth profile loads; the FTC program id is carried through", () => {
    mocks.auth = { user: { uid: "u1" }, profile: null, loading: true };
    mocks.program = "ftc";
    expect(render()).toMatchObject({ status: "loading", program: "ftc" });
  });

  it("two components mounting it add no read at render, and after the read answered both see the same state without reading again", async () => {
    await loadAccountMemberships("frc", "u1", async () => [stored("AAA111"), stored("BBB222")]);
    // Static rendering uses the server snapshot (loading) so the hook never reads while rendering; the shared store holds the answer:
    const first = render();
    const second = render();
    expect(first).toEqual(second);
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });
});
