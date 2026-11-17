import { describe, expect, it } from "vitest";
import type { EventMatch } from "@/lib/events/types";
import { buildFrcPlayoffBracket } from "./bracket";
import { firstRankingsToEventRankings, firstScheduleToEventMatches, firstTeamsToEventTeams, normalizeSchedule, parseStartTime, splitFirstAllianceTeams } from "./first-map";

describe("FIRST schedule mapping", () => {
  const payload = {
    Schedule: [
      {
        description: "Practice 2",
        startTime: "2026-03-17T09:10:00",
        matchNumber: 2,
        tournamentLevel: "Practice",
        teams: [
          { teamNumber: 254, station: "Red1" },
          { teamNumber: 1678, station: "Red2" },
          { teamNumber: 118, station: "Red3" },
          { teamNumber: 971, station: "Blue1" },
          { teamNumber: 148, station: "Blue2" },
          { teamNumber: 16, station: "Blue3" },
        ],
      },
      { matchNumber: 1, tournamentLevel: "Practice", teams: [{ teamNumber: 1, stationColor: "Red", stationNumber: 1 }], scoreRedFinal: 40, scoreBlueFinal: 35 },
      { matchNumber: 0, teams: [] },
    ],
  };

  it("normalizes rows from either envelope, sorted, dropping bad rows", () => {
    const rows = normalizeSchedule(payload);
    expect(rows.map((r) => r.matchNumber)).toEqual([1, 2]);
    expect(normalizeSchedule({ schedule: payload.Schedule }).length).toBe(2);
    expect(normalizeSchedule(null)).toEqual([]);
  });

  it("reads stations spelled as color plus number", () => {
    const rows = normalizeSchedule(payload);
    expect(rows[0].teams[0].station).toBe("Red1");
  });

  it("maps Practice rows to EventMatch", () => {
    const matches = firstScheduleToEventMatches(payload, "Practice");
    expect(matches[1]).toMatchObject({
      id: "Practice-2",
      matchNumber: 2,
      type: "Practice",
      description: "Practice 2",
      played: false,
      redTeams: [254, 1678, 118],
      blueTeams: [971, 148, 16],
      redScore: null,
      redPenaltyPoints: null,
    });
    expect(matches[0]).toMatchObject({ played: true, redScore: 40, blueScore: 35, redTeams: [1] });
    expect(matches[1].startTime).not.toBeNull();
  });

  it("parses start times in seconds, milliseconds and strings", () => {
    expect(parseStartTime(1_774_000_000)).toBe(1_774_000_000);
    expect(parseStartTime(1_774_000_000_000)).toBe(1_774_000_000);
    expect(parseStartTime("2026-03-17T09:10:00Z")).toBe(Date.parse("2026-03-17T09:10:00Z") / 1000);
    expect(parseStartTime("junk")).toBe(0);
  });

  it("splits alliances by station", () => {
    expect(splitFirstAllianceTeams({ teams: [{ teamNumber: 1, station: "red1" }, { teamNumber: 2, station: "Blue2" }, { teamNumber: 3, station: "" }] })).toEqual({ red: [1], blue: [2] });
  });

  it("maps fallback teams and rankings", () => {
    expect(firstTeamsToEventTeams({ teams: [{ teamNumber: 971, nameShort: "Spartan Robotics", city: "Mountain View" }, { teamNumber: 0 }] })).toEqual([
      { teamNumber: 971, nameShort: "Spartan Robotics", nameFull: "Spartan Robotics", city: "Mountain View", stateProv: null, country: null, rookieYear: null },
    ]);
    expect(firstRankingsToEventRankings({ Rankings: [{ rank: 2, teamNumber: 118, wins: 5, losses: 1, ties: 0, sortOrder1: 2.5 }] })).toEqual([
      { teamNumber: 118, rank: 2, wins: 5, losses: 1, ties: 0, matchesPlayed: 6, rankingPoints: 2.5 },
    ]);
  });
});

function playoff(matchNumber: number, red?: number, blue?: number): EventMatch {
  return {
    id: `Playoff-${matchNumber}`,
    matchNumber,
    type: "Playoff",
    description: `Match ${matchNumber}`,
    series: matchNumber,
    played: red !== undefined,
    redTeams: [1, 2, 3],
    blueTeams: [4, 5, 6],
    redScore: red ?? null,
    blueScore: blue ?? null,
    redPenaltyPoints: null,
    bluePenaltyPoints: null,
    startTime: null,
  };
}

describe("FRC double-elim bracket", () => {
  it("is unknown when there are no bracket slots", () => {
    expect(buildFrcPlayoffBracket([])).toEqual({ format: "unknown", matches: [] });
    expect(buildFrcPlayoffBracket([playoff(14)]).format).toBe("unknown");
  });

  it("lays out the 13 slots across upper and lower rounds, plus a 3-game finals", () => {
    const bracket = buildFrcPlayoffBracket([playoff(1, 80, 60), playoff(5), playoff(13), playoff(14, 50, 90)]);
    if (bracket.format !== "double-elim-8") throw new Error("expected double-elim-8");
    expect(bracket.upperBracket.flatMap((r) => r.matches.map((m) => m.label))).toEqual(["Match 1", "Match 2", "Match 3", "Match 4", "Match 7", "Match 8", "Match 11"]);
    expect(bracket.lowerBracket.flatMap((r) => r.matches.map((m) => m.label))).toEqual(["Match 5", "Match 6", "Match 9", "Match 10", "Match 12", "Match 13"]);
    expect(bracket.upperBracket[0].matches[0]).toMatchObject({ winner: "red", red: { seed: null, teams: [1, 2, 3] } });
    expect(bracket.upperBracket[0].matches[1]).toMatchObject({ match: null, red: null, winner: null });
    expect(bracket.lowerBracket[0].matches[0].match?.matchNumber).toBe(5);
    expect(bracket.finals.map((f) => f.label)).toEqual(["Finals 1", "Finals 2", "Finals 3"]);
    expect(bracket.finals[0].winner).toBe("blue");
    expect(bracket.finals[1].match).toBeNull();
  });
});
