"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";

// Type definitions
type Activity = {
  id: string;
  type: "scouting" | "practice" | "team";
  description: string;
  scoutName?: string;
  timestamp: number;
};

type DashboardStats = {
  totalEntries: number;
  activeScouts: number;
  averageAccuracy: number;
  recentActivity: Activity[];
};

type UpcomingEvent = {
  name: string;
  key: string;
  startDate: string;
  endDate: string;
  location: string;
  daysUntil: number;
  scoutsAssigned: number;
  scoutsRequired: number;
} | null;

function CoachDashboardContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [upcomingEvent, setUpcomingEvent] = useState<UpcomingEvent>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, [userData?.teamId]);

  async function getUpcomingEvent(): Promise<UpcomingEvent> {
    try {
      const TBA_KEY = process.env.NEXT_PUBLIC_TBA_AUTH_KEY;
      if (!TBA_KEY) {
        console.error("TBA API key not found");
        return null;
      }

      // Get current year
      const year = new Date().getFullYear();
      
      // Fetch events for the current year
      const response = await fetch(
        `https://www.thebluealliance.com/api/v3/events/${year}`,
        {
          headers: {
            "X-TBA-Auth-Key": TBA_KEY,
          },
        }
      );

      if (!response.ok) {
        console.error("TBA API error:", response.status);
        return null;
      }

      const events = await response.json();
      console.log("TBA Events:", events); // <-- Add this line
      const now = new Date();

      // Find the next upcoming event
      const upcomingEvents = events
        .filter((event: any) => {
          const startDate = new Date(event.start_date);
          return startDate > now;
        })
        .sort((a: any, b: any) => {
          return new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
        });

      if (upcomingEvents.length === 0) {
        return null;
      }

      const nextEvent = upcomingEvents[0];
      const startDate = new Date(nextEvent.start_date);
      const daysUntil = Math.ceil((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      return {
        name: nextEvent.name,
        key: nextEvent.key,
        startDate: nextEvent.start_date,
        endDate: nextEvent.end_date,
        location: `${nextEvent.city}, ${nextEvent.state_prov}`,
        daysUntil: daysUntil,
        scoutsAssigned: 0, // TODO: Get from team data
        scoutsRequired: 8, // TODO: Make configurable
      };
    } catch (error) {
      console.error("Error fetching upcoming event:", error);
      return null;
    }
  }

  async function loadDashboardData() {
    if (!userData?.teamId) return;
    
    setLoading(true);
    try {
      // Get all team scouts for accuracy calculation
      const teamQuery = query(collection(db, "users"), where("teamId", "==", userData.teamId));
      const teamSnapshot = await getDocs(teamQuery);
      const scouts = teamSnapshot.docs.filter(doc => doc.data().role === "scout");

      // Calculate team-wide average accuracy from practice sessions
      let totalAccuracy = 0;
      let totalScouts = 0;

      for (const scoutDoc of scouts) {
        const scoutName = scoutDoc.data().displayName;
        const practiceQuery = query(
          collection(db, "practiceSessions"),
          where("scoutName", "==", scoutName)
        );
        const practiceSnapshot = await getDocs(practiceQuery);
        
        if (practiceSnapshot.size > 0) {
          let scoutTotal = 0;
          practiceSnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.accuracy !== undefined) {
              scoutTotal += data.accuracy;
            }
          });
          totalAccuracy += scoutTotal / practiceSnapshot.size;
          totalScouts++;
        }
      }

      // Get scouting entries count
      const entriesQuery = query(
        collection(db, "scouting"),
        where("teamId", "==", userData.teamId)
      );
      const entriesSnapshot = await getDocs(entriesQuery);

      // Get recent activity
      const recentActivity: Activity[] = [];
      entriesSnapshot.docs.slice(0, 5).forEach((doc) => {
        const data = doc.data();
        recentActivity.push({
          id: doc.id,
          type: "scouting",
          description: `Scouted Team ${data.teamNumber}`,
          scoutName: data.scoutName,
          timestamp: data.submittedAt || data.timestamp || Date.now(),
        });
      });

      // Get upcoming event
      const event = await getUpcomingEvent();
      
      setStats({
        totalEntries: entriesSnapshot.size,
        activeScouts: scouts.length,
        averageAccuracy: totalScouts > 0 ? Math.round((totalAccuracy / totalScouts) * 100) / 100 : 0,
        recentActivity: recentActivity.sort((a, b) => b.timestamp - a.timestamp),
      });

      setUpcomingEvent(event);
    } catch (error) {
      console.error("Error loading dashboard data:", error);
    }
    
    setLoading(false);
  }

  function formatActivity(activity: Activity): string {
    if (activity.type === "scouting") {
      return `${activity.scoutName} ${activity.description}`;
    }
    return activity.description;
  }

  if (!userData) return null;

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
            Coach Dashboard
          </h1>
          <p className="text-gray-600 mb-8">Ready to scout? Here's your assignment.</p>

          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-16 h-16 border-4 border-gray-300 border-t-red-600 rounded-full animate-spin"></div>
            </div>
          ) : (
            <>
              {/* UPCOMING EVENT */}
              {upcomingEvent ? (
                <div className="bg-white rounded-xl shadow-md p-6 mb-8 border-l-4 border-red-600">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="text-sm text-gray-600 mb-1">Upcoming Event</p>
                      <h2 className="text-2xl font-bold mb-2" style={{ color: "#c42221" }}>
                        {upcomingEvent.name}
                      </h2>
                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        <span>📅 {new Date(upcomingEvent.startDate).toLocaleDateString()} - {new Date(upcomingEvent.endDate).toLocaleDateString()}</span>
                        <span>📍 {upcomingEvent.location}</span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-gray-600">Days Until Event</p>
                          <p className="text-3xl font-bold">{upcomingEvent.daysUntil}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">Scouts Assigned</p>
                          <p className="text-3xl font-bold">{upcomingEvent.scoutsAssigned}/{upcomingEvent.scoutsRequired}</p>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => router.push(`/event/${upcomingEvent.key}`)}
                      className="px-4 py-2 rounded-lg text-white font-semibold"
                      style={{ backgroundColor: "#c42221" }}
                    >
                      View Details
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl shadow-md p-6 mb-8 border-l-4 border-gray-300">
                  <p className="text-gray-600">No upcoming events found</p>
                </div>
              )}

              {/* STATS GRID */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-600">Total Entries</h3>
                    <span className="text-2xl">📊</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {stats?.totalEntries || 0}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">Across all events</p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-600">Active Scouts</h3>
                    <span className="text-2xl">👥</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {stats?.activeScouts || 0}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">Ready to scout</p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-600">Avg. Accuracy</h3>
                    <span className="text-2xl">🎯</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {stats?.averageAccuracy || 0}%
                  </p>
                  <p className="text-sm text-gray-500 mt-1">Scout reliability</p>
                </div>
              </div>

              {/* QUICK ACTIONS & RECENT ACTIVITY */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* QUICK ACTIONS */}
                <div className="bg-white rounded-xl shadow-md p-6">
                  <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => router.push("/scout-form")}
                      className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-600 hover:bg-red-50 transition-all"
                    >
                      <div className="text-3xl mb-2">📝</div>
                      <div className="font-semibold text-sm">Start Scouting</div>
                      <div className="text-xs text-gray-600">Begin a new scouting session</div>
                    </button>

                    <button
                      onClick={() => router.push("/analytics")}
                      className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-600 hover:bg-red-50 transition-all"
                    >
                      <div className="text-3xl mb-2">📈</div>
                      <div className="font-semibold text-sm">View Analytics</div>
                      <div className="text-xs text-gray-600">Analyze team performance data</div>
                    </button>

                    <button
                      onClick={() => router.push("/form-builder")}
                      className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-600 hover:bg-red-50 transition-all"
                    >
                      <div className="text-3xl mb-2">🔧</div>
                      <div className="font-semibold text-sm">Edit Form</div>
                      <div className="text-xs text-gray-600">Customize scouting fields</div>
                    </button>

                    <button
                      onClick={() => router.push("/scout-accuracy")}
                      className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-600 hover:bg-red-50 transition-all"
                    >
                      <div className="text-3xl mb-2">🎯</div>
                      <div className="font-semibold text-sm">Check Scout Accuracy</div>
                      <div className="text-xs text-gray-600">Review scout performance</div>
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
                    <p className="text-gray-500 text-sm">No recent activity</p>
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

export default function CoachDashboard() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach"]}>
      <CoachDashboardContent />
    </ProtectedRoute>
  );
}