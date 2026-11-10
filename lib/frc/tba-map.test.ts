import { describe, expect, it } from "vitest";
import {
  finalsSeriesNumber,
  isTbaMatchCompleted,
  mapPlayoffToBracketSlot,
  playoffMatchNumber,
  teamNumberFromKey,
  toFtcEvent,
  toFtcMatch,
  toFtcMatches,
  toFtcRanking,
  toFtcTeam,
  type TbaMatchRaw,
} from "./tba-map";

function tbaMatch(partial: Partial<TbaMatchRaw> & Pick<TbaMatchRaw, "comp_level" | "set_number" | "match_number">): TbaMatchRaw {
  const { comp_level, set_number, match_number } = partial;
  return {
    key: `2026arli_${comp_level}${comp_level === "qm" ? "" : set_number}m${match_number}`,
    alliances: {
      red: { team_keys: ["frc254", "frc1678", "frc118"], score: -1 },
      blue: { team_keys: ["frc971", "frc148", "frc16"], score: -1 },
    },
    ...partial,
  };
}

describe("events, teams, rankings", () => {
  it("maps a TBA event to FtcEvent with the TBA key as code", () => {
    const event = toFtcEvent({
      key: "2026arli",
      name: "Arkansas Regional",
      year: 2026,
      start_date: "2026-03-18",
      end_date: "2026-03-21",
      city: "Little Rock",
      state_prov: "AR",
      country: "USA",
      location_name: "Barton Coliseum",
      website: "https://example.test",
      timezone: "America/Chicago",
    });
    expect(event).toMatchObject({
      code: "2026arli",
      season: 2026,
      name: "Arkansas Regional",
      dateStart: "2026-03-18",
      dateEnd: "2026-03-21",
      stateProv: "AR",
      venue: "Barton Coliseum",
      timezone: "America/Chicago",
    });
    expect(["upcoming", "in-progress", "completed"]).toContain(event.status);
  });

  it("maps a team, falling back to a generic name", () => {
    expect(toFtcTeam({ team_number: 254, nickname: "The Cheesy Poofs", name: "Full Sponsor Name", rookie_year: 1999 })).toMatchObject({
      teamNumber: 254,
      nameShort: "The Cheesy Poofs",
      nameFull: "Full Sponsor Name",
      rookieYear: 1999,
    });
    expect(toFtcTeam({ team_number: 9999 })).toMatchObject({ nameShort: "Team 9999", nameFull: "Team 9999", city: null });
  });

  it("strips the frc prefix", () => {
    expect(teamNumberFromKey("frc254")).toBe(254);
    expect(teamNumberFromKey("254")).toBeNull();
  });

  it("maps a ranking with the first sort order as ranking points", () => {
    expect(
      toFtcRanking({ rank: 3, team_key: "frc118", matches_played: 8, record: { wins: 6, losses: 2, ties: 0 }, sort_orders: [3.25, 120] })
    ).toEqual({ teamNumber: 118, rank: 3, wins: 6, losses: 2, ties: 0, matchesPlayed: 8, rankingPoints: 3.25 });
    expect(toFtcRanking({ team_key: "frc118" })).toBeNull();
    expect(toFtcRanking({ rank: 1, team_key: "frc118" })?.rankingPoints).toBeNull();
  });
});

describe("match type and basic mapping", () => {
  it("maps qm to Qualification with three-team alliances and no frc prefix", () => {
    const mapped = toFtcMatch(
      tbaMatch({
        comp_level: "qm",
        set_number: 1,
        match_number: 12,
        alliances: {
          red: { team_keys: ["frc254", "frc1678", "frc118"], score: 88 },
          blue: { team_keys: ["frc971", "frc148", "frc16"], score: 70 },
        },
        score_breakdown: { red: { foulPoints: 6 }, blue: { foulPoints: 0 } },
        actual_time: 1_774_000_000,
      })
    );
    expect(mapped).toMatchObject({
      id: "Qualification-12",
      matchNumber: 12,
      type: "Qualification",
      played: true,
      redTeams: [254, 1678, 118],
      blueTeams: [971, 148, 16],
      redScore: 88,
      blueScore: 70,
      redPenaltyPoints: 6,
      bluePenaltyPoints: 0,
    });
    expect(mapped?.startTime).toBe(new Date(1_774_000_000 * 1000).toISOString());
  });

  it("treats -1 scores as unplayed with no scores or penalties", () => {
    const mapped = toFtcMatch(tbaMatch({ comp_level: "qm", set_number: 1, match_number: 3, predicted_time: 1_774_000_000 }));
    expect(mapped).toMatchObject({ played: false, redScore: null, blueScore: null, redPenaltyPoints: null, bluePenaltyPoints: null });
    expect(mapped?.startTime).not.toBeNull();
  });

  it("flags a match with a winner but no numeric score as complete", () => {
    expect(isTbaMatchCompleted(tbaMatch({ comp_level: "qm", set_number: 1, match_number: 1, winning_alliance: "red" }))).toBe(true);
    expect(isTbaMatchCompleted(tbaMatch({ comp_level: "qm", set_number: 1, match_number: 1 }))).toBe(false);
  });

  it("skips matches with no app number (eighths)", () => {
    expect(toFtcMatch(tbaMatch({ comp_level: "ef", set_number: 1, match_number: 1 }))).toBeNull();
  });

  it("splits matches by app type", () => {
    const list = [
      tbaMatch({ comp_level: "qm", set_number: 1, match_number: 2 }),
      tbaMatch({ comp_level: "qm", set_number: 1, match_number: 1 }),
      tbaMatch({ comp_level: "sf", set_number: 1, match_number: 1 }),
      tbaMatch({ comp_level: "f", set_number: 1, match_number: 1 }),
    ];
    expect(toFtcMatches(list, "Qualification").map((m) => m.matchNumber)).toEqual([1, 2]);
    expect(toFtcMatches(list, "Playoff").map((m) => m.matchNumber)).toEqual([1, 14]);
  });
});

