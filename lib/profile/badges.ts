import { BUILTIN_ACHIEVEMENTS } from "@/lib/achievements/builtins";
import { evaluate } from "@/lib/achievements/engine";
import type { AchievementFacts } from "@/lib/achievements/metrics";

// P25 / Session 8: the profile's built-in achievements. The thresholds now live in ONE place, lib/achievements/builtins.ts (definitions
// the engine evaluates); this module keeps the profile's original shape (BadgeFacts, BADGES, computeBadges) on top of it, so what a person
// has earned is exactly what it was (pinned by badges-characterization.test.ts). Computed in the browser; nothing is stored.

/** The facts badges are computed from — gathered once by computeProfileStats(). */
export type BadgeFacts = {
  /** Completed solo practice sessions (Trial + Competitive), exclusions NOT removed. */
  sessionCount: number;
  /** Highest accuracy (0-100) over non-excluded completed sessions, or null. */
  bestSessionAccuracy: number | null;
  /** Any category whose status is Excellent. */
  hasExcellentStatus: boolean;
  longestStreakDays: number;
  eventsAttended: number;
  /** A non-excluded Real Event entry whose alliance accuracy is 100%. */
  hasPerfectAlliance: boolean;
};

export type BadgeDef = {
  id: string;
  label: string;
  description: string;
  /** A glyph name the profile knows (components/achievements/achievement-icon.tsx). */
  icon: string;
  earned: (f: BadgeFacts) => boolean;
};

const all = (value: number | null, samples = value === null ? 0 : 1) => ({ all: { value, samples }, season: null });

/** The same facts in the engine's shape (only what the eight built-ins read). */
export function factsFromBadgeFacts(f: BadgeFacts): AchievementFacts {
  return {
    "practice-sessions": all(f.sessionCount, f.sessionCount),
    "best-accuracy": all(f.bestSessionAccuracy === null ? null : Math.round(f.bestSessionAccuracy)),
    "excellent-categories": all(f.hasExcellentStatus ? 1 : 0),
    "longest-streak": all(f.longestStreakDays),
    "events-attended": all(f.eventsAttended),
    "perfect-entries": all(f.hasPerfectAlliance ? 1 : 0),
  };
}

export const BADGES: BadgeDef[] = BUILTIN_ACHIEVEMENTS.map((def) => ({
  id: def.id,
  label: def.name,
  description: def.description,
  icon: def.icon,
  earned: (f) => evaluate(def, factsFromBadgeFacts(f))?.earned === true,
}));

export type BadgeResult = { badge: BadgeDef; earned: boolean };

/** Every badge, earned or not, in the config's order (the profile shows the earned ones and dims the rest). */
export function computeBadges(facts: BadgeFacts): BadgeResult[] {
  return BADGES.map((badge) => ({ badge, earned: badge.earned(facts) }));
}
