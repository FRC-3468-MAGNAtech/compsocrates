"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { calculateTeamStats, getUpcomingEvents, formatActivity, type TeamStats, type UpcomingEvent } from "@/app/utils/stats-calculator";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { doc, setDoc, getDoc, collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";
import { getEventMatches, type TBAMatch } from "@/app/utils/tba-api";
import { BarChart3, CalendarDays, ClipboardList, Target, Users, Wrench, MapPin } from "lucide-react";

interface TeamData {
  scoutCount?: number;
  eventScoutCounts?: Record<string, number>;
  eventAttendees?: Record<string, string[]>;
}

type DashboardMatch = {
  key: string;
  label: string;
  scheduleTime: number;
  compLevel: TBAMatch["comp_level"];
  redTeams: number[];
  blueTeams: number[];
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
      compLevel: match.comp_level,
      redTeams: match.alliances.red.team_keys
        .map((key) => parseInt(key.replace("frc", ""), 10))
        .filter((value) => Number.isFinite(value)),
      blueTeams: match.alliances.blue.team_keys
        .map((key) => parseInt(key.replace("frc", ""), 10))
        .filter((value) => Number.isFinite(value)),
    }));
}

function CoachDashboardContent() {
  const router = useRouter();
  const { userData } = useAuth();
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

  useEffect(() => {
    if (userData && !userData.teamId) {
      setLoading(false);
      router.push(getDashboardRoute(userData));
      return;
    }
    loadDashboardData();
  }, [userData?.teamId, userData, router]);

  async function loadDashboardData() {
    if (!userData?.teamId) return;
    
    setLoading(true);
    try {
      const [teamStats, events, teamDoc, usersSnap, practiceSnap] = await Promise.all([
        calculateTeamStats(userData.teamId),
        getUpcomingEvents(userData.teamId),
        getDoc(doc(db, "teams", userData.teamId)),
        getDocs(query(collection(db, "users"), where("teamId", "==", userData.teamId))),
        getDocs(collection(db, "practiceSessions")),
      ]);
      
      setStats(teamStats);
      setUpcomingEvents(events);
      setActiveEventKey((current) => {
        if (current && events.some((event) => event.key === current)) return current;
        return events[0]?.key || "";
      });
      if (teamDoc.exists()) {
        setTeamData(teamDoc.data());
      }
      const eventMatches = await Promise.all(
        events.map(async (event) => {
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

      const normalize = (value: string | null | undefined) =>
        (value || "").toLowerCase().replace(/\s+/g, "-");
      const scouts = usersSnap.docs.filter((userDoc) => {
        const data = userDoc.data();
        const specialRole = normalize(data.specialRole);
        const specialRoles = Array.isArray(data.specialRoles) ? data.specialRoles.map(normalize) : [];
        return data.role === "scout" || specialRole === "lead-scout" || specialRoles.includes("lead-scout");
      });
      const scoutNames = scouts.map((docSnap) => docSnap.data().displayName);

      const accuracyMapByScout: Record<string, { total: number; count: number }> = {};
      practiceSnap.forEach((practiceDoc) => {
        const data = practiceDoc.data();
        if (!scoutNames.includes(data.scoutName) || typeof data.accuracy !== "number") return;
        const scoutName = String(data.scoutName || "");
        if (!accuracyMapByScout[scoutName]) {
          accuracyMapByScout[scoutName] = { total: 0, count: 0 };
        }
        accuracyMapByScout[scoutName].total += Number(data.accuracy || 0);
        accuracyMapByScout[scoutName].count += 1;
      });

      const computedReadyScouts = scoutNames.filter((name) => {
        const entry = accuracyMapByScout[name];
        return Boolean(entry && entry.count > 0 && (entry.total / entry.count) >= 80);
      });
      setReadyScoutNames(computedReadyScouts);
    } catch (error) {
      console.error("Error loading dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }

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
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
            Dashboard
          </h1>
          <p className="text-gray-600 mb-8">Welcome back! Here&apos;s what&apos;s happening with your team.</p>

          {loading ? (
            <LoadingSpinner message="Loading dashboard..." />
          ) : (
            <>
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
                            style={activeEventKey === event.key ? { backgroundColor: "#c42221" } : {}}
                          >
                            {event.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {(() => {
                    const event = upcomingEvents.find((item) => item.key === activeEventKey) || upcomingEvents[0];
                    if (!event) return null;
                    const expected = teamData?.eventScoutCounts?.[event.key] || teamData?.scoutCount || 6;
                    const attendees = Array.isArray(teamData?.eventAttendees?.[event.key]) ? teamData.eventAttendees[event.key] : [];
                    const readyLookup = new Set(readyScoutNames.map((name) => name.trim().toLowerCase()));
                    const readyAttendees = attendees.length > 0
                      ? attendees.filter((name: string) => readyLookup.has(String(name || "").trim().toLowerCase())).length
                      : readyScoutNames.length;
                    const eventMatches = eventMatchesByKey[event.key] || [];
                    return (
                      <div className="space-y-4">
                        <div className="bg-white rounded-xl shadow-md p-6 border-l-4" style={{ borderColor: "#c42221" }}>
                          <div className="flex items-start justify-between">
                            <div>
                              <h2 className="text-xl font-semibold mb-1">Upcoming Event</h2>
                              <p className="text-2xl font-bold mb-2" style={{ color: "#c42221" }}>
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
                              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div>
                                  <p className="text-sm text-gray-600">Days Until Event</p>
                                  <p className="text-2xl font-bold">{event.daysUntil}</p>
                                </div>
                                <div>
                                  <p className="text-sm text-gray-600">Scouts Ready</p>
                                  <p className="text-2xl font-bold">{readyAttendees}/{expected}</p>
                                </div>
                                <div>
                                  <p className="text-sm text-gray-600">Configured Scouts</p>
                                  <p className="text-2xl font-bold">{expected}</p>
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
                              style={{ backgroundColor: "#c42221" }}
                            >
                              View Details
                            </button>
                          </div>
                        </div>
                        <div className="bg-white rounded-xl shadow-md overflow-hidden">
                          <div className="p-6 border-b border-gray-200">
                            <h3 className="text-xl font-semibold">Match Schedule</h3>
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

              {/* STATS GRID */}
              <div className="grid md:grid-cols-3 gap-6 mb-6">
                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Total Entries</h3>
                    <BarChart3 size={22} />
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {stats?.totalEntries || 0}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">Across all events</p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Active Scouts</h3>
                    <Users size={22} />
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {stats?.activeScouts || 0}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    Ready scouts ({stats?.totalScouts || 0} total)
                  </p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Avg. Accuracy</h3>
                    <Target size={22} />
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {stats?.averageAccuracy || 0}%
                  </p>
                  <p className="text-sm text-gray-600 mt-1">Scout reliability</p>
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
                          <p className="text-4xl font-bold" style={{ color: "#c42221" }}>
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
                    onClick={() => router.push("/scout-form")}
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
    <ProtectedRoute requireAuth={true} allowedRoles={["coach"]}>
      <CoachDashboardContent />
    </ProtectedRoute>
  );
}
