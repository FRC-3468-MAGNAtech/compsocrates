import type { RadarSample } from "@/lib/analytics/robot-radar";

// Pure model behind the Climb Reliability box plot of Robot Radar (CS app/components/ClimbBoxPlot.tsx): per team, the spread of
// endgame climb points across the matches where a climb was attempted.

/** The plot's value axis: 0 to the highest climb (30 points), in CS's 0-60 frame. */
export const CLIMB_AXIS_MAX = 60;
export const CLIMB_AXIS_STEP = 10;

export type ClimbBox = {
  teamNumber: number;
  values: number[];
  q1: number;
  median: number;
  q3: number;
  whiskerLow: number;
  whiskerHigh: number;
  outliers: number[];
  successCount: number;
  attemptCount: number;
};

/** Linear-interpolated percentile (`p` in 0..1) of unsorted values; 0 for none. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (1 - (idx - lower)) + sorted[upper] * (idx - lower);
}

export function buildBox(teamNumber: number, values: readonly number[], successCount: number, attemptCount: number): ClimbBox {
  if (values.length === 0) return { teamNumber, values: [], q1: 0, median: 0, q3: 0, whiskerLow: 0, whiskerHigh: 0, outliers: [], successCount, attemptCount };
  const q1 = percentile(values, 0.25);
  const median = percentile(values, 0.5);
  const q3 = percentile(values, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    teamNumber,
    values: sorted,
    q1,
    median,
    q3,
    whiskerLow: sorted.find((v) => v >= lowerFence) ?? sorted[0],
    whiskerHigh: [...sorted].reverse().find((v) => v <= upperFence) ?? sorted[sorted.length - 1],
    outliers: sorted.filter((v) => v < lowerFence || v > upperFence),
    successCount,
    attemptCount,
  };
}

/** One box per requested team, from the matches where a climb was attempted (a success is any attempt that scored climb points). */
export function buildClimbBoxes(samples: readonly RadarSample[], teamNumbers: readonly number[]): ClimbBox[] {
  const byTeam = new Map<number, { values: number[]; success: number; attempts: number }>();
  for (const s of samples) {
    if (!s.climbAttempt.attempted) continue;
    const bucket = byTeam.get(s.teamNumber) ?? { values: [], success: 0, attempts: 0 };
    bucket.values.push(s.climbAttempt.points);
    bucket.attempts += 1;
    if (s.climbAttempt.points > 0) bucket.success += 1;
    byTeam.set(s.teamNumber, bucket);
  }
  return teamNumbers.map((team) => {
    const b = byTeam.get(team) ?? { values: [], success: 0, attempts: 0 };
    return buildBox(team, b.values, b.success, b.attempts);
  });
}
