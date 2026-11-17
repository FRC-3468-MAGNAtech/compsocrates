import type { EventAttendance } from "@/lib/event-attendance";
import { canonicalEventKey, seasonOfEventKey, type EventKeyShape } from "@/lib/events/event-key";
import type { LibraryMatch } from "@/lib/match-library";
import type { PracticeSession } from "@/lib/practice-sessions";
import type { AchievementFacts, MetricValue } from "@/lib/achievements/metrics";
import { computeBadges, type BadgeResult } from "@/lib/profile/badges";
import { RECENT_SESSIONS_SHOWN } from "@/lib/profile/config";
import { currentStreak, longestStreak } from "@/lib/profile/streak";
import { computeScoutStats } from "@/lib/scout-stats/engine";
import type { PracticeSessionSummary, ScoutCategory, ScoutCategoryDetail } from "@/lib/scout-stats/types";
import type { ScoutEntry } from "@/lib/scout-entries";
import type { EventSetup } from "@/lib/scout-status/compute";
import type { ScheduleSlot } from "@/lib/scheduler/types";
import type { TeamMember } from "@/lib/team-members";

// P25: what a profile shows, as pure functions over data the app already loads. The accuracy rows come from
// computeScoutStats() — the same engine as Scout Accuracy and My Scouting, so exclusions, the Real Event default
// and the ranking all agree with those pages. Nothing here recomputes accuracy.

export const PROFILE_CATEGORIES: ScoutCategory[] = ["trial", "competitive", "real-event"];

export type CategoryStat = { category: ScoutCategory; detail: ScoutCategoryDetail | null; rank: number | null };

export type EventEntries = { eventCode: string; entries: number };

export type ProfileStats = {
  categories: CategoryStat[];
  /** The latest sessions (Trial + Competitive, most recent first), each with its PC/Mobile platform. */
  recentSessions: PracticeSessionSummary[];
  /** Completed solo practice sessions, all modes. */
  sessionCount: number;
  streak: number;
  longestStreak: number;
  /** Events of the shown season this member is on the attendance list of, with the event and live entries they scouted there (practice excluded). */
  events: EventEntries[];
  /** The latest session or entry activity (ms), or null when there's none. */
  lastActiveMs: number | null;
  badges: BadgeResult[];
  /** Session 8: the numbers achievements are measured on (the built-ins above are evaluated from the same facts). */
  achievementFacts: AchievementFacts;
};

export type ProfileStatsInput = {
  uid: string;
  members: TeamMember[];
  sessions: PracticeSession[];
  entries: ScoutEntry[];
  libraryMatchesById: Map<string, LibraryMatch>;
  attendance: EventAttendance[];
  now?: Date;
  /**
   * The season the Events card shows and the program's event-key shape (both from `ProgramConfig`: `event.keyShape`, and the season from
   * `currentSeasonFor(event.seasonKind, ...)`). Without it nothing is filtered or normalized (fixtures only: the profile always passes it).
   */
  eventScope?: { season: number; keyShape: EventKeyShape };
};

const isRealEntry = (e: ScoutEntry) => e.source === "event" || e.source === "live";

// The three badge computations, lifted out of computeProfileStats unchanged so the built-in achievements and the metrics share them.
/** Highest accuracy (0-100) over non-excluded completed sessions, or null. */
export const bestAccuracyOf = (accuracies: number[]): number | null => (accuracies.length > 0 ? Math.max(...accuracies) : null);
/** How many categories are at Excellent status. */
export const excellentCategoryCount = (categories: CategoryStat[]): number => categories.filter((c) => c.detail?.status?.id === "excellent").length;
/** Entries whose complete alliance accuracy is 100% (rounded). */
export const perfectEntryCount = (ownEntries: ScoutEntry[]): number =>
  ownEntries.filter((e) => e.accuracy?.status === "complete" && e.accuracy.value !== null && Math.round(e.accuracy.value * 100) >= 100).length;
const measured = (value: number | null, samples: number): MetricValue => ({ value, samples });

