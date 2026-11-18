// C8(a): the root program's AuthProvider. A FAILED read of users/{uid} (the daily quota) must not become "no profile": that would route a member with a team to the team
// setup screen. Only the rules' denial of a missing document means no profile.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ authCallback: null as null | ((u: unknown) => void) }));

vi.mock("react", async () => (await import("@/test-stubs/hook-runtime")).hookMock(await vi.importActual<typeof import("react")>("react")));
vi.mock("firebase/firestore", async () => (await import("@/test-stubs/fake-firestore")).fakeFirestoreModule);
vi.mock("firebase/auth", async (orig) => ({ ...(await orig<typeof import("firebase/auth")>()), onAuthStateChanged: (_a: unknown, cb: (u: unknown) => void) => ((h.authCallback = cb), () => {}), getRedirectResult: async () => null, signOut: async () => {} }));
vi.mock("@/lib/firebase/client", () => ({ db: { fake: true }, auth: { currentUser: null }, isFirebaseConfigured: () => true }));
vi.mock("@/lib/team-enrollment", () => ({ syncRoles: async () => ({ changed: false, ownerPendingVerification: false, ok: true }) }));

import * as fake from "@/test-stubs/fake-firestore";
import * as rt from "@/test-stubs/hook-runtime";
import { AuthProvider } from "@/lib/auth";

type Value = { profile: { name?: string; teamId?: string } | null; loading: boolean };
const fakeUser = { uid: "u1", providerData: [], metadata: {}, getIdToken: async () => "t" };

beforeEach(() => {
  fake.resetFake();
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ ok: true }) }));
  vi.stubGlobal("document", { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: "visible" });
});
afterEach(() => vi.unstubAllGlobals());

async function signedIn() {
  const hook = rt.renderHook(() => AuthProvider({ children: null }) as unknown as { props: { value: Value } });
  h.authCallback?.(fakeUser);
  await rt.settle();
  hook.rerender();
  return hook;
}
const view = (hook: { result: { current: { props: { value: Value } } } }) => hook.result.current.props.value;

describe("AuthProvider and a failed profile read", () => {
  it("a member whose profile read fails with the quota keeps the last profile and is not routed to team setup", async () => {
    fake.seed("users/u1", { displayName: "Ann", teamId: "T1", role: "match-scout" });
    const hook = await signedIn();
    expect(view(hook).loading).toBe(false);
    expect(view(hook).profile?.teamId).toBe("T1");
    fake.failAllListeners("resource-exhausted");
    hook.rerender();
    expect(view(hook).profile?.teamId).toBe("T1"); // kept, NOT null
    expect(view(hook).loading).toBe(false);
    hook.unmount();
  });

  it("with nothing known yet, a quota failure leaves the loading state instead of reporting no profile", async () => {
    fake.seed("users/u1", { displayName: "Ann", teamId: "T1" });
    fake.failNext("resource-exhausted");
    const hook = await signedIn();
    expect(view(hook).loading).toBe(true);
    expect(view(hook).profile).toBeNull();
    hook.unmount();
  });

  it("only the rules' denial still means no profile (the account that never finished team setup)", async () => {
    fake.failNext("permission-denied");
    const hook = await signedIn();
    expect(view(hook).loading).toBe(false);
    expect(view(hook).profile).toBeNull();
    hook.unmount();
  });
});
