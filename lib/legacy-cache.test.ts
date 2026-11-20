// C4: the legacy fallbacks' per-device cache (6 hours, keyed by uid and team, cleared on sign-out, bounded). What is displayed must be identical with and without it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ uid: "u0" as string | null }));
vi.mock("react", async () => (await import("@/test-stubs/hook-runtime")).hookMock(await vi.importActual<typeof import("react")>("react")));
vi.mock("firebase/firestore", async () => (await import("@/test-stubs/fake-firestore")).fakeFirestoreModule);
vi.mock("@/lib/firebase/client", () => ({
  db: { fake: true },
  get auth() {
    return { currentUser: session.uid ? { uid: session.uid } : null };
  },
  isFirebaseConfigured: () => true,
}));
vi.mock("@/lib/program/data", () => ({ useProgramData: () => null, programData: () => null }));
vi.mock("@/lib/program/context", () => ({ useProgram: () => "frc", useProgramConfig: () => ({ connection: { features: { live: true, practice: true } } }) }));
vi.mock("@/lib/team-roster", async (orig) => ({ ...(await orig<typeof import("@/lib/team-roster")>()), loadRosterExtras: async () => ({ members: [], denied: false }), useRosterExtras: () => [] }));
vi.mock("@/lib/personal/scope", () => ({ personalScopeUid: () => null }));
vi.mock("@/lib/memberships/client", () => ({ membershipsEnabled: async () => false, useMembershipsEnabled: () => false, membershipApi: {}, publicConfigOnce: async () => null }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ profile: null, user: { uid: "u0" } }) }));

import * as fake from "@/test-stubs/fake-firestore";
import * as rt from "@/test-stubs/hook-runtime";
import * as fx from "@/test-stubs/read-fixtures";
import { rebuiltDoc } from "@/lib/analytics/cs-test-fixtures";
import { resetLegacyRowsMemoryForTests, useTeamScoutEntries } from "@/lib/scout-entries";
import { clearPracticeExtrasCache } from "@/lib/practice-extras";
import { useAllTeamPracticeSessions } from "@/lib/practice-sessions";
import { LEGACY_MAX_CHARS, LEGACY_TTL_MS, UNSAFE, clearLegacyCache, legacyCacheKey, readLegacy, toStorable, writeLegacy } from "@/lib/legacy-cache";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
  session.uid = "u0";
  resetLegacyRowsMemoryForTests();
  clearPracticeExtrasCache();
  fake.resetFake();
});
afterEach(() => vi.unstubAllGlobals());

describe("the cache itself", () => {
  const key = legacyCacheKey({ uid: "u0", program: "frc", teamId: "T" });
  it("remembers a value for 6 hours under its own key only", () => {
    expect(writeLegacy("entries", key, [{ id: "a" }], 1_000)).toBe(true);
    expect(readLegacy("entries", key, 1_000 + LEGACY_TTL_MS - 1)).toEqual([{ id: "a" }]);
    expect(readLegacy("entries", key, 1_000 + LEGACY_TTL_MS)).toBeNull();
    expect(readLegacy("entries", legacyCacheKey({ uid: "other", program: "frc", teamId: "T" }), 2_000)).toBeNull();
    expect(readLegacy("entries", legacyCacheKey({ uid: "u0", program: "ftc", teamId: "T" }), 2_000)).toBeNull();
    expect(readLegacy("sessions", key, 2_000)).toBeNull();
  });
  it("is gone after clear (sign-out, switch, Refresh)", () => {
    writeLegacy("entries", key, [1], 1_000);
    clearLegacyCache();
    expect(readLegacy("entries", key, 1_001)).toBeNull();
    expect(store.size).toBe(0);
  });
  it("does not store what does not fit or is not plain data, and never throws", () => {
    expect(writeLegacy("entries", key, ["x".repeat(LEGACY_MAX_CHARS + 1)], 1)).toBe(false);
    expect(readLegacy("entries", key, 2)).toBeNull();
    expect(writeLegacy("entries", key, [new Map()], 1)).toBe(false);
    expect(toStorable(new (class Odd {})())).toBe(UNSAFE);
    vi.stubGlobal("window", {
      get localStorage(): never {
        throw new Error("blocked");
      },
    });
    expect(writeLegacy("entries", key, [1], 1)).toBe(false);
    expect(readLegacy("entries", key, 2)).toBeNull();
    expect(() => clearLegacyCache()).not.toThrow();
  });
  it("turns Firestore timestamps and dates into epoch milliseconds", () => {
    expect(toStorable({ a: { toMillis: () => 5 }, b: new Date(7), c: [1, undefined], d: undefined })).toEqual({ a: 5, b: 7, c: [1, null] });
  });
});

