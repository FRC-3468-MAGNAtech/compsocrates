import { describe, expect, it } from "vitest";
import { isClosedLobby, joinedAtMs, lobbyStub, pickMyLobby, readLobby } from "@/lib/ftc/lobby";
import { canStartLobby, lobbyGroupSize } from "@/lib/lobby/pairing";
import { determineJoinOption } from "@/lib/live/join-rules";
import { computePendingLiveRobots } from "@/lib/live/pending";
import type { PracticeSession } from "@/lib/practice-sessions";

describe("two-robot alliances in the shared live and lobby rules", () => {
  it("a lobby with no match chosen yet sizes its groups by the program's alliance size (a pair), a chosen match by its own team count", () => {
    expect(lobbyGroupSize(null, 2)).toBe(2);
    expect(lobbyGroupSize(null)).toBe(3); // the default program's size, unchanged
    expect(lobbyGroupSize({ red: [1, 2], blue: [3, 4] }, 3)).toBe(2);
    expect(canStartLobby(4, 2)).toBe(true);
    expect(canStartLobby(3, 2)).toBe(false);
  });

  it("live: with one of two robots covered, the joiner is forced onto the other; a covered alliance offers the whole other one", () => {
    expect(determineJoinOption([{ teamNumber: 1, alliance: "red" }], [1, 2], [3, 4])).toEqual({ kind: "forced", alliance: "red", teamNumber: 2 });
    expect(determineJoinOption([{ teamNumber: 1, alliance: "red" }, { teamNumber: 2, alliance: "red" }], [1, 2], [3, 4])).toEqual({ kind: "choice", alliance: "blue", teamNumbers: [3, 4] });
  });

  it("live: a scout who finished one robot is offered the other robot of the pair until someone covers it", () => {
    const done = { id: "LV-1", uid: "u1", kind: "live", status: "completed", robots: [1], allianceTeams: [1, 2], alliance: "red", eventCode: "EV", matchType: "Qualification", matchNumber: 4, streamUrl: null, streamStartSec: null } as unknown as PracticeSession;
    expect(computePendingLiveRobots([done], "u1").map((p) => p.teamNumber)).toEqual([2]);
    const partner = { ...done, id: "LV-2", uid: "u2", robots: [2], status: "in-progress" } as PracticeSession;
    expect(computePendingLiveRobots([done, partner], "u1")).toEqual([]);
  });
});

describe("readLobby", () => {
  const stored = { teamId: "T1", hostUid: "h", hostName: "Hal", seasonId: "biobuzz", mode: "trial", status: "scouting", libraryMatchId: "EV_Q1", settings: { hostScouts: true, hostIsDisplayer: false }, pairing: null, startsAt: null };

  it("reads a lobby with its id and keeps fields it does not know", () => {
    expect(readLobby("LB-AAAAAA", { ...stored, extra: 1 })).toMatchObject({ id: "LB-AAAAAA", teamId: "T1", hostUid: "h", status: "scouting", extra: 1 });
  });

  it("an unknown status reads as waiting; a doc with no team or no host is not a lobby", () => {
    expect(readLobby("LB-AAAAAA", { ...stored, status: "weird" })?.status).toBe("waiting");
    expect(readLobby("LB-AAAAAA", { ...stored, teamId: "" })).toBeNull();
    expect(readLobby("LB-AAAAAA", { ...stored, hostUid: undefined })).toBeNull();
  });
});

describe("lobbyStub", () => {
  it("is a waiting lobby, nothing chosen yet, the host scouting and their screen not the displayer", () => {
    const stub = lobbyStub({ teamId: "T1", hostUid: "h", hostName: "Hal", seasonId: "biobuzz", mode: "competitive" }, () => "NOW");
    expect(stub).toEqual({
      teamId: "T1",
      hostUid: "h",
      hostName: "Hal",
      seasonId: "biobuzz",
      mode: "competitive",
      status: "waiting",
      libraryMatchId: null,
      settings: { hostScouts: true, hostIsDisplayer: false },
      pairing: null,
      startsAt: null,
      hostLastSeen: "NOW",
      createdAt: "NOW",
      resolvedAt: null,
    });
  });
});

describe("the lobby I am in (replaces the collection-group query on `players`)", () => {
  it("offers the lobby joined most recently, and none when I am in none", () => {
    expect(pickMyLobby([{ lobbyId: "A", joinedAtMs: 5 }, { lobbyId: "B", joinedAtMs: 9 }, { lobbyId: "C", joinedAtMs: 1 }])).toBe("B");
    expect(pickMyLobby([])).toBeNull();
  });

  it("a join whose server time has not arrived yet (0) still counts, and loses to a dated one", () => {
    expect(pickMyLobby([{ lobbyId: "A", joinedAtMs: 0 }])).toBe("A");
    expect(pickMyLobby([{ lobbyId: "A", joinedAtMs: 0 }, { lobbyId: "B", joinedAtMs: 3 }])).toBe("B");
  });

  it("only a closed lobby is skipped, so reads are bounded to the team's live lobbies", () => {
    expect(isClosedLobby("closed")).toBe(true);
    for (const open of ["waiting", "scouting", "results", undefined]) expect(isClosedLobby(open)).toBe(false);
  });

  it("joinedAtMs reads a Firestore timestamp, a number, or nothing", () => {
    expect(joinedAtMs({ toMillis: () => 42 })).toBe(42);
    expect(joinedAtMs(7)).toBe(7);
    expect(joinedAtMs(null)).toBe(0);
    expect(joinedAtMs({})).toBe(0);
  });
});
