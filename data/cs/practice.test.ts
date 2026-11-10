import { describe, expect, it } from "vitest";
import {
  csPracticeMatchesToLibrary,
  csSessionMatchType,
  csSessionToPractice,
  importedMatchId,
  isCsImportedMatch,
  isCsLobbyDoc,
  mergeLibraryMatches,
  practicePatchToCsFields,
  seasonIdForGame,
  wireTimes,
} from "@/data/cs/practice";
import type { LibraryMatch } from "@/lib/match-library";
import type { PracticeSession } from "@/lib/practice-sessions";

/** A `practiceMatches` doc as CS's import script writes it (one per alliance). */
const csMatchDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  matchKey: "2026arli_qm12",
  eventKey: "2026arli",
  eventName: "Arkansas Regional",
  matchNumber: 12,
  matchType: "qualification",
  compLevel: "qm",
  setNumber: 1,
  videoUrl: "https://www.youtube.com/watch?v=abc123",
  difficulty: "medium",
  alliance: "red",
  allianceTeams: [254, 971, 1678],
  actualScore: 88,
  officialScore: 88,
  penaltyPoints: 6,
  officialData: { score: 88, penaltyPoints: 6, breakdown: { auto: 20 } },
  game: "REBUILT",
  createdAt: 1_700_000_000_000,
  importedByScript: "import-practice.mjs",
  ...over,
});

describe("csPracticeMatchesToLibrary", () => {
  it("merges the two alliance docs of a match into one library match", () => {
    const [match, ...rest] = csPracticeMatchesToLibrary([
      { id: "d-red", data: csMatchDoc() },
      { id: "d-blue", data: csMatchDoc({ alliance: "blue", allianceTeams: [118, 148, 2056], actualScore: 31, officialScore: 31, officialData: { score: 31, penaltyPoints: 2 }, penaltyPoints: 2, difficulty: "easy" }) },
    ]);
    expect(rest).toEqual([]);
    expect(match).toMatchObject({
      id: "cs:2026arli_Q12",
      seasonId: "rebuilt",
      eventCode: "2026arli",
      eventName: "Arkansas Regional",
      matchType: "Qualification",
      matchNumber: 12,
      published: true,
      origin: "api",
      video: { youtubeUrl: "https://www.youtube.com/watch?v=abc123" },
    });
    expect(match.alliances.red).toEqual({ teams: [254, 971, 1678], score: 88, penaltyPoints: 6, difficulty: "medium" });
    expect(match.alliances.blue).toEqual({ teams: [118, 148, 2056], score: 31, penaltyPoints: 2, difficulty: "easy" });
    expect(match.cs).toEqual({ matchKey: "2026arli_qm12", docIds: { red: "d-red", blue: "d-blue" } });
    expect(isCsImportedMatch(match)).toBe(true);
  });

  it("an alliance CS never imported is empty, not invented", () => {
    const [match] = csPracticeMatchesToLibrary([{ id: "only-red", data: csMatchDoc() }]);
    expect(match.alliances.blue.teams).toEqual([]);
    expect(match.cs?.docIds).toEqual({ red: "only-red" });
  });

  it("reads the score from officialData when the flat field is missing, and derives difficulty when it is not stored", () => {
    const [match] = csPracticeMatchesToLibrary([{ id: "x", data: csMatchDoc({ actualScore: undefined, officialScore: undefined, penaltyPoints: undefined, difficulty: undefined, officialData: { score: 95, penaltyPoints: 4 } }) }]);
    expect(match.alliances.red).toMatchObject({ score: 95, penaltyPoints: 4, difficulty: "hard" });
  });

  it("maps practice, playoff and finals keys to CE match types and numbers", () => {
    const rows = [
      { id: "p", data: csMatchDoc({ matchKey: "2026arli_pr3", matchType: "practice", matchNumber: 3 }) },
      { id: "s", data: csMatchDoc({ matchKey: "2026arli_sf5m1", matchType: "playoff", matchNumber: 1 }) },
      { id: "f", data: csMatchDoc({ matchKey: "2026arli_f1m2", matchType: "playoff", matchNumber: 2 }) },
    ];
    const matches = csPracticeMatchesToLibrary(rows);
    const byId = Object.fromEntries(matches.map((m) => [m.id, m]));
    expect(byId["cs:2026arli_P3"]).toMatchObject({ matchType: "Practice", matchNumber: 3 });
    expect(byId["cs:2026arli_F5"]).toMatchObject({ matchType: "Playoff", matchNumber: 5 });
    expect(byId["cs:2026arli_F15"]).toMatchObject({ matchType: "Playoff", matchNumber: 15 });
  });

  it("drops docs with no event, alliance or match; a missing video is null", () => {
    expect(csPracticeMatchesToLibrary([{ id: "a", data: csMatchDoc({ eventKey: "" }) }, { id: "b", data: csMatchDoc({ alliance: "" }) }, { id: "c", data: csMatchDoc({ matchKey: "junk", matchType: "", matchNumber: 0 }) }])).toEqual([]);
    expect(csPracticeMatchesToLibrary([{ id: "a", data: csMatchDoc({ videoUrl: "" }) }])[0].video).toBeNull();
  });

  it("normalizes an aliased event key", () => {
    expect(csPracticeMatchesToLibrary([{ id: "a", data: csMatchDoc({ eventKey: "2025lake", matchKey: "2025lake_qm1", matchNumber: 1 }) }])[0].eventCode).toBe("2026lake");
  });

  it("seasonIdForGame maps CS games to season ids", () => {
    expect(seasonIdForGame("REBUILT")).toBe("rebuilt");
    expect(seasonIdForGame("CHARGED_UP")).toBe("charged_up");
    expect(seasonIdForGame("REEFSCAPE")).toBe("reefscape");
    expect(seasonIdForGame("nope")).toBe("rebuilt");
  });
});