async function loadEntries(team: string) {
  const h = rt.renderHook(() => useTeamScoutEntries(team));
  await rt.settle();
  const out = h.result.current.entries;
  h.unmount();
  return out;
}

function seedTeamWithLegacy(team: string) {
  fx.seedDataset({ members: 3, entries: 30, otherTeamRows: 20 }, team);
  // legacy rows: empty teamId; one stores its time as a Firestore-style Timestamp object
  fake.seed("scouting/old1", { ...rebuiltDoc({ match: "q40", team: "254", scout: "Scout 0", event: fx.EVENT }), scoutId: "u0", teamId: "" });
  fake.seed("scouting/old2", { ...rebuiltDoc({ match: "q41", team: "971", scout: "Scout 1", event: fx.EVENT }), scoutId: "u1", teamId: "", submittedAt: { toMillis: () => 1_700_000_123_456 } });
}

describe("legacy scouting rows", () => {
  it("a second page load shows the same entries and skips the two member queries", async () => {
    seedTeamWithLegacy("TC-1");
    fake.resetBilling();
    const first = await loadEntries("TC-1");
    const firstBilled = fake.billing.total;
    expect(first.map((e) => e.id)).toContain("old1");
    expect(first.map((e) => e.id)).toContain("old2");

    resetLegacyRowsMemoryForTests(); // a reload loses the page's memory; the device copy stays
    fake.resetBilling();
    const second = await loadEntries("TC-1");
    expect(second).toEqual(first);
    // the first load also reads the members' rows twice over (by id and by name) and the users; the second reads the team query only
    expect(firstBilled).toBeGreaterThan(fake.billing.total * 2);
    expect(fake.billing.byCollection.scouting).toBe(30);
  });

  it("another account, a cleared cache, or an edit on this device reads fresh", async () => {
    seedTeamWithLegacy("TC-2");
    await loadEntries("TC-2");

    resetLegacyRowsMemoryForTests();
    session.uid = "someone-else";
    fake.resetBilling();
    await loadEntries("TC-2");
    expect(fake.billing.byCollection.scouting).toBeGreaterThan(30);

    resetLegacyRowsMemoryForTests();
    session.uid = "u0";
    fake.resetBilling();
    await loadEntries("TC-2"); // the previous run left the other account's key; this account's is read fresh again
    expect(fake.billing.byCollection.scouting).toBeGreaterThan(30);

    resetLegacyRowsMemoryForTests();
    clearLegacyCache();
    fake.resetBilling();
    await loadEntries("TC-2");
    expect(fake.billing.byCollection.scouting).toBeGreaterThan(30);
  });
});

describe("legacy practice sessions", () => {
  async function loadSessions(team: string) {
    const h = rt.renderHook(() => useAllTeamPracticeSessions(team));
    await rt.settle(12);
    const out = [...h.result.current.sessions].sort((a, b) => a.id.localeCompare(b.id));
    h.unmount();
    return out;
  }

  it("a second page load shows the same sessions (legacy ones included) and skips the member queries", async () => {
    fx.seedDataset({ members: 3, entries: 0, soloSessions: 12, liveSessions: 6 }, "TS-1");
    fake.seed("practiceSessions/legacy1", { teamId: "", uid: "u0", scoutId: "u0", scoutName: "Scout 0", kind: "solo", status: "completed", accuracy: 91, startedAt: 1_600_000_000_000 });
    const first = await loadSessions("TS-1");
    expect(first.map((s) => s.id)).toContain("legacy1");
    clearPracticeExtrasCache(); // the 2-minute in-memory copy is per page load too
    fake.resetBilling();
    const second = await loadSessions("TS-1");
    expect(second).toEqual(first);
    // the team query (18) once, plus nothing from the member queries
    expect(fake.billing.byCollection.practiceSessions).toBe(18);
  });
});
