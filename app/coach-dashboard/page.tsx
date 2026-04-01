"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { calculateTeamStats, getUpcomingEvents, formatActivity, type TeamStats, type UpcomingEvent } from "@/app/utils/stats-calculator";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";
import { getEventMatches, type TBAMatch } from "@/app/utils/tba-api";
import { getUserRoles } from "@/app/utils/roles";
import { BarChart3, CalendarDays, ClipboardList, Target, Users, Wrench, MapPin } from "lucide-react";
import DataSourceCredits from "@/app/components/DataSourceCredits";
import { getEffectiveNowMs, getEffectiveNowSec } from "@/app/utils/teamTime";

interface TeamData {
  scoutCount?: number;
  eventScoutCounts?: Record<string, number>;
  eventAttendees?: Record<string, string[]>;
}
type PracticeAccuracyMode = "trial" | "competitive";
type MatchAssignment = {
  eventKey?: string;
  matchKey?: string;
  matchLabel?: string;
  teamNumber?: number;
  scoutName?: string;
};

type SubInRequest = {
  id: string;
  eventKey?: string;
  matchId?: string;
  matchLabel?: string;
  matchType?: string;
  matchNumber?: number;
  teamNumber?: number | null;
  requestedById?: string;
  requestedByName?: string;
  requestedAt?: number;
};

type SubInClaim = {
  id: string;
  eventKey?: string;
  matchId?: string;
  matchLabel?: string;
  matchType?: string;
  matchNumber?: number;
  teamNumber?: number | null;
  claimedById?: string;
  claimedByName?: string;
  requestedById?: string;
  requestedByName?: string;
  submittedAt?: number;
};

type NotificationPermissionState = "default" | "denied" | "granted";

type DashboardMatch = {
  key: string;
  label: string;
  scheduleTime: number;
  compLevel: TBAMatch["comp_level"];
  redTeams: number[];
  blueTeams: number[];
};

function filterEventsByAttendance(
  events: UpcomingEvent[],
  attendanceByEvent: Record<string, string[]>,
  uid: string,
  displayName: string
) {
  const normalizedUid = uid.trim();
  const normalizedName = displayName.trim().toLowerCase();
  return events.filter((event) => {
    const attendees = Array.isArray(attendanceByEvent[event.key]) ? attendanceByEvent[event.key] : [];
    return attendees.some((value) => {
      const safe = String(value || "").trim();
      return safe === normalizedUid || safe.toLowerCase() === normalizedName;
    });
  });
}

function compLevelPriority(compLevel: TBAMatch["comp_level"]) {
  if (compLevel === "qm") return 0;
  if (compLevel === "ef") return 1;
  if (compLevel === "qf") return 2;
  if (compLevel === "sf") return 3;
  if (compLevel === "f") return 4;
  return 999;
}

function matchLabel(match: TBAMatch) {
  if (match.comp_level === "qm") return `Qualification ${match.match_number}`;
  if (match.comp_level === "f") return `Finals ${match.match_number}`;
  if (match.comp_level === "sf") return `Semifinal ${match.set_number}-${match.match_number}`;
  if (match.comp_level === "qf") return `Quarterfinal ${match.set_number}-${match.match_number}`;
  if (match.comp_level === "ef") return `Octofinal ${match.set_number}-${match.match_number}`;
  return match.key;
}

function normalizeMatchId(value: string): string {
  const raw = String(value || "").toLowerCase().trim();
  if (!raw) return "";
  const direct = raw.match(/^(p|q|qf|sf|f)(\d+)$/);
  if (direct) return `${direct[1]}${Number(direct[2])}`;
  const qm = raw.match(/_qm(\d+)/);
  if (qm) return `q${Number(qm[1])}`;
  const practiceKey = raw.match(/_(?:pr|pm)(\d+)/);
  if (practiceKey) return `p${Number(practiceKey[1])}`;
  const practice = raw.match(/practice(?:\s+match)?\s+(\d+)/);
  if (practice) return `p${Number(practice[1])}`;
  const qual = raw.match(/qualification(?:\s+match)?\s+(\d+)/);
  if (qual) return `q${Number(qual[1])}`;
  const sf = raw.match(/_sf(\d+)m(\d+)/);
  if (sf) return `sf${Number(sf[1])}`;
  const qf = raw.match(/_qf(\d+)m(\d+)/);
  if (qf) return `qf${Number(qf[1])}`;
  const finals = raw.match(/_f(\d+)m(\d+)/);
  if (finals) return `f${Number(finals[2])}`;
  const finalsLabel = raw.match(/finals?\s+(\d+)/);
  if (finalsLabel) return `f${Number(finalsLabel[1])}`;
  return "";
}

function normalizeMatches(matches: TBAMatch[]): DashboardMatch[] {
  return [...matches]
    .sort((a, b) => {
      const priorityDiff = compLevelPriority(a.comp_level) - compLevelPriority(b.comp_level);
      if (priorityDiff !== 0) return priorityDiff;
      if (a.set_number !== b.set_number) return a.set_number - b.set_number;
      return a.match_number - b.match_number;
    })
    .map((match) => ({
      key: match.key,
      label: matchLabel(match),
      scheduleTime: match.actual_time || match.predicted_time || match.time || 0,
      compLevel: match.comp_level,
      redTeams: match.alliances.red.team_keys
        .map((key) => parseInt(key.replace("frc", ""), 10))
        .filter((value) => Number.isFinite(value)),
      blueTeams: match.alliances.blue.team_keys
        .map((key) => parseInt(key.replace("frc", ""), 10))
        .filter((value) => Number.isFinite(value)),
    }));
}

function subInRequestKey(request: SubInRequest): string {
  const id = String(request.id || "").trim();
  if (id) return id;
  const matchId = String(request.matchId || "").trim();
  const team = String(request.teamNumber || "").trim();
  return `${matchId}|${team}`.trim();
}

function isPastEvent(event: UpcomingEvent, nowMs: number) {
  const end = new Date(`${event.endDate}T23:59:59`).getTime();
  return Number.isFinite(end) && nowMs > end;
}

