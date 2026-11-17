import { normalizeEventKey } from "@/config/event";
import { ALLIANCE_SIZE } from "@/config/alliance";
import { normalizeCsMatchId } from "@/data/cs/match-id";

// Pure model of `accuracyRescouts/{id}` (CS app/analytics/accuracy-verification): the requests to re-scout a high-accuracy match with an
// experienced scout, and the grouping, accuracy and "critical" rules the Accuracy Verification and Accuracy Compare pages share.

/** Alliance accuracy (percent) a match needs before it is offered for a re-scout. */
export const HIGH_ACCURACY_MIN = 75;
/** A fully re-scouted alliance is compared against the live scouting only when its re-scout accuracy reaches this. */
export const RESCOUT_COMPARE_MIN_ACCURACY = 95;
/** A comparison whose weighted difference is above this percent flags the match as critical. */
export const CRITICAL_DIFF_PERCENT = 5;

export type RescoutAlliance = "red" | "blue";

export type Rescout = {
  id: string;
  teamId: string;
  eventKey: string;
  eventName: string;
  matchKey: string;
  matchLabel: string;
  alliance: RescoutAlliance | null;
  teamNumber: number;
  scoutId: string;
  scoutName: string;
  game: string;
  status: string;
  accuracy: number | null;
  scoutedScore: number | null;
  officialScore: number | null;
  penaltyPoints: number | null;
  comparisonDiffPercent: number | null;
  comparisonComputedAt: number | null;
  criticalFlag: boolean;
  createdAt: number;
  updatedAt: number;
  submittedAt: number;
  practiceSessionId: string;
  originalScouts: string[];
};

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const finite = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** A stored document as a `Rescout` (tolerant: a missing field gets its neutral value; a Firestore timestamp reads as milliseconds). */
export function toRescout(id: string, data: Record<string, unknown>): Rescout {
  const ms = (v: unknown): number => {
    if (v && typeof v === "object" && "toMillis" in v && typeof (v as { toMillis: unknown }).toMillis === "function") return (v as { toMillis: () => number }).toMillis();
    return finite(v) ?? 0;
  };
  const alliance = text(data.alliance).toLowerCase();
  return {
    id,
    teamId: text(data.teamId),
    eventKey: text(data.eventKey),
    eventName: text(data.eventName),
    matchKey: text(data.matchKey),
    matchLabel: text(data.matchLabel),
    alliance: alliance === "red" || alliance === "blue" ? alliance : null,
    teamNumber: finite(data.teamNumber) ?? 0,
    scoutId: text(data.scoutId),
    scoutName: text(data.scoutName),
    game: text(data.game),
    status: text(data.status),
    accuracy: finite(data.accuracy),
    scoutedScore: finite(data.scoutedScore),
    officialScore: finite(data.officialScore),
    penaltyPoints: finite(data.penaltyPoints),
    comparisonDiffPercent: finite(data.comparisonDiffPercent),
    comparisonComputedAt: finite(data.comparisonComputedAt),
    criticalFlag: data.criticalFlag === true,
    createdAt: ms(data.createdAt),
    updatedAt: ms(data.updatedAt),
    submittedAt: ms(data.submittedAt),
    practiceSessionId: text(data.practiceSessionId),
    originalScouts: Array.isArray(data.originalScouts) ? data.originalScouts.filter((s): s is string => typeof s === "string") : [],
  };
}

/** CS: a re-scout counts once it is submitted, has a practice session behind it, or carries a submit time. */
export const isSubmittedRescout = (r: Pick<Rescout, "status" | "practiceSessionId" | "submittedAt">): boolean =>
  r.status.toLowerCase() === "submitted" || r.practiceSessionId !== "" || r.submittedAt > 0;

export const isDeletedRescout = (r: Pick<Rescout, "status">): boolean => r.status.toLowerCase() === "deleted";

const rescoutTime = (r: Pick<Rescout, "submittedAt" | "updatedAt" | "createdAt">): number => r.submittedAt || r.updatedAt || r.createdAt || 0;

/** CS `calculateAccuracy`: whole percent, `1 - |official - scouted| / official`, floored at 0; 0 without an official score. */
export function calculateRescoutAccuracy(scoutedScore: number, officialScore: number): number {
  if (!officialScore) return 0;
  return Math.round(Math.max(0, (1 - Math.abs(officialScore - scoutedScore) / officialScore) * 100));
}

export const rescoutGroupKey = (eventKey: string, matchKey: string, alliance: RescoutAlliance): string =>
  `${normalizeEventKey(String(eventKey || "").trim())}::${normalizeCsMatchId(matchKey)}::${alliance}`;

export type RescoutGroup = {
  key: string;
  eventKey: string;
  matchKey: string;
  alliance: RescoutAlliance;
  /** One submitted re-scout per team (the earliest wins). */
  rescouts: Rescout[];
  teamNumbers: number[];
  officialScore: number | null;
  penaltyPoints: number | null;
  /** Sum of the re-scouted robot scores plus penalty points; set once every robot of the alliance is re-scouted. */
  totalScoutedScore: number | null;
  accuracy: number | null;
  /** Every robot of the alliance has been re-scouted. */
  complete: boolean;
};

