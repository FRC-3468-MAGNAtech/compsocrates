// Read reduction 2a, step 2: ONE roster listener per team however many call sites, and the flag states read once when the entries feed is already listening.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => (await import("@/test-stubs/hook-runtime")).hookMock(await vi.importActual<typeof import("react")>("react")));
vi.mock("firebase/firestore", async () => (await import("@/test-stubs/fake-firestore")).fakeFirestoreModule);
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, auth: { currentUser: { uid: "u1" } }, isFirebaseConfigured: () => true }));
vi.mock("@/lib/program/data", () => ({ useProgramData: () => null, programData: () => null }));
vi.mock("@/lib/program/context", () => ({ useProgram: () => "frc", useProgramConfig: () => ({ connection: { features: { live: true, practice: true } } }) }));
vi.mock("@/lib/team-roster", async (orig) => ({ ...(await orig<typeof import("@/lib/team-roster")>()), loadRosterExtras: async () => ({ members: [], denied: false }), useRosterExtras: () => [] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ profile: null, user: { uid: "u1" } }) }));
vi.mock("@/lib/personal/scope", () => ({ personalScopeUid: () => null }));
vi.mock("@/lib/memberships/client", () => ({ membershipsEnabled: async () => false, useMembershipsEnabled: () => false, membershipApi: {}, publicConfigOnce: async () => null }));

import * as fake from "@/test-stubs/fake-firestore";
import * as rt from "@/test-stubs/hook-runtime";
import { resetRosterFeedsForTests, useTeamMembers } from "@/lib/team-members";
import { useTeamScoutEntries, resetLegacyRowsMemoryForTests } from "@/lib/scout-entries";
import { clearPracticeExtrasCache, loadPracticeExtras } from "@/lib/practice-extras";

let n = 0;
function team(): string {
  n += 1;
  resetRosterFeedsForTests();
  resetLegacyRowsMemoryForTests();
  clearPracticeExtrasCache();
  fake.resetFake();
  const id = `SF-${n}`;
  for (let i = 0; i < 5; i += 1) fake.seed(`users/m${i}`, { teamId: id, displayName: `Member ${i}`, role: "match-scout" });
  return id;
}

afterEach(() => resetRosterFeedsForTests());

describe("the shared roster listener", () => {
  it("three call sites open ONE listener and bill the roster once", async () => {
    const t = team();
    const hooks = [0, 1, 2].map(() => rt.renderHook(() => useTeamMembers(t)));
    await rt.settle();
    expect(fake.activeListeners()).toBe(1);
    expect(fake.billing.byCollection.users).toBe(5);
    for (const h of hooks) expect(h.result.current.members).toHaveLength(5);
    hooks.forEach((h) => h.unmount());
  });

  it("a page that mounts after another unmounted reuses the lingering listener (no new read)", async () => {
    const t = team();
    const first = rt.renderHook(() => useTeamMembers(t));
    await rt.settle();
    first.unmount();
    expect(fake.activeListeners()).toBe(1); // lingering
    const second = rt.renderHook(() => useTeamMembers(t));
    await rt.settle();
    expect(second.result.current.members).toHaveLength(5);
    expect(second.result.current.loaded).toBe(true);
    expect(fake.billing.byCollection.users).toBe(5);
    second.unmount();
  });

  it("after the linger the listener stops", async () => {
    vi.useFakeTimers();
    try {
      const t = team();
      const h = rt.renderHook(() => useTeamMembers(t));
      await vi.advanceTimersByTimeAsync(10);
      h.unmount();
      await vi.advanceTimersByTimeAsync(21_000);
      expect(fake.activeListeners()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("different teams do not share", async () => {
    const a = team();
    const b = `${a}-b`;
    fake.seed("users/other", { teamId: b, displayName: "Other", role: "match-scout" });
    const ha = rt.renderHook(() => useTeamMembers(a));
    const hb = rt.renderHook(() => useTeamMembers(b));
    await rt.settle();
    expect(ha.result.current.members).toHaveLength(5);
    expect(hb.result.current.members.map((m) => m.uid)).toEqual(["other"]);
    expect(fake.activeListeners()).toBe(2);
    ha.unmount();
    hb.unmount();
  });

  it("a failed source ends the feed: the error shows, and the next mount starts a fresh read", async () => {
    const t = team();
    fake.failNext("permission-denied");
    const h = rt.renderHook(() => useTeamMembers(t));
    await rt.settle();
    expect(h.result.current.error).not.toBeNull();
    h.unmount();
    const again = rt.renderHook(() => useTeamMembers(t));
    await rt.settle();
    expect(again.result.current.error).toBeNull();
    expect(again.result.current.members).toHaveLength(5);
    again.unmount();
  });
});

describe("the flag states are read once when the entries feed is listening", () => {
  const seedFlags = (t: string) => {
    fake.seed("practiceSessions/s1", { teamId: t, uid: "m0", scoutId: "m0", scoutName: "Member 0", kind: "solo", status: "completed", accuracy: 80, startedAt: 1_700_000_000_000 });
    for (let i = 0; i < 7; i += 1) fake.seed(`scoutingFlagStates/practiceSession:x${i}`, { teamId: t, entityType: "practiceSession", entityId: `x${i}`, excludeFromAccuracy: true });
  };

  it("entries feed + practice extras: 7 flag documents billed once, and the exclusions are the same", async () => {
    const t = team();
    seedFlags(t);
    const feed = rt.renderHook(() => useTeamScoutEntries(t));
    await rt.settle();
    fake.resetBilling();
    const { extras, error } = await loadPracticeExtras(t, [{ uid: "m0", name: "Member 0" }]);
    expect(error).toBeNull();
    expect(fake.billing.byCollection.scoutingFlagStates ?? 0).toBe(0); // taken from the live listener
    expect([...extras.excluded].sort()).toEqual(["x0", "x1", "x2", "x3", "x4", "x5", "x6"]);
    feed.unmount();
  });

  it("no entries feed: the extras still read the flag states themselves (7 documents)", async () => {
    const t = team();
    seedFlags(t);
    const { extras } = await loadPracticeExtras(t, [{ uid: "m0", name: "Member 0" }]);
    expect(fake.billing.byCollection.scoutingFlagStates).toBe(7);
    expect(extras.excluded.size).toBe(7);
  });

  it("the entries feed mounting FIRST and the extras asking before its first snapshot still bills once", async () => {
    const t = team();
    seedFlags(t);
    const feed = rt.renderHook(() => useTeamScoutEntries(t));
    const pending = loadPracticeExtras(t, [{ uid: "m0", name: "Member 0" }]); // asked in the same tick the listener starts
    await rt.settle();
    const { extras } = await pending;
    expect(fake.billing.byCollection.scoutingFlagStates).toBe(7);
    expect(extras.excluded.size).toBe(7);
    feed.unmount();
  });
});
