"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import Sidebar from "@/app/components/Sidebar";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { useAuth } from "@/app/AuthContext";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";
import { calculateTeamStats, getUpcomingEvents, type TeamStats, type UpcomingEvent } from "@/app/utils/stats-calculator";
import { getEventMatches, type TBAMatch } from "@/app/utils/tba-api";
import { canAccessForm, normalizeFormAccessOverrides, type FormAccessOverrides, type TeamRole } from "@/app/utils/roles";
import { BarChart3, CalendarDays, ClipboardList, MapPin, Target, TriangleAlert } from "lucide-react";
import DataSourceCredits from "@/app/components/DataSourceCredits";

type DashboardMatch = {
  key: string;
  label: string;
  scheduleTime: number;
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

type TeamRoleDashboardProps = {
  role: TeamRole;
  title: string;
  subtitle: string;
  roleDescription: string;
  specialNotice?: {
    title: string;
    description: string;
    actionLabel?: string;
    actionHref?: string;
  };
  showAssignmentsAction?: boolean;
  analyticsGuidance?: boolean;
  pitScoutFocus?: boolean;
  pitTeamFocus?: boolean;
  driveTeamFocus?: boolean;
  showManualScoutFallback?: boolean;
};

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
      redTeams: match.alliances.red.team_keys
        .map((key) => parseInt(key.replace("frc", ""), 10))
        .filter((value) => Number.isFinite(value)),
      blueTeams: match.alliances.blue.team_keys
        .map((key) => parseInt(key.replace("frc", ""), 10))
        .filter((value) => Number.isFinite(value)),
    }));
}

function isEventActive(event: UpcomingEvent) {
  const now = Date.now();
  const start = new Date(`${event.startDate}T00:00:00`).getTime();
  const end = new Date(`${event.endDate}T23:59:59`).getTime();
  return now >= start && now <= end;
}

