import { APP_EVENT_BY_KEY, APP_EVENTS, normalizeEventKey } from "@/app/utils/events";

export type AnalyticsGame = "REEFSCAPE" | "REBUILT";

export type AnalyticsEventOption = {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  key?: string;
};

const LEGACY_REEFSCAPE_EVENTS: AnalyticsEventOption[] = [
  { id: "2025alhu", key: "2025alhu", name: "Rocket City Regional", startDate: "2025-03-18", endDate: "2025-03-21" },
  { id: "2025lake", key: "2025lake", name: "Bayou Regional", startDate: "2025-04-01", endDate: "2025-04-04" },
  { id: "app-testing", name: "App Testing" },
];

const REBUILT_EVENTS: AnalyticsEventOption[] = [
  ...APP_EVENTS.map((event) => ({
    id: event.key,
    key: event.key,
    name: event.name,
    startDate: event.startDate,
    endDate: event.endDate,
  })),
  { id: "app-testing", name: "App Testing" },
];

export function getEventsForGame(game: AnalyticsGame): AnalyticsEventOption[] {
  return game === "REBUILT" ? REBUILT_EVENTS : LEGACY_REEFSCAPE_EVENTS;
}

type AnalyticsEntryLike = {
  eventKey?: string;
  eventName?: string;
  game?: string;
};

