"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useScoutAccuracy } from "@/app/hooks/useScoutAccuracy";
import { EVENTS, daysUntilEvent, formatEventDates } from "@/app/utils/eventDates";

function ScoutDashboardContent() {
  const router = useRouter();
  const [activePage, setActivePage] = useState("dashboard");
  const { avgAccuracy, totalPracticeSessions } = useScoutAccuracy();

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        {activePage === "dashboard" && (
          <div className="p-8 max-w-4xl">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Dashboard
            </h1>
            <p className="text-gray-600 mb-8">Ready to scout? Here's what's coming up.</p>

            {/* NO ASSIGNMENT CARD - Outside Event Dates */}
            <div className="bg-gray-50 rounded-xl shadow-md p-6 mb-6 border-2 border-gray-300">
              <div className="text-center py-4">
                <p className="text-gray-600 mb-4">No active event right now. Check back during competition!</p>
                <button
                  onClick={() => router.push("/practice-scouting")}
                  className="px-6 py-3 rounded-lg text-white font-semibold"
                  style={{ backgroundColor: "#c42221" }}
                >
                  Practice Scouting
                </button>
              </div>
            </div>

            {/* PRACTICE REMINDER */}
            {totalPracticeSessions < 3 && (
              <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-6 mb-6">
                <div className="flex items-start gap-4">
                  <span className="text-3xl">⚠️</span>
                  <div className="flex-1">
                    <h3 className="font-semibold mb-1">Practice Scouting Required</h3>
                    <p className="text-sm text-gray-700 mb-3">
                      You need to complete {3 - totalPracticeSessions} more practice session(s) to verify your accuracy before the event.
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

            {/* UPCOMING EVENTS - BOTH */}
            <div className="bg-white rounded-xl shadow-md p-6 mb-6">
              <h2 className="text-xl font-semibold mb-4">Upcoming Event</h2>
              <div>
                <p className="text-2xl font-bold mb-1" style={{ color: "#c42221" }}>
                  {EVENTS.arkansas.name}
                </p>
                <p className="text-gray-600">
                  📅 {formatEventDates('arkansas')} • 📍 {EVENTS.arkansas.location}
                </p>
                <p className="text-sm text-gray-600 mt-2">{daysUntilEvent('arkansas')} days away</p>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-md p-6 mb-6">
              <h2 className="text-xl font-semibold mb-4">Upcoming Event</h2>
              <div>
                <p className="text-2xl font-bold mb-1" style={{ color: "#c42221" }}>
                  {EVENTS.bayou.name}
                </p>
                <p className="text-gray-600">
                  📅 {formatEventDates('bayou')} • 📍 {EVENTS.bayou.location}
                </p>
                <p className="text-sm text-gray-600 mt-2">{daysUntilEvent('bayou')} days away</p>
              </div>
            </div>

            {/* YOUR STATS */}
            <div className="grid md:grid-cols-3 gap-6 mb-6">
              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-700">Matches Scouted</h3>
                  <span className="text-2xl">📝</span>
                </div>
                <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                  0
                </p>
                <p className="text-sm text-gray-600 mt-1">This season</p>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-700">Accuracy Score</h3>
                  <span className="text-2xl">🎯</span>
                </div>
                <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                  {avgAccuracy}%
                </p>
                <p className="text-sm text-gray-600 mt-1">Verified by practice</p>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-700">Practice Sessions</h3>
                  <span className="text-2xl">💪</span>
                </div>
                <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                  {totalPracticeSessions}
                </p>
                <p className="text-sm text-gray-600 mt-1">Completed</p>
              </div>
            </div>

            {/* QUICK ACTIONS */}
            <div className="bg-white rounded-xl shadow-md p-6 mb-6">
              <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
              <div className="grid md:grid-cols-2 gap-4">
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
                  <p className="text-sm text-gray-600">See team performance</p>
                </button>
              </div>
            </div>

            {/* RECENT ACTIVITY */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-xl font-semibold mb-4">Your Recent Activity</h2>
              <div className="text-center text-gray-500 py-8">
                No activity yet. Start by completing practice sessions!
              </div>
            </div>
          </div>
        )}

        {activePage === "practice" && (
          <div className="p-8 max-w-4xl">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Practice Scouting
            </h1>
            <p className="text-gray-600 mb-8">Improve your scouting skills with practice matches.</p>

            <div className="bg-white rounded-xl shadow-md p-8 mb-6">
              <h2 className="text-2xl font-semibold mb-4">How Practice Works</h2>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0" style={{ backgroundColor: "#c42221" }}>
                    1
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Watch a Recorded Match</h3>
                    <p className="text-gray-600">We'll show you a pre-recorded match video.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0" style={{ backgroundColor: "#c42221" }}>
                    2
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Scout the Robot</h3>
                    <p className="text-gray-600">Fill out the scouting form just like a real match.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0" style={{ backgroundColor: "#c42221" }}>
                    3
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Get Your Score</h3>
                    <p className="text-gray-600">We'll compare your data to the verified answer key.</p>
                  </div>
                </div>
              </div>

              <div className="mt-8 p-6 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold mb-1">Your Current Accuracy</h3>
                    <p className="text-4xl font-bold" style={{ color: "#c42221" }}>{avgAccuracy}%</p>
                    <p className="text-sm text-gray-600 mt-1">Based on {totalPracticeSessions} practice sessions</p>
                  </div>
                  <button
                    className="px-6 py-3 rounded-lg text-white font-semibold"
                    style={{ backgroundColor: "#c42221" }}
                  >
                    Start Practice Session
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
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