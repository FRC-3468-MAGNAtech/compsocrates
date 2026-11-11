import { getSeasonFromEventKey, isTbaEventKey, normalizeEventKey } from "@/config/event";
import { resolveEventName, type EventNameSource } from "@/lib/events/names";
import type { ActionError, ActionResult, EventInfo } from "@/lib/events/types";

/**
 * The event-name store: one season-wide request names every event of that season (TBA's `/events/{year}` answers with
 * all of them), cached in memory for the tab with a TTL. Framework-free so it is unit-testable; the React hooks are in
 * `lib/events/use-event-names.ts` and the app-wide instance (wired to the `getEvents` Server Action) is
 * `lib/events/event-names.ts`.
 *
 * - One request per season, however many keys or components ask (concurrent asks share the in-flight promise).
 * - A failure is never cached as data: the season is marked `failed` (so the UI can say why), a retry with a short
 *   backoff runs inside the same ask for transient errors, and the next ask after a short cooldown (or `force`) tries again.
 *   Errors an admin has to fix (missing key, server sign-in not configured, key rejected, not signed in) are not retried
 *   in the same ask, since repeating the request cannot help.
 * - Stored names (`selectedEventNames`, `eventName` on practice and library rows) are registered with `addStored` and
 *   read as the second step of the chain in `lib/events/names.ts`.
 */

export type EventNameStatus = "loading" | "ready" | "fallback";

export type EventNameState = {
  key: string;
  name: string;
  source: EventNameSource;
  /** `loading`: the season lookup is pending. `ready`: a definitive answer (the API's, or no lookup needed). `fallback`: the API failed, `name` is the best known fallback and `error` says why. */
  status: EventNameStatus;
  error?: ActionError;
  /** The full event from the season list when the API answered and knows the key (name, dates, place). */
  info?: EventInfo;
};

type SeasonState =
  | { status: "loading"; failures: number }
  | { status: "ready"; events: Map<string, EventInfo>; expires: number }
  | { status: "failed"; error: ActionError; failedAt: number; failures: number };

export type EventNameStoreOptions = {
  /** One request for the whole season. */
  fetchSeason: (season: number) => Promise<ActionResult<EventInfo[]>>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** How long a successful season list is trusted. Default 30 minutes. */
  ttlMs?: number;
  /** Waits between attempts of one ask (so the default makes three attempts). Default 400 ms, then 1200 ms. */
  retryDelaysMs?: readonly number[];
  /** After a failure, an ask without `force` does nothing until this long has passed. Default 15 s. */
  cooldownMs?: number;
};

/** Errors that repeating the request cannot fix: the person who runs the deployment has to. */
const NON_RETRYABLE: ReadonlySet<ActionError["code"]> = new Set(["missing_credentials", "server_not_configured", "unauthorized", "not_found"]);

/** Whether an admin can act on this error (a missing or rejected key, server sign-in not set up), as opposed to a passing outage or being signed out. */
export function isAdminFixableEventError(error: ActionError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "missing_credentials" || error.code === "server_not_configured") return true;
  return error.code === "unauthorized" && !/^sign in/i.test(error.message.trim());
}

const NETWORK_ERROR: ActionError = { code: "network_error", message: "Could not reach the server. Check your connection and try again." };

/** The season to look an event up in, or null when the key is not a real TBA key (`app-testing`, `week0`). */
export function lookupSeasonForKey(key: string): number | null {
  const normalized = normalizeEventKey(key);
  if (!isTbaEventKey(normalized)) return null;
  const year = getSeasonFromEventKey(normalized);
  return year !== null && year >= 1992 && year <= 2100 ? year : null;
}

