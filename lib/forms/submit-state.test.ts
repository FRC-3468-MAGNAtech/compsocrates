import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settleSubmit } from "@/lib/forms/submit-state";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const never = (): Promise<void> => new Promise(() => {});
const online = { isOffline: () => false, onOffline: () => () => {} };
const offline = { isOffline: () => true, onOffline: () => () => {} };

describe("settleSubmit", () => {
  it("is synced when the write is acknowledged", async () => {
    const r = await settleSubmit(Promise.resolve(), online);
    expect(r.outcome).toBe("synced");
  });

  it("treats a synchronous handler as synced", async () => {
    expect((await settleSubmit(undefined, online)).outcome).toBe("synced");
  });

  it("does not wait forever offline: reports queued after a moment while the write stays pending", async () => {
    let done = false;
    const write = never().finally(() => (done = true));
    const p = settleSubmit(write, offline);
    await vi.advanceTimersByTimeAsync(300);
    const r = await p;
    expect(r.outcome).toBe("queued");
    expect(r.settled).toBe(write);
    expect(done).toBe(false);
  });

  it("an acknowledgement that arrives in the grace period still counts as synced", async () => {
    let ack: () => void = () => {};
    const write = new Promise<void>((res) => (ack = res));
    const p = settleSubmit(write, offline);
    await vi.advanceTimersByTimeAsync(100);
    ack();
    expect((await p).outcome).toBe("synced");
  });

  it("a refusal that arrives first rejects, even offline (a client-side validation error is not queued)", async () => {
    const p = settleSubmit(Promise.reject(new Error("invalid data")), offline);
    await expect(p).rejects.toThrow("invalid data");
  });

  it("on a connection that says it is online, gives the server a grace period before calling it queued", async () => {
    const p = settleSubmit(never(), { ...online, graceMs: 8000 });
    await vi.advanceTimersByTimeAsync(7999);
    let settled = false;
    void p.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect((await p).outcome).toBe("queued");
  });

  it("goes queued shortly after the browser drops offline while waiting", async () => {
    let drop: () => void = () => {};
    const p = settleSubmit(never(), { isOffline: () => false, onOffline: (cb) => ((drop = cb), () => {}) });
    await vi.advanceTimersByTimeAsync(1000);
    drop();
    await vi.advanceTimersByTimeAsync(300);
    expect((await p).outcome).toBe("queued");
  });

  it("a queued write that the server later refuses is still observable on `settled`", async () => {
    let fail: (e: Error) => void = () => {};
    const write = new Promise<void>((_, rej) => (fail = rej));
    const p = settleSubmit(write, offline);
    await vi.advanceTimersByTimeAsync(300);
    const r = await p;
    expect(r.outcome).toBe("queued");
    const seen = r.settled.catch((e: Error) => e.message);
    fail(new Error("permission-denied"));
    expect(await seen).toBe("permission-denied");
  });

  it("stops its timers and listener once settled", async () => {
    const unsubscribe = vi.fn();
    await settleSubmit(Promise.resolve(), { isOffline: () => false, onOffline: () => unsubscribe });
    expect(unsubscribe).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
