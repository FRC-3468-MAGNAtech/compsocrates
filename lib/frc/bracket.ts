import { EVENT_CONFIG } from "@/config/event";
import type { BracketMatch, BracketRound, BracketStructure, FtcMatch } from "@/lib/ftc/types";

/**
 * The FRC 8-alliance double-elimination bracket (2023 onward, still used in 2026), keyed by the
 * D11 slot numbers 1..13 and finals 14..16. The slot layout is the one CS draws in
 * ReefscapeMatchSelectModal's FinalsBracket:
 *
 *   Round 1 (upper):  M1  M2  M3  M4
 *   Round 2:          upper M7 M8       lower M5 M6
 *   Round 3:          lower M9 M10
 *   Round 4:          upper M11         lower M12
 *   Round 5:          lower M13
 *   Finals:           M14 M15 M16 (best of three)
 *
 * The structure is fixed, so every slot is emitted even before TBA lists the match (the match is
 * `null` and the UI shows an empty box). Returns `{ format: "unknown" }` when no slot 1..13 match
 * is present, since nothing identifies the matches as a bracket.
 */

type SlotRound = { label: string; round: number; slots: number[] };

const UPPER_ROUNDS: SlotRound[] = [
  { label: "Upper Round 1", round: 1, slots: [1, 2, 3, 4] },
  { label: "Upper Round 2", round: 2, slots: [7, 8] },
  { label: "Upper Round 4", round: 4, slots: [11] },
];

const LOWER_ROUNDS: SlotRound[] = [
  { label: "Lower Round 2", round: 2, slots: [5, 6] },
  { label: "Lower Round 3", round: 3, slots: [9, 10] },
  { label: "Lower Round 4", round: 4, slots: [12] },
  { label: "Lower Round 5", round: 5, slots: [13] },
];

function toBracketMatch(label: string, match: FtcMatch | undefined): BracketMatch {
  if (!match) return { label, match: null, red: null, blue: null, winner: null };
  const winner =
    match.played && match.redScore !== null && match.blueScore !== null
      ? match.redScore > match.blueScore
        ? "red"
        : match.blueScore > match.redScore
          ? "blue"
          : null
      : null;
  return {
    label,
    match,
    red: match.redTeams.length ? { seed: null, teams: match.redTeams } : null,
    blue: match.blueTeams.length ? { seed: null, teams: match.blueTeams } : null,
    winner,
  };
}

function buildRounds(rounds: SlotRound[], bySlot: Map<number, FtcMatch>): BracketRound[] {
  return rounds.map(({ label, round, slots }) => ({
    label,
    round,
    matches: slots.map((slot) => toBracketMatch(`Match ${slot}`, bySlot.get(slot))),
  }));
}

export function buildFrcPlayoffBracket(matches: FtcMatch[]): BracketStructure {
  const { bracketSlots, finalsOffset } = EVENT_CONFIG.playoff;
  const playoff = matches.filter((m) => m.type === "Playoff");
  const bySlot = new Map(playoff.filter((m) => m.matchNumber >= 1 && m.matchNumber <= bracketSlots).map((m) => [m.matchNumber, m]));
  if (bySlot.size === 0) return { format: "unknown", matches };

  // Always show the best-of-three (plus any overtime games), with empty boxes for unscheduled games.
  const byFinal = new Map(playoff.filter((m) => m.matchNumber > finalsOffset).map((m) => [m.matchNumber - finalsOffset, m]));
  const lastFinal = Math.max(3, ...byFinal.keys());
  const finals: BracketMatch[] = [];
  for (let n = 1; n <= lastFinal; n += 1) finals.push(toBracketMatch(`Finals ${n}`, byFinal.get(n)));

  return {
    format: "double-elim-8",
    upperBracket: buildRounds(UPPER_ROUNDS, bySlot),
    lowerBracket: buildRounds(LOWER_ROUNDS, bySlot),
    finals,
  };
}
