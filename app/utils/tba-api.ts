// TBA (The Blue Alliance) API Integration
// This file provides functions to fetch real FRC event data

const TBA_BASE_URL = "https://www.thebluealliance.com/api/v3";
const TBA_API_KEY = process.env.NEXT_PUBLIC_TBA_API_KEY || ""; // Add your key to .env.local

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
  comp_level: "qm" | "ef" | "qf" | "sf" | "f"; // qualification, eighths, quarters, semis, finals
  set_number: number;
  match_number: number;
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
}

// Helper to make TBA API calls
async function tbaFetch(endpoint: string) {
  const response = await fetch(`${TBA_BASE_URL}${endpoint}`, {
    headers: {
      "X-TBA-Auth-Key": TBA_API_KEY,
    },
    cache: "no-store", // Always get fresh data
  });

  if (!response.ok) {
    throw new Error(`TBA API error: ${response.statusText}`);
  }

  return response.json();
}

// Get all events for a specific year
export async function getEventsByYear(year: number): Promise<TBAEvent[]> {
  return tbaFetch(`/events/${year}`);
}

// Get a specific event by key (e.g., "2026arli" for 2026 Arkansas Regional at Little Rock)
export async function getEvent(eventKey: string): Promise<TBAEvent> {
  return tbaFetch(`/event/${eventKey}`);
}

// Get all teams at an event
export async function getEventTeams(eventKey: string): Promise<TBATeam[]> {
  return tbaFetch(`/event/${eventKey}/teams`);
}

// Get all matches at an event
export async function getEventMatches(eventKey: string): Promise<TBAMatch[]> {
  return tbaFetch(`/event/${eventKey}/matches`);
}

// Get team info
export async function getTeam(teamNumber: number): Promise<TBATeam> {
  return tbaFetch(`/team/frc${teamNumber}`);
}

// Get events a team is attending this year
export async function getTeamEvents(teamNumber: number, year: number): Promise<TBAEvent[]> {
  return tbaFetch(`/team/frc${teamNumber}/events/${year}`);
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

  const typeLabel = types[compLevel] || "Match";
  
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