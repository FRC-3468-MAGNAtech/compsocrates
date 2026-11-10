/**
 * Realistic CS `scouting` documents for the adapter tests (shapes taken from CS's own submit code:
 * app/scout-form/page.tsx, app/practice-scouting/page.tsx, docs/AUDIT.md 3.2). Test support only.
 */
import type { CsRecord } from "@/data/cs/types";

export const SUBMITTED = 1_776_000_000_000;

/** An official REBUILT entry exactly as CS's scout form writes it today (one shared teleop human-player counter, no byShift map). */
export function rebuiltDoc(overrides: CsRecord = {}): CsRecord {
  return {
    scoutName: "Ada Lovelace",
    scoutId: "uid-ada",
    teamId: "MAG2403",
    eventKey: "2026arli",
    game: "REBUILT",
    matchId: "q12",
    matchType: "qualification",
    matchNumber: "12",
    teamNumber: "1234",
    startingPosition: "middle",
    auto: {
      preloadScale: 2,
      bpsScale: 4,
      carryingScale: 5,
      cycleTimes: [0.5, 3, 5],
      estimatedFuel: 91,
      counterOverride: 0,
      counterOverrideMissedFuel: 5,
      humanPlayerFuel: 3,
      failedClimb: 0,
      successfulClimb: true,
      wonAuto: true,
      hubActivationOverride: false,
    },
    teleop: {
      shiftParityFromWonAuto: true,
      bpsScale: 3,
      carryingScale: 3,
      transitionCycles: [2],
      shift1Cycles: [1, 10],
      shift2Cycles: [3],
      shift3Cycles: [1],
      shift4Cycles: [5],
      transitionOverride: 0,
      transitionMissedFuel: 0,
      shift1Override: 0,
      shift1MissedFuel: 0,
      shift2Override: 0,
      shift2MissedFuel: 0,
      shift3Override: 10,
      shift3MissedFuel: 0,
      shift4Override: 0,
      shift4MissedFuel: 2,
      humanPlayerFuel: 7,
      estimatedFuel: 77,
    },
    endgame: {
      cycleTimes: [1, 1],
      counterOverride: 0,
      counterOverrideMissedFuel: 0,
      humanPlayerFuel: 2,
      estimatedFuel: 18,
      failedClimb: 0,
      status: "level-2",
    },
    incidents: ["died", "tipped"],
    notes: "Fast cycler, tipped once",
    scoringWeights: { autoFuel: 1, autoClimbLevel1: 15, teleopFuel: 1, teleopClimbLevel1: 10, teleopClimbLevel2: 20, teleopClimbLevel3: 30 },
    submittedAt: SUBMITTED,
    timestamp: SUBMITTED,
    ...overrides,
  };
}

/** A doc with fields this app knows nothing about (D10): they must survive any rewrite. */
export function rebuiltDocWithUnknowns(): CsRecord {
  return rebuiltDoc({
    priorityTeamsByEvent: { "2026arli": ["254"] },
    deviceType: "tablet",
    someFutureField: { nested: [1, 2, 3] },
    auto: { ...(rebuiltDoc().auto as CsRecord), futureAutoField: "keep me" },
  });
}

/** Older REEFSCAPE row: no `game` field at all, flat fields, a legacy event alias, a TBA-style match id. */
export function reefscapeDoc(overrides: CsRecord = {}): CsRecord {
  return {
    scoutName: "Grace Hopper",
    scoutId: "uid-grace",
    teamId: "MAG2403",
    eventKey: "2025lake",
    matchId: "sf5",
    matchType: "finals",
    matchNumber: "5",
    teamNumber: " 254 ",
    leftStartingZone: true,
    autoCoralL1: 1,
    autoCoralL2: 2,
    teleopCoralL3: 3,
    teleopCoralL4: 1,
    teleopProcessorScored: 2,
    teleopNetHumanScored: 1,
    stageStatus: "Deep climb",
    penaltyPoints: 4,
    incidents: [],
    notes: "reef",
    submittedAt: SUBMITTED,
    timestamp: SUBMITTED,
    ...overrides,
  };
}

export function chargedUpDoc(overrides: CsRecord = {}): CsRecord {
  return {
    scoutName: "Katherine Johnson",
    scoutId: "uid-kj",
    teamId: "MAG2403",
    eventKey: "2023lake",
    game: "CHARGED_UP",
    matchId: "f1",
    matchType: "finals",
    matchNumber: "1",
    teamNumber: "2468",
    auto: { mobility: true, gridBottom: 2, gridMiddle: 1, gridTop: 1, missed: false, chargeStation: "Engaged" },
    teleop: { gridBottom: 3, gridMiddle: 2, gridTop: 2, links: 1 },
    endgame: { chargeStation: "Docked" },
    penaltyPoints: 4,
    incidents: ["tipped"],
    notes: "",
    submittedAt: SUBMITTED,
    timestamp: SUBMITTED,
    ...overrides,
  };
}

/** A practice-scouting session row (a REBUILT row plus the practice markers CS adds). */
export function practiceDoc(overrides: CsRecord = {}): CsRecord {
  return rebuiltDoc({
    matchId: "q7",
    matchNumber: "7",
    matchKey: "2026arli_qm7",
    alliance: "red",
    allianceColor: "red",
    accuracy: 82,
    isPracticeScouting: true,
    practiceMode: "trial",
    practiceSessionId: "session-1",
    difficulty: "easy",
    penaltyPoints: 6,
    deviceType: "phone",
    ...overrides,
  });
}

export function subInDoc(): CsRecord {
  return {
    entryType: "sub-in-request",
    formType: "sub-in-request",
    game: "REBUILT",
    teamId: "MAG2403",
    eventKey: "2026arli",
    matchId: "q12",
    matchKey: "q12",
    matchType: "qualification",
    matchNumber: "12",
    teamNumber: "1234",
    scoutId: "uid-ada",
    scoutName: "Ada Lovelace",
    requestedById: "uid-ada",
    requestedByName: "Ada Lovelace",
    submittedAt: SUBMITTED,
    requestedAt: SUBMITTED,
    timestamp: SUBMITTED,
  };
}

export function leadDoc(): CsRecord {
  return {
    scoutName: "Ada Lovelace",
    scoutId: "uid-ada",
    teamId: "MAG2403",
    eventKey: "2026arli",
    game: "REBUILT",
    matchKey: "q12",
    matchId: "q12",
    matchType: "qualification",
    matchNumber: "12",
    alliance: "red",
    isPracticeScouting: false,
    isLeadScouting: true,
    entryType: "lead",
    robots: [{ teamNumber: "1", notes: "", skillLevel: 3 }],
    overallAlliance: { teams: "1, 2, 3", notes: "", skillLevel: 3 },
    createdAt: SUBMITTED,
    submittedAt: SUBMITTED,
    timestamp: SUBMITTED,
  };
}
