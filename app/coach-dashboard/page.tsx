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
import { classifyRebuiltEventByTimestamp } from "@/app/utils/analyticsEvents";

interface TeamData {
  scoutCount?: number;
  eventScoutCounts?: Record<string, number>;
  eventAttendees?: Record<string, string[]>;
}

function CoachDashboardContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingScoutCount, setEditingScoutCount] = useState(false);
  const [scoutCountInput, setScoutCountInput] = useState("");
  const [eventScoutCountInputs, setEventScoutCountInputs] = useState<Record<string, string>>({});
  const [teamData, setTeamData] = useState<TeamData | null>(null);
  const [readyScoutNamesByEvent, setReadyScoutNamesByEvent] = useState<Record<string, string[]>>({});

  useEffect(() => {
    loadDashboardData();
  }, [userData?.teamId]);

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
      if (teamDoc.exists()) {
        setTeamData(teamDoc.data());
      }

      const normalize = (value: string | null | undefined) =>
        (value || "").toLowerCase().replace(/\s+/g, "-");
      const scouts = usersSnap.docs.filter((userDoc) => {
        const data = userDoc.data();
        const specialRole = normalize(data.specialRole);
        const specialRoles = Array.isArray(data.specialRoles) ? data.specialRoles.map(normalize) : [];
        return data.role === "scout" || specialRole === "lead-scout" || specialRoles.includes("lead-scout");
      });
      const scoutNames = scouts.map((docSnap) => docSnap.data().displayName);

      const accuracyMapByEvent: Record<string, Record<string, { total: number; count: number }>> = {};
      practiceSnap.forEach((practiceDoc) => {
        const data = practiceDoc.data();
        if (!scoutNames.includes(data.scoutName) || typeof data.accuracy !== "number") return;
        const eventKey = (data.eventKey as string) || classifyRebuiltEventByTimestamp(Number(data.timestamp || 0));
        if (!accuracyMapByEvent[eventKey]) accuracyMapByEvent[eventKey] = {};
        if (!accuracyMapByEvent[eventKey][data.scoutName]) {
          accuracyMapByEvent[eventKey][data.scoutName] = { total: 0, count: 0 };
        }
        accuracyMapByEvent[eventKey][data.scoutName].total += data.accuracy;
        accuracyMapByEvent[eventKey][data.scoutName].count += 1;
      });

      const computedReadyByEvent: Record<string, string[]> = {};
      Object.entries(accuracyMapByEvent).forEach(([eventKey, eventAccuracies]) => {
        computedReadyByEvent[eventKey] = scoutNames.filter((name) => {
          const entry = eventAccuracies[name];
          return Boolean(entry && entry.count > 0 && (entry.total / entry.count) >= 80);
        });
      });
      setReadyScoutNamesByEvent(computedReadyByEvent);
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
              {/* UPCOMING EVENTS - Show Arkansas and Bayou */}
              {upcomingEvents.length > 0 && (
                <div className="mb-6 space-y-4">
                  {upcomingEvents.map((event) => (
                    <div key={event.key} className="bg-white rounded-xl shadow-md p-6 border-l-4" style={{ borderColor: "#c42221" }}>
                      <div className="flex items-start justify-between">
                        <div>
                          <h2 className="text-xl font-semibold mb-1">Upcoming Event</h2>
                          <p className="text-2xl font-bold mb-2" style={{ color: "#c42221" }}>
                            {event.name}
                          </p>
                          <p className="text-gray-600">
                            📅 {new Date(event.startDate + 'T12:00:00').toLocaleDateString("en-US", { month: "long", day: "numeric" })} - {new Date(event.endDate + 'T12:00:00').toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} • 📍 {event.location}
                          </p>
                          <div className="mt-4 flex gap-4">
                            <div>
                              <p className="text-sm text-gray-600">Days Until Event</p>
                              <p className="text-2xl font-bold">{event.daysUntil}</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-600">Scouts Ready</p>
                              <p className="text-2xl font-bold">
                                {(() => {
                                  const expected = teamData?.eventScoutCounts?.[event.key] || teamData?.scoutCount || 6;
                                  const attendees = Array.isArray(teamData?.eventAttendees?.[event.key])
                                    ? teamData.eventAttendees[event.key]
                                    : [];
                                  const readyNames = readyScoutNamesByEvent[event.key] || [];
                                  const readyAttendees = attendees.length > 0
                                    ? attendees.filter((name: string) => readyNames.includes(name)).length
                                    : readyNames.length;
                                  return `${readyAttendees}/${expected}`;
                                })()}
                              </p>
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
                  ))}
                </div>
              )}

              {/* STATS GRID */}
              <div className="grid md:grid-cols-3 gap-6 mb-6">
                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Total Entries</h3>
                    <span className="text-2xl">📊</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {stats?.totalEntries || 0}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">Across all events</p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Active Scouts</h3>
                    <span className="text-2xl">👥</span>
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
                    <span className="text-2xl">🎯</span>
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
                    <div className="text-2xl mb-2">📝</div>
                    <h3 className="font-semibold mb-1">Start Scouting</h3>
                    <p className="text-sm text-gray-600">Begin a new scouting session</p>
                  </button>

                  <button
                    onClick={() => router.push("/analytics")}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                  >
                    <div className="text-2xl mb-2">📈</div>
                    <h3 className="font-semibold mb-1">View Analytics</h3>
                    <p className="text-sm text-gray-600">Analyze team performance data</p>
                  </button>

                  <button
                    onClick={() => router.push("/form-builder")}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                  >
                    <div className="text-2xl mb-2">🔧</div>
                    <h3 className="font-semibold mb-1">Edit Form</h3>
                    <p className="text-sm text-gray-600">Customize scouting fields</p>
                  </button>

                  <button
                    onClick={() => router.push("/scout-accuracy")}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                  >
                    <div className="text-2xl mb-2">🎯</div>
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
                        <span className="text-xl">
                          {activity.type === "scouting" ? "📝" : activity.type === "practice" ? "🎯" : "👥"}
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