export function computeProfileStats(input: ProfileStatsInput): ProfileStats {
  const { uid, members, sessions, entries, libraryMatchesById, attendance } = input;

  const categories: CategoryStat[] = PROFILE_CATEGORIES.map((category) => {
    const result = computeScoutStats({
      category,
      members,
      sessions,
      entries,
      libraryMatchesById,
      attendance,
      roleFilter: [],
      eventFilter: [],
      rankingBasis: "preserve",
      realEventScope: { eventCode: null, variant: "plain" },
    });
    return { category, detail: result.detailsByUid.get(uid) ?? null, rank: result.rows.find((r) => r.uid === uid)?.rank ?? null };
  });

  const detailOf = (c: ScoutCategory) => categories.find((x) => x.category === c)?.detail ?? null;
  const recentSessions = [...(detailOf("trial")?.recentPracticeSessions ?? []), ...(detailOf("competitive")?.recentPracticeSessions ?? [])]
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, RECENT_SESSIONS_SHOWN);

  const ownCompleted = sessions.filter((s) => s.uid === uid && s.kind === "solo" && s.status === "completed" && (s.mode === "trial" || s.mode === "competitive"));
  const practiceDates = ownCompleted.map((s) => s.finishedAt ?? s.startedAt);
  const streak = currentStreak(practiceDates, input.now);
  const longest = longestStreak(practiceDates);

  const ownEntries = entries.filter((e) => e.uid === uid && isRealEntry(e) && !e.excluded);
  // Both sides go through the same key canonicalizer, so an alias or a letter-case difference cannot hide an event's entries.
  const scope = input.eventScope;
  const canon = (key: string) => (scope ? canonicalEventKey(scope.keyShape, key) : key);
  const entriesByEvent = new Map<string, number>();
  for (const e of ownEntries) entriesByEvent.set(canon(e.eventCode), (entriesByEvent.get(canon(e.eventCode)) ?? 0) + 1);
  // Attended = the member is on that event's attendance list. Entries never add an event the member is not listed for.
  const attendedKeys = [...new Set(attendance.filter((a) => a.uids.includes(uid)).map((a) => canon(a.eventCode)))];
  const events: EventEntries[] = attendedKeys
    .filter((key) => !scope || seasonOfEventKey(scope.keyShape, key) === scope.season)
    .map((key) => ({ eventCode: key, entries: entriesByEvent.get(key) ?? 0 }))
    .sort((a, b) => b.entries - a.entries || a.eventCode.localeCompare(b.eventCode));

  const activity = [...sessions.filter((s) => s.uid === uid).map((s) => s.finishedAt ?? s.startedAt), ...entries.filter((e) => e.uid === uid).map((e) => e.submittedAt)]
    .map((iso) => Date.parse(iso))
    .filter((t) => Number.isFinite(t));
  const lastActiveMs = activity.length > 0 ? Math.max(...activity) : null;

  const nonExcludedAccuracies = ownCompleted.filter((s) => !s.excluded && s.accuracy !== null).map((s) => s.accuracy as number);
  const bestAccuracy = bestAccuracyOf(nonExcludedAccuracies);
  const excellentCount = excellentCategoryCount(categories);
  const perfectCount = perfectEntryCount(ownEntries);
  const badges = computeBadges({
    sessionCount: ownCompleted.length,
    bestSessionAccuracy: bestAccuracy,
    hasExcellentStatus: excellentCount > 0,
    longestStreakDays: longest,
    // Achievements stay all-time: the card shows one season, but an earned badge is not taken back by a new season.
    eventsAttended: attendedKeys.length,
    hasPerfectAlliance: perfectCount > 0,
  });

  // Season scope (only with an event scope): the Events card's own list, and entries whose event key is in the shown season.
  const seasonEntryCount = scope ? ownEntries.filter((e) => seasonOfEventKey(scope.keyShape, canon(e.eventCode)) === scope.season).length : 0;
  const mean = nonExcludedAccuracies.length > 0 ? nonExcludedAccuracies.reduce((a, b) => a + b, 0) / nonExcludedAccuracies.length : null;
  const achievementFacts: AchievementFacts = {
    "practice-sessions": { all: measured(ownCompleted.length, ownCompleted.length), season: null },
    "longest-streak": { all: measured(longest, ownCompleted.length), season: null },
    "events-attended": { all: measured(attendedKeys.length, attendedKeys.length), season: scope ? measured(events.length, events.length) : null },
    "scout-entries": { all: measured(ownEntries.length, ownEntries.length), season: scope ? measured(seasonEntryCount, seasonEntryCount) : null },
    "best-accuracy": { all: measured(bestAccuracy === null ? null : Math.round(bestAccuracy), nonExcludedAccuracies.length), season: null },
    // The same Math.round the status tiers use, so "90" here means Excellent there. A session with no accuracy is not in the list, so it is never a 0.
    "average-accuracy": { all: measured(mean === null ? null : Math.round(mean), nonExcludedAccuracies.length), season: null },
    "excellent-categories": { all: measured(excellentCount, 3), season: null },
    "perfect-entries": { all: measured(perfectCount, ownEntries.length), season: null },
  };

  return { categories, recentSessions, sessionCount: ownCompleted.length, streak, longestStreak: longest, events, lastActiveMs, badges, achievementFacts };
}

export type EventTargetProgress = {
  eventCode: string;
  entries: number;
  /** null when the member has no target at this event. */
  target: number | null;
  /** 0-1, capped at 1; null with no target. */
  completion: number | null;
  /** Where the target came from. */
  source: "manual" | "assignments" | "none";
};

/**
 * Target completion at one event (P16 Scout Status): the member's manual targets from that event's setup (the sum
 * over categories) when an admin set any, else the number of distinct matches Assignments gives them. The Scout Status
 * page's match ranges and category filters aren't re-applied here (a profile doesn't have those controls).
 */
export function eventTargetProgress(input: { uid: string; eventCode: string; entries: ScoutEntry[]; setup: EventSetup | null; slots: ScheduleSlot[] | null | undefined }): EventTargetProgress {
  const { uid, eventCode, setup } = input;
  const done = input.entries.filter((e) => e.uid === uid && isRealEntry(e) && !e.excluded && e.eventCode === eventCode);
  // Scout Status compares the number of entries with the target, so this does too.
  const entries = done.length;

  const manual = setup?.individual[uid];
  const manualValues = manual ? Object.values(manual).filter((v): v is number => typeof v === "number") : [];
  let target: number | null = null;
  let source: EventTargetProgress["source"] = "none";
  if (manualValues.length > 0) {
    target = manualValues.reduce((a, b) => a + Math.max(0, Math.round(b)), 0);
    source = "manual";
  } else {
    const assigned = new Set((input.slots ?? []).filter((s) => s.scoutUid === uid).map((s) => `${s.matchType}|${s.matchNumber}`));
    if (assigned.size > 0) {
      target = assigned.size;
      source = "assignments";
    }
  }
  const completion = target !== null && target > 0 ? Math.min(1, entries / target) : null;
  return { eventCode, entries, target, completion, source };
}
