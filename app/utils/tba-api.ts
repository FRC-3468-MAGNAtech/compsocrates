// TBA (The Blue Alliance) API Integration
// This file provides functions to fetch real FRC event data

import { normalizeEventKey } from "@/app/utils/events";

const TBA_BASE_URL = "https://www.thebluealliance.com/api/v3";
const TBA_API_KEY = process.env.NEXT_PUBLIC_TBA_API_KEY || ""; // Fallback key from .env.local

// Types
export interface TBAEvent {
  key: string;
  name: string;
  event_code: string;
  event_type: number;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  year: number;
  city: string;
  state_prov: string;
  country: string;
  week: number;
}

export interface TBATeam {
  key: string; // e.g., "frc1234"
  team_number: number;
  nickname: string;
  name: string;
  city: string;
  state_prov: string;
  country: string;
}

export interface TBAMatch {
  key: string;
  comp_level: "pr" | "qm" | "ef" | "qf" | "sf" | "f"; // practice, qualification, eighths, quarters, semis, finals
  set_number: number;
  match_number: number;
  videos?: Array<{
    type: string;
    key: string;
  }>;
  alliances: {
    red: {
      team_keys: string[]; // ["frc1234", "frc5678", "frc9012"]
      score: number;
    };
    blue: {
      team_keys: string[]; // ["frc1234", "frc5678", "frc9012"]
      score: number;
    };
  };
  time: number; // Unix timestamp
  predicted_time: number;
  actual_time: number;
  post_result_time?: number;
  winning_alliance?: "red" | "blue" | "";
  score_breakdown?: Record<string, { foulPoints?: number }>;
}

// Helper to make TBA API calls
async function tbaFetch(endpoint: string, apiKey?: string) {
  const resolvedApiKey = apiKey || TBA_API_KEY;
  if (!resolvedApiKey) {
    throw new Error("TBA API key not configured");
  }

  const response = await fetch(`${TBA_BASE_URL}${endpoint}`, {
    headers: {
      "X-TBA-Auth-Key": resolvedApiKey,
    },
    cache: "no-store", // Always get fresh data
  });

  if (!response.ok) {
    throw new Error(`TBA API error: ${response.statusText}`);
  }

  return response.json();
}

// Get all events for a specific year
export async function getEventsByYear(year: number, apiKey?: string): Promise<TBAEvent[]> {
  return tbaFetch(`/events/${year}`, apiKey);
}

// Get a specific event by key (e.g., "2026arli" for 2026 Arkansas Regional at Little Rock)
export async function getEvent(eventKey: string, apiKey?: string): Promise<TBAEvent> {
  const safeKey = normalizeEventKey(eventKey);
  return tbaFetch(`/event/${safeKey}`, apiKey);
}

// Get all teams at an event
export async function getEventTeams(eventKey: string, apiKey?: string): Promise<TBATeam[]> {
  const safeKey = normalizeEventKey(eventKey);
  return tbaFetch(`/event/${safeKey}/teams`, apiKey);
}

// Get all matches at an event
export async function getEventMatches(eventKey: string, apiKey?: string): Promise<TBAMatch[]> {
  const safeKey = normalizeEventKey(eventKey);
  return tbaFetch(`/event/${safeKey}/matches`, apiKey);
}

// Get team info
export async function getTeam(teamNumber: number, apiKey?: string): Promise<TBATeam> {
  return tbaFetch(`/team/frc${teamNumber}`, apiKey);
}

// Get events a team is attending this year
export async function getTeamEvents(teamNumber: number, year: number, apiKey?: string): Promise<TBAEvent[]> {
  return tbaFetch(`/team/frc${teamNumber}/events/${year}`, apiKey);
}

// Helper: Format match type for display
export function formatMatchType(compLevel: string, setNumber: number, matchNumber: number): string {
  const types: Record<string, string> = {
    qm: "Qualification",
    ef: "Octofinals",
    qf: "Quarterfinals",
    sf: "Semifinals",
    f: "Finals",
  };

  let typeLabel = types[compLevel] || "Match";
  if (compLevel === "sf") {
    const upperSlots = new Set([1, 2, 3, 4, 7, 8, 11]);
    const lowerSlots = new Set([5, 6, 9, 10, 12, 13]);
    if (upperSlots.has(setNumber)) {
      typeLabel = "Upper Semifinals";
    } else if (lowerSlots.has(setNumber)) {
      typeLabel = "Lower Semifinals";
    }
  }
  
  if (compLevel === "qm") {
    return `${typeLabel} ${matchNumber}`;
  } else {
    return `${typeLabel} ${setNumber} Match ${matchNumber}`;
  }
}

// Helper: Get days until event
export function getDaysUntilEvent(startDate: string): number {
  const now = new Date();
  const start = new Date(startDate);
  const diff = start.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// Helper: Check if event is happening now
export function isEventActive(startDate: string, endDate: string): boolean {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate + "T23:59:59"); // End of end date
  return now >= start && now <= end;
}

// Helper: Extract team numbers from alliance
export function getTeamNumbers(teamKeys: string[]): number[] {
  return teamKeys.map(key => parseInt(key.replace("frc", "")));
}

// Search for events by state/region (client-side filter)
export function filterEventsByLocation(events: TBAEvent[], searchTerm: string): TBAEvent[] {
  const term = searchTerm.toLowerCase();
  return events.filter(event => 
    event.city.toLowerCase().includes(term) ||
    event.state_prov.toLowerCase().includes(term) ||
    event.name.toLowerCase().includes(term)
  );
}

// Example usage:
// const events = await getEventsByYear(2026);
// const arkansasEvent = events.find(e => e.state_prov === "AR");
// const teams = await getEventTeams(arkansasEvent.key);
// const matches = await getEventMatches(arkansasEvent.key);
