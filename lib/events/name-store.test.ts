import { describe, expect, it, vi } from "vitest";
import { createEventNameStore, isAdminFixableEventError, lookupSeasonForKey } from "@/lib/events/name-store";
import type { ActionError, ActionResult, EventInfo } from "@/lib/events/types";

const event = (code: string, name: string): EventInfo => ({
  code,
  season: Number(code.slice(0, 4)),
  name,
  dateStart: "2026-03-18",
  dateEnd: "2026-03-21",
  city: null,
  stateProv: null,
  country: null,
  venue: null,
  website: null,
  timezone: null,
  status: "upcoming",
});

const ok = (events: EventInfo[]): ActionResult<EventInfo[]> => ({ ok: true, data: events });
const fail = (code: ActionError["code"], message = `failed: ${code}`): ActionResult<EventInfo[]> => ({ ok: false, error: { code, message } });

const SEASON_2026 = [event("2026arli", "Arkansas Regional (FIRST)"), event("2026lake", "Bayou Regional (FIRST)"), event("2026txhou", "Houston District")];

function makeStore(fetchSeason: (season: number) => Promise<ActionResult<EventInfo[]>>, extra: { now?: () => number; cooldownMs?: number; ttlMs?: number } = {}) {
  const sleep = vi.fn(async () => {});
  const store = createEventNameStore({ fetchSeason, sleep, ...extra });
  return { store, sleep };
}

describe("lookupSeasonForKey", () => {
  it("returns the year of a real TBA key (aliases resolved) and null otherwise", () => {
    expect(lookupSeasonForKey("2026lake")).toBe(2026);
    expect(lookupSeasonForKey("2025lake")).toBe(2026); // alias of 2026lake
    expect(lookupSeasonForKey("app-testing")).toBeNull();
    expect(lookupSeasonForKey("week0")).toBeNull();
    expect(lookupSeasonForKey("")).toBeNull();
  });
});

describe("one request per season", () => {
  it("names many keys of one year with ONE request", async () => {
    const fetchSeason = vi.fn(async () => ok(SEASON_2026));
    const { store } = makeStore(fetchSeason);
    await Promise.all([store.ensureSeason(2026), store.ensureSeason(2026), store.ensureSeason(2026)]);
    await store.ensureSeason(2026);
    expect(fetchSeason).toHaveBeenCalledTimes(1);
    expect(fetchSeason).toHaveBeenCalledWith(2026);
    for (const key of ["2026arli", "2026lake", "2026txhou"]) expect(store.resolve(key).source).toBe("api");
    expect(store.resolve("2026lake")).toMatchObject({ name: "Bayou Regional (FIRST)", source: "api", status: "ready" });
  });

  it("makes one request per distinct season", async () => {
    const fetchSeason = vi.fn(async (season: number) => ok([event(`${season}arli`, `Arkansas ${season}`)]));
    const { store } = makeStore(fetchSeason);
    await Promise.all([store.ensureSeason(2026), store.ensureSeason(2025), store.ensureSeason(2026)]);
    expect(fetchSeason.mock.calls.map((c) => c[0]).sort()).toEqual([2025, 2026]);
  });

  it("asks again once the TTL has passed", async () => {
    let t = 1_000;
    const fetchSeason = vi.fn(async () => ok(SEASON_2026));
    const { store } = makeStore(fetchSeason, { now: () => t, ttlMs: 60_000 });
    await store.ensureSeason(2026);
    t += 59_000;
    await store.ensureSeason(2026);
    expect(fetchSeason).toHaveBeenCalledTimes(1);
    t += 2_000;
    await store.ensureSeason(2026);
    expect(fetchSeason).toHaveBeenCalledTimes(2);
  });

  it("keeps the stale names while a refresh runs and when it fails", async () => {
    let t = 0;
    const fetchSeason = vi.fn<(s: number) => Promise<ActionResult<EventInfo[]>>>().mockResolvedValueOnce(ok(SEASON_2026)).mockResolvedValue(fail("upstream_error"));
    const { store } = makeStore(fetchSeason, { now: () => t, ttlMs: 1000, cooldownMs: 5000 });
    await store.ensureSeason(2026);
    t += 2000;
    await store.ensureSeason(2026);
    expect(store.resolve("2026lake")).toMatchObject({ name: "Bayou Regional (FIRST)", source: "api", status: "ready" });
  });
});

