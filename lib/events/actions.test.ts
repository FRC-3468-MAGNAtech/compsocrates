import { beforeEach, describe, expect, it, vi } from "vitest";

const checkSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/require-user", async () => {
  // The real requireUserResult, over a mocked session check.
  return {
    requireUserResult: async () => {
      const check = await checkSession();
      if (check.ok) return check;
      return { ok: false, error: { code: check.reason === "not-configured" ? "server_not_configured" : "unauthorized", message: check.message } };
    },
  };
});

const frc = vi.hoisted(() => ({
  getEvents: vi.fn(), getEvent: vi.fn(), getTeamsForEvent: vi.fn(), getTeamByNumber: vi.fn(),
  getRankingsForEvent: vi.fn(), getMatchesForEvent: vi.fn(), getPlayoffBracket: vi.fn(),
}));
vi.mock("@/lib/frc/provider", () => frc);

const statbotics = vi.hoisted(() => ({ getStatboticsTeam: vi.fn() }));
vi.mock("@/lib/frc/statbotics", () => statbotics);

const frcInternal = vi.hoisted(() => ({ fetchMatchesForEventInternal: vi.fn() }));
vi.mock("@/lib/frc/matches-internal", () => frcInternal);

import * as events from "./actions";
import { getDefaultSeason, getSelectableSeasons } from "./config";
import { fetchMatchesForEventInternal } from "./matches-internal";

const OK = { ok: true as const, data: [] };

beforeEach(() => {
  vi.clearAllMocks();
  checkSession.mockResolvedValue({ ok: true, uid: "u1" });
  for (const fn of [...Object.values(frc), statbotics.getStatboticsTeam]) fn.mockResolvedValue(OK);
  frcInternal.fetchMatchesForEventInternal.mockResolvedValue([]);
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

type AnyAction = (...a: readonly unknown[]) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;

describe("event actions", () => {
  it.each(calls)("routes %s straight to the FRC provider, behind the session check", async (name, args) => {
    await (events[name] as AnyAction)(...args);
    expect(checkSession).toHaveBeenCalledTimes(1);
    expect(frc[name]).toHaveBeenCalledWith(...args);
  });

  it.each(calls)("returns an unauthorized result for %s without a session and never reaches the provider", async (name, args) => {
    checkSession.mockResolvedValue({ ok: false, reason: "not-signed-in", message: "Sign in to view event data." });
    const result = await (events[name] as AnyAction)(...args);
    expect(result).toMatchObject({ ok: false, error: { code: "unauthorized", message: "Sign in to view event data." } });
    expect(frc[name]).not.toHaveBeenCalled();
  });

  it.each(calls)("says the server is not configured (naming the variables) for %s when the Admin SDK is unset", async (name, args) => {
    checkSession.mockResolvedValue({ ok: false, reason: "not-configured", message: "Server sign-in is not configured: set FIREBASE_ADMIN_PROJECT_ID." });
    const result = await (events[name] as AnyAction)(...args);
    expect(result).toMatchObject({ ok: false, error: { code: "server_not_configured" } });
    expect(result.error?.message).toContain("FIREBASE_ADMIN_PROJECT_ID");
    expect(frc[name]).not.toHaveBeenCalled();
  });

  it("passes a provider error through untouched", async () => {
    frc.getEvents.mockResolvedValue({ ok: false, error: { code: "missing_credentials", message: "TBA key is not configured: set NEXT_PUBLIC_TBA_API_KEY." } });
    expect(await events.getEvents({ season: 2026 })).toEqual({ ok: false, error: { code: "missing_credentials", message: "TBA key is not configured: set NEXT_PUBLIC_TBA_API_KEY." } });
  });

  it("serves Statbotics behind the same gate", async () => {
    await events.getStatboticsTeam(254, 2026, "2026arli");
    expect(statbotics.getStatboticsTeam).toHaveBeenCalledWith(254, 2026, "2026arli");
    checkSession.mockResolvedValue({ ok: false, reason: "not-signed-in", message: "Sign in to view event data." });
    expect(await events.getStatboticsTeam(254, 2026)).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });
});

describe("session-less match fetch", () => {
  it("goes straight to the FRC fetch and passes the season through", async () => {
    await fetchMatchesForEventInternal("2026arli", "Playoff", 2026);
    expect(frcInternal.fetchMatchesForEventInternal).toHaveBeenCalledWith("2026arli", "Playoff", 2026);
    await fetchMatchesForEventInternal("2026arli", "Qualification");
    expect(frcInternal.fetchMatchesForEventInternal).toHaveBeenCalledWith("2026arli", "Qualification", undefined);
  });
});

describe("season helpers", () => {
  it("use the configured season", () => {
    expect(getDefaultSeason()).toBe(2026);
    expect(getSelectableSeasons()).toEqual([2027, 2026, 2025, 2024]);
  });
});
