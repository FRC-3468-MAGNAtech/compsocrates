import type { AllianceColor } from "@/lib/practice-sessions";

export type CoveredRobot = { teamNumber: number; alliance: AllianceColor };

export type JoinOption =
  | { kind: "forced"; alliance: AllianceColor; teamNumber: number }
  /** Pick any of `teamNumbers` on `alliance`: the whole other alliance, or (3-robot alliances) the robots still uncovered on a partly covered one. */
  | { kind: "choice"; alliance: AllianceColor; teamNumbers: number[] }
  | { kind: "none" };

/**
 * What a new joiner is offered, given who's already covering this match
 * (active scouts + already-completed entries, this team only). Per the
 * prompt: the first joiner completing an alliance is *forced* onto that
 * alliance's other robot (no free choice); only once an alliance is fully
 * covered can further joiners pick freely from the other alliance. If both
 * alliances are already partially covered (1 each) — a case the prompt
 * doesn't address — this forces onto the first one found, favoring
 * completing an alliance over starting a third; see docs/ASSUMPTIONS.md
 * (P7).
 */
export function determineJoinOption(covered: CoveredRobot[], redTeams: readonly number[], blueTeams: readonly number[]): JoinOption {
  const byAlliance: Record<AllianceColor, number[]> = {
    red: covered.filter((c) => c.alliance === "red").map((c) => c.teamNumber),
    blue: covered.filter((c) => c.alliance === "blue").map((c) => c.teamNumber),
  };
  const teams: Record<AllianceColor, readonly number[]> = { red: redTeams, blue: blueTeams };

  if (byAlliance.red.length === 0 && byAlliance.blue.length === 0) return { kind: "none" };

  // A partly covered alliance is completed first. One robot left is forced (always the case for
  // 2-robot alliances); with 3-robot alliances and two left, the joiner picks between them.
  for (const alliance of ["red", "blue"] as AllianceColor[]) {
    const n = byAlliance[alliance].length;
    if (n >= 1 && n < teams[alliance].length) {
      const remaining = teams[alliance].filter((t) => !byAlliance[alliance].includes(t));
      if (remaining.length === 1) return { kind: "forced", alliance, teamNumber: remaining[0] };
      if (remaining.length > 1) return { kind: "choice", alliance, teamNumbers: remaining };
    }
  }

  for (const [alliance, other] of [
    ["red", "blue"],
    ["blue", "red"],
  ] as [AllianceColor, AllianceColor][]) {
    if (byAlliance[alliance].length >= teams[alliance].length && byAlliance[other].length === 0) {
      return { kind: "choice", alliance: other, teamNumbers: [...teams[other]] };
    }
  }

  return { kind: "none" };
}