describe("failures are never cached and are retried", () => {
  it("retries a transient failure with backoff inside one ask", async () => {
    const fetchSeason = vi
      .fn<(s: number) => Promise<ActionResult<EventInfo[]>>>()
      .mockResolvedValueOnce(fail("network_error"))
      .mockResolvedValueOnce(fail("upstream_error"))
      .mockResolvedValueOnce(ok(SEASON_2026));
    const { store, sleep } = makeStore(fetchSeason);
    await store.ensureSeason(2026);
    expect(fetchSeason).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map((c) => (c as unknown as number[])[0])).toEqual([400, 1200]);
    expect(store.resolve("2026arli").source).toBe("api");
    expect(store.failures()).toEqual([]);
  });

  it("marks the season failed after the attempts run out, then retries on the next ask (never cached)", async () => {
    let t = 0;
    const fetchSeason = vi.fn<(s: number) => Promise<ActionResult<EventInfo[]>>>().mockResolvedValue(fail("network_error", "Could not reach The Blue Alliance."));
    const { store } = makeStore(fetchSeason, { now: () => t, cooldownMs: 10_000 });
    await store.ensureSeason(2026);
    expect(fetchSeason).toHaveBeenCalledTimes(3);
    expect(store.resolve("2026lake")).toMatchObject({ status: "fallback", source: "static", name: "Bayou Regional", error: { code: "network_error" } });

    // Within the cooldown nothing is requested (no hammering) ...
    t += 5_000;
    await store.ensureSeason(2026);
    expect(fetchSeason).toHaveBeenCalledTimes(3);
    // ... afterwards the next ask requests again, and a success replaces the failure.
    t += 6_000;
    fetchSeason.mockResolvedValue(ok(SEASON_2026));
    await store.ensureSeason(2026);
    expect(fetchSeason).toHaveBeenCalledTimes(4);
    expect(store.resolve("2026lake")).toMatchObject({ status: "ready", source: "api", name: "Bayou Regional (FIRST)" });
    expect(store.failures()).toEqual([]);
  });

  it("force bypasses the cooldown", async () => {
    const fetchSeason = vi.fn<(s: number) => Promise<ActionResult<EventInfo[]>>>().mockResolvedValue(fail("missing_credentials", "TBA key is not configured: set NEXT_PUBLIC_TBA_API_KEY."));
    const { store } = makeStore(fetchSeason);
    await store.ensureSeason(2026);
    await store.ensureSeason(2026);
    expect(fetchSeason).toHaveBeenCalledTimes(1);
    fetchSeason.mockResolvedValue(ok(SEASON_2026));
    await store.ensureSeason(2026, { force: true });
    expect(fetchSeason).toHaveBeenCalledTimes(2);
    expect(store.resolve("2026arli").status).toBe("ready");
  });

  it("does not retry an error a retry cannot fix", async () => {
    for (const code of ["missing_credentials", "server_not_configured", "unauthorized"] as const) {
      const fetchSeason = vi.fn(async () => fail(code));
      const { store, sleep } = makeStore(fetchSeason);
      await store.ensureSeason(2026);
      expect(fetchSeason).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(store.canAutoRetry(2026)).toBe(false);
    }
  });

  it("turns a thrown Server Action into a network_error", async () => {
    const fetchSeason = vi.fn(async () => {
      throw new Error("boom");
    });
    const { store } = makeStore(fetchSeason);
    await store.ensureSeason(2026);
    expect(store.resolve("2026lake")).toMatchObject({ status: "fallback", error: { code: "network_error" } });
    expect(store.canAutoRetry(2026)).toBe(true);
  });

  it("stops auto-retrying after three failed asks in a row", async () => {
    let t = 0;
    const fetchSeason = vi.fn(async () => fail("upstream_error"));
    const { store } = makeStore(fetchSeason, { now: () => t, cooldownMs: 1000 });
    for (let i = 0; i < 3; i++) {
      expect(store.canAutoRetry(2026)).toBe(i === 0 ? false : true);
      await store.ensureSeason(2026);
      t += 2000;
    }
    expect(store.canAutoRetry(2026)).toBe(false);
  });
});