describe("mergeLibraryMatches", () => {
  const own = (over: Partial<LibraryMatch> = {}): LibraryMatch => ({
    id: "2026arli_Q12",
    seasonId: "rebuilt",
    eventCode: "2026ARLI",
    eventName: "x",
    matchType: "Qualification",
    matchNumber: 12,
    alliances: { red: { teams: [1, 2, 3], score: 1, penaltyPoints: 0, difficulty: "easy" }, blue: { teams: [4, 5, 6], score: 1, penaltyPoints: 0, difficulty: "easy" } },
    video: null,
    importedAt: "",
    scoresUpdatedAt: "",
    ...over,
  });
  const imported = csPracticeMatchesToLibrary([{ id: "a", data: csMatchDoc() }, { id: "b", data: csMatchDoc({ matchKey: "2026arli_qm13", matchNumber: 13 }) }]);

  it("CE's own copy of a match wins; the rest of the imported set is appended", () => {
    const merged = mergeLibraryMatches([own()], imported);
    expect(merged.map((m) => m.id)).toEqual(["2026arli_Q12", "cs:2026arli_Q13"]);
  });

  it("filters the imported set", () => {
    expect(mergeLibraryMatches([], imported, (m) => m.matchNumber === 13).map((m) => m.matchNumber)).toEqual([13]);
    expect(mergeLibraryMatches([], imported, () => false)).toEqual([]);
  });

  it("importedMatchId matches the id the importer gives", () => {
    expect(importedMatchId("2026arli", "Qualification", 12)).toBe(imported[0].id);
  });
});

/** A `practiceSessions` snapshot as CS's practice page writes it on finishing. */
const csSessionDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  teamId: "MAG2403",
  scoutName: "Ada Lovelace",
  scoutId: "uid-ada",
  matchId: "d-red",
  matchKey: "2026arli_qm12",
  matchNumber: 12,
  matchType: "qualification",
  alliance: "red",
  difficulty: "medium",
  mode: "competitive",
  isLivePracticeScouting: false,
  liveVideoUrl: "",
  scoutedData: { teamNumber: "254" },
  allScoutedData: [{ teamNumber: "254" }, { teamNumber: "971" }, { teamNumber: "1678" }],
  eventKey: "2026arli",
  eventName: "Arkansas Regional",
  game: "REBUILT",
  officialScore: 88,
  actualScore: 88,
  scoutedScore: 80,
  penaltyPoints: 6,
  accuracy: 91,
  scoringWeights: { autoFuel: 1 },
  deviceType: "mobile",
  deviceDetails: "iPhone",
  timestamp: 1_700_000_100_000,
  startedAt: 1_700_000_000_000,
  completedAt: 1_700_000_100_000,
  ...over,
});

