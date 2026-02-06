"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CoachDashboard() {
  const router = useRouter();
  const [activePage, setActivePage] = useState("dashboard");

  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* SIDEBAR NAVIGATION */}
      <nav className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: "#c42221" }}>
              <span className="text-white text-lg font-bold">CS</span>
            </div>
            <h1 className="text-xl font-bold" style={{ color: "#c42221" }}>
              CompSocrates
            </h1>
          </div>
          <p className="text-sm text-gray-600 ml-[52px]">Team 1234</p>
        </div>

        <div className="flex-1 p-4">
          <div className="space-y-1">
            <button
              onClick={() => setActivePage("dashboard")}
              className={`w-full text-left px-3 py-2 rounded ${
                activePage === "dashboard"
                  ? "bg-red-100 text-red-800 font-semibold"
                  : "hover:bg-gray-100 text-gray-700"
              }`}
            >
              📊 Dashboard
            </button>
            
            <button
              onClick={() => router.push("/scout")}
              className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 text-gray-700"
            >
              📝 Scout Form
            </button>
            
            <button
              onClick={() => router.push("/analytics")}
              className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 text-gray-700"
            >
              📈 Analytics
            </button>

            <div className="pt-4 pb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-3">
                Coach Tools
              </p>
            </div>

            <button
              onClick={() => setActivePage("form-builder")}
              className={`w-full text-left px-3 py-2 rounded ${
                activePage === "form-builder"
                  ? "bg-red-100 text-red-800 font-semibold"
                  : "hover:bg-gray-100 text-gray-700"
              }`}
            >
              🔧 Form Builder
            </button>

            <button
              onClick={() => setActivePage("scout-accuracy")}
              className={`w-full text-left px-3 py-2 rounded ${
                activePage === "scout-accuracy"
                  ? "bg-red-100 text-red-800 font-semibold"
                  : "hover:bg-gray-100 text-gray-700"
              }`}
            >
              🎯 Scout Accuracy
            </button>

            <button
              onClick={() => setActivePage("team-management")}
              className={`w-full text-left px-3 py-2 rounded ${
                activePage === "team-management"
                  ? "bg-red-100 text-red-800 font-semibold"
                  : "hover:bg-gray-100 text-gray-700"
              }`}
            >
              👥 Team Management
            </button>
          </div>
        </div>

        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center">
              <span className="text-sm font-semibold">JD</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">John Doe</p>
              <p className="text-xs text-gray-600">Coach</p>
            </div>
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <div className="flex-1 overflow-auto">
        {activePage === "dashboard" && (
          <div className="p-8">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Dashboard
            </h1>
            <p className="text-gray-600 mb-8">Welcome back! Here's what's happening with your team.</p>

            {/* UPCOMING EVENT CARD */}
            <div className="bg-white rounded-xl shadow-md p-6 mb-6 border-l-4" style={{ borderColor: "#c42221" }}>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-semibold mb-1">Upcoming Event</h2>
                  <p className="text-2xl font-bold mb-2" style={{ color: "#c42221" }}>
                    Arkansas Regional
                  </p>
                  <p className="text-gray-600">
                    📅 March 15-18, 2026 • 📍 Little Rock, AR
                  </p>
                  <div className="mt-4 flex gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Days Until Event</p>
                      <p className="text-2xl font-bold">38</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Scouts Assigned</p>
                      <p className="text-2xl font-bold">6/8</p>
                    </div>
                  </div>
                </div>
                <button
                  className="px-4 py-2 rounded-lg text-white font-medium"
                  style={{ backgroundColor: "#c42221" }}
                >
                  View Details
                </button>
              </div>
            </div>

            {/* STATS GRID */}
            <div className="grid md:grid-cols-3 gap-6 mb-6">
              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-700">Total Entries</h3>
                  <span className="text-2xl">📊</span>
                </div>
                <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                  342
                </p>
                <p className="text-sm text-gray-600 mt-1">Across all events</p>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-700">Active Scouts</h3>
                  <span className="text-2xl">👥</span>
                </div>
                <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                  8
                </p>
                <p className="text-sm text-gray-600 mt-1">Ready to scout</p>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-700">Avg. Accuracy</h3>
                  <span className="text-2xl">🎯</span>
                </div>
                <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                  94%
                </p>
                <p className="text-sm text-gray-600 mt-1">Scout reliability</p>
              </div>
            </div>

            {/* QUICK ACTIONS */}
            <div className="bg-white rounded-xl shadow-md p-6 mb-6">
              <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
              <div className="grid md:grid-cols-2 gap-4">
                <button
                  onClick={() => router.push("/scout")}
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
                  onClick={() => setActivePage("form-builder")}
                  className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                >
                  <div className="text-2xl mb-2">🔧</div>
                  <h3 className="font-semibold mb-1">Edit Form</h3>
                  <p className="text-sm text-gray-600">Customize scouting fields</p>
                </button>

                <button
                  onClick={() => setActivePage("scout-accuracy")}
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
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="text-xl">📝</span>
                  <div className="flex-1">
                    <p className="font-medium">Jordan Smith scouted Team 5678</p>
                    <p className="text-sm text-gray-600">Qualification Match 67 • 2 hours ago</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="text-xl">🎯</span>
                  <div className="flex-1">
                    <p className="font-medium">Alex Johnson completed practice scouting</p>
                    <p className="text-sm text-gray-600">Accuracy: 96% • 5 hours ago</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="text-xl">👥</span>
                  <div className="flex-1">
                    <p className="font-medium">You added Sarah Williams to the team</p>
                    <p className="text-sm text-gray-600">Scout role • Yesterday</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activePage === "form-builder" && (
          <div className="p-8">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Form Builder
            </h1>
            <p className="text-gray-600 mb-8">Customize your scouting form for the current season.</p>
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <div className="text-6xl mb-4">🔧</div>
              <h2 className="text-2xl font-semibold mb-2">Coming Soon</h2>
              <p className="text-gray-600">
                The form builder will allow you to create custom scouting forms for each season.
              </p>
            </div>
          </div>
        )}

        {activePage === "scout-accuracy" && (
          <div className="p-8">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Scout Accuracy
            </h1>
            <p className="text-gray-600 mb-8">Track and verify the accuracy of your scouts' data.</p>
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <div className="text-6xl mb-4">🎯</div>
              <h2 className="text-2xl font-semibold mb-2">Coming Soon</h2>
              <p className="text-gray-600">
                View detailed accuracy reports for each scout on your team.
              </p>
            </div>
          </div>
        )}

        {activePage === "team-management" && (
          <div className="p-8">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Team Management
            </h1>
            <p className="text-gray-600 mb-8">Manage your team members, roles, and permissions.</p>
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <div className="text-6xl mb-4">👥</div>
              <h2 className="text-2xl font-semibold mb-2">Coming Soon</h2>
              <p className="text-gray-600">
                Add, remove, and manage scouts and coaches on your team.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}