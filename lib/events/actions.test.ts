import { beforeEach, describe, expect, it, vi } from "vitest";

// A mutable config so each test can pick the program the dispatcher reads at call time.
const config = vi.hoisted(() => ({ program: "frc" as "frc" | "ftc", season: 2026 }));
vi.mock("@/config/event", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/event")>();
  return { ...actual, EVENT_CONFIG: { ...actual.EVENT_CONFIG, get program() { return config.program; }, get season() { return config.season; } } };
});

const requireUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/require-user", () => ({ requireUser }));

const frc = vi.hoisted(() => ({
  getEvents: vi.fn(), getEvent: vi.fn(), getTeamsForEvent: vi.fn(), getTeamByNumber: vi.fn(),
  getRankingsForEvent: vi.fn(), getMatchesForEvent: vi.fn(), getPlayoffBracket: vi.fn(),
}));
vi.mock("@/lib/frc/provider", () => frc);

const ftc = vi.hoisted(() => ({
  getEvents: vi.fn(), getEvent: vi.fn(), getTeamsForEvent: vi.fn(), getTeamByNumber: vi.fn(),
  getRankingsForEvent: vi.fn(), getMatchesForEvent: vi.fn(), getPlayoffBracket: vi.fn(),
}));
vi.mock("@/lib/ftc/actions", () => ftc);

const statbotics = vi.hoisted(() => ({ getStatboticsTeam: vi.fn() }));
vi.mock("@/lib/frc/statbotics", () => statbotics);

const frcInternal = vi.hoisted(() => ({ fetchMatchesForEventInternal: vi.fn() }));
vi.mock("@/lib/frc/matches-internal", () => frcInternal);
const ftcInternal = vi.hoisted(() => ({ fetchMatchesForEventInternal: vi.fn() }));
vi.mock("@/lib/ftc/matches-internal", () => ftcInternal);

import * as events from "./actions";
import { getDefaultSeason, getSelectableSeasons } from "./config";
import { fetchMatchesForEventInternal } from "./matches-internal";

const OK = { ok: true as const, data: [] };

beforeEach(() => {
  vi.clearAllMocks();
  config.program = "frc";
  requireUser.mockResolvedValue({ uid: "u1" });
  for (const fn of [...Object.values(frc), ...Object.values(ftc), statbotics.getStatboticsTeam]) fn.mockResolvedValue(OK);
  frcInternal.fetchMatchesForEventInternal.mockResolvedValue([]);
  ftcInternal.fetchMatchesForEventInternal.mockResolvedValue([]);
});

const calls = [
  ["getEvents", [{ season: 2026 }]],
  ["getEvent", ["2026arli", 2026]],
  ["getTeamsForEvent", ["2026arli", 2026]],
  ["getTeamByNumber", [254, 2026]],
  ["getRankingsForEvent", ["2026arli", 2026]],
  ["getMatchesForEvent", ["2026arli", "Qualification", 2026]],
  ["getPlayoffBracket", ["2026arli", 2026]],
] as const;

describe("facade routing", () => {
  it.each(calls)("routes %s to the FRC provider by default, behind requireUser", async (name, args) => {
    await (events[name] as (...a: readonly unknown[]) => Promise<unknown>)(...args);
    expect(requireUser).toHaveBeenCalledTimes(1);
    expect(frc[name]).toHaveBeenCalledWith(...args);
    expect(ftc[name]).not.toHaveBeenCalled();
  });

  it.each(calls)("routes %s to FTC when the program is ftc, without a second session check", async (name, args) => {
    config.program = "ftc";
    await (events[name] as (...a: readonly unknown[]) => Promise<unknown>)(...args);
    expect(ftc[name]).toHaveBeenCalledWith(...args);
    expect(frc[name]).not.toHaveBeenCalled();
    expect(requireUser).not.toHaveBeenCalled(); // lib/ftc/actions gates itself
  });

  it.each(calls)("returns an unauthorized result for %s without a session and never reaches the provider", async (name, args) => {
    requireUser.mockResolvedValue(null);
    const result = await (events[name] as (...a: readonly unknown[]) => Promise<{ ok: boolean; error?: { code: string } }>)(...args);
    expect(result).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(frc[name]).not.toHaveBeenCalled();
  });

  it("exposes Statbotics for FRC only", async () => {
    await events.getStatboticsTeam(254, 2026, "2026arli");
    expect(statbotics.getStatboticsTeam).toHaveBeenCalledWith(254, 2026, "2026arli");
    config.program = "ftc";
    expect(await events.getStatboticsTeam(254, 2026)).toMatchObject({ ok: false });
  });
});

describe("session-less match fetch", () => {
  it("dispatches by program and passes the season through", async () => {
    await fetchMatchesForEventInternal("2026arli", "Playoff", 2026);
    expect(frcInternal.fetchMatchesForEventInternal).toHaveBeenCalledWith("2026arli", "Playoff", 2026);
    config.program = "ftc";
    await fetchMatchesForEventInternal("USWABON1", "Qualification");
    expect(ftcInternal.fetchMatchesForEventInternal).toHaveBeenCalledWith("USWABON1", "Qualification", undefined);
  });
});

describe("season helpers", () => {
  it("FRC uses the configured season", () => {
    expect(getDefaultSeason()).toBe(2026);
    expect(getSelectableSeasons()).toEqual([2027, 2026, 2025, 2024]);
  });

  it("FTC keeps its date-derived season", () => {
    config.program = "ftc";
    expect(getDefaultSeason(new Date(2026, 9, 1))).toBe(2026);
    expect(getDefaultSeason(new Date(2026, 2, 1))).toBe(2025);
    expect(getSelectableSeasons(new Date(2026, 9, 1))).toEqual([2027, 2026, 2025, 2024]);
  });
});
