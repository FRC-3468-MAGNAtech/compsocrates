import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/scheduler/rng";
import { ALLIANCE_SIZE } from "@/config/alliance";
import { assignPairs, canStartLobby, lobbyGroupSize, lobbyStartBlocker } from "./pairing";

const TEAMS = { red: [100, 200] as [number, number], blue: [300, 400] as [number, number] };

describe("assignPairs", () => {
  it("splits players into pairs of 2", () => {
    const pairs = assignPairs(["a", "b", "c", "d"], TEAMS, mulberry32(1));
    expect(pairs).toHaveLength(2);
    expect(pairs.flatMap((p) => p.playerUids).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("alternates alliance across pairs", () => {
    const pairs = assignPairs(["a", "b", "c", "d", "e", "f"], TEAMS, mulberry32(42));
    expect(pairs.map((p) => p.alliance)).toEqual(["red", "blue", "red"]);
  });

  it("assigns each pair's two players to that alliance's two distinct team numbers", () => {
    const pairs = assignPairs(["a", "b", "c", "d"], TEAMS, mulberry32(7));
    for (const pair of pairs) {
      const [teamA, teamB] = TEAMS[pair.alliance];
      const robots = pair.playerUids.map((uid) => pair.robotForUid[uid]);
      expect(robots.sort()).toEqual([teamA, teamB].sort());
    }
  });

  it("is deterministic for the same seed", () => {
    const a = assignPairs(["a", "b", "c", "d"], TEAMS, mulberry32(99));
    const b = assignPairs(["a", "b", "c", "d"], TEAMS, mulberry32(99));
    expect(a).toEqual(b);
  });

  it("leaves an odd leftover player unpaired", () => {
    const pairs = assignPairs(["a", "b", "c"], TEAMS, mulberry32(1));
    expect(pairs).toHaveLength(1);
  });
});

describe("assignPairs — 3-robot alliances", () => {
  const TEAMS3 = { red: [100, 200, 300], blue: [400, 500, 600] };
  const players = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

  it("splits players into groups of three, alternating red and blue", () => {
    const groups = assignPairs(players(6), TEAMS3, mulberry32(3));
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.alliance)).toEqual(["red", "blue"]);
    expect(groups.every((g) => g.playerUids.length === 3)).toBe(true);
    expect(groups.flatMap((g) => g.playerUids).sort()).toEqual(players(6));
  });

  it("gives each player in a group a different robot, covering the alliance exactly", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const group of assignPairs(players(9), TEAMS3, mulberry32(seed))) {
        const robots = group.playerUids.map((uid) => group.robotForUid[uid]).sort();
        expect(robots).toEqual([...TEAMS3[group.alliance]].sort());
      }
    }
  });

  it("is deterministic for the same seed and leaves a short remainder unpaired", () => {
    expect(assignPairs(players(7), TEAMS3, mulberry32(9))).toEqual(assignPairs(players(7), TEAMS3, mulberry32(9)));
    expect(assignPairs(players(7), TEAMS3, mulberry32(9))).toHaveLength(2);
  });

  it("sizes each group by that alliance's own team count, so a 2-team match still pairs players in twos", () => {
    const groups = assignPairs(players(4), { red: [100, 200], blue: [300, 400] }, mulberry32(1));
    expect(groups.map((g) => g.playerUids.length)).toEqual([2, 2]);
  });
});

describe("lobby start rules", () => {
  it("needs whole groups on at least two alliances", () => {
    expect(canStartLobby(4, 2)).toBe(true);
    expect(canStartLobby(6, 2)).toBe(true);
    expect(canStartLobby(2, 2)).toBe(false);
    expect(canStartLobby(5, 2)).toBe(false);
    expect(canStartLobby(6, 3)).toBe(true);
    expect(canStartLobby(9, 3)).toBe(true);
    expect(canStartLobby(3, 3)).toBe(false);
    expect(canStartLobby(8, 3)).toBe(false);
  });

  it("explains why it can't, keeping the original wording for pairs", () => {
    expect(lobbyStartBlocker(3, 2)).toBe("Need an even number of players, at least 4.");
    expect(lobbyStartBlocker(4, 3)).toBe("Need a multiple of 3 players, at least 6.");
    expect(lobbyStartBlocker(6, 3)).toBeNull();
  });

  it("derives the group size from the chosen match, falling back to the event's alliance size", () => {
    expect(lobbyGroupSize({ red: [1, 2], blue: [3, 4] })).toBe(2);
    expect(lobbyGroupSize({ red: [1, 2, 3], blue: [4, 5, 6] })).toBe(3);
    expect(lobbyGroupSize(null)).toBe(ALLIANCE_SIZE);
  });
});
