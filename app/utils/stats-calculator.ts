// Utility functions to calculate real statistics from Firebase data
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import { APP_EVENTS } from "@/app/utils/events";

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

export interface UpcomingEvent {
  name: string;
  location: string;
  startDate: string;
  endDate: string;
  daysUntil: number;
  key: string; // TBA event key
}

// Get all scouting entries for a team
type ScoutingEntry = Record<string, unknown> & {
  id?: string;
  scoutName?: string;
  teamNumber?: string;
  matchNumber?: string;
  submittedAt?: number;
  timestamp?: number;
};

export async function getTeamEntries(teamId: string): Promise<ScoutingEntry[]> {
  // First get all team members
  const usersQuery = query(collection(db, "users"), where("teamId", "==", teamId));
  const usersSnapshot = await getDocs(usersQuery);
  const scoutNames = usersSnapshot.docs.map(doc => doc.data().displayName);

  // Get all scouting entries by team scouts
  const allEntries: ScoutingEntry[] = [];
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
  const normalize = (value: string | null | undefined) =>
    (value || "").toLowerCase().replace(/\s+/g, "-");
  
  // Get team members - FIXED: Include coaches with special roles as scouts
  const usersQuery = query(collection(db, "users"), where("teamId", "==", teamId));
  const usersSnapshot = await getDocs(usersQuery);
  const teamMemberNames = new Set(usersSnapshot.docs.map((d) => d.data().displayName));
  const scouts = usersSnapshot.docs.filter(doc => {
    const data = doc.data();
    const specialRole = normalize(data.specialRole);
    const specialRoles = Array.isArray(data.specialRoles) ? data.specialRoles.map(normalize) : [];
    // Scout-readiness should reflect members who can be assigned match scouting.
    return data.role === "scout" || specialRole === "lead-scout" || specialRoles.includes("lead-scout");
  });
  const scoutNames = scouts.map((doc) => doc.data().displayName);

  // Get practice sessions from Firebase to calculate REAL average accuracy
  const practiceQuery = query(collection(db, "practiceSessions"));
  const practiceSnapshot = await getDocs(practiceQuery);
  
  const accuracyByScout: Record<string, { total: number; count: number }> = {};
  practiceSnapshot.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.accuracy !== undefined && teamMemberNames.has(data.scoutName)) {
      if (!accuracyByScout[data.scoutName]) {
        accuracyByScout[data.scoutName] = { total: 0, count: 0 };
      }
      accuracyByScout[data.scoutName].total += data.accuracy;
      accuracyByScout[data.scoutName].count += 1;
    }
  });

  const scoutAverages = scoutNames
    .map((name) => accuracyByScout[name])
    .filter((value): value is { total: number; count: number } => Boolean(value && value.count > 0))
    .map((value) => value.total / value.count);

  const avgAccuracy = scoutAverages.length > 0
    ? Math.round(scoutAverages.reduce((sum, value) => sum + value, 0) / scoutAverages.length)
    : 0;
  const readyScoutCount = scoutNames.filter((name) => {
    const data = accuracyByScout[name];
    return Boolean(data && data.count > 0 && (data.total / data.count) >= 80);
  }).length;

  // Count entries by event (based on submittedAt timestamp)
  const entriesByEvent: Record<string, number> = {};
  entries.forEach(() => {
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
    .sort((a, b) => {
      const bTime = typeof b.submittedAt === "number" ? b.submittedAt : (typeof b.timestamp === "number" ? b.timestamp : 0);
      const aTime = typeof a.submittedAt === "number" ? a.submittedAt : (typeof a.timestamp === "number" ? a.timestamp : 0);
      return bTime - aTime;
    })
    .slice(0, 5)
    .map(entry => ({
      id: entry.id || `${entry.scoutName || "unknown"}-${entry.timestamp || Date.now()}`,
      type: "scouting" as const,
      scoutName: entry.scoutName,
      teamNumber: entry.teamNumber,
      matchNumber: entry.matchNumber,
      timestamp: entry.submittedAt || entry.timestamp || Date.now(),
    }));

  return {
    totalEntries: entries.length,
    activeScouts: readyScoutCount,
    totalScouts: scouts.length,
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
export async function getUpcomingEvents(teamId?: string): Promise<UpcomingEvent[]> {
  const now = new Date();
  let selectedEventKeys: string[] = [];

  if (teamId) {
    const teamDoc = await getDoc(doc(db, "teams", teamId));
    if (teamDoc.exists()) {
      const teamData = teamDoc.data();
      if (Array.isArray(teamData.selectedEvents)) {
        selectedEventKeys = teamData.selectedEvents;
      }
    }
  }

  const events = selectedEventKeys.length
    ? APP_EVENTS.filter((event) => selectedEventKeys.includes(event.key))
    : APP_EVENTS;

  return events.map(event => {
    const startDate = new Date(`${event.startDate}T12:00:00`);
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
