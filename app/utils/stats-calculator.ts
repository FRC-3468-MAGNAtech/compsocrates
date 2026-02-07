// Utility functions to calculate real statistics from Firebase data
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";

export interface TeamStats {
  totalEntries: number;
  activeScouts: number;
  averageAccuracy: number;
  entriesByEvent: Record<string, number>;
  entriesByScout: Record<string, number>;
  recentActivity: Activity[];
}

export interface Activity {
  id: string;
  type: "scouting" | "practice" | "team_join";
  scoutName?: string;
  teamNumber?: string;
  matchNumber?: string;
  accuracy?: number;
  timestamp: number;
}

export interface UpcomingEvent {
  name: string;
  location: string;
  startDate: string;
  endDate: string;
  daysUntil: number;
  key: string; // TBA event key
}

// Get all scouting entries for a team
export async function getTeamEntries(teamId: string) {
  // First get all team members
  const usersQuery = query(collection(db, "users"), where("teamId", "==", teamId));
  const usersSnapshot = await getDocs(usersQuery);
  const scoutNames = usersSnapshot.docs.map(doc => doc.data().displayName);

  // Get all scouting entries by team scouts
  const allEntries: any[] = [];
  for (const scoutName of scoutNames) {
    const entriesQuery = query(collection(db, "scouting"), where("scoutName", "==", scoutName));
    const entriesSnapshot = await getDocs(entriesQuery);
    allEntries.push(...entriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  }

  return allEntries;
}

// Calculate comprehensive team stats
export async function calculateTeamStats(teamId: string): Promise<TeamStats> {
  const entries = await getTeamEntries(teamId);
  
  // Get team members
  const usersQuery = query(collection(db, "users"), where("teamId", "==", teamId));
  const usersSnapshot = await getDocs(usersQuery);
  const scouts = usersSnapshot.docs.filter(doc => doc.data().role === "scout");

  // Get practice sessions (in real app would be separate collection)
  // For now, using mock data
  const mockPracticeSessions = scouts.map(scout => ({
    scoutName: scout.data().displayName,
    sessionsCompleted: Math.floor(Math.random() * 10) + 5,
    averageAccuracy: Math.floor(Math.random() * 10) + 90,
  }));

  const totalAccuracy = mockPracticeSessions.reduce((sum, s) => sum + s.averageAccuracy, 0);
  const avgAccuracy = mockPracticeSessions.length > 0 ? Math.round(totalAccuracy / mockPracticeSessions.length) : 0;

  // Count entries by event (based on submittedAt timestamp)
  const entriesByEvent: Record<string, number> = {};
  entries.forEach(entry => {
    const event = "Current Event"; // In real app, would map timestamp to event
    entriesByEvent[event] = (entriesByEvent[event] || 0) + 1;
  });

  // Count entries by scout
  const entriesByScout: Record<string, number> = {};
  entries.forEach(entry => {
    const scout = entry.scoutName || "Unknown";
    entriesByScout[scout] = (entriesByScout[scout] || 0) + 1;
  });

  // Get recent activity
  const recentEntries = entries
    .sort((a, b) => (b.submittedAt || b.timestamp) - (a.submittedAt || a.timestamp))
    .slice(0, 5)
    .map(entry => ({
      id: entry.id,
      type: "scouting" as const,
      scoutName: entry.scoutName,
      teamNumber: entry.teamNumber,
      matchNumber: entry.matchNumber,
      timestamp: entry.submittedAt || entry.timestamp,
    }));

  return {
    totalEntries: entries.length,
    activeScouts: scouts.length,
    averageAccuracy: avgAccuracy,
    entriesByEvent,
    entriesByScout,
    recentActivity: recentEntries,
  };
}

// Get upcoming events - ONLY Arkansas and Bayou Regional
export async function getUpcomingEvents(): Promise<UpcomingEvent[]> {
  const now = new Date();
  
  const events = [
    {
      name: "Arkansas Regional",
      location: "Little Rock, AR",
      startDate: "2026-03-14",
      endDate: "2026-03-17",
      key: "2026arli"
    },
    {
      name: "Bayou Regional",
      location: "Kenner, LA",
      startDate: "2026-03-26",
      endDate: "2026-03-29",
      key: "2026labr"
    }
  ];

  return events.map(event => {
    const startDate = new Date(event.startDate);
    const daysUntil = Math.ceil((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    return {
      ...event,
      daysUntil: Math.max(0, daysUntil)
    };
  }).filter(event => event.daysUntil >= 0); // Only show upcoming/current events
}

// Get single upcoming event (for scout dashboard - shows next event)
export async function getUpcomingEvent(): Promise<UpcomingEvent | null> {
  const events = await getUpcomingEvents();
  // Return the event with the smallest daysUntil (soonest)
  return events.sort((a, b) => a.daysUntil - b.daysUntil)[0] || null;
}

// Get scout-specific stats
export async function getScoutStats(scoutName: string) {
  const entriesQuery = query(collection(db, "scouting"), where("scoutName", "==", scoutName));
  const entriesSnapshot = await getDocs(entriesQuery);
  const entries = entriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // Mock practice data
  const practiceSessionsCompleted = Math.floor(Math.random() * 10) + 5;
  const averageAccuracy = Math.floor(Math.random() * 10) + 90;

  return {
    totalEntries: entries.length,
    practiceSessionsCompleted,
    averageAccuracy,
    recentEntries: entries.slice(0, 5),
  };
}

// Get team name from team document
export async function getTeamName(teamId: string): Promise<string> {
  try {
    const teamDoc = await getDoc(doc(db, "teams", teamId));
    if (teamDoc.exists()) {
      return teamDoc.data().teamName || `Team ${teamId}`;
    }
    return `Team ${teamId}`;
  } catch (error) {
    console.error("Error fetching team name:", error);
    return `Team ${teamId}`;
  }
}

// Format recent activity for display
export function formatActivity(activity: Activity): string {
  switch (activity.type) {
    case "scouting":
      return `${activity.scoutName} scouted Team ${activity.teamNumber} in Match ${activity.matchNumber}`;
    case "practice":
      return `${activity.scoutName} completed practice session (${activity.accuracy}% accuracy)`;
    case "team_join":
      return `${activity.scoutName} joined the team`;
    default:
      return "Unknown activity";
  }
}

// Calculate days until event
export function getDaysUntilEvent(eventDate: string): number {
  const event = new Date(eventDate);
  const now = new Date();
  const diff = event.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}