describe("playoff numbering (D11)", () => {
  it("uses the 2026 sf{slot}m1 set number as the bracket slot 1..13", () => {
    for (let slot = 1; slot <= 13; slot += 1) {
      const m = { comp_level: "sf", set_number: slot, match_number: 1, key: `2026arli_sf${slot}m1` };
      expect(playoffMatchNumber(m)).toBe(slot);
    }
  });

  it("maps legacy qf sets 1..4 to slots 1..4", () => {
    expect(mapPlayoffToBracketSlot({ comp_level: "qf", set_number: 3, match_number: 1, key: "2026arli_qf3m1" })).toBe(3);
  });

  it("keeps CS's quirk: a qf set 1..4 replay (match 2) stays on its set slot, the 7/8 branch is only reached for sets outside 1..4", () => {
    expect(mapPlayoffToBracketSlot({ comp_level: "qf", set_number: 1, match_number: 2, key: "2026arli_qf1m2" })).toBe(1);
    expect(mapPlayoffToBracketSlot({ comp_level: "qf", set_number: 0, match_number: 1, key: "2026arli_qf0m1" })).toBeNull();
    expect(mapPlayoffToBracketSlot({ comp_level: "ef", set_number: 1, match_number: 1, key: "2026arli_ef1m1" })).toBeNull();
  });

  it("numbers finals f1..f3 as 14..16", () => {
    expect(playoffMatchNumber({ comp_level: "f", set_number: 1, match_number: 1, key: "2026arli_f1m1" })).toBe(14);
    expect(playoffMatchNumber({ comp_level: "f", set_number: 1, match_number: 2, key: "2026arli_f1m2" })).toBe(15);
    expect(playoffMatchNumber({ comp_level: "f", set_number: 1, match_number: 3, key: "2026arli_f1m3" })).toBe(16);
    // Feeds that put the game in the set number instead.
    expect(finalsSeriesNumber({ key: "2026arli_f2m1", set_number: 2, match_number: 1 })).toBe(2);
    expect(finalsSeriesNumber({ key: "2026arli_f15m1", set_number: 15, match_number: 1 })).toBe(2);
  });

  it("emits Playoff matches with the D11 numbers and descriptions", () => {
    const slot = toFtcMatch(tbaMatch({ comp_level: "sf", set_number: 9, match_number: 1 }));
    expect(slot).toMatchObject({ id: "Playoff-9", matchNumber: 9, type: "Playoff", description: "Match 9", series: 9 });
    const final = toFtcMatch(tbaMatch({ comp_level: "f", set_number: 1, match_number: 2 }));
    expect(final).toMatchObject({ id: "Playoff-15", matchNumber: 15, description: "Finals 2" });
  });

  it("keeps the latest replay when two TBA matches share a slot", () => {
    const first = tbaMatch({ comp_level: "sf", set_number: 4, match_number: 1, alliances: { red: { team_keys: ["frc1"], score: 10 }, blue: { team_keys: ["frc2"], score: 12 } } });
    const replay = tbaMatch({ comp_level: "sf", set_number: 4, match_number: 2, alliances: { red: { team_keys: ["frc1"], score: 30 }, blue: { team_keys: ["frc2"], score: 12 } } });
    const out = toFtcMatches([first, replay], "Playoff");
    expect(out).toHaveLength(1);
    expect(out[0].redScore).toBe(30);
  });
});
