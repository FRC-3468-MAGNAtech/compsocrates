import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/require-user", () => ({ requireUserResult: async () => ({ ok: true, uid: "u1" }) }));

const frc = vi.hoisted(() => ({
  getEvents: vi.fn(), getEvent: vi.fn(), getTeamsForEvent: vi.fn(), getTeamByNumber: vi.fn(),
  getRankingsForEvent: vi.fn(), getMatchesForEvent: vi.fn(), getPlayoffBracket: vi.fn(),
}));
const ftc = vi.hoisted(() => ({
  getEvents: vi.fn(), getEvent: vi.fn(), getTeamsForEvent: vi.fn(), getTeamByNumber: vi.fn(),
  getRankingsForEvent: vi.fn(), getMatchesForEvent: vi.fn(), getPlayoffBracket: vi.fn(),
}));
vi.mock("@/lib/frc/provider", () => frc);
vi.mock("@/lib/ftc/provider", () => ftc);
vi.mock("@/lib/frc/statbotics", () => ({ getStatboticsTeam: vi.fn() }));

import { eventDetailQuery, eventQueries } from "@/lib/events/event-queries";

const OK = { ok: true as const, data: [] };

beforeEach(() => {
  for (const fn of [...Object.values(frc), ...Object.values(ftc)]) {
    fn.mockReset();
    fn.mockResolvedValue(OK);
  }
});

const FTC_EVENT = { code: "USCALAB", season: 2025 };
const FRC_EVENT = { code: "2026lake", season: 2026 };

describe("event page reads go to the program's own provider", () => {
  it("an FTC event reads the FTC provider for the header, teams, rankings and both schedules, and never the FRC one", async () => {
    const q = eventQueries("ftc", FTC_EVENT);
    await eventDetailQuery("ftc", "2025-USCALAB", FTC_EVENT).fetch();
    await q.teams.fetch();
    await q.rankings.fetch();
    await q.matches("Qualification").fetch();
    await q.matches("Playoff").fetch();
    expect(ftc.getEvent).toHaveBeenCalledWith("USCALAB", 2025);
    expect(ftc.getTeamsForEvent).toHaveBeenCalledWith("USCALAB", 2025);
    expect(ftc.getRankingsForEvent).toHaveBeenCalledWith("USCALAB", 2025);
    expect(ftc.getMatchesForEvent).toHaveBeenCalledWith("USCALAB", "Qualification", 2025);
    expect(ftc.getMatchesForEvent).toHaveBeenCalledWith("USCALAB", "Playoff", 2025);
    for (const fn of Object.values(frc)) expect(fn).not.toHaveBeenCalled();
  });

  it("an FRC event reads exactly what it read before: the FRC provider with the same arguments, and never the FTC one", async () => {
    const q = eventQueries("frc", FRC_EVENT);
    await eventDetailQuery("frc", "2026lake", FRC_EVENT).fetch();
    await q.teams.fetch();
    await q.rankings.fetch();
    await q.matches("Qualification").fetch();
    await q.matches("Playoff").fetch();
    expect(frc.getEvent).toHaveBeenCalledWith("2026lake", 2026);
    expect(frc.getTeamsForEvent).toHaveBeenCalledWith("2026lake", 2026);
    expect(frc.getRankingsForEvent).toHaveBeenCalledWith("2026lake", 2026);
    expect(frc.getMatchesForEvent).toHaveBeenCalledWith("2026lake", "Qualification", 2026);
    expect(frc.getMatchesForEvent).toHaveBeenCalledWith("2026lake", "Playoff", 2026);
    for (const fn of Object.values(ftc)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("cache keys", () => {
  it("FRC keys keep their old value (so the page and the Active Events cards still share one result)", () => {
    const q = eventQueries("frc", FRC_EVENT);
    expect(q.teams.key).toBe("teams:2026lake:2026");
    expect(q.rankings.key).toBe("rankings:2026lake:2026");
    expect(q.matches("Qualification").key).toBe("matches:2026lake:2026:Qualification");
    expect(eventDetailQuery("frc", "2026lake", FRC_EVENT).key).toBe("event:frc:2026lake");
  });

  it("FTC keys carry the program, so the same code in the other program is a different entry", () => {
    const ftcKeys = eventQueries("ftc", { code: "ABC", season: 2025 });
    const frcKeys = eventQueries("frc", { code: "ABC", season: 2025 });
    expect(ftcKeys.teams.key).toBe("ftc:teams:ABC:2025");
    expect(ftcKeys.teams.key).not.toBe(frcKeys.teams.key);
    expect(ftcKeys.matches("Playoff").key).not.toBe(frcKeys.matches("Playoff").key);
    expect(eventDetailQuery("ftc", "2025-ABC", { code: "ABC", season: 2025 }).key).toBe("event:ftc:2025-ABC");
  });

  it("the Active Events page and the event page use the same key for the same FTC event", () => {
    // app/(app)/[program]/event/page.tsx builds scopedKey(program, `teams:${code}:${season}`).
    expect(eventQueries("ftc", FTC_EVENT).teams.key).toBe("ftc:teams:USCALAB:2025");
  });
});
