import { computeAllianceAccuracy } from "@/lib/accuracy/engine";
import type { LibraryAlliance } from "@/lib/match-library";

/**
 * What a finished practice session records, from the robots' scores and the alliance's official result. Pure.
 *  - A form with scoring off has nothing to total or compare: everything is null ("n/a").
 *  - An alliance with no official score yet (`scoreKnown: false`, a scheduled match nobody has scored): the robots' total is kept on its own and accuracy,
 *    the official score and the penalty points are null. A missing accuracy is NEVER stored as 0.
 *  - Otherwise the shared accuracy formula (`computeAllianceAccuracy`), exactly as before.
 */
export type PracticeOutcome = { accuracy: number | null; scoutedTotal: number | null; officialScore: number | null; penaltyPoints: number | null; difference: number | null };

export function practiceOutcome(args: { robotScores: readonly number[]; official: Pick<LibraryAlliance, "score" | "penaltyPoints" | "scoreKnown">; scoringEnabled: boolean }): PracticeOutcome {
  const { robotScores, official, scoringEnabled } = args;
  if (!scoringEnabled) return { accuracy: null, scoutedTotal: null, officialScore: null, penaltyPoints: null, difference: null };
  if (official.scoreKnown === false) return { accuracy: null, scoutedTotal: robotScores.reduce((sum, s) => sum + s, 0), officialScore: null, penaltyPoints: null, difference: null };
  const result = computeAllianceAccuracy({ robotScores: [...robotScores], penaltyPoints: official.penaltyPoints, officialScore: official.score });
  return { accuracy: result.accuracy, scoutedTotal: result.scoutedTotal, officialScore: official.score, penaltyPoints: official.penaltyPoints, difference: result.difference };
}
