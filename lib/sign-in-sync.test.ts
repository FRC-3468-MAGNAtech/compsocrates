import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIGN_IN_SYNC_MIN_INTERVAL_MS, clearSignInSyncMarker, syncRolesThrottled, type SyncResult } from "./sign-in-sync";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", { sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
});

const ok = (over: Partial<SyncResult> = {}): SyncResult => ({ changed: false, ownerPendingVerification: false, ok: true, ...over });

describe("the sign-in sync's minimum interval", () => {
  it("ten page loads (restored sessions) inside ten minutes call the server once; a real sign-in always does", async () => {
    const run = vi.fn(async () => ok());
    for (let i = 0; i < 10; i += 1) await syncRolesThrottled("u1", run, { force: false }, 1_000 + i * 1_000);
    expect(run).toHaveBeenCalledTimes(1); // before: 10
    await syncRolesThrottled("u1", run, { force: true }, 20_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs again after ten minutes, for another account, and after sign-out", async () => {
    const run = vi.fn(async () => ok());
    await syncRolesThrottled("u1", run, { force: false }, 1_000);
    await syncRolesThrottled("u1", run, { force: false }, 1_000 + SIGN_IN_SYNC_MIN_INTERVAL_MS);
    await syncRolesThrottled("u2", run, { force: false }, 1_000 + SIGN_IN_SYNC_MIN_INTERVAL_MS + 1);
    expect(run).toHaveBeenCalledTimes(3);
    clearSignInSyncMarker();
    await syncRolesThrottled("u2", run, { force: false }, 1_000 + SIGN_IN_SYNC_MIN_INTERVAL_MS + 2);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("a restored session reuses the last answer (the owner-pending flag) and reports no change", async () => {
    await syncRolesThrottled("u1", async () => ok({ ownerPendingVerification: true }), { force: true }, 1_000);
    const again = await syncRolesThrottled("u1", async () => ok(), { force: false }, 2_000);
    expect(again).toEqual({ changed: false, ownerPendingVerification: true, ok: true });
  });

  it("a failed sync leaves no marker, so the next page load tries again", async () => {
    const run = vi.fn(async () => ok({ ok: false }));
    await syncRolesThrottled("u1", run, { force: false }, 1_000);
    await syncRolesThrottled("u1", run, { force: false }, 2_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("two callers that start together share one request", async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<SyncResult>((resolve) => (release = () => resolve(ok()))));
    const a = syncRolesThrottled("u1", run, { force: true }, 1_000);
    const b = syncRolesThrottled("u1", run, { force: true }, 1_001);
    release();
    await Promise.all([a, b]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("blocked storage never throws and just syncs every time", async () => {
    vi.stubGlobal("window", {
      get sessionStorage(): never {
        throw new Error("blocked");
      },
    });
    const run = vi.fn(async () => ok());
    await syncRolesThrottled("u1", run, { force: false }, 1_000);
    await syncRolesThrottled("u1", run, { force: false }, 2_000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
