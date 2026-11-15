import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as provider from "@/lib/ftc/provider";
import { fetchFtcSchedule, type ScheduleDeps } from "@/lib/ftc/library-import";
import { planScheduleImport } from "@/lib/ftc/library";

// The schedule import against the FTC provider over a MOCKED fetch (no real API, no keys). Each case uses its own event code: the provider keeps a
// short in-memory cache keyed by URL.

const realDeps: ScheduleDeps = {
  getEvent: (code, season) => provider.getEvent(code, season),
  getMatches: (code, type, season) => provider.getMatchesForEvent(code, type, season),
};

const team = (n: number, station: string) => ({ teamNumber: n, station });
const rawEvent = (code: string) => ({ events: [{ code, name: `Event ${code}`, dateStart: "2026-12-01", dateEnd: "2026-12-01", timezone: "America/Los_Angeles" }] });
const schedule = (...rows: { n: number; series?: number; teams: ReturnType<typeof team>[]; startTime?: string }[]) => ({ schedule: rows.map((r) => ({ matchNumber: r.n, series: r.series ?? 0, startTime: r.startTime ?? null, teams: r.teams })) });
const quad = (a: number, b: number, c: number, d: number) => [team(a, "Red1"), team(b, "Red2"), team(c, "Blue1"), team(d, "Blue2")];

type Route = { status?: number; body?: unknown };
function mockFetch(routes: { events?: Route; qual?: Route; playoff?: Route }) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    void init;
    const url = String(input);
    calls.push(url);
    let route: Route | undefined;
    if (/\/events\?/.test(url)) route = routes.events;
    else if (/\/schedule\//.test(url)) route = /tournamentLevel=playoff/.test(url) ? routes.playoff : routes.qual;
    else if (/\/matches\//.test(url)) route = { body: { matches: [] } };
    const r = route ?? { body: {} };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

beforeEach(() => {
  vi.stubEnv("FTC_API_USERNAME", "test-user");
  vi.stubEnv("FTC_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetchFtcSchedule", () => {
  it("success: the event name and the qualification and playoff schedule", async () => {
    mockFetch({ events: { body: rawEvent("OKAY1") }, qual: { body: schedule({ n: 1, teams: quad(1, 2, 3, 4), startTime: "2026-12-01T09:00:00" }, { n: 2, teams: quad(5, 6, 7, 8) }) }, playoff: { body: schedule({ n: 1, series: 1, teams: quad(1, 2, 3, 4) }) } });
    const r = await fetchFtcSchedule(realDeps, { eventCode: "okay1", apiSeason: 2025 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.eventCode).toBe("OKAY1");
    expect(r.eventName).toBe("Event OKAY1");
    expect(r.matches.map((m) => `${m.type}${m.matchNumber}`)).toEqual(["Qualification1", "Qualification2", "Playoff1"]);
    expect(r.matches[0]).toMatchObject({ redTeams: [1, 2], blueTeams: [3, 4], startTime: "2026-12-01T09:00:00" });
  });

  it("the keys go in the request header only, never in a URL or the result", async () => {
    const { fn, calls } = mockFetch({ events: { body: rawEvent("HDR1") }, qual: { body: schedule() }, playoff: { body: schedule() } });
    const r = await fetchFtcSchedule(realDeps, { eventCode: "HDR1", apiSeason: 2025 });
    expect(JSON.stringify(r)).not.toContain("test-key");
    expect(calls.join(" ")).not.toContain("test-key");
    const init = fn.mock.calls[0]?.[1] as unknown as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("test-user:test-key").toString("base64")}`);
  });

  it("missing keys: the typed error names both variables and nothing is fetched", async () => {
    vi.stubEnv("FTC_API_USERNAME", "");
    vi.stubEnv("FTC_API_KEY", "");
    const { fn } = mockFetch({});
    const r = await fetchFtcSchedule(realDeps, { eventCode: "NOKEY1", apiSeason: 2025 });
    expect(r).toMatchObject({ ok: false, code: "missing_credentials" });
    if (!r.ok) expect(r.message).toMatch(/FTC_API_USERNAME and FTC_API_KEY.*Manual entry still works/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("a rejected key (401) names the variables", async () => {
    mockFetch({ events: { status: 401, body: {} } });
    const r = await fetchFtcSchedule(realDeps, { eventCode: "BADKEY1", apiSeason: 2025 });
    expect(r).toMatchObject({ ok: false, code: "unauthorized" });
    if (!r.ok) expect(r.message).toMatch(/FTC_API_USERNAME.*FTC_API_KEY/);
  });

  it("a rate limit (429) fails the whole import with a retry message", async () => {
    mockFetch({ events: { body: rawEvent("RATE1") }, qual: { status: 429, body: {} } });
    const r = await fetchFtcSchedule(realDeps, { eventCode: "RATE1", apiSeason: 2025 });
    expect(r).toMatchObject({ ok: false, code: "rate_limited" });
    if (!r.ok) expect(r.message).toMatch(/Try again shortly.*Nothing was changed/);
  });

  it("an unknown event code is a clear message, not an empty import", async () => {
    mockFetch({ events: { body: { events: [] } } });
    const r = await fetchFtcSchedule(realDeps, { eventCode: "NOPE1", apiSeason: 2025 });
    expect(r).toMatchObject({ ok: false, code: "no_event" });
  });

  it("an invalid code never reaches the API", async () => {
    const { fn } = mockFetch({});
    expect(await fetchFtcSchedule(realDeps, { eventCode: "not a code", apiSeason: 2025 })).toMatchObject({ ok: false, code: "invalid_code" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("playoffs not scheduled yet (404) is just an empty playoff list", async () => {
    mockFetch({ events: { body: rawEvent("PLAY1") }, qual: { body: schedule({ n: 1, teams: quad(1, 2, 3, 4) }) }, playoff: { status: 404, body: {} } });
    const r = await fetchFtcSchedule(realDeps, { eventCode: "PLAY1", apiSeason: 2025 });
    expect(r.ok && r.matches).toHaveLength(1);
  });

  it("a partial schedule imports the posted teams; running it twice gives the same ids and creates nothing new", async () => {
    mockFetch({
      events: { body: rawEvent("PART1") },
      qual: { body: schedule({ n: 1, teams: quad(1, 2, 3, 4) }, { n: 2, teams: [team(5, "Red1"), team(7, "Blue1"), team(8, "Blue2")] }, { n: 3, teams: [] }) },
      playoff: { body: schedule() },
    });
    const run = async () => {
      const r = await fetchFtcSchedule(realDeps, { eventCode: "PART1", apiSeason: 2025 });
      if (!r.ok) throw new Error(r.message);
      return r;
    };
    const first = await run();
    const event = { eventCode: first.eventCode, eventName: first.eventName, seasonId: "biobuzz" };
    const p1 = planScheduleImport({ event, matches: first.matches, existing: new Map(), uid: "u", now: "2026-11-15T00:00:00Z" });
    expect(p1.created).toBe(2);
    expect(p1.skippedNoTeams).toBe(1);
    expect(p1.writes[1].data.alliances).toEqual({ red: { teams: [5] }, blue: { teams: [7, 8] } });

    const stored = new Map(p1.writes.map((w) => [w.id, w.data]));
    const second = await run();
    const p2 = planScheduleImport({ event, matches: second.matches, existing: stored, uid: "u", now: "2026-11-15T01:00:00Z" });
    expect(p2.created).toBe(0);
    expect(p2.updated).toBe(2);
    expect(p2.writes.map((w) => w.id)).toEqual(p1.writes.map((w) => w.id));
  });
});