describe("csSessionToPractice", () => {
  it("maps a CS snapshot to a completed solo session", () => {
    const s = csSessionToPractice("abc", csSessionDoc())!;
    expect(s).toMatchObject({
      id: "abc",
      teamId: "MAG2403",
      uid: "uid-ada",
      scoutName: "Ada Lovelace",
      kind: "solo",
      status: "completed",
      seasonId: "rebuilt",
      mode: "competitive",
      difficulty: "medium",
      libraryMatchId: "cs:2026arli_Q12",
      eventCode: "2026arli",
      alliance: "red",
      robots: [254, 971, 1678],
      completedRobots: [254, 971, 1678],
      accuracy: 91,
      scoutedTotal: 80,
      penaltyPoints: 6,
      officialScore: 88,
      platform: "mobile",
      matchType: "Qualification",
      matchNumber: 12,
      streamUrl: null,
      excluded: false,
    });
    expect(s.startedAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(s.finishedAt).toBe(new Date(1_700_000_100_000).toISOString());
    // unknown CS fields stay on the object (D10)
    expect((s as unknown as Record<string, unknown>).scoringWeights).toEqual({ autoFuel: 1 });
  });

  it("a live-practice snapshot keeps its video url; unknown mode/difficulty are null", () => {
    const s = csSessionToPractice("x", csSessionDoc({ isLivePracticeScouting: true, liveVideoUrl: "https://youtu.be/live", difficulty: "live", mode: "" }))!;
    expect(s.streamUrl).toBe("https://youtu.be/live");
    expect(s.difficulty).toBeNull();
    expect(s.mode).toBeNull();
  });

  it("a snapshot with one scouted robot has no alliance team list", () => {
    const s = csSessionToPractice("x", csSessionDoc({ allScoutedData: undefined }))!;
    expect(s.robots).toEqual([254]);
    expect(s.allianceTeams).toBeNull();
  });

  it("is null for CS's live-lobby docs and for a doc with no team", () => {
    const lobby = { code: "ABCD", hostId: "u", status: "waiting", playersByUid: {}, matchJson: "{}", assignmentsJson: "{}", submissionsJson: "{}", teamId: "MAG2403" };
    expect(isCsLobbyDoc(lobby)).toBe(true);
    expect(csSessionToPractice("l", lobby)).toBeNull();
    expect(csSessionToPractice("n", csSessionDoc({ teamId: "" }))).toBeNull();
  });

  it("a CE-written doc passes through, with ms times as ISO and uid from scoutId", () => {
    const ce = { teamId: "T", scoutId: "u1", kind: "live", status: "paused", startedAt: 1_700_000_000_000, finishedAt: null, robots: [1], completedRobots: [], libraryMatchId: "L" };
    const s = csSessionToPractice("PS-ABC123", ce)!;
    expect(s).toMatchObject({ id: "PS-ABC123", kind: "live", status: "paused", uid: "u1", libraryMatchId: "L", robots: [1] });
    expect(s.startedAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(s.finishedAt).toBeNull();
    const iso = csSessionToPractice("PS-X", { ...ce, uid: "u9", startedAt: "2026-03-01T00:00:00.000Z" })!;
    expect(iso.uid).toBe("u9");
    expect(iso.startedAt).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("practicePatchToCsFields", () => {
  const [match] = csPracticeMatchesToLibrary([{ id: "d-red", data: csMatchDoc() }]);
  const NOW = 1_700_000_500_000;

  it("writes the CS names for a session start", () => {
    const patch: Partial<PracticeSession> = {
      scoutName: "Ada Lovelace",
      seasonId: "rebuilt",
      mode: "trial",
      difficulty: "medium",
      libraryMatchId: match.id,
      eventCode: "2026arli",
      alliance: "red",
      robots: [254, 971, 1678],
      platform: "pc",
    };
    expect(practicePatchToCsFields(patch, { match, now: NOW })).toEqual({
      scoutName: "Ada Lovelace",
      eventKey: "2026arli",
      eventName: "Arkansas Regional",
      game: "REBUILT",
      alliance: "red",
      difficulty: "medium",
      mode: "trial",
      matchType: "qualification",
      matchNumber: 12,
      matchKey: "2026arli_qm12",
      matchId: "d-red",
      deviceType: "desktop",
    });
  });

  it("a CE library match (no CS doc ids) keeps its own id as matchId and builds the TBA-style matchKey", () => {
    const fields = practicePatchToCsFields({ libraryMatchId: "ARLI_Q4", eventCode: "2026ARLI", alliance: "blue", matchType: "Qualification", matchNumber: 4 });
    expect(fields).toMatchObject({ matchId: "ARLI_Q4", matchKey: "2026arli_qm4", matchType: "qualification", matchNumber: 4, eventKey: "2026arli" });
  });

  it("writes the results with CS's names and times at completion", () => {
    const fields = practicePatchToCsFields({ status: "completed", accuracy: 91, scoutedTotal: 80, officialScore: 88, penaltyPoints: 6, finishedAt: new Date(NOW).toISOString() }, { now: 1 });
    expect(fields).toEqual({ accuracy: 91, scoutedScore: 80, officialScore: 88, actualScore: 88, penaltyPoints: 6, completedAt: NOW, timestamp: NOW });
  });

  it("a partial patch stays partial, and a live session maps its stream", () => {
    expect(practicePatchToCsFields({ completedRobots: [254] })).toEqual({});
    expect(practicePatchToCsFields({ streamUrl: "https://youtu.be/x" }, { kind: "live" })).toEqual({ isLivePracticeScouting: true, liveVideoUrl: "https://youtu.be/x" });
    expect(practicePatchToCsFields({ uid: "u1" })).toEqual({ scoutId: "u1" });
  });

  it("wireTimes: ISO start becomes ms; completed without a finish time uses now", () => {
    expect(wireTimes({ startedAt: "2026-01-01T00:00:00.000Z" }, 5)).toEqual({ startedAt: Date.parse("2026-01-01T00:00:00.000Z") });
    expect(wireTimes({ status: "completed" }, 9)).toEqual({ completedAt: 9, timestamp: 9 });
    expect(wireTimes({}, 9)).toEqual({});
  });

  it("csSessionMatchType follows CS (playoff, not finals, for sessions)", () => {
    expect(csSessionMatchType("Practice")).toBe("practice");
    expect(csSessionMatchType("Qualification")).toBe("qualification");
    expect(csSessionMatchType("Playoff")).toBe("playoff");
  });

  it("round trip: a CE session write reads back as the same session in CS's reader", () => {
    const fields = practicePatchToCsFields(
      { scoutName: "Ada", seasonId: "rebuilt", mode: "competitive", difficulty: "hard", libraryMatchId: match.id, eventCode: "2026arli", alliance: "red", robots: [254, 971, 1678], status: "completed", accuracy: 77, scoutedTotal: 70, officialScore: 90, penaltyPoints: 2, finishedAt: new Date(NOW).toISOString() },
      { match, now: NOW }
    );
    const csDoc = { teamId: "MAG2403", scoutId: "uid-ada", allScoutedData: [{ teamNumber: "254" }, { teamNumber: "971" }, { teamNumber: "1678" }], ...fields };
    const back = csSessionToPractice("rt", csDoc)!;
    expect(back).toMatchObject({ uid: "uid-ada", libraryMatchId: match.id, alliance: "red", accuracy: 77, scoutedTotal: 70, officialScore: 90, penaltyPoints: 2, mode: "competitive", difficulty: "hard", status: "completed", matchType: "Qualification", matchNumber: 12 });
  });
});
