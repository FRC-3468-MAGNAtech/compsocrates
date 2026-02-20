import { APP_EVENTS } from "@/app/utils/events";

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
  game: AnalyticsGame
): AnalyticsEventOption[] {
  if (game === "REEFSCAPE") {
    return LEGACY_REEFSCAPE_EVENTS;
  }

  const base = getEventsForGame(game);
  const byId = new Map<string, AnalyticsEventOption>(base.map((event) => [event.id, event]));

  entries.forEach((entry) => {
    const entryGame = (entry.game || "REEFSCAPE") as AnalyticsGame;
    if (entryGame !== game) return;
    const key = String(entry.eventKey || "").trim();
    if (!key) return;
    if (byId.has(key)) return;
    byId.set(key, {
      id: key,
      key,
      name: String(entry.eventName || key),
    });
  });

  return Array.from(byId.values()).sort((a, b) => {
    if (a.id === "app-testing") return 1;
    if (b.id === "app-testing") return -1;
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
  const rebuiltEvents = getEventsForGame("REBUILT");
  for (const event of rebuiltEvents) {
    if (event.id === "app-testing") continue;
    if (isInEventWindow(timestamp, event.startDate, event.endDate)) return event.id;
  }
  return "app-testing";
}

export function normalizeMatchLabel(rawMatch: string): { matchType: "practice" | "qualification" | "finals"; matchNumber: string; matchId: string } {
  const value = (rawMatch || "").trim().toLowerCase();
  const compact = value.replace(/[^a-z0-9]/g, "");
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
  if (isPracticeLabel) return { matchType: "practice", matchNumber: number, matchId: `p${number}` };
  if (isFinalsLabel) return { matchType: "finals", matchNumber: number, matchId: `f${number}` };
  if (isQualificationLabel) return { matchType: "qualification", matchNumber: number, matchId: `q${number}` };
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

export function isPracticeScoutedEntry(entry: PracticeScoutedLike): boolean {
  return Boolean(entry.isPracticeScouting) || Boolean(entry.practiceMode) || Boolean(entry.practiceSessionId);
}

export function entryMatchesAnalyticsFilters(
  entry: EventLikeEntry,
  game: AnalyticsGame,
  eventId: string
): boolean {
  if ((entry.game || "REEFSCAPE") !== game) return false;
  if (eventId === "all") return true;

  const eventKey = entry.eventKey || classifyRebuiltEventByTimestamp(entry.submittedAt || entry.timestamp || 0);
  if (eventId === "app-testing") return eventKey === "app-testing";
  return eventKey === eventId;
}