export function createEventNameStore(options: EventNameStoreOptions) {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const ttlMs = options.ttlMs ?? 30 * 60 * 1000;
  const retryDelaysMs = options.retryDelaysMs ?? [400, 1200];
  const cooldownMs = options.cooldownMs ?? 15_000;

  const seasons = new Map<number, SeasonState>();
  const inFlight = new Map<number, Promise<void>>();
  const stored = new Map<string, string>();
  const listeners = new Set<() => void>();
  let version = 0;

  const notify = () => {
    version += 1;
    for (const listener of listeners) listener();
  };

  async function attempt(season: number): Promise<ActionResult<EventInfo[]>> {
    try {
      return await options.fetchSeason(season);
    } catch {
      // The Server Action itself failed (network drop, deploy in flight).
      return { ok: false, error: NETWORK_ERROR };
    }
  }

  async function load(season: number, previousFailures: number): Promise<void> {
    // An expired list stays in place while it is refreshed (and after a failed refresh): a stale real name beats a placeholder.
    const prior = seasons.get(season);
    if (prior?.status !== "ready") {
      seasons.set(season, { status: "loading", failures: previousFailures });
      notify();
    }
    let error: ActionError = NETWORK_ERROR;
    for (let i = 0; i <= retryDelaysMs.length; i++) {
      const result = await attempt(season);
      if (result.ok) {
        const events = new Map<string, EventInfo>();
        for (const e of result.data) events.set(String(e.code).toLowerCase(), e);
        seasons.set(season, { status: "ready", events, expires: now() + ttlMs });
        notify();
        return;
      }
      error = result.error;
      if (NON_RETRYABLE.has(error.code) || i === retryDelaysMs.length) break;
      await sleep(retryDelaysMs[i]);
    }
    if (prior?.status === "ready") {
      seasons.set(season, { ...prior, expires: now() + cooldownMs });
      return;
    }
    seasons.set(season, { status: "failed", error, failedAt: now(), failures: previousFailures + 1 });
    notify();
  }

  /**
   * Makes sure `season` is loaded: a fresh cached list is left alone, a request already in flight is shared, a recent
   * failure is not hammered (unless `force`), anything else is requested. Never rejects: read the outcome from the store.
   */
  function ensureSeason(season: number, opts: { force?: boolean } = {}): Promise<void> {
    const running = inFlight.get(season);
    if (running) return running;
    const state = seasons.get(season);
    if (!opts.force) {
      if (state?.status === "ready" && state.expires > now()) return Promise.resolve();
      if (state?.status === "failed" && now() - state.failedAt < cooldownMs) return Promise.resolve();
    }
    const failures = state?.status === "failed" || state?.status === "loading" ? state.failures : 0;
    const promise = load(season, failures).finally(() => inFlight.delete(season));
    inFlight.set(season, promise);
    return promise;
  }

  function addStored(names: Readonly<Record<string, string>> | null | undefined): void {
    if (!names) return;
    let changed = false;
    for (const [rawKey, rawName] of Object.entries(names)) {
      const key = normalizeEventKey(rawKey);
      const name = typeof rawName === "string" ? rawName.trim() : "";
      if (!key || !name || name.toLowerCase() === key || stored.get(key) === name) continue;
      stored.set(key, name);
      changed = true;
    }
    if (changed) notify();
  }

  /** The state for one key. `extraStored` (keyed by normalized key) is checked before the registered names. */
  function resolve(key: string, extraStored?: Readonly<Record<string, string>>): EventNameState {
    const normalized = normalizeEventKey(key);
    const storedName = extraStored?.[normalized] ?? extraStored?.[String(key ?? "").trim()] ?? stored.get(normalized) ?? null;
    const season = lookupSeasonForKey(key);
    if (season === null) return { key, ...resolveEventName({ key, stored: storedName }), status: "ready" };

    const state = seasons.get(season);
    if (state?.status === "ready") {
      const info = state.events.get(normalized);
      return { key, ...resolveEventName({ key, api: info?.name, stored: storedName }), status: "ready", ...(info ? { info } : {}) };
    }
    const resolved = resolveEventName({ key, stored: storedName });
    if (state?.status === "failed") return { key, ...resolved, status: "fallback", error: state.error };
    return { key, ...resolved, status: "loading" };
  }

  /** Every season whose lookup currently failed, for the admin notice. */
  function failures(): { season: number; error: ActionError; failures: number }[] {
    const out: { season: number; error: ActionError; failures: number }[] = [];
    for (const [season, state] of seasons) if (state.status === "failed") out.push({ season, error: state.error, failures: state.failures });
    return out;
  }

  return {
    ensureSeason,
    addStored,
    resolve,
    failures,
    /** True when a failed season may be asked again by a timer (a transient error, and not too many failures in a row). */
    canAutoRetry(season: number): boolean {
      const state = seasons.get(season);
      return state?.status === "failed" && !NON_RETRYABLE.has(state.error.code) && state.failures < 3;
    },
    cooldownMs,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion: () => version,
    /** Forgets everything (tests, and sign-out). */
    reset(): void {
      seasons.clear();
      inFlight.clear();
      stored.clear();
      notify();
    },
  };
}

export type EventNameStore = ReturnType<typeof createEventNameStore>;
