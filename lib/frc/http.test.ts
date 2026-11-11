import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearFrcCache, FrcApiError, frcFetch } from "./http";
import { getEvents, getMatchesForEvent, getTeamsForEvent } from "./provider";

/** A fetch stub that answers from a queue of responses (or throws for `"network"`); never touches the network. */
function stubFetch(...answers: Array<{ status: number; body?: unknown } | "network">) {
  const queue = [...answers];
  const mock = vi.fn(async () => {
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (next === "network") throw new TypeError("offline");
    return new Response(JSON.stringify(next.body ?? []), { status: next.status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const rejection = (promise: Promise<unknown>) => promise.then(() => null, (e: unknown) => e as FrcApiError);

beforeEach(() => {
  clearFrcCache();
  vi.stubEnv("NEXT_PUBLIC_TBA_API_KEY", "tba-secret");
  vi.stubEnv("FIRST_API_USERNAME", "user");
  vi.stubEnv("FIRST_API_TOKEN", "token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("missing keys", () => {
  it("names NEXT_PUBLIC_TBA_API_KEY when the TBA key is unset, without calling out", async () => {
    vi.stubEnv("NEXT_PUBLIC_TBA_API_KEY", "");
    const fetchMock = stubFetch({ status: 200 });
    const result = await getEvents({ season: 2026 });
    expect(result).toEqual({ ok: false, error: { code: "missing_credentials", message: "TBA key is not configured: set NEXT_PUBLIC_TBA_API_KEY." } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores the old TBA_API_KEY name", async () => {
    vi.stubEnv("NEXT_PUBLIC_TBA_API_KEY", "");
    vi.stubEnv("TBA_API_KEY", "old-name");
    stubFetch({ status: 200 });
    expect(await getEvents({ season: 2026 })).toMatchObject({ ok: false, error: { code: "missing_credentials" } });
  });

  it.each([
    ["FIRST_API_USERNAME", "FIRST_API_TOKEN"],
    ["FIRST_API_TOKEN", "FIRST_API_USERNAME"],
  ])("names %s when only that FIRST credential is unset", async (missing, present) => {
    vi.stubEnv(missing, "");
    vi.stubEnv(present, "set");
    const fetchMock = stubFetch({ status: 200 });
    const error = await rejection(frcFetch("first", "/2026/teams"));
    expect(error).toBeInstanceOf(FrcApiError);
    expect(error).toMatchObject({ code: "missing_credentials" });
    expect(error?.message).toContain(missing);
    expect(error?.message).not.toContain(present);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names both FIRST variables when neither is set", async () => {
    vi.stubEnv("FIRST_API_USERNAME", "");
    vi.stubEnv("FIRST_API_TOKEN", "");
    const error = await rejection(frcFetch("first", "/2026/teams"));
    expect(error?.message).toBe("FIRST API credentials are not configured: set FIRST_API_USERNAME and FIRST_API_TOKEN.");
  });

  it("does not cache the missing-key error: setting the key fixes the next call", async () => {
    vi.stubEnv("NEXT_PUBLIC_TBA_API_KEY", "");
    stubFetch({ status: 200, body: [{ key: "2026arli", name: "Arkansas Regional", year: 2026, start_date: "2026-03-18", end_date: "2026-03-21" }] });
    expect(await getEvents({ season: 2026 })).toMatchObject({ ok: false });
    vi.stubEnv("NEXT_PUBLIC_TBA_API_KEY", "now-set");
    expect(await getEvents({ season: 2026 })).toMatchObject({ ok: true, data: [{ code: "2026arli" }] });
  });
});

describe("upstream failures", () => {
  it.each([401, 403])("a TBA %i says the key was rejected and names the variable", async (status) => {
    stubFetch({ status });
    const result = await getEvents({ season: 2026 });
    expect(result).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(!result.ok && result.error.message).toBe("The Blue Alliance rejected the configured key: check NEXT_PUBLIC_TBA_API_KEY.");
  });

  it("a FIRST 401 says the credentials were rejected and names both variables", async () => {
    stubFetch({ status: 401 });
    const error = await rejection(frcFetch("first", "/2026/teams"));
    expect(error).toMatchObject({ code: "unauthorized" });
    expect(error?.message).toBe("FIRST FRC API rejected the configured key: check FIRST_API_USERNAME and FIRST_API_TOKEN.");
  });

  it("a Statbotics 403 does not blame a key (it has none)", async () => {
    stubFetch({ status: 403 });
    const error = await rejection(frcFetch("statbotics", "/team_year/254/2026"));
    expect(error?.message).not.toMatch(/KEY|TOKEN/);
  });

  it("a 429 is rate_limited and retryable", async () => {
    stubFetch({ status: 429 });
    const result = await getEvents({ season: 2026 });
    expect(result).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    expect(!result.ok && result.error.message).toContain("rate limit");
  });

  it("a network failure is network_error and names the service", async () => {
    stubFetch("network");
    const result = await getEvents({ season: 2026 });
    expect(result).toEqual({ ok: false, error: { code: "network_error", message: "Could not reach The Blue Alliance." } });
  });

  it.each([
    ["429", { status: 429 }],
    ["500", { status: 500 }],
    ["401", { status: 401 }],
    ["a network failure", "network" as const],
  ])("does not cache a failure (%s): the next call asks again and succeeds", async (_label, failure) => {
    const fetchMock = stubFetch(failure, { status: 200, body: [] });
    expect(await getEvents({ season: 2026 })).toMatchObject({ ok: false });
    expect(await getEvents({ season: 2026 })).toEqual({ ok: true, data: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does cache a success for the short TTL", async () => {
    const fetchMock = stubFetch({ status: 200, body: [] });
    await getEvents({ season: 2026 });
    await getEvents({ season: 2026 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fallback to FIRST keeps the TBA error when both fail", () => {
  it("reports the TBA key problem, not the FIRST one, when TBA has no key and FIRST fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_TBA_API_KEY", "");
    stubFetch({ status: 500 });
    const result = await getTeamsForEvent("2026arli");
    expect(result).toMatchObject({ ok: false, error: { code: "missing_credentials" } });
    expect(!result.ok && result.error.message).toContain("NEXT_PUBLIC_TBA_API_KEY");
  });

  it("a playoff request has no FIRST fallback, so a rejected TBA key is reported as is", async () => {
    stubFetch({ status: 401 });
    const result = await getMatchesForEvent("2026arli", "Playoff");
    expect(result).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(!result.ok && result.error.message).toContain("NEXT_PUBLIC_TBA_API_KEY");
  });
});