function sortDashboardEvents(events: UpcomingEvent[], nowMs: number) {
  return [...events].sort((a, b) => {
    const aPast = isPastEvent(a, nowMs);
    const bPast = isPastEvent(b, nowMs);
    if (aPast !== bPast) return aPast ? 1 : -1;
    const aTime = new Date(`${a.startDate}T12:00:00`).getTime();
    const bTime = new Date(`${b.startDate}T12:00:00`).getTime();
    return aTime - bTime;
  });
}

function CoachDashboardContent() {
  const router = useRouter();
  const { userData, teamTimeOverride } = useAuth();
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [activeEventKey, setActiveEventKey] = useState("");
  const [eventMatchesByKey, setEventMatchesByKey] = useState<Record<string, DashboardMatch[]>>({});
  const [loading, setLoading] = useState(true);
  const [editingScoutCount, setEditingScoutCount] = useState(false);
  const [scoutCountInput, setScoutCountInput] = useState("");
  const [eventScoutCountInputs, setEventScoutCountInputs] = useState<Record<string, string>>({});
  const [teamData, setTeamData] = useState<TeamData | null>(null);
  const [readyScoutNames, setReadyScoutNames] = useState<string[]>([]);
  const [readyScoutIds, setReadyScoutIds] = useState<string[]>([]);
  const [readyCompetitiveScoutIds, setReadyCompetitiveScoutIds] = useState<string[]>([]);
  const [readyCompetitiveScoutNames, setReadyCompetitiveScoutNames] = useState<string[]>([]);
  const [userMatchAssignments, setUserMatchAssignments] = useState<MatchAssignment[]>([]);
  const [subInRequests, setSubInRequests] = useState<SubInRequest[]>([]);
  const [subInClaimsByKey, setSubInClaimsByKey] = useState<Record<string, SubInClaim>>({});
  const [subInClaimsForUser, setSubInClaimsForUser] = useState<SubInClaim[]>([]);
  const [subInClaimingId, setSubInClaimingId] = useState<string | null>(null);
  const [subInClearing, setSubInClearing] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>("default");
  const notificationsSupported = typeof window !== "undefined" && "Notification" in window;
  const notifiedSubInRequestsRef = useRef<Set<string>>(new Set());
  const notifiedUpNextRef = useRef<string>("");
  const notificationsEnabledAtRef = useRef<number | null>(null);
  const notificationsInitializedRef = useRef(false);
  const [eventAverageAccuracyByKey, setEventAverageAccuracyByKey] = useState<Record<string, number>>({});
  const [overallAverageAccuracy, setOverallAverageAccuracy] = useState(0);
  const [accuracyMode, setAccuracyMode] = useState<PracticeAccuracyMode>("competitive");
  const nowMs = getEffectiveNowMs(teamTimeOverride);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("coach-dashboard-accuracy-mode");
    if (saved === "trial" || saved === "competitive") {
      setAccuracyMode(saved);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("coach-dashboard-accuracy-mode", accuracyMode);
  }, [accuracyMode]);

  useEffect(() => {
    if (!notificationsSupported) return;
    setNotificationPermission(Notification.permission);
  }, [notificationsSupported]);

  useEffect(() => {
    if (!notificationsSupported) return;
    if (notificationPermission !== "default") return;
    if (typeof window === "undefined") return;
    try {
      const key = "cs-notification-prompted";
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, String(Date.now()));
      void Notification.requestPermission().then((permission) => {
        setNotificationPermission(permission);
      });
    } catch (error) {
      console.warn("Notification auto-prompt failed:", error);
    }
  }, [notificationPermission, notificationsSupported]);

  useEffect(() => {
    if (userData && !userData.teamId) {
      setLoading(false);
      router.push(getDashboardRoute(userData));
      return;
    }
    loadDashboardData();
  }, [userData?.teamId, userData, router, accuracyMode, teamTimeOverride?.enabled, teamTimeOverride?.offsetMs]);

  async function loadSubInRequests(teamId: string) {
    try {
      const [requestSnap, claimSnap] = await Promise.all([
        getDocs(query(collection(db, "scouting"), where("teamId", "==", teamId), where("entryType", "==", "sub-in-request"))),
        getDocs(query(collection(db, "scouting"), where("teamId", "==", teamId), where("entryType", "==", "sub-in-claim"))),
      ]);
      const requests = requestSnap.docs.map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        return {
          id: docSnap.id,
          eventKey: String(data.eventKey || ""),
          matchId: String(data.matchId || ""),
          matchLabel: String(data.matchLabel || ""),
          matchType: String(data.matchType || ""),
          matchNumber: Number(data.matchNumber || 0),
          teamNumber: Number(data.teamNumber || 0) || null,
          requestedById: String(data.requestedById || data.scoutId || ""),
          requestedByName: String(data.requestedByName || data.scoutName || ""),
          requestedAt: Number(data.requestedAt || data.submittedAt || 0),
        } as SubInRequest;
      });
      const claimsByKey: Record<string, SubInClaim> = {};
      const claimsForUser: SubInClaim[] = [];
      claimSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        const matchId = String(data.matchId || "");
        const teamNumber = Number(data.teamNumber || 0) || null;
        if (!matchId || !teamNumber) return;
        const claim: SubInClaim = {
          id: docSnap.id,
          eventKey: String(data.eventKey || ""),
          matchId,
          matchLabel: String(data.matchLabel || ""),
          matchType: String(data.matchType || ""),
          matchNumber: Number(data.matchNumber || 0),
          teamNumber,
          claimedById: String(data.claimedById || data.scoutId || ""),
          claimedByName: String(data.claimedByName || data.scoutName || ""),
          requestedById: String(data.requestedById || ""),
          requestedByName: String(data.requestedByName || ""),
          submittedAt: Number(data.submittedAt || data.timestamp || 0),
        };
        const claimEventKey = claim.eventKey || "";
        claimsByKey[`${claimEventKey}|${matchId}|${teamNumber}`] = claim;
        if (userData?.uid && claim.claimedById === userData.uid) {
          claimsForUser.push(claim);
        }
      });
      setSubInRequests(requests);
      setSubInClaimsByKey(claimsByKey);
      setSubInClaimsForUser(claimsForUser);
    } catch (error) {
      console.warn("Failed to load sub-in requests:", error);
      setSubInRequests([]);
      setSubInClaimsByKey({});
      setSubInClaimsForUser([]);
    }
  }

  async function claimSubIn(request: SubInRequest) {
    if (!userData?.teamId || !userData?.uid) {
      alert("You must be signed in to accept a sub-in.");
      return;
    }
    if (!request.matchId || !request.teamNumber) {
      alert("Missing match or team info for this sub-in request.");
      return;
    }
    const eventKey = String(request.eventKey || activeEvent?.key || "").trim();
    if (!eventKey) {
      alert("Event not set for this sub-in request.");
      return;
    }
    if (subInClaimingId === request.id) return;
    setSubInClaimingId(request.id);
    try {
      const now = Date.now();
      await addDoc(collection(db, "scouting"), {
        entryType: "sub-in-claim",
        formType: "sub-in-claim",
        game: "REBUILT",
        teamId: userData.teamId,
        eventKey,
        matchId: request.matchId,
        matchKey: request.matchId,
        matchLabel: request.matchLabel || "",
        matchType: request.matchType || "",
        matchNumber: String(request.matchNumber || ""),
        teamNumber: String(request.teamNumber),
        scoutId: userData.uid,
        scoutName: userData.displayName || "Scout",
        claimedById: userData.uid,
        claimedByName: userData.displayName || "Scout",
        requestedById: request.requestedById || "",
        requestedByName: request.requestedByName || "",
        requestId: request.id,
        submittedAt: now,
        timestamp: now,
      });
      await loadSubInRequests(userData.teamId);
    } catch (error) {
      console.error("Failed to accept sub-in request:", error);
      const message = error instanceof Error ? error.message : String(error);
      alert(`Could not accept sub-in request. ${message}`);
    } finally {
      setSubInClaimingId(null);
    }
  }

  async function deleteSubInRequest(request: SubInRequest) {
    if (!userData?.teamId || !userData?.uid) {
      alert("You must be signed in to delete a sub-in request.");
      return;
    }
    if (!request.id) return;
    try {
      await deleteDoc(doc(db, "scouting", request.id));
      await loadSubInRequests(userData.teamId);
    } catch (error) {
      console.error("Failed to delete sub-in request:", error);
      const message = error instanceof Error ? error.message : String(error);
      alert(`Could not delete sub-in request. ${message}`);
    }
  }

  async function clearAllSubInRequests() {
    if (!userData?.teamId || !userData?.isTeamAdmin) {
      alert("Only team admins can clear all sub-in requests.");
      return;
    }
    if (subInClearing) return;
    const confirmed = window.confirm("Delete all sub-in requests and claims for this team?");
    if (!confirmed) return;
    setSubInClearing(true);
    try {
      const [requestSnap, claimSnap] = await Promise.all([
        getDocs(query(collection(db, "scouting"), where("teamId", "==", userData.teamId), where("entryType", "==", "sub-in-request"))),
        getDocs(query(collection(db, "scouting"), where("teamId", "==", userData.teamId), where("entryType", "==", "sub-in-claim"))),
      ]);
      const deletions: Promise<void>[] = [];
      requestSnap.docs.forEach((docSnap) => deletions.push(deleteDoc(doc(db, "scouting", docSnap.id))));
      claimSnap.docs.forEach((docSnap) => deletions.push(deleteDoc(doc(db, "scouting", docSnap.id))));
      await Promise.all(deletions);
      await loadSubInRequests(userData.teamId);
    } catch (error) {
      console.error("Failed to clear sub-in requests:", error);
      const message = error instanceof Error ? error.message : String(error);
      alert(`Could not clear sub-in requests. ${message}`);
    } finally {
      setSubInClearing(false);
    }
  }

  async function requestNotificationPermission() {
    if (!notificationsSupported) return;
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    } catch (error) {
      console.warn("Notification permission request failed:", error);
    }
  }

  async function loadDashboardData() {
    if (!userData?.teamId) return;
    
    setLoading(true);
    try {
      const [teamStats, events, teamDoc, usersSnap, scoutingSnap, assignmentSnap] = await Promise.all([
        calculateTeamStats(userData.teamId),
        getUpcomingEvents(userData.teamId),
        getDoc(doc(db, "teams", userData.teamId)),
        getDocs(query(collection(db, "users"), where("teamId", "==", userData.teamId))),
        getDocs(collection(db, "scouting")),
        userData?.uid
          ? getDocs(query(collection(db, "matchAssignments"), where("scoutId", "==", userData.uid)))
          : Promise.resolve({ docs: [] } as { docs: Array<{ data: () => MatchAssignment }> }),
      ]);
      
      setStats(teamStats);
      setUserMatchAssignments(
        assignmentSnap.docs.map((docSnap) => docSnap.data() as MatchAssignment).filter((row) => row.eventKey)
      );
      await loadSubInRequests(userData.teamId);
      const attendanceByEvent = teamDoc.exists()
        ? (teamDoc.data().eventAttendees as Record<string, string[]> | undefined) || {}
        : {};
      const visibleEvents = filterEventsByAttendance(
        events,
        attendanceByEvent,
        userData.uid || "",
        userData.displayName || ""
      );
      const orderedEvents = sortDashboardEvents(visibleEvents, nowMs);
      setUpcomingEvents(orderedEvents);
      setActiveEventKey((current) => {
        if (current && orderedEvents.some((event) => event.key === current)) return current;
        return orderedEvents[0]?.key || "";
      });
      if (teamDoc.exists()) {
        setTeamData(teamDoc.data());
      }
      const eventMatches = await Promise.all(
        orderedEvents.map(async (event) => {
          try {
            const matches = await getEventMatches(event.key);
            return [event.key, normalizeMatches(matches)] as const;
          } catch (error) {
            console.error(`Unable to fetch matches for ${event.key}:`, error);
            return [event.key, []] as const;
          }
        })
      );
      setEventMatchesByKey(Object.fromEntries(eventMatches));

      const scouts = usersSnap.docs.filter((userDoc) => {
        const data = userDoc.data();
        const roles = getUserRoles({
          role: String(data.role || ""),
          roles: data.roles as string[] | undefined,
          secondaryRoles: data.secondaryRoles as string[] | undefined,
        });
        return roles.includes("match-scout") || roles.includes("lead-scout");
      });
      const scoutDocs = scouts.map((docSnap) => ({ uid: docSnap.id, displayName: String(docSnap.data().displayName || "") }));
      const scoutUidSet = new Set(scoutDocs.map((row) => row.uid));
      const scoutByName = new Map<string, { uid: string; displayName: string }>();
      scoutDocs.forEach((row) => {
        const nameKey = row.displayName.trim().toLowerCase();
        if (!nameKey || scoutByName.has(nameKey)) return;
        scoutByName.set(nameKey, row);
      });

      const accuracyMapByScoutUidByMode: Record<PracticeAccuracyMode, Map<string, { total: number; count: number }>> = {
        trial: new Map<string, { total: number; count: number }>(),
        competitive: new Map<string, { total: number; count: number }>(),
      };
      scoutingSnap.forEach((scoutingDoc) => {
        const data = scoutingDoc.data() as Record<string, unknown>;
        const isRebuilt = String(data.game || "").toUpperCase() === "REBUILT";
        const isPracticeScouted = Boolean(data.isPracticeScouting) || Boolean(data.practiceMode) || Boolean(data.practiceSessionId);
        const mode = String(data.practiceMode || "trial").toLowerCase();
        if (!isRebuilt || !isPracticeScouted || (mode !== "trial" && mode !== "competitive") || typeof data.accuracy !== "number") return;
        const scoutId = String(data.scoutId || "").trim();
        const scoutNameKey = String(data.scoutName || "").trim().toLowerCase();
        const resolvedUid = scoutUidSet.has(scoutId) ? scoutId : scoutByName.get(scoutNameKey)?.uid || "";
        if (!resolvedUid) return;
        const mapForMode = accuracyMapByScoutUidByMode[mode as PracticeAccuracyMode];
        const existing = mapForMode.get(resolvedUid) || { total: 0, count: 0 };
        existing.total += Number(data.accuracy || 0);
        existing.count += 1;
        mapForMode.set(resolvedUid, existing);
      });
      const accuracyMapByScoutUid = accuracyMapByScoutUidByMode[accuracyMode];
      const accuracyMapByScoutUidCompetitive = accuracyMapByScoutUidByMode.competitive;

      const computedReadyScoutUids = scoutDocs
        .filter((row) => {
          const entry = accuracyMapByScoutUid.get(row.uid);
          return Boolean(entry && entry.count > 0 && (entry.total / entry.count) >= 75);
        })
        .map((row) => row.uid);
      const computedReadyCompetitiveScoutUids = scoutDocs
        .filter((row) => {
          const entry = accuracyMapByScoutUidCompetitive.get(row.uid);
          return Boolean(entry && entry.count > 0 && (entry.total / entry.count) >= 75);
        })
        .map((row) => row.uid);
      const readyUidSet = new Set(computedReadyScoutUids);
      const computedReadyScouts = scoutDocs.filter((row) => readyUidSet.has(row.uid)).map((row) => row.displayName);
      const readyCompetitiveUidSet = new Set(computedReadyCompetitiveScoutUids);
      const computedReadyCompetitiveScouts = scoutDocs
        .filter((row) => readyCompetitiveUidSet.has(row.uid))
        .map((row) => row.displayName);
      setReadyScoutNames(computedReadyScouts);
      setReadyScoutIds(computedReadyScoutUids);
      setReadyCompetitiveScoutIds(computedReadyCompetitiveScoutUids);
      setReadyCompetitiveScoutNames(computedReadyCompetitiveScouts);

      const avgByEvent: Record<string, number> = {};
      const scoutAccuracyByUid = new Map<string, number>();
      const scoutAccuracyByName = new Map<string, number>();
      scoutDocs.forEach((docSnap) => {
        const byUid = accuracyMapByScoutUid.get(docSnap.uid);
        if (!byUid || byUid.count <= 0) return;
        const avg = byUid.total / byUid.count;
        scoutAccuracyByUid.set(docSnap.uid, avg);
        scoutAccuracyByName.set(docSnap.displayName.trim().toLowerCase(), avg);
      });
      const allAccuracies = Array.from(scoutAccuracyByUid.values()).filter((value) => Number.isFinite(value) && value > 0);
      setOverallAverageAccuracy(
        allAccuracies.length > 0
          ? Math.round(allAccuracies.reduce((sum, value) => sum + value, 0) / allAccuracies.length)
          : 0
      );
      orderedEvents.forEach((event) => {
        const attendees = Array.isArray(attendanceByEvent[event.key]) ? attendanceByEvent[event.key] : [];
        const attendeeAccuracies = attendees
          .map((value) => {
            const safe = String(value || "").trim();
            if (!safe) return null;
            return scoutAccuracyByUid.get(safe) ?? scoutAccuracyByName.get(safe.toLowerCase()) ?? null;
          })
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
        if (attendeeAccuracies.length > 0) {
          avgByEvent[event.key] = Math.round(
            attendeeAccuracies.reduce((sum, value) => sum + value, 0) / attendeeAccuracies.length
          );
        }
      });
      setEventAverageAccuracyByKey(avgByEvent);
    } catch (error) {
      console.error("Error loading dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!userData?.teamId) return;
    const interval = setInterval(() => {
      void loadSubInRequests(userData.teamId);
    }, 20000);
    return () => clearInterval(interval);
  }, [userData?.teamId]);

  const activeEvent = useMemo(
    () => upcomingEvents.find((event) => event.key === activeEventKey) || upcomingEvents[0],
    [activeEventKey, upcomingEvents]
  );
  const activeMatches = activeEvent ? eventMatchesByKey[activeEvent.key] || [] : [];
  const subInAssignmentsForUser = useMemo(
    () =>
      subInClaimsForUser.map((claim) => ({
        eventKey: claim.eventKey,
        matchKey: claim.matchId,
        matchLabel: claim.matchLabel,
        teamNumber: claim.teamNumber || undefined,
        scoutName: claim.claimedByName,
      })),
    [subInClaimsForUser]
  );
  const nowSec = getEffectiveNowSec(teamTimeOverride);
  const visibleSubInRequests = useMemo(() => {
    if (!activeEvent) return [];
    const ttlMs = 6 * 60 * 60 * 1000;
    return subInRequests
      .filter((request) => request.eventKey === activeEvent.key)
      .filter((request) => {
        const ts = Number(request.requestedAt || 0);
        return !ts || nowMs - ts <= ttlMs;
      })
      .sort((a, b) => Number(b.requestedAt || 0) - Number(a.requestedAt || 0));
  }, [activeEvent, subInRequests, nowMs]);
  const upNextAssignment = useMemo(() => {
    if (!activeEvent) return null;
    const assignmentsForEvent = [
      ...userMatchAssignments.filter((assignment) => assignment.eventKey === activeEvent.key),
      ...subInAssignmentsForUser.filter((assignment) => assignment.eventKey === activeEvent.key),
    ];
    if (assignmentsForEvent.length === 0) return null;
    const upcomingMatch = [...activeMatches]
      .filter((match) => match.scheduleTime > 0 && match.scheduleTime >= nowSec)
      .sort((a, b) => a.scheduleTime - b.scheduleTime)[0];
    if (!upcomingMatch) return null;
    const matchId = normalizeMatchId(upcomingMatch.key) || normalizeMatchId(upcomingMatch.label);
    const assignment = assignmentsForEvent.find((row) => {
      const assignmentId = normalizeMatchId(String(row.matchKey || "")) || normalizeMatchId(String(row.matchLabel || ""));
      return assignmentId && matchId && assignmentId === matchId;
    });
    if (!assignment) return null;
    return { match: upcomingMatch, assignment };
  }, [activeEvent, activeMatches, nowSec, userMatchAssignments, subInAssignmentsForUser]);
  const upcomingAssignment = useMemo(() => {
    if (!activeEvent) return null;
    const assignmentsForEvent = [
      ...userMatchAssignments.filter((assignment) => assignment.eventKey === activeEvent.key),
      ...subInAssignmentsForUser.filter((assignment) => assignment.eventKey === activeEvent.key),
    ];
    if (assignmentsForEvent.length === 0) return null;
    const assignmentIds = new Set(
      assignmentsForEvent
        .map((row) => normalizeMatchId(String(row.matchKey || "")) || normalizeMatchId(String(row.matchLabel || "")))
        .filter(Boolean)
    );
    if (assignmentIds.size === 0) return null;
    const candidates = activeMatches
      .map((match) => ({ match, id: normalizeMatchId(match.key) || normalizeMatchId(match.label) }))
      .filter((row) => row.id && assignmentIds.has(row.id));
    if (candidates.length === 0) return null;
    const sorted = candidates
      .filter((row) => (row.match.scheduleTime > 0 ? row.match.scheduleTime >= nowSec : true))
      .sort((a, b) => {
        const timeA = a.match.scheduleTime > 0 ? a.match.scheduleTime : Number.MAX_SAFE_INTEGER;
        const timeB = b.match.scheduleTime > 0 ? b.match.scheduleTime : Number.MAX_SAFE_INTEGER;
        if (timeA !== timeB) return timeA - timeB;
        return a.match.label.localeCompare(b.match.label);
      });
    const next = sorted[0] || candidates[0];
    const assignment = assignmentsForEvent.find((row) => {
      const assignmentId = normalizeMatchId(String(row.matchKey || "")) || normalizeMatchId(String(row.matchLabel || ""));
      return assignmentId && assignmentId === next.id;
    });
    if (!assignment) return null;
    return { match: next.match, assignment };
  }, [activeEvent, activeMatches, nowSec, userMatchAssignments, subInAssignmentsForUser]);

  useEffect(() => {
    if (!notificationsSupported) return;
    if (notificationPermission !== "granted") {
      notificationsInitializedRef.current = false;
      notificationsEnabledAtRef.current = null;
      return;
    }
    if (notificationsInitializedRef.current) return;
    notificationsEnabledAtRef.current = Date.now();
    const initialKeys = visibleSubInRequests.map(subInRequestKey).filter((key) => key.length > 0);
    notifiedSubInRequestsRef.current = new Set(initialKeys);
    if (upNextAssignment) {
      notifiedUpNextRef.current = `${upNextAssignment.match.key}|${upNextAssignment.assignment.teamNumber || ""}`;
    } else {
      notifiedUpNextRef.current = "";
    }
    notificationsInitializedRef.current = true;
  }, [notificationPermission, notificationsSupported, visibleSubInRequests, upNextAssignment]);

  useEffect(() => {
    if (!notificationsSupported || notificationPermission !== "granted") return;
    if (!notificationsInitializedRef.current) return;
    visibleSubInRequests.forEach((request) => {
      const key = subInRequestKey(request);
      if (!key || notifiedSubInRequestsRef.current.has(key)) return;
      const enabledAt = notificationsEnabledAtRef.current;
      const requestedAt = Number(request.requestedAt || 0);
      if (enabledAt && (!requestedAt || requestedAt <= enabledAt)) return;
      try {
        const body = `${request.matchLabel || "Match"}${request.teamNumber ? ` - Team ${request.teamNumber}` : ""}`;
        new Notification("Sub-In Requested", { body });
        notifiedSubInRequestsRef.current.add(key);
      } catch (error) {
        console.warn("Unable to send sub-in notification:", error);
      }
    });
  }, [visibleSubInRequests, notificationPermission, notificationsSupported]);

  useEffect(() => {
    if (!notificationsSupported || notificationPermission !== "granted") return;
    if (!notificationsInitializedRef.current) return;
    if (!upNextAssignment) return;
    const key = `${upNextAssignment.match.key}|${upNextAssignment.assignment.teamNumber || ""}`;
    if (notifiedUpNextRef.current === key) return;
    const enabledAt = notificationsEnabledAtRef.current;
    if (enabledAt && upNextAssignment.match.scheduleTime > 0 && upNextAssignment.match.scheduleTime * 1000 <= enabledAt) {
      notifiedUpNextRef.current = key;
      return;
    }
    try {
      const body = `${upNextAssignment.match.label}${upNextAssignment.assignment.teamNumber ? ` - Team ${upNextAssignment.assignment.teamNumber}` : ""}`;
      new Notification("Up Next Assignment", { body });
      notifiedUpNextRef.current = key;
    } catch (error) {
      console.warn("Unable to send up-next notification:", error);
    }
  }, [upNextAssignment, notificationPermission, notificationsSupported]);

  async function handleSaveScoutCount() {
    if (!userData?.teamId) return;
    
    const count = parseInt(scoutCountInput);
    if (isNaN(count) || count < 1 || count > 20) {
      alert('Please enter a number between 1 and 20');
      return;
    }

    try {
      await setDoc(doc(db, "teams", userData.teamId), { scoutCount: count }, { merge: true });
      setTeamData({ ...teamData, scoutCount: count });
      setEditingScoutCount(false);
      alert('Scout count updated!');
    } catch (error) {
      console.error('Error updating scout count:', error);
      alert('Error updating scout count');
    }
  }

  async function handleSaveEventScoutCounts() {
    if (!userData?.teamId) return;
    const payload: Record<string, number> = {};
    for (const [eventKey, rawValue] of Object.entries(eventScoutCountInputs)) {
      const count = parseInt(rawValue, 10);
      if (isNaN(count) || count < 1 || count > 20) {
        alert("Each event scout count must be between 1 and 20.");
        return;
      }
      payload[eventKey] = count;
    }

    try {
      await setDoc(doc(db, "teams", userData.teamId), { eventScoutCounts: payload }, { merge: true });
      setTeamData({ ...teamData, eventScoutCounts: payload });
      setEditingScoutCount(false);
      alert("Event scout counts updated.");
    } catch (error) {
      console.error("Error updating event scout counts:", error);
      alert("Error updating event scout counts");
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
            Team Coach Dashboard
          </h1>
          <p className="text-gray-600 mb-8">Welcome back! Here&apos;s what&apos;s happening with your team.</p>
          <DataSourceCredits className="mb-6" />

          {loading ? (
            <LoadingSpinner message="Loading dashboard..." />
          ) : (
            <>
              {notificationsSupported && notificationPermission !== "granted" && (
                <div className="bg-white rounded-xl shadow-md p-5 mb-6 border-l-4" style={{ borderColor: "var(--primary-color)" }}>
                  <h2 className="text-xl font-semibold mb-2">Enable Notifications</h2>
                  <p className="text-sm text-gray-700 mb-3">
                    Turn on device notifications for sub-in requests and upcoming assignments.
                  </p>
                  <button
                    type="button"
                    onClick={() => void requestNotificationPermission()}
                    className="px-4 py-2 rounded text-white text-sm font-semibold"
                    style={{ backgroundColor: "var(--primary-color)" }}
                  >
                    Enable Notifications
                  </button>
                  {notificationPermission === "denied" && (
                    <p className="text-xs text-gray-500 mt-2">
                      Notifications are blocked in your browser settings. Re-enable them to get alerts.
                    </p>
                  )}
                </div>
              )}

              {visibleSubInRequests.length > 0 && (
                <div className="bg-white rounded-xl shadow-md p-5 mb-6 border-l-4 border-orange-500">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <h2 className="text-xl font-semibold">Sub-In Requests</h2>
                    {userData?.isTeamAdmin && (
                      <button
                        type="button"
                        onClick={() => void clearAllSubInRequests()}
                        disabled={subInClearing}
                        className="px-3 py-1 rounded text-xs font-semibold border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60"
                      >
                        {subInClearing ? "Clearing..." : "Clear All"}
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {visibleSubInRequests.map((request) => {
                      const claimKey = `${request.eventKey || ""}|${request.matchId || ""}|${request.teamNumber || ""}`;
                      const claim = subInClaimsByKey[claimKey];
                      const isRequester = Boolean(request.requestedById && userData?.uid && request.requestedById === userData.uid);
                      return (
                        <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <div className="text-gray-800">
                            <span className="font-semibold">{request.matchLabel || "Match"}</span>
                            {request.teamNumber ? ` - Team ${request.teamNumber}` : ""}
                            {request.requestedByName ? ` - Requested by ${request.requestedByName}` : ""}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {claim ? (
                              <span className="text-xs font-semibold text-green-700">
                                Sub Assigned{claim.claimedByName ? ` - ${claim.claimedByName}` : ""}
                              </span>
                            ) : isRequester ? (
                              <button
                                type="button"
                                onClick={() => void deleteSubInRequest(request)}
                                className="px-3 py-1 rounded text-xs font-semibold border border-red-200 text-red-700 hover:bg-red-50"
                              >
                                Delete Request
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void claimSubIn(request)}
                                disabled={subInClaimingId === request.id}
                                className="px-3 py-1 rounded text-xs font-semibold text-white disabled:opacity-60"
                                style={{ backgroundColor: "var(--primary-color)" }}
                              >
                                {subInClaimingId === request.id ? "Assigning..." : "Take Sub-In"}
                              </button>
                            )}
                            {request.requestedAt ? (
                              <span className="text-xs text-gray-500">
                                {new Date(request.requestedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {upNextAssignment && (
                <div className="bg-white rounded-xl shadow-md p-5 mb-6 border-l-4 border-amber-500">
                  <h2 className="text-xl font-semibold mb-2">Up Next Assignment</h2>
                  <p className="text-sm text-gray-800">
                    You are up next for <span className="font-semibold">{upNextAssignment.match.label}</span>
                    {upNextAssignment.assignment.teamNumber ? ` - Team ${upNextAssignment.assignment.teamNumber}` : ""}.
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {upNextAssignment.match.scheduleTime > 0
                      ? new Date(upNextAssignment.match.scheduleTime * 1000).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "Time TBD"}
                  </p>
                </div>
              )}

              {!upNextAssignment && upcomingAssignment && (
                <div className="bg-white rounded-xl shadow-md p-5 mb-6 border-l-4 border-blue-500">
                  <h2 className="text-xl font-semibold mb-2">Upcoming Assignment</h2>
                  <p className="text-sm text-gray-800">
                    Your next assigned match is <span className="font-semibold">{upcomingAssignment.match.label}</span>
                    {upcomingAssignment.assignment.teamNumber ? ` - Team ${upcomingAssignment.assignment.teamNumber}` : ""}.
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {upcomingAssignment.match.scheduleTime > 0
                      ? new Date(upcomingAssignment.match.scheduleTime * 1000).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "Time TBD"}
                  </p>
                </div>
              )}

              {/* EVENT TABS + MATCHES */}
              {upcomingEvents.length > 0 && (
                <div className="mb-6">
                  <div className="bg-white rounded-xl shadow-md p-4 mb-4">
                    <div className="overflow-x-auto">
                      <div className="inline-flex gap-2 min-w-full">
                        {upcomingEvents.map((event) => (
                          <button
                            key={event.key}
                            onClick={() => setActiveEventKey(event.key)}
                            className={`px-4 py-2 rounded-lg whitespace-nowrap font-medium transition-colors ${
                              activeEventKey === event.key ? "text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                            style={activeEventKey === event.key ? { backgroundColor: "var(--primary-color)" } : {}}
                          >
                            {event.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {(() => {
                    const event = activeEvent;
                    if (!event) return null;
                    const expected = teamData?.eventScoutCounts?.[event.key] || teamData?.scoutCount || 6;
                    const attendees = Array.isArray(teamData?.eventAttendees?.[event.key]) ? teamData.eventAttendees[event.key] : [];
                    const readyNameLookup = new Set(readyScoutNames.map((name) => name.trim().toLowerCase()));
                    const readyIdLookup = new Set(readyScoutIds.map((id) => id.trim()));
                    const readyAttendees = attendees.length > 0
                      ? attendees.filter((value: string) => {
                          const safe = String(value || "").trim();
                          return readyIdLookup.has(safe) || readyNameLookup.has(safe.toLowerCase());
                        }).length
                      : readyScoutNames.length;
                    const eventMatches = activeMatches;
                    const eventIsPast = isPastEvent(event, nowMs);
                    return (
                      <div className="space-y-4">
                        <div className="bg-white rounded-xl shadow-md p-6 border-l-4" style={{ borderColor: "var(--primary-color)" }}>
                          <div className="flex items-start justify-between">
                            <div>
                              <h2 className="text-xl font-semibold mb-1">{eventIsPast ? "Past Event" : "Upcoming Event"}</h2>
                              <p className="text-2xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
                                {event.name}
                              </p>
                              <p className="text-gray-600 flex flex-wrap items-center gap-2">
                                <CalendarDays size={16} />
                                <span>
                                  {new Date(event.startDate + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })} - {new Date(event.endDate + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                                </span>
                                <span aria-hidden="true">•</span>
                                <MapPin size={16} />
                                <span>{event.location}</span>
                              </p>
                              <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-4">
                                <div>
                                  <p className="text-sm text-gray-600">{eventIsPast ? "Event Status" : "Days Until Event"}</p>
                                  <p className="text-2xl font-bold">{eventIsPast ? "Ended" : event.daysUntil}</p>
                                </div>
                                <div>
                                  <p className="text-sm text-gray-600">{`Scouts Ready (${accuracyMode})`}</p>
                                  <p className="text-2xl font-bold">{readyAttendees}/{expected}</p>
                                </div>
                                <div>
                                  <p className="text-sm text-gray-600">Matches Loaded</p>
                                  <p className="text-2xl font-bold">{eventMatches.length}</p>
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => router.push(`/event-details/${event.key}`)}
                              className="px-4 py-2 rounded-lg text-white font-medium"
                              style={{ backgroundColor: "var(--primary-color)" }}
                            >
                              View Details
                            </button>
                          </div>
                        </div>
                        <div className="bg-white rounded-xl shadow-md overflow-hidden">
                          <div className="p-6 border-b border-gray-200">
                            <h3 className="text-xl font-semibold">Upcoming Matches</h3>
                            <p className="text-sm text-gray-600">All matches for this selected event.</p>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[840px]">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Match</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Red Alliance</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Blue Alliance</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {eventMatches.length > 0 ? (
                                  eventMatches.map((match) => (
                                    <tr key={match.key}>
                                      <td className="px-4 py-3 font-medium">{match.label}</td>
                                      <td className="px-4 py-3 text-sm text-gray-600">
                                        {match.scheduleTime > 0
                                          ? new Date(match.scheduleTime * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                                          : "TBD"}
                                      </td>
                                      <td className="px-4 py-3 text-sm text-gray-700">{match.redTeams.join(", ") || "-"}</td>
                                      <td className="px-4 py-3 text-sm text-gray-700">{match.blueTeams.join(", ") || "-"}</td>
                                    </tr>
                                  ))
                                ) : (
                                  <tr>
                                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                                      No matches available yet for this event.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="bg-white rounded-xl shadow-md p-4 mb-6">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="font-semibold text-gray-700">Accuracy Source</h3>
                    <p className="text-sm text-gray-600">Active scout and average % cards use this mode.</p>
                  </div>
                  <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setAccuracyMode("trial")}
                      className={`px-4 py-2 text-sm font-medium ${
                        accuracyMode === "trial" ? "text-white" : "bg-white text-gray-700 hover:bg-gray-100"
                      }`}
                      style={accuracyMode === "trial" ? { backgroundColor: "var(--primary-color)" } : {}}
                    >
                      Trial
                    </button>
                    <button
                      type="button"
                      onClick={() => setAccuracyMode("competitive")}
                      className={`px-4 py-2 text-sm font-medium ${
                        accuracyMode === "competitive" ? "text-white" : "bg-white text-gray-700 hover:bg-gray-100"
                      }`}
                      style={accuracyMode === "competitive" ? { backgroundColor: "var(--primary-color)" } : {}}
                    >
                      Competitive
                    </button>
                  </div>
                </div>
              </div>

              {/* STATS GRID */}
              <div className="grid md:grid-cols-3 gap-6 mb-6">
                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Total Entries</h3>
                    <BarChart3 size={22} />
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "var(--primary-color)" }}>
                    {stats?.totalEntries || 0}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">Across all events</p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Active Scouts</h3>
                    <Users size={22} />
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "var(--primary-color)" }}>
                    {readyScoutNames.length}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    {`All scouts >=75% (${accuracyMode})`}
                  </p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Avg. Accuracy</h3>
                    <Target size={22} />
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "var(--primary-color)" }}>
                    {typeof eventAverageAccuracyByKey[activeEventKey] === "number"
                      ? eventAverageAccuracyByKey[activeEventKey]
                      : overallAverageAccuracy}%
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    {typeof eventAverageAccuracyByKey[activeEventKey] === "number"
                      ? `Average ${accuracyMode} practice accuracy for attending scouts`
                      : `Average ${accuracyMode} practice accuracy for all scouts`}
                  </p>
                </div>
              </div>

              {/* SCOUT COUNT CONFIGURATION */}
              <div className="bg-white rounded-xl shadow-md p-6 mb-6">
                <h3 className="text-lg font-semibold mb-4">Team Configuration</h3>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 mb-2">Expected Scouts Per Event</p>
                    {editingScoutCount ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-700 w-28">Default</span>
                          <input
                            type="number"
                            value={scoutCountInput}
                            onChange={(e) => setScoutCountInput(e.target.value)}
                            className="border rounded px-3 py-2 w-24"
                            min="1"
                            max="20"
                            placeholder="6"
                          />
                          <button
                            onClick={handleSaveScoutCount}
                            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium"
                          >
                            Save Default
                          </button>
                        </div>
                        {upcomingEvents.map((event) => (
                          <div key={event.key} className="flex items-center gap-2">
                            <span className="text-sm text-gray-700 w-28">{event.name.split(" ")[0]}</span>
                            <input
                              type="number"
                              value={eventScoutCountInputs[event.key] ?? ""}
                              onChange={(e) =>
                                setEventScoutCountInputs((prev) => ({ ...prev, [event.key]: e.target.value }))
                              }
                              className="border rounded px-3 py-2 w-24"
                              min="1"
                              max="20"
                              placeholder={String(teamData?.scoutCount || 6)}
                            />
                          </div>
                        ))}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleSaveEventScoutCounts}
                            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium"
                          >
                            Save Event Counts
                          </button>
                          <button
                            onClick={() => setEditingScoutCount(false)}
                            className="px-4 py-2 bg-gray-400 text-white rounded hover:bg-gray-500 text-sm font-medium"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-4">
                        <div>
                          <p className="text-4xl font-bold" style={{ color: "var(--primary-color)" }}>
                            {teamData?.scoutCount || 6}
                          </p>
                          {upcomingEvents.map((event) => (
                            <p key={event.key} className="text-xs text-gray-600">
                              {event.name}: {teamData?.eventScoutCounts?.[event.key] || teamData?.scoutCount || 6}
                            </p>
                          ))}
                        </div>
                        <button 
                          onClick={() => {
                            setScoutCountInput((teamData?.scoutCount || 6).toString());
                            const currentEventCounts = teamData?.eventScoutCounts || {};
                            const initialInputs: Record<string, string> = {};
                            upcomingEvents.forEach((event) => {
                              initialInputs[event.key] = String(currentEventCounts[event.key] || teamData?.scoutCount || 6);
                            });
                            setEventScoutCountInputs(initialInputs);
                            setEditingScoutCount(true);
                          }}
                          className="text-sm text-blue-600 hover:underline font-medium"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">This number is used to calculate</p>
                    <p className="text-xs text-gray-500">scout accuracy thresholds</p>
                  </div>
                </div>
              </div>

              {/* QUICK ACTIONS */}
              <div className="bg-white rounded-xl shadow-md p-6 mb-6">
                <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
                <div className="grid md:grid-cols-2 gap-4">
                  <button
                    onClick={() => router.push("/scout-form?lead=0")}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                  >
                    <ClipboardList size={22} className="mb-2" />
                    <h3 className="font-semibold mb-1">Start Scouting</h3>
                    <p className="text-sm text-gray-600">Begin a new scouting session</p>
                  </button>

                  <button
                    onClick={() => router.push("/analytics")}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                  >
                    <BarChart3 size={22} className="mb-2" />
                    <h3 className="font-semibold mb-1">View Analytics</h3>
                    <p className="text-sm text-gray-600">Analyze team performance data</p>
                  </button>

                  <button
                    onClick={() => router.push("/form-builder")}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                  >
                    <Wrench size={22} className="mb-2" />
                    <h3 className="font-semibold mb-1">Edit Form</h3>
                    <p className="text-sm text-gray-600">Customize scouting fields</p>
                  </button>

                  <button
                    onClick={() => router.push("/event-details")}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                  >
                    <CalendarDays size={22} className="mb-2" />
                    <h3 className="font-semibold mb-1">Event Details</h3>
                    <p className="text-sm text-gray-600">Open event details and schedules</p>
                  </button>

                  <button
                    onClick={() => router.push("/scout-accuracy")}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                  >
                    <Target size={22} className="mb-2" />
                    <h3 className="font-semibold mb-1">Scout Accuracy</h3>
                    <p className="text-sm text-gray-600">Review scout performance</p>
                  </button>
                </div>
              </div>

              {/* RECENT ACTIVITY */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
                {stats?.recentActivity && stats.recentActivity.length > 0 ? (
                  <div className="space-y-3">
                    {stats.recentActivity.map((activity) => (
                      <div key={activity.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                        <span className="text-gray-600 mt-0.5">
                          {activity.type === "scouting" ? <ClipboardList size={18} /> : activity.type === "practice" ? <Target size={18} /> : <Users size={18} />}
                        </span>
                        <div className="flex-1">
                          <p className="font-medium">{formatActivity(activity)}</p>
                          <p className="text-sm text-gray-600">
                            {new Date(activity.timestamp).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">No recent activity</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CoachDashboard() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["team-coach"]}>
      <CoachDashboardContent />
    </ProtectedRoute>
  );
}