describe("API down: fallback to static, then the raw key", () => {
  it("shows the static name when the API failed, and the raw key for a key not in the map", async () => {
    const { store } = makeStore(async () => fail("server_not_configured", "Server sign-in is not configured: set FIREBASE_ADMIN_PROJECT_ID."));
    await store.ensureSeason(2026);
    expect(store.resolve("2026lake")).toMatchObject({ name: "Bayou Regional", source: "static", status: "fallback" });
    expect(store.resolve("2026arli")).toMatchObject({ name: "Arkansas Regional", source: "static", status: "fallback" });
    expect(store.resolve("2026zzzz")).toMatchObject({ name: "2026zzzz", source: "key", status: "fallback", error: { code: "server_not_configured" } });
  });

  it("prefers a stored name over the static one while the API is down", async () => {
    const { store } = makeStore(async () => fail("network_error"));
    await store.ensureSeason(2026);
    store.addStored({ "2026LAKE": "Team's Bayou", "2026zzzz": "Zed Regional" });
    expect(store.resolve("2026lake")).toMatchObject({ name: "Team's Bayou", source: "stored" });
    expect(store.resolve("2026zzzz")).toMatchObject({ name: "Zed Regional", source: "stored" });
    expect(store.resolve("2026zzzz", { "2026zzzz": "Caller name" }).name).toBe("Caller name");
  });

  it("reports loading (with the best known name) before the season answered", () => {
    const { store } = makeStore(async () => ok(SEASON_2026));
    expect(store.resolve("2026lake")).toMatchObject({ name: "Bayou Regional", source: "static", status: "loading" });
    expect(store.resolve("2026zzzz")).toMatchObject({ name: "2026zzzz", source: "key", status: "loading" });
  });

  it("needs no lookup for keys that are not TBA keys", () => {
    const { store } = makeStore(async () => ok([]));
    expect(store.resolve("app-testing")).toMatchObject({ name: "App Testing", source: "static", status: "ready" });
    expect(store.resolve("week0")).toMatchObject({ name: "Week 0", status: "ready" });
  });

  it("answers ready (not failed) for a key the API does not list", async () => {
    const { store } = makeStore(async () => ok(SEASON_2026));
    await store.ensureSeason(2026);
    expect(store.resolve("2026tuis")).toMatchObject({ name: "Istanbul Regional", source: "static", status: "ready" });
    expect(store.resolve("2026nope")).toMatchObject({ name: "2026nope", source: "key", status: "ready" });
  });

  it("exposes the full event for enrichment", async () => {
    const { store } = makeStore(async () => ok(SEASON_2026));
    await store.ensureSeason(2026);
    expect(store.resolve("2026LAKE").info?.dateStart).toBe("2026-03-18");
  });
});

describe("subscriptions", () => {
  it("notifies on loading, on an answer and on new stored names", async () => {
    const { store } = makeStore(async () => ok(SEASON_2026));
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const v0 = store.getVersion();
    await store.ensureSeason(2026);
    expect(store.getVersion()).toBeGreaterThan(v0);
    const calls = listener.mock.calls.length;
    store.addStored({ "2026zzzz": "Zed" });
    expect(listener.mock.calls.length).toBe(calls + 1);
    store.addStored({ "2026zzzz": "Zed" }); // unchanged
    expect(listener.mock.calls.length).toBe(calls + 1);
    unsubscribe();
    store.addStored({ "2026yyyy": "Why" });
    expect(listener.mock.calls.length).toBe(calls + 1);
  });
});

describe("isAdminFixableEventError", () => {
  it("is true for a missing or rejected key and for server sign-in not configured, false otherwise", () => {
    expect(isAdminFixableEventError({ code: "missing_credentials", message: "TBA key is not configured: set NEXT_PUBLIC_TBA_API_KEY." })).toBe(true);
    expect(isAdminFixableEventError({ code: "server_not_configured", message: "Server sign-in is not configured" })).toBe(true);
    expect(isAdminFixableEventError({ code: "unauthorized", message: "The Blue Alliance rejected the configured key: check NEXT_PUBLIC_TBA_API_KEY." })).toBe(true);
    expect(isAdminFixableEventError({ code: "unauthorized", message: "Sign in to view event data." })).toBe(false);
    expect(isAdminFixableEventError({ code: "network_error", message: "Could not reach The Blue Alliance." })).toBe(false);
    expect(isAdminFixableEventError(null)).toBe(false);
  });
});
