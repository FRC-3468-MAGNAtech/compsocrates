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
  { id: "rocket-city", name: "Rocket City Regional", startDate: "2025-03-18", endDate: "2025-03-21" },
  { id: "bayou-reefscape", name: "Bayou Regional", startDate: "2025-04-01", endDate: "2025-04-04" },
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
  const number = (value.match(/\d+/)?.[0] || "1").replace(/^0+/, "") || "1";

  if (value.startsWith("p") || value.includes("practice")) {
    return { matchType: "practice", matchNumber: number, matchId: `p${number}` };
  }
  if (value.startsWith("f") || value.includes("final")) {
    return { matchType: "finals", matchNumber: number, matchId: `f${number}` };
  }
  if (value.startsWith("q") || value.includes("qual")) {
    return { matchType: "qualification", matchNumber: number, matchId: `q${number}` };
  }

  return { matchType: "qualification", matchNumber: number, matchId: `q${number}` };
}

type EventLikeEntry = {
  eventKey?: string;
  submittedAt?: number;
  timestamp?: number;
  game?: string;
};

export function entryMatchesAnalyticsFilters(
  entry: EventLikeEntry,
  game: AnalyticsGame,
  eventId: string
): boolean {
  if ((entry.game || "REBUILT") !== game) return false;
  if (eventId === "all") return true;

  const eventKey = entry.eventKey || classifyRebuiltEventByTimestamp(entry.submittedAt || entry.timestamp || 0);
  if (eventId === "app-testing") return eventKey === "app-testing";
  return eventKey === eventId;
}
