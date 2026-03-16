// Utility functions to calculate real statistics from Firebase data
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import { APP_EVENTS, dedupeEventKeys } from "@/app/utils/events";
import { getUserRoles } from "@/app/utils/roles";
import { getEventsForGame, isInEventWindow } from "@/app/utils/analyticsEvents";
import { getEffectiveNowDate, parseTeamTimeOverride } from "@/app/utils/teamTime";

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

function isRebuiltScoutedAccuracyEntry(entry: ScoutingEntry): boolean {
  const game = String(entry.game || "").toUpperCase();
  const hasAccuracy = typeof entry.accuracy === "number" && Number.isFinite(Number(entry.accuracy));
  const isPracticeScouted = Boolean(entry.isPracticeScouting) || Boolean(entry.practiceMode) || Boolean(entry.practiceSessionId);
  return game === "REBUILT" && hasAccuracy && isPracticeScouted;
}

function isRealCompetitionEntry(entry: ScoutingEntry): boolean {
  const game = String(entry.game || "REEFSCAPE").toUpperCase();
  const matchType = String(entry.matchType || "").toLowerCase();
  const practiceMode = String(entry.practiceMode || "").toLowerCase();
  const isPracticeScouting = Boolean(entry.isPracticeScouting);
  return (
    game === "REEFSCAPE" &&
    matchType !== "practice" &&
    !isPracticeScouting &&
    practiceMode !== "trial" &&
    practiceMode !== "competitive"
  );
}

function getEventWindowTimestamp(entry: Record<string, unknown>): number {
  const submittedAt = Number(entry.submittedAt || 0);
  if (Number.isFinite(submittedAt) && submittedAt > 0) return submittedAt;
  const timestamp = Number(entry.timestamp || 0);
  if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
  const createdAt = Number(entry.createdAt || 0);
  if (Number.isFinite(createdAt) && createdAt > 0) return createdAt;
  const completedAt = Number(entry.completedAt || 0);
  if (Number.isFinite(completedAt) && completedAt > 0) return completedAt;
  const startedAt = Number(entry.startedAt || 0);
  if (Number.isFinite(startedAt) && startedAt > 0) return startedAt;
  return 0;
}

