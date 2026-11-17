import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearFrcCache } from "./http";
import { fetchMatchesForEventInternal } from "./matches-internal";
import { getEvents, getMatchesForEvent, getPlayoffBracket, getRankingsForEvent, getTeamByNumber, getTeamsForEvent } from "./provider";
import { getStatboticsTeam } from "./statbotics";

type Route = { match: (url: string) => boolean; status?: number; body?: unknown };

/** Stubs global fetch; every call is recorded so tests can assert URLs and headers. Never touches the network. */
function stubFetch(routes: Route[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = routes.find((r) => r.match(url));
    if (!route) throw new Error(`unmocked fetch: ${url}`);
    return new Response(JSON.stringify(route.body ?? null), { status: route.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", mock);
  return calls;
}

const has = (fragment: string) => (url: string) => url.includes(fragment);

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

describe("TBA", () => {
  it("lists events for a season with the server key header, filtered and sorted", async () => {
    const calls = stubFetch([
      {
        match: has("/events/2026"),
        body: [
          { key: "2026lake", name: "Bayou Regional", year: 2026, start_date: "2026-04-01", end_date: "2026-04-04" },
          { key: "2026arli", name: "Arkansas Regional", year: 2026, start_date: "2026-03-18", end_date: "2026-03-21" },
        ],
      },
    ]);
    const all = await getEvents({ season: 2026 });
    expect(all.ok && all.data.map((e) => e.code)).toEqual(["2026arli", "2026lake"]);
    expect(calls[0].url).toBe("https://www.thebluealliance.com/api/v3/events/2026");
    expect(calls[0].headers["X-TBA-Auth-Key"]).toBe("tba-secret");

    const filtered = await getEvents({ season: 2026, search: "bayou" });
    expect(filtered.ok && filtered.data.map((e) => e.code)).toEqual(["2026lake"]);
  });

  it("returns missing_credentials without calling out when no TBA key is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_TBA_API_KEY", "");
    const calls = stubFetch([]);
    const result = await getEvents({ season: 2026 });
    expect(result).toMatchObject({ ok: false, error: { code: "missing_credentials" } });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [404, "not_found"],
    [429, "rate_limited"],
    [500, "upstream_error"],
  ])("maps HTTP %i to %s", async (status, code) => {
    stubFetch([{ match: has("/events/"), status }]);
    expect(await getEvents({ season: 2026 })).toMatchObject({ ok: false, error: { code } });
  });

  it("maps a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await getEvents({ season: 2026 })).toMatchObject({ ok: false, error: { code: "network_error" } });
  });

  it("resolves aliases before calling TBA and sorts teams", async () => {
    const calls = stubFetch([
      {
        match: has("/event/2026lake/teams"),
        body: [
          { team_number: 971, nickname: "Spartans" },
          { team_number: 254, nickname: "Poofs" },
        ],
      },
    ]);
    const result = await getTeamsForEvent("2026labr");
    expect(result.ok && result.data.map((t) => t.teamNumber)).toEqual([254, 971]);
    expect(calls[0].url).toContain("/event/2026lake/teams");
  });

  it("does not call any API for the app-testing sentinel", async () => {
    const calls = stubFetch([]);
    expect(await getTeamsForEvent("app-testing")).toEqual({ ok: true, data: [] });
    expect(await getRankingsForEvent("app-testing")).toEqual({ ok: true, data: [] });
    expect(await getMatchesForEvent("app-testing", "Qualification")).toEqual({ ok: true, data: [] });
    expect(calls).toHaveLength(0);
  });

  it("looks a team up by number and treats 404 as no such team", async () => {
    stubFetch([{ match: has("/team/frc254"), body: { team_number: 254, nickname: "Poofs", rookie_year: 1999 } }, { match: has("/team/frc9998"), status: 404 }]);
    expect(await getTeamByNumber(254)).toMatchObject({ ok: true, data: { teamNumber: 254, nameShort: "Poofs" } });
    expect(await getTeamByNumber(9998)).toEqual({ ok: true, data: null });
    expect(await getTeamByNumber(0)).toMatchObject({ ok: false });
  });

  it("maps rankings and tolerates a null payload", async () => {
    stubFetch([
      { match: has("/event/2026arli/rankings"), body: { rankings: [{ rank: 1, team_key: "frc254", record: { wins: 5, losses: 0, ties: 0 }, matches_played: 5, sort_orders: [4.2] }] } },
      { match: has("/event/2026lake/rankings"), body: null },
    ]);
    expect(await getRankingsForEvent("2026arli")).toMatchObject({ ok: true, data: [{ teamNumber: 254, rank: 1, rankingPoints: 4.2 }] });
    expect(await getRankingsForEvent("2026lake")).toEqual({ ok: true, data: [] });
  });

  it("falls back to FIRST for teams when TBA is down", async () => {
    const calls = stubFetch([
      { match: has("thebluealliance"), status: 500 },
      { match: has("frc-api.firstinspires.org/v3.0/2026/teams"), body: { teams: [{ teamNumber: 118, nameShort: "Robonauts" }] } },
    ]);
    const result = await getTeamsForEvent("2026arli");
    expect(result).toMatchObject({ ok: true, data: [{ teamNumber: 118, nameShort: "Robonauts" }] });
    expect(calls[1].url).toBe("https://frc-api.firstinspires.org/v3.0/2026/teams?eventCode=ARLI");
    expect(calls[1].headers.Authorization).toBe(`Basic ${Buffer.from("user:token").toString("base64")}`);
  });
});

