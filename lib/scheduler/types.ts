import { allianceSlots, type AllianceColor } from "@/config/alliance";
import type { MatchType } from "@/lib/events/types";

/** "red1" ... "blue4". Older stored docs only ever hold index 1 and 2; FRC adds 3. */
export type SlotId = `${AllianceColor}${1 | 2 | 3 | 4}`;

/** The configured event's slots (`ALLIANCE_SIZE` per alliance), red first. */
export const SLOT_IDS: SlotId[] = allianceSlots() as SlotId[];

/**
 * One match's teams, generic across match sources (event schedule, practice
 * library, live). An alliance is `null` when it's excluded for this source
 * (e.g. a practice-library alliance whose own difficulty doesn't match the
 * difficulty the admin picked) — its slots are simply never generated. An
 * alliance's length is the data's own (2 for a stored 2-team match even when the event
 * is configured for 3), so slot ids follow the array, not the config.
 */
export type MatchInput = {
  matchType: MatchType;
  matchNumber: number;
  red: number[] | null;
  blue: number[] | null;
};

export type RotationPattern = "rotate-each-match" | "custom-interval" | "constant-same-order";

export type ScheduleSettings = {
  /** The selected scout pool — order doesn't matter, the scheduler shuffles. */
  scoutUids: string[];
  pattern: RotationPattern;
  /** Only read for `"custom-interval"`. Defaults to 4. */
  intervalSize?: number;
  /**
   * When set (non-empty), ONLY these teams' slots are ever assigned — every
   * other slot in every match is left `scoutUid: null` outright, not
   * "filled if there's capacity." This is what frees up enough slack for
   * breaks when there are only ~4-6 scouts total.
   */
  prioritizedTeams?: number[];
  seed: number;
};

export type ScheduleSlot = {
  matchType: MatchType;
  matchNumber: number;
  slot: SlotId;
  teamNumber: number;
  scoutUid: string | null;
};

export type ScheduleResult = {
  slots: ScheduleSlot[];
  /** Every selected scout's total assigned-slot count, even if 0. */
  counts: Record<string, number>;
  /** `max(counts) - min(counts) <= 1`, the fairness target. */
  fair: boolean;
  /** Set whenever `fair` is false, or there were no scouts/matches to schedule — human-readable, shown as-is in the UI. */
  warning: string | null;
};
