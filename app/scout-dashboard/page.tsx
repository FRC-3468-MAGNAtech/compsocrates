"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { getUpcomingEvents, type UpcomingEvent } from "@/app/utils/stats-calculator";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";
import { getEventMatches, type TBAMatch } from "@/app/utils/tba-api";
import { BarChart3, CalendarDays, ClipboardList, Dumbbell, MapPin, Target, TriangleAlert } from "lucide-react";

type ScoutStats = {
  matchesScoutedCount: number;
  accuracyScore: number;
  practiceSessionsCount: number;
};

type MatchEntry = Record<string, unknown>;

type DashboardMatch = {
  key: string;
  label: string;
  scheduleTime: number;
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
      redTeams: match.alliances.red.team_keys
        .map((key) => parseInt(key.replace("frc", ""), 10))
        .filter((value) => Number.isFinite(value)),
      blueTeams: match.alliances.blue.team_keys
        .map((key) => parseInt(key.replace("frc", ""), 10))
        .filter((value) => Number.isFinite(value)),
    }));
}

function isRealCompetitionEntry(entry: MatchEntry): boolean {
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

function ScoutDashboardContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const [stats, setStats] = useState<ScoutStats | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [activeEventKey, setActiveEventKey] = useState("");
  const [eventMatchesByKey, setEventMatchesByKey] = useState<Record<string, DashboardMatch[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userData && !userData.teamId) {
      setLoading(false);
      router.push(getDashboardRoute(userData));
      return;
    }
    loadDashboardData();
  }, [userData, router]);

  async function loadDashboardData() {
    if (!userData) return;
    
    setLoading(true);
    try {
      // Get scout's scouting entries
      const entriesQuery = query(
        collection(db, "scouting"),
        where("scoutName", "==", userData.displayName)
      );
      const entriesSnapshot = await getDocs(entriesQuery);
      const matchesScoutedCount = entriesSnapshot.docs
        .map((docSnap) => docSnap.data() as MatchEntry)
        .filter(isRealCompetitionEntry).length;

      // Get scout's practice sessions
      const practiceQuery = query(
        collection(db, "practiceSessions"),
        where("scoutName", "==", userData.displayName)
      );
      const practiceSnapshot = await getDocs(practiceQuery);
      
      // Calculate average accuracy from practice sessions
      let totalAccuracy = 0;
      let practiceCount = 0;
      
      practiceSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.accuracy !== undefined) {
          totalAccuracy += data.accuracy;
          practiceCount++;
        }
      });

      const accuracyScore = practiceCount > 0 ? Math.round(totalAccuracy / practiceCount) : 0;

      setStats({
        matchesScoutedCount,
        accuracyScore,
        practiceSessionsCount: practiceSnapshot.size,
      });

      // Get selected/upcoming events for this scout's team
      const events = await getUpcomingEvents(userData.teamId);
      setUpcomingEvents(events);
      setActiveEventKey((current) => {
        if (current && events.some((event) => event.key === current)) return current;
        return events[0]?.key || "";
      });
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

    } catch (error) {
      console.error("Error loading dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }

  const needsPractice = stats && stats.practiceSessionsCount < 3;

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
            Dashboard
          </h1>
          <p className="text-gray-600 mb-8">Ready to scout? Here's your assignment.</p>

          {loading ? (
            <div className="text-center py-12">
              <LoadingSpinner />
              <p className="text-gray-600 mt-4">Loading dashboard...</p>
            </div>
          ) : (
            <>
              {/* NO ASSIGNMENT PLACEHOLDER */}
              <div className="bg-white rounded-xl shadow-md p-8 mb-6 text-center border-2 border-dashed border-gray-300">
                <div className="flex justify-center mb-3 text-gray-700">
                  <ClipboardList size={36} />
                </div>
                <h2 className="text-xl font-semibold mb-2">No Active Assignment</h2>
                <p className="text-gray-600 mb-4">
                  Your coach hasn't assigned you a match yet. Check back later or start practicing!
                </p>
                <button
                  onClick={() => router.push("/scout-form")}
                  className="px-6 py-3 rounded-lg text-white font-semibold"
                  style={{ backgroundColor: "var(--primary-color)" }}
                >
                  Scout Manually
                </button>
              </div>

              {/* PRACTICE REMINDER */}
              {needsPractice && (
                <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-6 mb-6">
                  <div className="flex items-start gap-4">
                    <span className="text-yellow-700 mt-0.5">
                      <TriangleAlert size={28} />
                    </span>
                    <div className="flex-1">
                      <h3 className="font-semibold mb-1">Practice Scouting Required</h3>
                      <p className="text-sm text-gray-700 mb-3">
                        You need to complete {3 - (stats?.practiceSessionsCount || 0)} more practice session(s) to verify your accuracy before the event.
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
                    const event = upcomingEvents.find((item) => item.key === activeEventKey) || upcomingEvents[0];
                    if (!event) return null;
                    const eventMatches = eventMatchesByKey[event.key] || [];
                    return (
                      <div className="space-y-4">
                        <div className="bg-white rounded-xl shadow-md p-6 border-l-4" style={{ borderColor: "var(--primary-color)" }}>
                          <div className="flex items-start justify-between">
                            <div>
                              <h2 className="text-xl font-semibold mb-1">Upcoming Event</h2>
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
                              <p className="text-sm text-gray-600 mt-2">{event.daysUntil} days away</p>
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
              <div className="grid md:grid-cols-3 gap-6 mb-6">
                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Matches Scouted</h3>
                    <ClipboardList size={22} />
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "var(--primary-color)" }}>
                    {stats?.matchesScoutedCount || 0}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">This season</p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Accuracy Score</h3>
                    <Target size={22} />
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "var(--primary-color)" }}>
                    {stats?.accuracyScore || 0}%
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    {stats?.accuracyScore && stats.accuracyScore >= 95 ? "Excellent!" : 
                     stats?.accuracyScore && stats.accuracyScore >= 85 ? "Good" : 
                     "Needs practice"}
                  </p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Practice Sessions</h3>
                    <Dumbbell size={22} />
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "var(--primary-color)" }}>
                    {stats?.practiceSessionsCount || 0}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">Completed</p>
                </div>
              </div>

              {/* QUICK ACTIONS */}
              <div className="bg-white rounded-xl shadow-md p-6">
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
                    onClick={() => router.push("/practice-scouting")}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                  >
                    <Target size={22} className="mb-2" />
                    <h3 className="font-semibold mb-1">Practice Scouting</h3>
                    <p className="text-sm text-gray-600">Improve your accuracy</p>
                  </button>

                  <button
                    onClick={() => router.push("/analytics")}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                  >
                    <BarChart3 size={22} className="mb-2" />
                    <h3 className="font-semibold mb-1">View Analytics</h3>
                    <p className="text-sm text-gray-600">Check team performance</p>
                  </button>

                  <button
                    onClick={() => router.push("/event-details")}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                  >
                    <CalendarDays size={22} className="mb-2" />
                    <h3 className="font-semibold mb-1">Event Details</h3>
                    <p className="text-sm text-gray-600">Browse selected event pages</p>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ScoutDashboard() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["scout"]}>
      <ScoutDashboardContent />
    </ProtectedRoute>
  );
}

