// C8: the daily-quota experience. (1) one banner, (2) a shared team feed keeps its rows when the quota error arrives, (3) a failed profile read is never "no profile".
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  program: null as null | { profile: { subscribe: (uid: string, ok: (p: unknown) => void, bad: (f: unknown) => void) => () => void; update: () => Promise<void> } },
  user: { uid: "u1" } as { uid: string } | null,
  fetchCalls: 0,
  fetchBody: {} as Record<string, unknown>,
  fetchStatus: 200,
}));

vi.mock("react", async () => (await import("@/test-stubs/hook-runtime")).hookMock(await vi.importActual<typeof import("react")>("react")));
vi.mock("firebase/firestore", async () => (await import("@/test-stubs/fake-firestore")).fakeFirestoreModule);
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, auth: { currentUser: { uid: "u1", getIdToken: async () => "t" } }, isFirebaseConfigured: () => true }));
vi.mock("@/lib/program/data", () => ({ useProgramData: () => h.program, programData: () => null }));
vi.mock("@/lib/program/context", () => ({ useProgram: () => "frc", useProgramConfig: () => ({ connection: { features: { live: true, practice: true } } }) }));
vi.mock("@/lib/team-roster", () => ({ loadRosterExtras: async () => ({ members: [], denied: false }) }));
vi.mock("@/lib/personal/scope", () => ({ personalScopeUid: () => null }));
vi.mock("@/lib/auth", async () => {
  const { createContext } = await vi.importActual<typeof import("react")>("react");
  return { AuthContext: createContext(null), useAuth: () => ({ user: h.user, loading: false, profile: null }) };
});

import * as fake from "@/test-stubs/fake-firestore";
import * as rt from "@/test-stubs/hook-runtime";
import * as fx from "@/test-stubs/read-fixtures";
import { ProgramAuth } from "@/components/program/program-auth";
import { authedApi } from "@/lib/api-client";
import { getDocs, collection } from "@/lib/firebase/metered";
import { isQuotaExceeded, isQuotaFlagged, resetQuotaForTests, useQuotaBanner, dismissQuotaBanner } from "@/lib/quota";
import { readFailureMeansNoProfile } from "@/lib/profile-read-failure";
import { useTeamScoutEntries } from "@/lib/scout-entries";

beforeEach(() => {
  resetQuotaForTests();
  fake.resetFake();
  h.program = null;
  h.fetchStatus = 200;
});

describe("recognizing the quota", () => {
  it.each([
    [{ code: "resource-exhausted" }, true],
    [{ code: "firestore/resource-exhausted" }, true],
    [{ code: 8 }, true],
    [{ code: "quota_exceeded" }, true],
    [new Error("RESOURCE_EXHAUSTED: Quota exceeded."), true],
    [{ code: "permission-denied" }, false],
    [{ code: "unavailable" }, false],
    [null, false],
  ])("%j -> %s", (err, expected) => expect(isQuotaExceeded(err)).toBe(expected));
});

describe("the banner", () => {
  it("one quota failure shows it; a later server read clears it; dismissing hides it", async () => {
    fake.seed("scouting/a", { teamId: "T" });
    const banner = rt.renderHook(() => useQuotaBanner());
    expect(banner.result.current).toBe(false);
    fake.failNext("resource-exhausted");
    await expect(getDocs(collection({} as never, "scouting"))).rejects.toMatchObject({ code: "resource-exhausted" });
    expect(isQuotaFlagged()).toBe(true);
    banner.rerender();
    expect(banner.result.current).toBe(true);
    dismissQuotaBanner();
    banner.rerender();
    expect(banner.result.current).toBe(false);
    await getDocs(collection({} as never, "scouting")); // the allowance is back
    expect(isQuotaFlagged()).toBe(false);
  });

  it("an API answer with code quota_exceeded flags it too", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 503, json: async () => ({ ok: false, code: "quota_exceeded", error: "busy" }) }));
    await expect(authedApi("/api/x")).rejects.toMatchObject({ code: "quota_exceeded" });
    expect(isQuotaFlagged()).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("the shared team feed when the quota error arrives", () => {
  async function feed(team: string) {
    fx.seedDataset({ members: 2, entries: 6 }, team);
    const hook = rt.renderHook(() => useTeamScoutEntries(team));
    await rt.settle();
    return hook;
  }

  it("keeps the last rows on screen (and flags the banner)", async () => {
    const hook = await feed("TQ-1");
    expect(hook.result.current.entries).toHaveLength(6);
    fake.failAllListeners("resource-exhausted");
    hook.rerender();
    expect(hook.result.current.entries).toHaveLength(6);
    expect(hook.result.current.loaded).toBe(true);
    expect(isQuotaFlagged()).toBe(true);
    hook.unmount();
  });

  it("any other failure still clears them, as before", async () => {
    const hook = await feed("TQ-2");
    fake.failAllListeners("unavailable");
    hook.rerender();
    expect(hook.result.current.entries).toHaveLength(0);
    hook.unmount();
  });
});

describe("a failed profile read is never 'no profile'", () => {
  it("only the rules' denial means no profile", () => {
    expect(readFailureMeansNoProfile({ code: "permission-denied" })).toBe(true);
    expect(readFailureMeansNoProfile({ code: "firestore/permission-denied" })).toBe(true);
    for (const code of ["resource-exhausted", "unavailable", "internal", "unknown"]) expect(readFailureMeansNoProfile({ code })).toBe(false);
    expect(readFailureMeansNoProfile(null)).toBe(false);
  });

  function programProfile() {
    let ok!: (p: unknown) => void;
    let bad!: (f: unknown) => void;
    h.program = { profile: { subscribe: (_uid, onOk, onBad) => ((ok = onOk), (bad = onBad), () => {}), update: async () => {} } };
    const hook = rt.renderHook(() => ProgramAuth({ children: null }) as unknown as { props: { value: { profile: unknown; loading: boolean } } });
    return { hook, ok: (p: unknown) => ok(p), bad: (f: unknown) => bad(f), view: () => hook.result.current.props.value };
  }

  it("the other program's profile: a quota failure keeps the last profile; one with nothing to show stays loading; only permission-denied is 'no profile'", () => {
    const p = programProfile();
    expect(p.view().loading).toBe(true);
    p.bad({ code: "resource-exhausted" }); // nothing known yet: still loading, NOT routed to team setup
    expect(p.view().loading).toBe(true);
    expect(p.view().profile).toBeNull();
    p.ok({ name: "Ann", teamId: "T1" });
    expect(p.view().profile).toEqual({ name: "Ann", teamId: "T1" });
    expect(p.view().loading).toBe(false);
    p.bad({ code: "resource-exhausted" });
    expect(p.view().profile).toEqual({ name: "Ann", teamId: "T1" }); // kept
    expect(p.view().loading).toBe(false);
    p.bad({ code: "permission-denied" });
    expect(p.view().profile).toBeNull(); // the legitimate "no profile yet"
    expect(p.view().loading).toBe(false);
  });
});