/** The submitted re-scouts grouped by event, match and alliance, with the alliance's accuracy once all its robots are done. */
export function groupRescouts(rescouts: readonly Rescout[], allianceSize: number = ALLIANCE_SIZE): Map<string, RescoutGroup> {
  const groups = new Map<string, RescoutGroup>();
  for (const row of rescouts) {
    if (!isSubmittedRescout(row)) continue;
    const alliance: RescoutAlliance = row.alliance === "blue" ? "blue" : "red";
    if (!Number.isFinite(row.teamNumber) || row.teamNumber <= 0) continue;
    const eventKey = normalizeEventKey(row.eventKey);
    const matchKey = normalizeCsMatchId(row.matchKey);
    if (!eventKey || !matchKey) continue;
    const key = `${eventKey}::${matchKey}::${alliance}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, eventKey, matchKey, alliance, rescouts: [], teamNumbers: [], officialScore: null, penaltyPoints: null, totalScoutedScore: null, accuracy: null, complete: false };
      groups.set(key, group);
    }
    const existing = group.rescouts.find((r) => r.teamNumber === row.teamNumber);
    if (existing) {
      const t0 = rescoutTime(existing);
      const t1 = rescoutTime(row);
      if (t1 > 0 && (t0 === 0 || t1 < t0)) group.rescouts = [...group.rescouts.filter((r) => r.teamNumber !== row.teamNumber), row];
    } else {
      group.rescouts.push(row);
      group.teamNumbers.push(row.teamNumber);
    }
    if (row.officialScore !== null) group.officialScore = Math.max(group.officialScore ?? 0, row.officialScore);
    if (row.penaltyPoints !== null) group.penaltyPoints = Math.max(group.penaltyPoints ?? 0, row.penaltyPoints);
  }

  for (const group of groups.values()) {
    group.complete = group.teamNumbers.length >= allianceSize;
    if (!group.complete) continue;
    const scouted = group.rescouts.reduce((sum, r) => sum + (r.scoutedScore ?? 0), 0);
    group.totalScoutedScore = scouted + (group.penaltyPoints ?? 0);
    if (group.officialScore) group.accuracy = calculateRescoutAccuracy(group.totalScoutedScore, group.officialScore);
  }
  return groups;
}

/** A group's comparison with the live scouting: the mean weighted difference (percent, one decimal) over its robots. */
export type GroupComparison = { diffPercent: number };

export type RescoutPatch = { id: string; patch: Partial<Pick<Rescout, "accuracy" | "criticalFlag" | "comparisonDiffPercent" | "comparisonComputedAt">> };

/**
 * The writes CS makes back to the re-scout documents: each complete group's accuracy on every row, and, for groups at or above
 * `RESCOUT_COMPARE_MIN_ACCURACY` with a comparison, the critical flag and difference (critical when the difference is above
 * `CRITICAL_DIFF_PERCENT`). Below that accuracy any critical flag is cleared. Only rows that differ from the stored values are returned.
 */
export function planRescoutUpdates(groups: Iterable<RescoutGroup>, comparisons: ReadonlyMap<string, GroupComparison>, now: number): RescoutPatch[] {
  const patches: RescoutPatch[] = [];
  for (const group of groups) {
    if (!group.complete) continue;
    for (const row of group.rescouts) {
      if (row.accuracy !== group.accuracy) patches.push({ id: row.id, patch: { accuracy: group.accuracy } });
    }
    if ((group.accuracy ?? 0) < RESCOUT_COMPARE_MIN_ACCURACY) {
      for (const row of group.rescouts) if (row.criticalFlag) patches.push({ id: row.id, patch: { criticalFlag: false } });
      continue;
    }
    const comparison = comparisons.get(group.key);
    if (!comparison) continue;
    const critical = comparison.diffPercent > CRITICAL_DIFF_PERCENT;
    for (const row of group.rescouts) {
      if (row.criticalFlag !== critical || row.comparisonDiffPercent === null) {
        patches.push({ id: row.id, patch: { criticalFlag: critical, comparisonDiffPercent: comparison.diffPercent, comparisonComputedAt: now } });
      }
    }
  }
  return patches;
}

/** `event::match::team` of every robot that already has a submitted re-scout, except robots of a complete group below the compare accuracy (those may be re-scouted again). */
export function rescoutedTeamKeys(rescouts: readonly Rescout[], groups: Iterable<RescoutGroup>): Set<string> {
  const keys = new Set<string>();
  for (const row of rescouts) {
    if (!isSubmittedRescout(row) || row.teamNumber <= 0) continue;
    const eventKey = normalizeEventKey(row.eventKey);
    const matchKey = normalizeCsMatchId(row.matchKey);
    if (eventKey && matchKey) keys.add(`${eventKey}::${matchKey}::${row.teamNumber}`);
  }
  for (const group of groups) {
    if (!group.complete || (group.accuracy ?? 0) >= RESCOUT_COMPARE_MIN_ACCURACY) continue;
    for (const team of group.teamNumbers) keys.delete(`${group.eventKey}::${group.matchKey}::${team}`);
  }
  return keys;
}
