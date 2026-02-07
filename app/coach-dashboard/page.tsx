"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { calculateTeamStats, formatActivity, type TeamStats } from "@/app/utils/stats-calculator";
import { EVENTS, daysUntilEvent } from "@/app/utils/eventDates";

function CoachDashboardContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const [activePage, setActivePage] = useState("dashboard");
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, [userData?.teamId]);

  useEffect(() => {
    if (activePage === "form-builder") {
      router.push("/form-builder");
    } else if (activePage === "scout-accuracy") {
      router.push("/scout-accuracy");
    } else if (activePage === "team-management") {
      router.push("/team-management");
    }
  }, [activePage, router]);

  async function loadDashboardData() {
    if (!userData?.teamId) return;
    
    setLoading(true);
    try {
      const teamStats = await calculateTeamStats(userData.teamId);
      setStats(teamStats);
    } catch (error) {
      console.error("Error loading dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        {activePage === "dashboard" && (
          <div className="p-8">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Dashboard
            </h1>
            <p className="text-gray-600 mb-8">Welcome back! Here's what's happening with your team.</p>

            {loading ? (
              <div className="text-center py-12">
                <div className="text-4xl mb-4 animate-spin">🔄</div>
                <p className="text-gray-600">Loading dashboard...</p>
              </div>
            ) : (
              <>
                {/* UPCOMING EVENTS */}
                {Object.entries(EVENTS).map(([key, event]) => {
                  const daysUntil = daysUntilEvent(key);
                  const today = new Date();
                  const isUpcoming = event.endDate >= today;
                  
                  if (!isUpcoming) return null;
                  
                  return (
                    <div key={key} className="bg-white rounded-xl shadow-md p-6 mb-6 border-l-4" style={{ borderColor: "#c42221" }}>
                      <div className="flex items-start justify-between">
                        <div>
                          <h2 className="text-xl font-semibold mb-1">Upcoming Event</h2>
                          <p className="text-2xl font-bold mb-2" style={{ color: "#c42221" }}>
                            {event.name}
                          </p>
                          <p className="text-gray-600">
                            📅 {event.startDate.toLocaleDateString("en-US", { month: "long", day: "numeric" })} - {event.endDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} • 📍 {event.location}
                          </p>
                          <div className="mt-4 flex gap-4">
                            <div>
                              <p className="text-sm text-gray-600">Days Until Event</p>
                              <p className="text-2xl font-bold">{daysUntil}</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-600">Scouts Ready</p>
                              <p className="text-2xl font-bold">{stats?.activeScouts || 0}/{stats?.totalScouts || 0}</p>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => router.push("/event-details")}
                          className="px-4 py-2 rounded-lg text-white font-medium"
                          style={{ backgroundColor: "#c42221" }}
                        >
                          View Details
                        </button>
                      </div>
                    </div>
                  );
                })}

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
                    <p className="text-sm text-gray-600 mt-1">Ready to scout</p>
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
                      <h3 className="font-semibold mb-1">Check Scout Accuracy</h3>
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
        )}

        {activePage === "form-builder" && (
          <div className="p-8">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Form Builder
            </h1>
            <p className="text-gray-600 mb-8">Redirecting to Form Builder...</p>
          </div>
        )}

        {activePage === "scout-accuracy" && (
          <div className="p-8">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Scout Accuracy
            </h1>
            <p className="text-gray-600 mb-8">Redirecting to Scout Accuracy...</p>
          </div>
        )}

        {activePage === "team-management" && (
          <div className="p-8">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Team Management
            </h1>
            <p className="text-gray-600 mb-8">Redirecting to Team Management...</p>
          </div>
        )}
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