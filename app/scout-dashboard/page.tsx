"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { getUpcomingEvent } from "@/app/utils/stats-calculator";

type ScoutStats = {
  matchesScoutedCount: number;
  accuracyScore: number;
  practiceSessionsCount: number;
};

function ScoutDashboardContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const [stats, setStats] = useState<ScoutStats | null>(null);
  const [upcomingEvent, setUpcomingEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, [userData]);

  async function loadDashboardData() {
    if (!userData) return;
    
    setLoading(true);
    try {
      // Get scout's scouting entries
      const entriesQuery = query(
        collection(db, "scoutingEntries"),
        where("scoutName", "==", userData.displayName)
      );
      const entriesSnapshot = await getDocs(entriesQuery);
      const matchesScoutedCount = entriesSnapshot.size;

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

      // Get upcoming event
      const event = await getUpcomingEvent();
      setUpcomingEvent(event);

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
        <div className="p-8 max-w-4xl">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
            Dashboard
          </h1>
          <p className="text-gray-600 mb-8">Ready to scout? Here's your assignment.</p>

          {loading ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-4 animate-spin">🔄</div>
              <p className="text-gray-600">Loading dashboard...</p>
            </div>
          ) : (
            <>
              {/* NO ASSIGNMENT PLACEHOLDER */}
              <div className="bg-white rounded-xl shadow-md p-8 mb-6 text-center border-2 border-dashed border-gray-300">
                <div className="text-4xl mb-3">📋</div>
                <h2 className="text-xl font-semibold mb-2">No Active Assignment</h2>
                <p className="text-gray-600 mb-4">
                  Your coach hasn't assigned you a match yet. Check back later or start practicing!
                </p>
                <button
                  onClick={() => router.push("/scout-form")}
                  className="px-6 py-3 rounded-lg text-white font-semibold"
                  style={{ backgroundColor: "#c42221" }}
                >
                  Scout Manually
                </button>
              </div>

              {/* PRACTICE REMINDER */}
              {needsPractice && (
                <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-6 mb-6">
                  <div className="flex items-start gap-4">
                    <span className="text-3xl">⚠️</span>
                    <div className="flex-1">
                      <h3 className="font-semibold mb-1">Practice Scouting Required</h3>
                      <p className="text-sm text-gray-700 mb-3">
                        You need to complete {3 - (stats?.practiceSessionsCount || 0)} more practice session(s) to verify your accuracy before the event.
                      </p>
                      <button
                        onClick={() => router.push("/practice-scouting")}
                        className="px-4 py-2 rounded-lg text-white font-medium"
                        style={{ backgroundColor: "#c42221" }}
                      >
                        Start Practice Session
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* UPCOMING EVENT */}
              {upcomingEvent && (
                <div className="bg-white rounded-xl shadow-md p-6 mb-6">
                  <h2 className="text-xl font-semibold mb-4">Upcoming Event</h2>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold mb-1" style={{ color: "#c42221" }}>
                        {upcomingEvent.name}
                      </p>
                      <p className="text-gray-600">
                        📅 {new Date(upcomingEvent.startDate).toLocaleDateString("en-US", { month: "long", day: "numeric" })} - {new Date(upcomingEvent.endDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} • 📍 {upcomingEvent.location}
                      </p>
                      <p className="text-sm text-gray-600 mt-2">{upcomingEvent.daysUntil} days away</p>
                    </div>
                  </div>
                </div>
              )}

              {/* YOUR STATS */}
              <div className="grid md:grid-cols-3 gap-6 mb-6">
                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Matches Scouted</h3>
                    <span className="text-2xl">📝</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {stats?.matchesScoutedCount || 0}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">This season</p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Accuracy Score</h3>
                    <span className="text-2xl">🎯</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
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
                    <span className="text-2xl">💪</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
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
                    <div className="text-2xl mb-2">📝</div>
                    <h3 className="font-semibold mb-1">Start Scouting</h3>
                    <p className="text-sm text-gray-600">Begin a new scouting session</p>
                  </button>

                  <button
                    onClick={() => router.push("/practice-scouting")}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                  >
                    <div className="text-2xl mb-2">🎯</div>
                    <h3 className="font-semibold mb-1">Practice Scouting</h3>
                    <p className="text-sm text-gray-600">Improve your accuracy</p>
                  </button>

                  <button
                    onClick={() => router.push("/analytics")}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                  >
                    <div className="text-2xl mb-2">📈</div>
                    <h3 className="font-semibold mb-1">View Analytics</h3>
                    <p className="text-sm text-gray-600">Check team performance</p>
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