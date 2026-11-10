import { describe, expect, it } from "vitest";
import {
  daysUntilStart,
  eventBadge,
  eventKeyYear,
  locationLabel,
  matchLabel,
  matchWinner,
  parseEventTab,
  parseHighlightedTeam,
  recordLabel,
  safeWebsite,
  sortRankings,
  sortSchedule,
  sortTeams,
  teamNameMap,
} from "@/lib/events/details-model";
import type { FtcMatch, FtcRanking, FtcTeam } from "@/lib/ftc/types";

const at = (iso: string) => new Date(iso).getTime();

describe("event key and params", () => {
  it("reads the season from a TBA key", () => {
    expect(eventKeyYear("2026arli")).toBe(2026);
    expect(eventKeyYear("2025LAKE")).toBe(2025);
  });
  it("is null for fallback or malformed keys", () => {
    expect(eventKeyYear("app-testing")).toBeNull();
    expect(eventKeyYear("")).toBeNull();
    expect(eventKeyYear("2026")).toBeNull();
    expect(eventKeyYear("26arli")).toBeNull();
  });
  it("parseEventTab defaults to overview", () => {
    expect(parseEventTab("TEAMS")).toBe("teams");
    expect(parseEventTab("schedule")).toBe("schedule");
    expect(parseEventTab("rankings")).toBe("rankings");
    expect(parseEventTab("nope")).toBe("overview");
    expect(parseEventTab(null)).toBe("overview");
  });
  it("parseHighlightedTeam needs a positive integer", () => {
    expect(parseHighlightedTeam("1234")).toBe(1234);
    expect(parseHighlightedTeam("0")).toBeNull();
    expect(parseHighlightedTeam("-5")).toBeNull();
    expect(parseHighlightedTeam("1.5")).toBeNull();
    expect(parseHighlightedTeam("abc")).toBeNull();
    expect(parseHighlightedTeam(null)).toBeNull();
  });
});

describe("eventBadge", () => {
  const event = { dateStart: "2026-03-10", dateEnd: "2026-03-12", timezone: null };
  it("is live during the event", () => {
    expect(eventBadge(event, at("2026-03-11T15:00:00")).tone).toBe("live");
  });
  it("counts days away, never below one", () => {
    const badge = eventBadge(event, at("2026-03-07T12:00:00"));
    expect(badge).toEqual({ label: "3 days away", tone: "upcoming" });
    expect(eventBadge(event, at("2026-03-09T20:00:00")).label).toBe("1 day away");
  });
  it("is completed after the end date", () => {
    expect(eventBadge(event, at("2026-03-13T09:00:00"))).toEqual({ label: "Completed", tone: "done" });
  });
  it("daysUntilStart rounds up to whole days", () => {
    expect(daysUntilStart("2026-03-10", at("2026-03-09T12:00:01"))).toBe(1);
    expect(daysUntilStart("2026-03-10", at("2026-03-10T12:00:00"))).toBe(0);
  });
});

const match = (over: Partial<FtcMatch>): FtcMatch => ({
  id: "m",
  matchNumber: 1,
  type: "Qualification",
  description: null,
  series: null,
  played: false,
  redTeams: [],
  blueTeams: [],
  redScore: null,
  blueScore: null,
  redPenaltyPoints: null,
  bluePenaltyPoints: null,
  startTime: null,
  ...over,
});

describe("schedule", () => {
  it("labels with the description, else type and number", () => {
    expect(matchLabel(match({ matchNumber: 12 }))).toBe("Qualification 12");
    expect(matchLabel(match({ type: "Playoff", matchNumber: 3, description: "Match 3 (R2)" }))).toBe("Match 3 (R2)");
    expect(matchLabel(match({ description: "  " , matchNumber: 4 }))).toBe("Qualification 4");
  });
  it("sorts by number then series without mutating", () => {
    const input = [match({ matchNumber: 2 }), match({ matchNumber: 1, series: 2 }), match({ matchNumber: 1, series: 1 })];
    const sorted = sortSchedule(input);
    expect(sorted.map((m) => [m.matchNumber, m.series])).toEqual([[1, 1], [1, 2], [2, null]]);
    expect(input[0].matchNumber).toBe(2);
  });
  it("finds the winner only for played, scored matches", () => {
    expect(matchWinner(match({ played: true, redScore: 90, blueScore: 70 }))).toBe("red");
    expect(matchWinner(match({ played: true, redScore: 60, blueScore: 70 }))).toBe("blue");
    expect(matchWinner(match({ played: true, redScore: 70, blueScore: 70 }))).toBe("tie");
    expect(matchWinner(match({ played: false, redScore: 70, blueScore: 70 }))).toBeNull();
    expect(matchWinner(match({ played: true, redScore: null, blueScore: 70 }))).toBeNull();
  });
});

describe("teams and rankings", () => {
  const team = (teamNumber: number, nameShort: string, nameFull = ""): FtcTeam => ({ teamNumber, nameShort, nameFull, city: null, stateProv: null, country: null, rookieYear: null });
  it("sorts teams by number", () => {
    expect(sortTeams([team(30, "c"), team(4, "a")]).map((t) => t.teamNumber)).toEqual([4, 30]);
  });
  it("maps names with fallbacks", () => {
    const names = teamNameMap([team(1, "Short"), team(2, "", "Full Name"), team(3, "")]);
    expect(names.get(1)).toBe("Short");
    expect(names.get(2)).toBe("Full Name");
    expect(names.get(3)).toBe("Team 3");
  });
  it("sorts rankings by rank, ties by team number", () => {
    const r = (teamNumber: number, rank: number): FtcRanking => ({ teamNumber, rank, wins: 1, losses: 2, ties: 3, matchesPlayed: 6, rankingPoints: null });
    expect(sortRankings([r(9, 2), r(5, 2), r(1, 1)]).map((x) => x.teamNumber)).toEqual([1, 5, 9]);
    expect(recordLabel(r(1, 1))).toBe("1-2-3");
  });
});

describe("event facts", () => {
  it("joins the location parts that exist", () => {
    expect(locationLabel({ city: "Arlington", stateProv: "TX", country: "USA" })).toBe("Arlington, TX, USA");
    expect(locationLabel({ city: null, stateProv: " ", country: "USA" })).toBe("USA");
    expect(locationLabel({ city: null, stateProv: null, country: null })).toBeNull();
  });
  it("links only http(s) websites", () => {
    expect(safeWebsite("https://example.org/e")).toBe("https://example.org/e");
    expect(safeWebsite("javascript:alert(1)")).toBeNull();
    expect(safeWebsite(null)).toBeNull();
    expect(safeWebsite("example.org")).toBeNull();
  });
});