export function getEventOptionsForEntries(
  entries: AnalyticsEntryLike[],
  game: AnalyticsGame,
  extraEvents: AnalyticsEventOption[] = []
): AnalyticsEventOption[] {
  if (game === "REEFSCAPE") {
    return LEGACY_REEFSCAPE_EVENTS;
  }

  const base = getEventsForGame(game);
  const byId = new Map<string, AnalyticsEventOption>(
    base.map((event) => [normalizeEventKey(event.id), { ...event, id: normalizeEventKey(event.id) }])
  );
  extraEvents.forEach((event) => {
    const id = normalizeEventKey(String(event.id || "").trim());
    if (!id || byId.has(id)) return;
    byId.set(id, { ...event, id });
  });

  entries.forEach((entry) => {
    const entryGame = (entry.game || "REEFSCAPE") as AnalyticsGame;
    if (entryGame !== game) return;
    const key = normalizeEventKey(String(entry.eventKey || "").trim());
    if (!key) return;
    if (byId.has(key)) return;
    const known = APP_EVENT_BY_KEY[key];
    byId.set(key, {
      id: key,
      key,
      name: known?.name || String(entry.eventName || key),
      startDate: known?.startDate,
      endDate: known?.endDate,
    });
  });

  return Array.from(byId.values()).sort((a, b) => {
    if (a.id === "app-testing") return 1;
    if (b.id === "app-testing") return -1;
    if (a.startDate && b.startDate) {
      const aTime = new Date(`${a.startDate}T12:00:00`).getTime();
      const bTime = new Date(`${b.startDate}T12:00:00`).getTime();
      if (aTime !== bTime) return aTime - bTime;
    }
    if (a.startDate && !b.startDate) return -1;
    if (!a.startDate && b.startDate) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function isInEventWindow(timestamp: number, startDate?: string, endDate?: string): boolean {
  if (!startDate || !endDate || !timestamp) return false;
  const time = new Date(timestamp);
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59`);
  return time >= start && time <= end;
}

export function classifyRebuiltEventByTimestamp(timestamp: number): string {
  return classifyRebuiltEventByTimestampWithOptions(timestamp, getEventsForGame("REBUILT"));
}

export function classifyRebuiltEventByTimestampWithOptions(
  timestamp: number,
  options: AnalyticsEventOption[]
): string {
  const rebuiltEvents = options;
  for (const event of rebuiltEvents) {
    if (event.id === "app-testing") continue;
    if (isInEventWindow(timestamp, event.startDate, event.endDate)) return event.id;
  }
  return "app-testing";
}

export function normalizeMatchLabel(rawMatch: string): { matchType: "practice" | "qualification" | "finals"; matchNumber: string; matchId: string } {
  const rawValue = (rawMatch || "").trim();
  let normalized = rawValue;
  if (normalized.includes("_")) {
    const suffix = normalized.split("_").pop() || "";
    if (suffix && /[a-z]/i.test(suffix)) {
      normalized = suffix;
    }
  }
  const value = normalized.toLowerCase();
  const compact = value.replace(/[^a-z0-9]/g, "");
  const semiMatch =
    value.match(/\b(?:sf|semifinal|semi-final)\s*#?\s*(\d+)(?:\s*[-m]\s*(\d+))?/i) ||
    compact.match(/^(sf)(\d+)(?:m(\d+))?/i);
  const quarterMatch =
    value.match(/\b(?:qf|quarterfinal|quarter-final|ef|octofinal|octo-final)\s*#?\s*(\d+)(?:\s*[-m]\s*(\d+))?/i) ||
    compact.match(/^(qf|ef)(\d+)(?:m(\d+))?/i);
  const finalMatch =
    value.match(/\b(?:finals?|f)\s*#?\s*(\d+)(?:\s*[-m]\s*(\d+))?/i) ||
    compact.match(/^(f)(\d+)(?:m(\d+))?/i);
  const explicitMatchNumber =
    value.match(/\b(?:match|mtch|matc?h|march|marltch)\s*#?\s*(\d+)\b/)?.[1] ||
    value.match(/\bm\s*#?\s*(\d+)\b/)?.[1];
  const roundThenMatchNumber = value.match(/\bround\s*\d+\D+(\d+)\b/)?.[1];
  const allNumbers = value.match(/\d+/g) || [];
  const matchNumberFromLabel =
    explicitMatchNumber ||
    roundThenMatchNumber ||
    (allNumbers.length > 1 && value.includes("round") ? allNumbers[allNumbers.length - 1] : undefined) ||
    value.match(/\d+/)?.[0] ||
    "1";
  const number = matchNumberFromLabel.replace(/^0+/, "") || "1";

  const isPracticeLabel =
    value.includes("practice") ||
    /pract|prct|pratc|prac|warmup|test/i.test(compact) ||
    /^p[\s#-]*\d+/i.test(value) ||
    /^p\d+/i.test(compact);
  if (semiMatch) {
    const isCompact = semiMatch[1] === "sf";
    const setNumber = (isCompact ? semiMatch[2] : semiMatch[1]) || "1";
    const matchNumber = (isCompact ? semiMatch[3] : semiMatch[2]) || "1";
    return { matchType: "finals", matchNumber: setNumber, matchId: `sf${setNumber}m${matchNumber}` };
  }

  if (quarterMatch) {
    const prefix = String(quarterMatch[1] || "qf").toLowerCase();
    const isCompact = prefix === "qf" || prefix === "ef";
    const setNumber = (isCompact ? quarterMatch[2] : quarterMatch[1]) || "1";
    const matchNumber = (isCompact ? quarterMatch[3] : quarterMatch[2]) || "1";
    return { matchType: "finals", matchNumber: setNumber, matchId: `${prefix}${setNumber}m${matchNumber}` };
  }

  if (finalMatch) {
    const isCompact = finalMatch[1] === "f";
    const setNumber = (isCompact ? finalMatch[2] : finalMatch[1]) || "1";
    const matchNumber = (isCompact ? finalMatch[3] : finalMatch[2]) || "";
    const matchId = matchNumber ? `f${setNumber}m${matchNumber}` : `f${setNumber}`;
    return { matchType: "finals", matchNumber: setNumber, matchId };
  }

  const isFinalsLabel =
    value.startsWith("f") ||
    value.includes("final") ||
    value.includes("playoff") ||
    value.includes("elim") ||
    value.includes("bracket") ||
    /\bupper\b/.test(value) ||
    /\blower\b/.test(value) ||
    /\bub\b/.test(value) ||
    /\blb\b/.test(value) ||
    /fnl|fnls|playof|braket|bracke|upper|uppr|lower|lowr|elim/i.test(compact);
  const isQualificationLabel =
    value.startsWith("q") ||
    value.includes("qual") ||
    /\bqm\b/.test(value) ||
    /qual|qm|quali|qul|qulification/i.test(compact);
  const isGenericMatchLabel = /^match\b/i.test(value) || compact.startsWith("match");
  if (isPracticeLabel) return { matchType: "practice", matchNumber: number, matchId: `p${number}` };
  if (isFinalsLabel) return { matchType: "finals", matchNumber: number, matchId: `f${number}` };
  if (isQualificationLabel) return { matchType: "qualification", matchNumber: number, matchId: `q${number}` };
  if (isGenericMatchLabel) return { matchType: "finals", matchNumber: number, matchId: `sf${number}` };
  return { matchType: "qualification", matchNumber: number, matchId: `q${number}` };
}

export function getExplicitMatchTypeFromLabel(rawMatch: string): "practice" | "qualification" | "finals" | null {
  const value = (rawMatch || "").trim().toLowerCase();
  if (!value) return null;
  const compact = value.replace(/[^a-z0-9]/g, "");

  const isPracticeLabel =
    value.includes("practice") ||
    /pract|prct|pratc|prac|warmup|test/i.test(compact) ||
    /^p[\s#-]*\d+/i.test(value) ||
    /^p\d+/i.test(compact);
  if (isPracticeLabel) return "practice";

  const isFinalsLabel =
    value.startsWith("f") ||
    value.includes("final") ||
    value.includes("playoff") ||
    value.includes("elim") ||
    value.includes("bracket") ||
    /\bupper\b/.test(value) ||
    /\blower\b/.test(value) ||
    /\bub\b/.test(value) ||
    /\blb\b/.test(value) ||
    /fnl|fnls|playof|braket|bracke|upper|uppr|lower|lowr|elim/i.test(compact);
  if (isFinalsLabel) return "finals";

  const isQualificationLabel =
    value.startsWith("q") ||
    value.includes("qual") ||
    /\bqm\b/.test(value) ||
    /qual|qm|quali|qul|qulification/i.test(compact);
  if (isQualificationLabel) return "qualification";

  return null;
}

type EventLikeEntry = {
  eventKey?: string;
  submittedAt?: number;
  timestamp?: number;
  game?: string;
};

type PracticeScoutedLike = {
  isPracticeScouting?: boolean;
  practiceMode?: string;
  practiceSessionId?: string;
};

type LeadScoutedLike = {
  entryType?: string;
  formType?: string;
  isLeadScouting?: boolean;
};

export function isSubInRequestEntry(entry: { entryType?: string; formType?: string }): boolean {
  const type = String(entry.entryType || entry.formType || "").toLowerCase().trim();
  return type === "sub-in-request" || type === "sub-in-claim" || type === "sub-in";
}

export function isPracticeScoutedEntry(entry: PracticeScoutedLike): boolean {
  return Boolean(entry.isPracticeScouting) || Boolean(entry.practiceMode) || Boolean(entry.practiceSessionId);
}

export function isPracticeMatchEntry(entry: {
  matchType?: string;
  matchLabel?: string;
  matchId?: string;
  matchKey?: string;
}): boolean {
  const matchType = String(entry.matchType || "").toLowerCase().trim();
  if (matchType === "practice") return true;
  const labels = [entry.matchLabel, entry.matchId, entry.matchKey].map((value) => String(value || ""));
  return labels.some((value) => getExplicitMatchTypeFromLabel(value) === "practice");
}

export function isLeadScoutingEntry(entry: LeadScoutedLike): boolean {
  if (Boolean(entry.isLeadScouting)) return true;
  const type = String(entry.entryType || entry.formType || "").toLowerCase().trim();
  return type === "lead" || type === "lead-scout" || type === "lead-scouting";
}

export function entryMatchesAnalyticsFilters(
  entry: EventLikeEntry,
  game: AnalyticsGame,
  eventId: string,
  eventOptions: AnalyticsEventOption[] = getEventsForGame(game),
  options?: { includeLead?: boolean }
): boolean {
  if (isSubInRequestEntry(entry as LeadScoutedLike)) return false;
  if (!options?.includeLead && isLeadScoutingEntry(entry as LeadScoutedLike)) return false;
  if ((entry.game || "REEFSCAPE") !== game) return false;
  if (eventId === "all") return true;

  const eventKey =
    entry.eventKey ||
    classifyRebuiltEventByTimestampWithOptions(entry.submittedAt || entry.timestamp || 0, eventOptions);
  const normalizedEventKey = normalizeEventKey(String(eventKey || ""));
  if (eventId === "app-testing") return normalizedEventKey === "app-testing";
  return normalizedEventKey === normalizeEventKey(eventId);
}