describe("matches", () => {
  const tbaMatches = [
    { key: "2026arli_qm2", comp_level: "qm", set_number: 1, match_number: 2, alliances: { red: { team_keys: ["frc1", "frc2", "frc3"], score: 50 }, blue: { team_keys: ["frc4", "frc5", "frc6"], score: 40 } }, score_breakdown: { red: { foulPoints: 4 }, blue: { foulPoints: 0 } }, actual_time: 1_774_000_000 },
    { key: "2026arli_qm1", comp_level: "qm", set_number: 1, match_number: 1, alliances: { red: { team_keys: ["frc1", "frc2", "frc3"], score: -1 }, blue: { team_keys: ["frc4", "frc5", "frc6"], score: -1 } } },
    { key: "2026arli_sf5m1", comp_level: "sf", set_number: 5, match_number: 1, alliances: { red: { team_keys: ["frc1", "frc2", "frc3"], score: 60 }, blue: { team_keys: ["frc4", "frc5", "frc6"], score: 70 } }, winning_alliance: "blue" },
    { key: "2026arli_f1m3", comp_level: "f", set_number: 1, match_number: 3, alliances: { red: { team_keys: ["frc1", "frc2", "frc3"], score: -1 }, blue: { team_keys: ["frc4", "frc5", "frc6"], score: -1 } } },
  ];

  it("serves Qualification and Playoff from one TBA request with D11 numbering", async () => {
    const calls = stubFetch([{ match: has("/event/2026arli/matches"), body: tbaMatches }]);
    const quals = await getMatchesForEvent("2026arli", "Qualification");
    expect(quals.ok && quals.data.map((m) => [m.matchNumber, m.played, m.redPenaltyPoints])).toEqual([
      [1, false, null],
      [2, true, 4],
    ]);
    const playoffs = await getMatchesForEvent("2026arli", "Playoff");
    expect(playoffs.ok && playoffs.data.map((m) => m.matchNumber)).toEqual([5, 16]);
    expect(calls).toHaveLength(1); // second call is served from the cache
  });

  it("serves Practice from the FIRST schedule, with the code derived from the TBA key", async () => {
    const calls = stubFetch([
      { match: has("/schedule/ARLI"), body: { Schedule: [{ matchNumber: 1, startTime: "2026-03-17T09:00:00", teams: [{ teamNumber: 254, station: "Red1" }, { teamNumber: 971, station: "Blue1" }] }] } },
      { match: has("/schedule/LAKE"), status: 404 },
    ]);
    const practice = await getMatchesForEvent("2026arli", "Practice");
    expect(practice).toMatchObject({ ok: true, data: [{ id: "Practice-1", type: "Practice", redTeams: [254], blueTeams: [971] }] });
    expect(calls[0].url).toBe("https://frc-api.firstinspires.org/v3.0/2026/schedule/ARLI?tournamentLevel=Practice");
    // Aliased key -> LAKE (override table); an unpublished schedule is an empty list, not an error.
    expect(await getMatchesForEvent("2026labr", "Practice")).toEqual({ ok: true, data: [] });
    expect(calls[1].url).toContain("/schedule/LAKE?");
  });

  it("falls back to the FIRST qualification schedule when TBA fails, but not for Playoff", async () => {
    const calls = stubFetch([
      { match: has("thebluealliance"), status: 503 },
      { match: has("/schedule/ARLI"), body: { Schedule: [{ matchNumber: 7, teams: [{ teamNumber: 254, station: "Red1" }] }] } },
    ]);
    const quals = await fetchMatchesForEventInternal("2026arli", "Qualification");
    expect(quals.map((m) => m.matchNumber)).toEqual([7]);
    expect(calls.at(-1)?.url).toContain("tournamentLevel=Qualification");
    await expect(fetchMatchesForEventInternal("2026arli", "Playoff")).rejects.toMatchObject({ code: "upstream_error" });
  });

  it("rethrows the TBA error when the fallback fails too", async () => {
    vi.stubEnv("FIRST_API_USERNAME", "");
    stubFetch([{ match: has("thebluealliance"), status: 429 }]);
    await expect(fetchMatchesForEventInternal("2026arli", "Qualification")).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("builds the double-elim bracket from the playoff matches", async () => {
    stubFetch([{ match: has("/event/2026arli/matches"), body: tbaMatches }]);
    const bracket = await getPlayoffBracket("2026arli");
    if (!bracket.ok || bracket.data.format !== "double-elim-8") throw new Error("expected a bracket");
    expect(bracket.data.lowerBracket[0].matches[0].match?.matchNumber).toBe(5);
    expect(bracket.data.lowerBracket[0].matches[0].winner).toBe("blue");
    expect(bracket.data.finals[2].match?.matchNumber).toBe(16);
  });
});

describe("Statbotics", () => {
  it("returns the event EPA, else the season EPA, via the keyless v3 API", async () => {
    const calls = stubFetch([
      { match: has("/team_year/254/2026"), body: { name: "Poofs", epa: { total_points: { mean: 80 } } } },
      { match: has("/team_event/254/2026lake"), body: { epa: { total_points: { mean: 91.5 } } } },
    ]);
    const withEvent = await getStatboticsTeam(254, 2026, "2026labr");
    expect(withEvent).toMatchObject({ ok: true, data: { epa: 91.5, unavailable: false } });
    expect(calls.map((c) => c.url)).toContain("https://api.statbotics.io/v3/team_event/254/2026lake");
    expect(calls[0].headers["X-TBA-Auth-Key"]).toBeUndefined();

    const seasonOnly = await getStatboticsTeam(254, 2026);
    expect(seasonOnly).toMatchObject({ ok: true, data: { epa: 80, teamEvent: null } });
  });

  it("flags unavailable when Statbotics has no season row, and rejects bad input", async () => {
    stubFetch([{ match: has("/team_year/"), status: 404 }]);
    expect(await getStatboticsTeam(1, 2026)).toMatchObject({ ok: true, data: { teamYear: null, unavailable: true, epa: null } });
    expect(await getStatboticsTeam(0, 2026)).toMatchObject({ ok: false });
    expect(await getStatboticsTeam(254, 1800)).toMatchObject({ ok: false });
  });
});
