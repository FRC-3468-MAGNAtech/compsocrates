"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";

type UpcomingEvent = {
  name: string;
  key: string;
  startDate: string;
  endDate: string;
  location: string;
  daysUntil: number;
} | null;

function ScoutDashboardContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const [stats, setStats] = useState<{
    matchesCompleted: number;
    accuracy: number;
    practiceCompleted: number;
  } | null>(null);
  const [upcomingEvent, setUpcomingEvent] = useState<UpcomingEvent>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, [userData?.displayName]);

  async function getUpcomingEvent(): Promise<UpcomingEvent> {
    try {
      const TBA_KEY = process.env.NEXT_PUBLIC_TBA_AUTH_KEY;
      if (!TBA_KEY) {
        console.error("TBA API key not found");
        return null;
      }

      const year = new Date().getFullYear();
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
      const now = new Date();

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
      };
    } catch (error) {
      console.error("Error fetching upcoming event:", error);
      return null;
    }
  }

  async function loadDashboardData() {
    if (!userData?.displayName) return;

    setLoading(true);
    try {
      // Get scouting entries for this scout
      const entriesQuery = query(
        collection(db, "scouting"),
        where("scoutName", "==", userData.displayName)
      );
      const entriesSnapshot = await getDocs(entriesQuery);

      // Get practice sessions for this scout
      const practiceQuery = query(
        collection(db, "practiceSessions"),
        where("scoutName", "==", userData.displayName)
      );
      const practiceSnapshot = await getDocs(practiceQuery);

      // Calculate average accuracy from practice sessions
      let totalAccuracy = 0;
      let sessionsWithAccuracy = 0;

      practiceSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.accuracy !== undefined) {
          totalAccuracy += data.accuracy;
          sessionsWithAccuracy++;
        }
      });

      const avgAccuracy = sessionsWithAccuracy > 0 
        ? Math.round((totalAccuracy / sessionsWithAccuracy) * 100) / 100 
        : 0;

      // Get upcoming event
      const event = await getUpcomingEvent();

      setStats({
        matchesCompleted: entriesSnapshot.size,
        accuracy: avgAccuracy,
        practiceCompleted: practiceSnapshot.size,
      });

      setUpcomingEvent(event);
    } catch (error) {
      console.error("Error loading dashboard data:", error);
    }

    setLoading(false);
  }

  if (!userData) return null;

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
            Dashboard
          </h1>
          <p className="text-gray-600 mb-8">Welcome back! Here's what's happening with your team.</p>

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
                      <div className="flex items-center gap-4 text-sm text-gray-600 mb-4">
                        <span>📅 {new Date(upcomingEvent.startDate).toLocaleDateString()} - {new Date(upcomingEvent.endDate).toLocaleDateString()}</span>
                        <span>📍 {upcomingEvent.location}</span>
                      </div>
                      <p className="text-sm text-gray-600">
                        {upcomingEvent.daysUntil} days away
                      </p>
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
                    <h3 className="text-sm font-medium text-gray-600">Matches Scouted</h3>
                    <span className="text-2xl">📝</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {stats?.matchesCompleted || 0}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">This season</p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-600">Accuracy Score</h3>
                    <span className="text-2xl">🎯</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {stats?.accuracy || 0}%
                  </p>
                  <p className="text-sm text-gray-500 mt-1">Verified by coach</p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-600">Practice Sessions</h3>
                    <span className="text-2xl">💪</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {stats?.practiceCompleted || 0}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">Completed</p>
                </div>
              </div>

              {/* QUICK ACTIONS */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button
                    onClick={() => router.push("/scout-form")}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-600 hover:bg-red-50 transition-all text-left"
                  >
                    <div className="text-3xl mb-2">📝</div>
                    <div className="font-semibold">Scout Current Match</div>
                    <div className="text-sm text-gray-600">Begin your assigned match</div>
                  </button>

                  <button
                    onClick={() => router.push("/practice-scouting")}
                    className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-600 hover:bg-red-50 transition-all text-left"
                  >
                    <div className="text-3xl mb-2">🎯</div>
                    <div className="font-semibold">Practice Scouting</div>
                    <div className="text-sm text-gray-600">Improve your accuracy</div>
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