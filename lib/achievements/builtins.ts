import { EVENT_VETERAN_EVENTS, STREAK_BADGE_DAYS } from "@/lib/profile/config";
import type { AchievementDefinition } from "./engine";

// Session 8: the eight built-in achievements as definitions (they were the BADGES list in lib/profile/badges.ts). Same ids, names, descriptions, icons and
// thresholds; all-time, as before. A team can rename one, change its description or hide it, never its threshold.

const builtin = (id: string, name: string, description: string, icon: string, metric: AchievementDefinition["metric"], threshold: number): AchievementDefinition => ({
  id,
  name,
  description,
  icon,
  metric,
  threshold,
  scope: "all",
  hidden: false,
});

export const BUILTIN_ACHIEVEMENTS: readonly AchievementDefinition[] = [
  builtin("first-session", "First Session", "Completed a first practice session.", "flag", "practice-sessions", 1),
  builtin("ten-sessions", "10 Sessions", "Completed 10 practice sessions.", "layers", "practice-sessions", 10),
  builtin("fifty-sessions", "50 Sessions", "Completed 50 practice sessions.", "medal", "practice-sessions", 50),
  builtin("perfect-session", "100% Session", "A practice session at 100% accuracy.", "target", "best-accuracy", 100),
  builtin("excellent", "Excellent status", "Excellent accuracy status in a category.", "sparkles", "excellent-categories", 1),
  builtin("streak", `${STREAK_BADGE_DAYS}-Day Streak`, `Practiced ${STREAK_BADGE_DAYS} days in a row.`, "flame", "longest-streak", STREAK_BADGE_DAYS),
  builtin("event-veteran", "Event Veteran", `Attended ${EVENT_VETERAN_EVENTS} or more events.`, "calendar", "events-attended", EVENT_VETERAN_EVENTS),
  builtin("perfect-alliance", "Perfect Alliance", "A Real Event alliance scouted at 100% accuracy.", "trophy", "perfect-entries", 1),
];

export const BUILTIN_IDS: ReadonlySet<string> = new Set(BUILTIN_ACHIEVEMENTS.map((d) => d.id));
