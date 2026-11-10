// Offline-tolerant submit. Firestore writes are applied to the local cache at once and queued for the server, but the promise `addDoc` returns only
// settles when the server acknowledges: offline, it never does. A form that awaits it forever sits on "Submitting..." even though nothing is wrong.
// `settleSubmit` waits for the real acknowledgement, but gives up waiting (reporting "queued") as soon as the browser is offline, or after a grace period
// on a slow connection. The write is not cancelled: `settled` is still the real promise, so the caller can react if the server later refuses it.

export type SubmitOutcome = "synced" | "queued";

export type SettledSubmit = {
  outcome: SubmitOutcome;
  /** The submit's own promise, still pending when `outcome` is "queued". Rejects if the server refuses the write. */
  settled: Promise<void>;
};

export type SettleOptions = {
  /** Is the browser offline right now? */
  isOffline: () => boolean;
  /** How long to wait for the server on a connection that says it is online (default 8 s). */
  graceMs?: number;
  /** How long to wait offline before reporting "queued" (default 250 ms: long enough for a synchronous client-side refusal to arrive first). */
  offlineGraceMs?: number;
  /** Calls back when the browser goes offline; returns the unsubscribe. Default: the window's `offline` event (nothing outside a browser). */
  onOffline?: (callback: () => void) => () => void;
};

const browserOnOffline = (callback: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("offline", callback);
  return () => window.removeEventListener("offline", callback);
};

/**
 * Resolves when `submit` is acknowledged ("synced"), or when waiting is pointless ("queued"): offline now, going offline while waiting, or the grace
 * period passing. A rejection that arrives first (a refused write) rejects the result, so the caller's error handling is unchanged. `submit` may also be
 * a plain value (a synchronous handler): that is "synced".
 */
export function settleSubmit(submit: void | Promise<void>, options: SettleOptions): Promise<SettledSubmit> {
  if (!submit || typeof (submit as Promise<void>).then !== "function") return Promise.resolve({ outcome: "synced", settled: Promise.resolve() });
  const settled = submit as Promise<void>;
  const { isOffline, graceMs = 8000, offlineGraceMs = 250, onOffline = browserOnOffline } = options;
  return new Promise<SettledSubmit>((resolve, reject) => {
    let done = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let unsubscribe: (() => void) | null = null;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      unsubscribe?.();
      fn();
    };
    const queued = () => finish(() => resolve({ outcome: "queued", settled }));
    settled.then(
      () => finish(() => resolve({ outcome: "synced", settled })),
      (error: unknown) => finish(() => reject(error))
    );
    if (done) return;
    timers.push(setTimeout(queued, isOffline() ? offlineGraceMs : graceMs));
    unsubscribe = onOffline(() => timers.push(setTimeout(queued, offlineGraceMs)));
  });
}