function isDuringRebuiltEventWindow(entry: Record<string, unknown>): boolean {
  const timestamp = getEventWindowTimestamp(entry);
  if (!timestamp) return false;
  const rebuiltEvents = getEventsForGame("REBUILT").filter((event) => event.id !== "app-testing");
  return rebuiltEvents.some((event) => isInEventWindow(timestamp, event.startDate, event.endDate));
}

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
  const competitionEntries = entries.filter(isRealCompetitionEntry);
  // Get team members with new roles model (while accepting legacy role values).
  const usersQuery = query(collection(db, "users"), where("teamId", "==", teamId));
  const usersSnapshot = await getDocs(usersQuery);
  const scouts = usersSnapshot.docs.filter(doc => {
    const data = doc.data();
    const roles = getUserRoles({ role: String(data.role || ""), roles: data.roles as string[] | undefined });
    return roles.includes("match-scout") || roles.includes("media");
  });
  const scoutNames = scouts.map((doc) => doc.data().displayName);
  const teamMemberNames = new Set(
    usersSnapshot.docs.map((docSnap) => String(docSnap.data().displayName || "").trim()).filter(Boolean)
  );

  // Use REBUILT scouted-match rows from scouting for dashboard accuracy.
  const scoutingSnapshot = await getDocs(collection(db, "scouting"));
  
  const accuracyByScout: Record<string, { total: number; count: number }> = {};
  scoutingSnapshot.forEach((docSnap) => {
    const data = docSnap.data() as ScoutingEntry;
    const scoutName = String(data.scoutName || "");
    if (isRebuiltScoutedAccuracyEntry(data) && teamMemberNames.has(scoutName)) {
      if (!accuracyByScout[scoutName]) {
        accuracyByScout[scoutName] = { total: 0, count: 0 };
      }
      accuracyByScout[scoutName].total += Number(data.accuracy || 0);
      accuracyByScout[scoutName].count += 1;
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

  const eventWindowCollections = [
    "scouting",
    "pitScouting",
    "strategyScouting",
    "matchStrategyPlans",
    "driveScouting",
    "helperReports",
  ] as const;

  const eventWindowEntries = await Promise.all(
    eventWindowCollections.map(async (collectionName) => {
      const snap = await getDocs(collection(db, collectionName));
      return snap.docs
        .map((docSnap) => docSnap.data() as Record<string, unknown>)
        .filter((row) => {
          const rowTeamId = String(row.teamId || "").trim();
          const rowScout = String(row.scoutName || row.submittedByName || "").trim();
          const sameTeam = rowTeamId ? rowTeamId === teamId : teamMemberNames.has(rowScout);
          if (!sameTeam) return false;
          return isDuringRebuiltEventWindow(row);
        }).length;
    })
  );
  const rebuiltWindowTotalEntries = eventWindowEntries.reduce((sum, count) => sum + count, 0);

  // Count entries by event (based on submittedAt timestamp)
  const entriesByEvent: Record<string, number> = {};
  competitionEntries.forEach((entry) => {
    const event = String(entry.eventName || entry.eventKey || "Current Event");
    entriesByEvent[event] = (entriesByEvent[event] || 0) + 1;
  });

  // Count entries by scout
  const entriesByScout: Record<string, number> = {};
  competitionEntries.forEach(entry => {
    const scout = entry.scoutName || "Unknown";
    entriesByScout[scout] = (entriesByScout[scout] || 0) + 1;
  });

  // Get recent activity
  const recentEntries = competitionEntries
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
    totalEntries: rebuiltWindowTotalEntries,
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

export async function getUpcomingEvents(teamId?: string): Promise<UpcomingEvent[]> {
  let now = new Date();
  let baseYear = now.getFullYear();
  let selectedEventKeys: string[] = [];
  let encryptedKey = "";
  let plainKey = "";

  if (teamId) {
    const teamDoc = await getDoc(doc(db, "teams", teamId));
    if (teamDoc.exists()) {
      const teamData = teamDoc.data();
      const override = parseTeamTimeOverride(teamData as Record<string, unknown>);
      now = getEffectiveNowDate(override);
      baseYear = now.getFullYear();
      if (Array.isArray(teamData.selectedEvents)) {
        selectedEventKeys = dedupeEventKeys(teamData.selectedEvents.map((value: unknown) => String(value || "")));
      }
      encryptedKey = typeof teamData.tbaApiKeyEncrypted === "string" ? teamData.tbaApiKeyEncrypted.trim() : "";
      plainKey = typeof teamData.tbaApiKey === "string" ? teamData.tbaApiKey.trim() : "";
    }
  }

  const staticByKey = new Map(APP_EVENTS.map((event) => [event.key, event]));
  let events: UpcomingEvent[] = [];

  if (selectedEventKeys.length > 0) {
    const selectedSet = new Set(selectedEventKeys);
    const tbaByKey = new Map<string, { name: string; city: string; stateProv: string; startDate: string; endDate: string }>();

    if (encryptedKey || plainKey) {
      const years = new Set<number>();
      selectedEventKeys.forEach((eventKey) => {
        const year = Number(String(eventKey).slice(0, 4));
        if (Number.isFinite(year)) years.add(year);
      });
      if (years.size === 0) years.add(baseYear);

      const responses = await Promise.all(
        Array.from(years).map(async (year) => {
          const response = await fetch("/api/tba/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year, encryptedKey, plainKey }),
          });
          if (!response.ok) return [] as Array<Record<string, unknown>>;
          const payload = await response.json();
          return Array.isArray(payload.events) ? (payload.events as Array<Record<string, unknown>>) : [];
        })
      );

      responses.flat().forEach((event) => {
        const key = String(event.key || "");
        if (!key || !selectedSet.has(key)) return;
        tbaByKey.set(key, {
          name: String(event.name || key),
          city: String(event.city || ""),
          stateProv: String(event.state_prov || ""),
          startDate: String(event.start_date || ""),
          endDate: String(event.end_date || ""),
        });
      });
    }

    events = selectedEventKeys.map((key) => {
      const tba = tbaByKey.get(key);
      const fallback = staticByKey.get(key);
      const startDate = tba?.startDate || fallback?.startDate || `${baseYear}-01-01`;
      const endDate = tba?.endDate || fallback?.endDate || startDate;
      const location =
        [tba?.city || fallback?.city || "", tba?.stateProv || fallback?.state_prov || ""].filter(Boolean).join(", ") ||
        fallback?.location ||
        "Location TBD";
      const daysUntil = Math.ceil((new Date(`${startDate}T12:00:00`).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return {
        key,
        name: tba?.name || fallback?.name || key,
        location,
        startDate,
        endDate,
        daysUntil: Math.max(0, daysUntil),
      };
    });
  } else {
    events = APP_EVENTS.map((event) => {
      const daysUntil = Math.ceil((new Date(`${event.startDate}T12:00:00`).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return {
        ...event,
        daysUntil: Math.max(0, daysUntil),
      };
    });
  }

  const dedupedByName = new Map<string, UpcomingEvent>();
  events.forEach((event) => {
    const nameKey = event.name.trim().toLowerCase();
    if (!nameKey) return;
    const existing = dedupedByName.get(nameKey);
    if (!existing) {
      dedupedByName.set(nameKey, event);
      return;
    }
    const existingTime = new Date(`${existing.startDate}T12:00:00`).getTime();
    const incomingTime = new Date(`${event.startDate}T12:00:00`).getTime();
    if (incomingTime < existingTime) {
      dedupedByName.set(nameKey, event);
    }
  });

  return Array.from(dedupedByName.values()).sort((a, b) => {
    const aTime = new Date(`${a.startDate}T12:00:00`).getTime();
    const bTime = new Date(`${b.startDate}T12:00:00`).getTime();
    return aTime - bTime;
  });
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
