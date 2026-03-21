import {
  classifyRebuiltEventByTimestampWithOptions,
  normalizeMatchLabel,
  type AnalyticsEventOption,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";

type EntryLike = {
  teamNumber?: string;
  matchId?: string;
  matchKey?: string;
  matchLabel?: string;
  matchNumber?: string | number;
  matchType?: string;
  eventKey?: string;
  eventName?: string;
  submittedAt?: number;
  timestamp?: number;
  createdAt?: number;
};

function normalizeTeamNumber(value: unknown) {
  return String(value || "").replace(/[^\d]/g, "");
}

export function entryTimeForDedup(entry: EntryLike): number {
  const submitted = Number(entry.submittedAt ?? 0);
  if (Number.isFinite(submitted) && submitted > 0) return submitted;
  const timestamp = Number(entry.timestamp ?? 0);
  if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
  const created = Number(entry.createdAt ?? 0);
  if (Number.isFinite(created) && created > 0) return created;
  return 0;
}

export function entryMatchKeyForDedup(entry: EntryLike): string {
  const direct = String(entry.matchId || entry.matchKey || "").trim().toLowerCase();
  if (direct) return direct;

  const label = String(entry.matchLabel || "").trim();
  if (label) {
    const parsed = normalizeMatchLabel(label);
    return parsed.matchId || `${parsed.matchType}-${parsed.matchNumber}`;
  }

  const matchType = String(entry.matchType || "").trim().toLowerCase();
  const matchNumber = String(entry.matchNumber || "").replace(/[^\d]/g, "");
  if (matchType && matchNumber) {
    const prefix = matchType.startsWith("p") ? "p" : matchType.startsWith("f") ? "f" : "q";
    return `${prefix}${matchNumber}`;
  }
  if (matchNumber) return `q${matchNumber}`;
  return "";
}

export function entryEventKeyForDedup(
  entry: EntryLike,
  game: AnalyticsGame,
  eventOptions: AnalyticsEventOption[],
  selectedEvent?: string
): string {
  let eventKey = String(entry.eventKey || "").trim().toLowerCase();
  if (!eventKey && game === "REBUILT") {
    const ts = Number(entry.submittedAt ?? entry.timestamp ?? entry.createdAt ?? 0);
    if (Number.isFinite(ts) && ts > 0) {
      eventKey = classifyRebuiltEventByTimestampWithOptions(ts, eventOptions);
    }
  }
  if (!eventKey) {
    eventKey = String(entry.eventName || "").trim().toLowerCase();
  }
  if (!eventKey && selectedEvent && selectedEvent !== "all") {
    eventKey = String(selectedEvent).trim().toLowerCase();
  }
  return eventKey || "unknown";
}

export function dedupeEntriesByMatchTeam<T extends EntryLike>(
  entries: T[],
  options: {
    game: AnalyticsGame;
    eventOptions: AnalyticsEventOption[];
    selectedEvent?: string;
    preferLatest?: boolean;
  }
): T[] {
  const { game, eventOptions, selectedEvent, preferLatest = true } = options;
  const byKey = new Map<string, { entry: T; time: number; order: number }>();

  entries.forEach((entry, index) => {
    const team = normalizeTeamNumber(entry.teamNumber);
    if (!team) return;
    const matchKey = entryMatchKeyForDedup(entry);
    const eventKey = entryEventKeyForDedup(entry, game, eventOptions, selectedEvent);
    const time = entryTimeForDedup(entry);
    const key = matchKey ? `${eventKey}::${matchKey}::${team}` : `${eventKey}::${team}::${index}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { entry, time, order: index });
      return;
    }
    if (preferLatest) {
      if (time > existing.time || (time === existing.time && index > existing.order)) {
        byKey.set(key, { entry, time, order: index });
      }
      return;
    }
    if (time < existing.time || (time === existing.time && index < existing.order)) {
      byKey.set(key, { entry, time, order: index });
    }
  });

  return Array.from(byKey.values())
    .sort((a, b) => a.order - b.order)
    .map((row) => row.entry);
}