function parseTeamNumber(input: string | undefined | null): number | null {
  if (!input) return null;
  const numeric = String(input).match(/\d+/)?.[0];
  if (!numeric) return null;
  const parsed = parseInt(numeric, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function TeamRoleDashboardContent({
  title,
  subtitle,
  roleDescription,
  specialNotice,
  showAssignmentsAction,
  analyticsGuidance,
  pitScoutFocus,
  pitTeamFocus,
  driveTeamFocus,
  showManualScoutFallback,
}: Omit<TeamRoleDashboardProps, "role">) {
  const { userData } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [activeEventKey, setActiveEventKey] = useState("");
  const [eventMatchesByKey, setEventMatchesByKey] = useState<Record<string, DashboardMatch[]>>({});
  const [practiceSessionsCount, setPracticeSessionsCount] = useState(0);
  const [unscoutedTeams, setUnscoutedTeams] = useState<number[]>([]);
  const [nextTeamMatch, setNextTeamMatch] = useState<DashboardMatch | null>(null);
  const [formAccessOverrides, setFormAccessOverrides] = useState<FormAccessOverrides>({});

  useEffect(() => {
    if (userData && !userData.teamId) {
      router.push(getDashboardRoute(userData));
      return;
    }
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData?.teamId, userData?.uid]);

  async function loadData() {
    if (!userData?.teamId || !userData?.uid) return;
    setLoading(true);
    try {
      const teamStats: TeamStats = await calculateTeamStats(userData.teamId);
      const events: UpcomingEvent[] = await getUpcomingEvents(userData.teamId);
      const practiceSnap = await getDocs(
        query(collection(db, "practiceSessions"), where("scoutName", "==", userData.displayName || ""))
      );
      const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
      setFormAccessOverrides(normalizeFormAccessOverrides(teamDoc.exists() ? teamDoc.data().formAccessOverrides : null));
      const attendanceByEvent = teamDoc.exists()
        ? (teamDoc.data().eventAttendees as Record<string, string[]> | undefined) || {}
        : {};
      const visibleEvents = filterEventsByAttendance(
        events,
        attendanceByEvent,
        userData.uid || "",
        userData.displayName || ""
      );

      setStats(teamStats);
      setUpcomingEvents(visibleEvents);
      setActiveEventKey((current) => {
        if (current && visibleEvents.some((event) => event.key === current)) return current;
        return visibleEvents[0]?.key || "";
      });
      setPracticeSessionsCount(practiceSnap.size);

      const eventMatches = await Promise.all(
        visibleEvents.map(async (event: UpcomingEvent) => {
          try {
            const matches = await getEventMatches(event.key);
            return [event.key, normalizeMatches(matches)] as const;
          } catch (error) {
            console.error(`Unable to fetch matches for ${event.key}:`, error);
            return [event.key, []] as const;
          }
        })
      );
      const matchMap: Record<string, DashboardMatch[]> = Object.fromEntries(eventMatches);
      setEventMatchesByKey(matchMap);

      const activeEvent =
        visibleEvents.find((event: UpcomingEvent) => event.key === (visibleEvents[0]?.key || "")) || visibleEvents[0];
      if (pitScoutFocus && activeEvent) {
        const eventTeams: number[] = Array.from(
          new Set((matchMap[activeEvent.key] || []).flatMap((match: DashboardMatch) => [...match.redTeams, ...match.blueTeams]))
        ).sort((a: number, b: number) => a - b);
        const pitSnap = await getDocs(
          query(
            collection(db, "pitScouting"),
            where("teamId", "==", userData.teamId),
            where("eventKey", "==", activeEvent.key)
          )
        );
        const alreadyScouted = new Set(
          pitSnap.docs
            .map((docSnap) => parseInt(String(docSnap.data().teamNumber || ""), 10))
            .filter((value: number) => Number.isFinite(value))
        );
        setUnscoutedTeams(eventTeams.filter((team) => !alreadyScouted.has(team)));
      }

      if (driveTeamFocus) {
        const teamNumber = parseTeamNumber(String(teamDoc.data()?.teamNumber || teamDoc.data()?.teamName || userData.teamId));
        if (teamNumber) {
          const allMatches: DashboardMatch[] = Object.values(matchMap).flatMap((matches: DashboardMatch[]) => matches);
          const nowSec = Math.floor(Date.now() / 1000);
          const nextMatch = allMatches
            .filter((match: DashboardMatch) => match.scheduleTime > nowSec)
            .filter((match: DashboardMatch) => [...match.redTeams, ...match.blueTeams].includes(teamNumber))
            .sort((a: DashboardMatch, b: DashboardMatch) => a.scheduleTime - b.scheduleTime)[0] || null;
          setNextTeamMatch(nextMatch);
        } else {
          setNextTeamMatch(null);
        }
      }
    } catch (error) {
      console.error("Error loading role dashboard:", error);
    } finally {
      setLoading(false);
    }
  }

  const needsPractice = practiceSessionsCount < 3;
  const canOpenMatchForm = canAccessForm({ formKey: "match-scout-form", user: userData, formAccessOverrides });
  const canOpenPitForm = canAccessForm({ formKey: "pit-scout-form", user: userData, formAccessOverrides });
  const activeEvent = useMemo(
    () => upcomingEvents.find((event) => event.key === activeEventKey) || upcomingEvents[0],
    [activeEventKey, upcomingEvents]
  );
  const activeMatches = activeEvent ? eventMatchesByKey[activeEvent.key] || [] : [];

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>{title}</h1>
          <p className="text-gray-600 mb-2">{subtitle}</p>
          <p className="text-sm text-gray-700 mb-8">{roleDescription}</p>
          <DataSourceCredits className="mb-6" />

          {loading ? (
            <div className="text-center py-12">
              <LoadingSpinner />
              <p className="text-gray-600 mt-4">Loading dashboard...</p>
            </div>
          ) : (
            <>
              {specialNotice && (
                <div className="bg-white rounded-xl shadow-md p-6 mb-6 border-l-4" style={{ borderColor: "var(--primary-color)" }}>
                  <h2 className="text-xl font-semibold mb-2">{specialNotice.title}</h2>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-gray-700">{specialNotice.description}</p>
                    {specialNotice.actionLabel && specialNotice.actionHref && (
                      <button
                        onClick={() => router.push(specialNotice.actionHref || "/")}
                        className="px-4 py-2 rounded-lg text-white font-medium"
                        style={{ backgroundColor: "var(--primary-color)" }}
                      >
                        {specialNotice.actionLabel}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {showAssignmentsAction && (
                <div className="bg-white rounded-xl shadow-md p-6 mb-6 border-l-4" style={{ borderColor: "var(--primary-color)" }}>
                  <h2 className="text-xl font-semibold mb-2">Match Assignments</h2>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-gray-700">Review assignment coverage and manage scout workload before scouting starts.</p>
                    <button
                      onClick={() => router.push("/assignments")}
                      className="px-4 py-2 rounded-lg text-white font-medium"
                      style={{ backgroundColor: "var(--primary-color)" }}
                    >
                      Open Assignments
                    </button>
                  </div>
                </div>
              )}

              {pitScoutFocus && (
                <div className="bg-white rounded-xl shadow-md p-6 mb-6">
                  <h2 className="text-xl font-semibold mb-2">Teams Left To Scout</h2>
                  {activeEvent ? (
                    <>
                      <p className="text-sm text-gray-600 mb-3">Detected event: {activeEvent.name}</p>
                      {unscoutedTeams.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {unscoutedTeams.map((team) => (
                            <span key={team} className="px-2 py-1 text-sm rounded bg-gray-100 border">Team {team}</span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-700">No unscouted teams left for the detected event.</p>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-gray-700">No teams have been picked for pit scouting yet.</p>
                      <button
                        onClick={() => router.push("/event-details")}
                        className="px-4 py-2 rounded-lg text-white font-medium"
                        style={{ backgroundColor: "var(--primary-color)" }}
                      >
                        View Team List
                      </button>
                    </div>
                  )}
                </div>
              )}

              {pitTeamFocus && (
                <div className="bg-white rounded-xl shadow-md p-6 mb-6">
                  <h2 className="text-xl font-semibold mb-2">Helper Form Status</h2>
                  {activeEvent && isEventActive(activeEvent) ? (
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <p className="text-sm text-gray-700">Competition is active. Log any pit assistance in the Helper Form.</p>
                      <button
                        onClick={() => router.push("/helper-form")}
                        className="px-4 py-2 rounded-lg text-white font-medium"
                        style={{ backgroundColor: "var(--primary-color)" }}
                      >
                        Open Helper Form
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-gray-700">No active competition detected yet.</p>
                      <button
                        onClick={() => router.push("/event-details")}
                        className="px-4 py-2 rounded-lg text-white font-medium"
                        style={{ backgroundColor: "var(--primary-color)" }}
                      >
                        View Events
                      </button>
                    </div>
                  )}
                </div>
              )}

              {driveTeamFocus && (
                <div className="bg-white rounded-xl shadow-md p-6 mb-6">
                  <h2 className="text-xl font-semibold mb-2">Next Team Match</h2>
                  {nextTeamMatch ? (
                    <>
                      <p className="font-semibold">{nextTeamMatch.label}</p>
                      <p className="text-sm text-gray-600 mb-2">
                        {new Date(nextTeamMatch.scheduleTime * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </p>
                      <p className="text-sm text-gray-700">Reminder: complete the Drive Reflection Form immediately after this match.</p>
                    </>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-gray-700">No team matches are assigned yet.</p>
                      <button
                        onClick={() => router.push("/match-list")}
                        className="px-4 py-2 rounded-lg text-white font-medium"
                        style={{ backgroundColor: "var(--primary-color)" }}
                      >
                        View Match List
                      </button>
                    </div>
                  )}
                </div>
              )}

              {analyticsGuidance && (
                <div className="bg-white rounded-xl shadow-md p-6 mb-6">
                  <h2 className="text-xl font-semibold mb-2">Analytics Focus</h2>
                  {activeEvent ? (
                    <p className="text-sm text-gray-700">Use Analytics to shape match plans for {activeEvent.name} and adjust strategy between matches.</p>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-gray-700">No active competition is detected yet.</p>
                      <button
                        onClick={() => router.push("/analytics")}
                        className="px-4 py-2 rounded-lg text-white font-medium"
                        style={{ backgroundColor: "var(--primary-color)" }}
                      >
                        Open Analytics
                      </button>
                    </div>
                  )}
                </div>
              )}

              {showManualScoutFallback && activeMatches.length === 0 && (
                <div className="bg-white rounded-xl shadow-md p-6 mb-6 border-l-4" style={{ borderColor: "var(--primary-color)" }}>
                  <h2 className="text-xl font-semibold mb-2">No Matches Assigned Yet</h2>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-gray-700">You can still open the match form and scout manually.</p>
                    <button
                      onClick={() => router.push("/scout-form")}
                      className="px-4 py-2 rounded-lg text-white font-medium"
                      style={{ backgroundColor: "var(--primary-color)" }}
                    >
                      Scout Manually
                    </button>
                  </div>
                </div>
              )}

              {needsPractice && (
                <div
                  className="rounded-xl p-6 mb-6 border-l-4"
                  style={{
                    backgroundColor: "var(--theme-surface-raised)",
                    borderColor: "rgba(var(--primary-rgb), 0.45)",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                  }}
                >
                  <div className="flex items-start gap-4">
                    <span className="mt-0.5" style={{ color: "var(--primary-color)" }}>
                      <TriangleAlert size={28} />
                    </span>
                    <div className="flex-1">
                      <h3 className="font-semibold mb-1 text-gray-900">Practice Scouting Required</h3>
                      <p className="text-sm text-gray-700 mb-3">
                        You need to complete {3 - practiceSessionsCount} more practice session(s) to verify accuracy before event operations.
                      </p>
                      <button
                        onClick={() => router.push("/practice-scouting")}
                        className="px-4 py-2 rounded-lg text-white font-medium"
                        style={{ backgroundColor: "var(--primary-color)" }}
                      >
                        Start Practice Session
                      </button>
                    </div>
                  </div>
                </div>
              )}

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

                  {activeEvent && (
                    <div className="space-y-4">
                      <div className="bg-white rounded-xl shadow-md p-6 border-l-4" style={{ borderColor: "var(--primary-color)" }}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h2 className="text-xl font-semibold mb-1">Event Data</h2>
                            <p className="text-2xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>{activeEvent.name}</p>
                            <p className="text-gray-600 flex flex-wrap items-center gap-2">
                              <CalendarDays size={16} />
                              <span>
                                {new Date(activeEvent.startDate + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })} - {new Date(activeEvent.endDate + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                              </span>
                              <span aria-hidden="true">|</span>
                              <MapPin size={16} />
                              <span>{activeEvent.location}</span>
                            </p>
                          </div>
                          <button
                            onClick={() => router.push(`/event-details/${activeEvent.key}`)}
                            className="px-4 py-2 rounded-lg text-white font-medium whitespace-nowrap"
                            style={{ backgroundColor: "var(--primary-color)" }}
                          >
                            View Details
                          </button>
                        </div>
                      </div>

                      <div className="bg-white rounded-xl shadow-md overflow-hidden">
                        <div className="p-6 border-b border-gray-200">
                          <h3 className="text-xl font-semibold">Upcoming Matches</h3>
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
                              {activeMatches.length > 0 ? (
                                activeMatches.map((match) => (
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
                                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">No matches available yet for this event.</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="grid md:grid-cols-3 gap-6 mb-6">
                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Total Entries</h3>
                    <ClipboardList size={22} />
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "var(--primary-color)" }}>{stats?.totalEntries || 0}</p>
                  <p className="text-sm text-gray-600 mt-1">Team scouting entries</p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Active Scouts</h3>
                    <Target size={22} />
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "var(--primary-color)" }}>{stats?.activeScouts || 0}</p>
                  <p className="text-sm text-gray-600 mt-1">Ready scouts ({stats?.totalScouts || 0} total)</p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Avg. Accuracy</h3>
                    <BarChart3 size={22} />
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "var(--primary-color)" }}>{stats?.averageAccuracy || 0}%</p>
                  <p className="text-sm text-gray-600 mt-1">REBUILT scouted-match average</p>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
                <div className="grid md:grid-cols-2 gap-4">
                  <button
                    onClick={() => router.push("/analytics")}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                  >
                    <BarChart3 size={22} className="mb-2" />
                    <h3 className="font-semibold mb-1">Open Analytics</h3>
                    <p className="text-sm text-gray-600">Review team and event data</p>
                  </button>

                  <button
                    onClick={() => router.push("/practice-scouting")}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                  >
                    <Target size={22} className="mb-2" />
                    <h3 className="font-semibold mb-1">Practice Scouting</h3>
                    <p className="text-sm text-gray-600">Run calibration sessions</p>
                  </button>

                  {canOpenMatchForm && (
                    <button
                      onClick={() => router.push("/scout-form")}
                      className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                    >
                      <ClipboardList size={22} className="mb-2" />
                      <h3 className="font-semibold mb-1">Open Match Scout Form</h3>
                      <p className="text-sm text-gray-600">Submit match observations</p>
                    </button>
                  )}

                  {canOpenPitForm && (
                    <button
                      onClick={() => router.push("/pit-scout-form")}
                      className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                    >
                      <ClipboardList size={22} className="mb-2" />
                      <h3 className="font-semibold mb-1">Open Pit Scout Form</h3>
                      <p className="text-sm text-gray-600">Capture pit capabilities</p>
                    </button>
                  )}

                  {showAssignmentsAction && (
                    <button
                      onClick={() => router.push("/assignments")}
                      className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                    >
                      <CalendarDays size={22} className="mb-2" />
                      <h3 className="font-semibold mb-1">Manage Assignments</h3>
                      <p className="text-sm text-gray-600">Assign scouts to matches</p>
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TeamRoleDashboard(props: TeamRoleDashboardProps) {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={[props.role]}>
      <TeamRoleDashboardContent {...props} />
    </ProtectedRoute>
  );
}
