// Utility functions to calculate real statistics from Firebase data
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import { EVENTS, getCurrentEvent } from "./eventDates";

export interface TeamStats {
  totalEntries: number;
  activeScouts: number;
  totalScouts: number;
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

// Get all scouting entries for a team
export async function getTeamEntries(teamId: string) {
  // First get all team members
  const usersQuery = query(collection(db, "users"), where("teamId", "==", teamId));
  const usersSnapshot = await getDocs(usersQuery);
  const scoutNames = usersSnapshot.docs.map(doc => doc.data().displayName);

  // Get all scouting entries by team scouts
  const allEntries: any[] = [];
  for (const scoutName of scoutNames) {
    const entriesQuery = query(collection(db, "scoutingEntries"), where("scoutName", "==", scoutName));
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

  // Get all practice sessions to calculate REAL average accuracy
  const practiceQuery = query(collection(db, "practiceSessions"));
  const practiceSnapshot = await getDocs(practiceQuery);
  
  let totalAccuracy = 0;
  let practiceCount = 0;
  
  practiceSnapshot.forEach((doc) => {
    const data = doc.data();
    if (data.accuracy !== undefined) {
      totalAccuracy += data.accuracy;
      practiceCount++;
    }
  });

  const avgAccuracy = practiceCount > 0 ? Math.round(totalAccuracy / practiceCount) : 0;

  // Count entries ONLY during event dates (Arkansas: March 18-21, Bayou: April 1-4)
  const currentEvent = getCurrentEvent();
  let eventBasedEntries = 0;
  
  if (currentEvent) {
    // There's an active event, count all entries
    eventBasedEntries = entries.length;
  } else {
    // No active event, show 0
    eventBasedEntries = 0;
  }

  // Count entries by event
  const entriesByEvent: Record<string, number> = {};
  entries.forEach(entry => {
    const event = "Current Season";
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

  // Get scouts who have completed at least one practice session
  const scoutsWithPractice = new Set();
  practiceSnapshot.forEach(doc => {
    scoutsWithPractice.add(doc.data().scoutName);
  });

  return {
    totalEntries: eventBasedEntries,
    activeScouts: scoutsWithPractice.size,
    totalScouts: scouts.length,
    averageAccuracy: avgAccuracy,
    entriesByEvent,
    entriesByScout,
    recentActivity: recentEntries,
  };
}

// Get scout-specific stats
export async function getScoutStats(scoutName: string) {
  const entriesQuery = query(collection(db, "scoutingEntries"), where("scoutName", "==", scoutName));
  const entriesSnapshot = await getDocs(entriesQuery);
  const entries = entriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // Get REAL practice data
  const practiceQuery = query(collection(db, "practiceSessions"), where("scoutName", "==", scoutName));
  const practiceSnapshot = await getDocs(practiceQuery);
  
  let totalAccuracy = 0;
  let practiceCount = 0;
  
  practiceSnapshot.forEach((doc) => {
    const data = doc.data();
    if (data.accuracy !== undefined) {
      totalAccuracy += data.accuracy;
      practiceCount++;
    }
  });

  const averageAccuracy = practiceCount > 0 ? Math.round(totalAccuracy / practiceCount) : 0;

  return {
    totalEntries: entries.length,
    practiceSessionsCompleted: practiceSnapshot.size,
    averageAccuracy,
    recentEntries: entries.slice(0, 5),
  };
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