import { ALLIANCE_SIZE } from "@/config/alliance";
import { seededShuffle } from "@/lib/scheduler/rng";
import type { AllianceColor } from "@/lib/practice-sessions";

/**
 * One alliance's worth of players: `playerUids` has one player per robot on `alliance`
 * (2 for FTC, 3 for FRC). The name `pair` is kept for stored lobby docs and security rules.
 */
export type PairAssignment = {
  pairId: string;
  playerUids: string[];
  alliance: AllianceColor;
  /** Which of the alliance's team numbers each player in the pair scouts. */
  robotForUid: Record<string, number>;
};

/**
 * Random grouping per the P8 spec: shuffle players, chunk into groups of one
 * alliance's robot count (a pair for FTC, a trio for FRC), alliances alternate
 * red/blue/red/blue... across groups in shuffled order (so with more than 2
 * groups, several end up on the same alliance — each still gets its own
 * independent result), and within a group the alliance's team numbers are
 * randomly split between its players. A group is as big as that alliance's own
 * team list (the data's length, not the config), so a 2-team FTC match works
 * under a 3-robot configuration. Requires `playerUids.length` to be a multiple
 * of the group size, at least twice it — the caller (the Start button) already
 * guarantees this; leftover players are silently left unpaired rather than
 * this function inventing a rule the spec never gave.
 */
export function assignPairs(
  playerUids: string[],
  allianceTeams: { red: readonly number[]; blue: readonly number[] },
  rng: () => number
): PairAssignment[] {
  const shuffled = seededShuffle(playerUids, rng);
  const pairs: PairAssignment[] = [];

  let at = 0;
  for (let pairIndex = 0; ; pairIndex++) {
    const alliance: AllianceColor = pairIndex % 2 === 0 ? "red" : "blue";
    const teams = allianceTeams[alliance];
    if (teams.length === 0 || at + teams.length > shuffled.length) break;
    const players = shuffled.slice(at, at + teams.length);
    at += teams.length;
    const robots = seededShuffle([...teams], rng);
    const robotForUid = Object.fromEntries(players.map((uid, i) => [uid, robots[i]]));
    pairs.push({ pairId: `pair-${pairIndex + 1}`, playerUids: players, alliance, robotForUid });
  }

  return pairs;
}

/** How many players make one group: a robot per slot of the alliance (the match's own team count when known). */
export function lobbyGroupSize(allianceTeams?: { red: readonly number[]; blue: readonly number[] } | null): number {
  const n = allianceTeams ? Math.max(allianceTeams.red.length, allianceTeams.blue.length) : 0;
  return n > 0 ? n : ALLIANCE_SIZE;
}

/** The round can start with whole groups on at least two alliances: a multiple of `groupSize`, at least twice it. */
export function canStartLobby(playerCount: number, groupSize: number): boolean {
  return playerCount >= groupSize * 2 && playerCount % groupSize === 0;
}

/** Why Start is disabled for this player count, or null when it isn't. */
export function lobbyStartBlocker(playerCount: number, groupSize: number): string | null {
  if (canStartLobby(playerCount, groupSize)) return null;
  return groupSize === 2 ? "Need an even number of players, at least 4." : `Need a multiple of ${groupSize} players, at least ${groupSize * 2}.`;
}
