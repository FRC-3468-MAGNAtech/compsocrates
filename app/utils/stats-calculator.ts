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
  
  // Get team members - FIXED: Include coaches with special roles as scouts
  const usersQuery = query(collection(db, "users"), where("teamId", "==", teamId));
  const usersSnapshot = await getDocs(usersQuery);
  const scouts = usersSnapshot.docs.filter(doc => {
    const data = doc.data();
    // Count scouts AND coaches with special scout roles
    return data.role === "scout" || 
           (data.role === "coach" && data.specialRole && 
            ["lead-scout", "lead-strategist", "pit-scout"].includes(data.specialRole));
  });

  // Get practice sessions from Firebase to calculate REAL average accuracy
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
      timestamp: entry.submittedAt || entry.timestamp || Date.now(),
    }));

  return {
    totalEntries: entries.length,
    activeScouts: scouts.length, // FIXED: Now includes lead scouts
    averageAccuracy: avgAccuracy,
    entriesByEvent,
    entriesByScout,
    recentActivity: recentEntries,
  };
}

// Format activity for display
export function formatActivity(activity: Activity): string {
  if (activity.type === "scouting") {
    return `${activity.scoutName} scouted Team ${activity.teamNumber} (Match ${activity.matchNumber})`;
  }
  if (activity.type === "practice") {
    return `${activity.scoutName} completed practice session (${activity.accuracy}% accuracy)`;
  }
  if (activity.type === "team_join") {
    return `${activity.scoutName} joined the team`;
  }
  return "Unknown activity";
}

// Get upcoming events - hardcoded for Arkansas and Bayou
export async function getUpcomingEvents(): Promise<UpcomingEvent[]> {
  const now = new Date();
  
  const events = [
    {
      name: "Arkansas Regional",
      location: "Little Rock, AR",
      startDate: "2026-03-18",
      endDate: "2026-03-21",
      key: "2026arli"
    },
    {
      name: "Bayou Regional",
      location: "Kenner, LA",
      startDate: "2026-04-01",
      endDate: "2026-04-04",
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

// Get team name from teams collection
export async function getTeamName(teamId: string): Promise<string> {
  try {
    const teamDoc = await getDoc(doc(db, "teams", teamId));
    if (teamDoc.exists()) {
      return teamDoc.data().teamName || teamId;
    }
    return teamId;
  } catch (error) {
    console.error("Error getting team name:", error);
    return teamId;
  }
}
