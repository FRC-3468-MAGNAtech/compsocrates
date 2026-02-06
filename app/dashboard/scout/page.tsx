"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ScoutDashboard() {
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
              onClick={() => setActivePage("practice")}
              className={`w-full text-left px-3 py-2 rounded ${
                activePage === "practice"
                  ? "bg-red-100 text-red-800 font-semibold"
                  : "hover:bg-gray-100 text-gray-700"
              }`}
            >
              🎯 Practice Scouting
            </button>

            <button
              onClick={() => router.push("/analytics")}
              className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 text-gray-700"
            >
              📈 Analytics
            </button>
          </div>
        </div>

        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center">
              <span className="text-sm font-semibold">JS</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Jordan Smith</p>
              <p className="text-xs text-gray-600">Scout</p>
            </div>
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <div className="flex-1 overflow-auto">
        {activePage === "dashboard" && (
          <div className="p-8 max-w-4xl">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Dashboard
            </h1>
            <p className="text-gray-600 mb-8">Ready to scout? Here's your assignment.</p>

            {/* NEXT ASSIGNMENT CARD */}
            <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl shadow-md p-6 mb-6 border-2" style={{ borderColor: "#c42221" }}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-1">NEXT ASSIGNMENT</p>
                  <h2 className="text-2xl font-bold mb-2" style={{ color: "#c42221" }}>
                    Qualification Match 23
                  </h2>
                  <p className="text-lg font-medium mb-1">Scout Team 5678</p>
                  <p className="text-gray-600">
                    🕐 11:45 AM • 📍 Field 2 • Red Alliance
                  </p>
                </div>
                <button
                  onClick={() => router.push("/scout")}
                  className="px-6 py-3 rounded-lg text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-shadow"
                  style={{ backgroundColor: "#c42221" }}
                >
                  Start Scouting
                </button>
              </div>
              <div className="flex gap-4 mt-4 pt-4 border-t border-red-200">
                <div>
                  <p className="text-sm text-gray-600">Time Until Match</p>
                  <p className="text-xl font-bold">24 min</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Your Accuracy</p>
                  <p className="text-xl font-bold">96%</p>
                </div>
              </div>
            </div>

            {/* PRACTICE REMINDER (if accuracy < 100%) */}
            <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-6 mb-6">
              <div className="flex items-start gap-4">
                <span className="text-3xl">⚠️</span>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">Practice Scouting Required</h3>
                  <p className="text-sm text-gray-700 mb-3">
                    You need to complete 3 practice scouting sessions to verify your accuracy before the event.
                  </p>
                  <button
                    onClick={() => setActivePage("practice")}
                    className="px-4 py-2 rounded-lg text-white font-medium"
                    style={{ backgroundColor: "#c42221" }}
                  >
                    Start Practice Session
                  </button>
                </div>
              </div>
            </div>

            {/* UPCOMING EVENT */}
            <div className="bg-white rounded-xl shadow-md p-6 mb-6">
              <h2 className="text-xl font-semibold mb-4">Upcoming Event</h2>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold mb-1" style={{ color: "#c42221" }}>
                    Arkansas Regional
                  </p>
                  <p className="text-gray-600">
                    📅 March 15-18, 2026 • 📍 Little Rock, AR
                  </p>
                  <p className="text-sm text-gray-600 mt-2">38 days away</p>
                </div>
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
                  47
                </p>
                <p className="text-sm text-gray-600 mt-1">This season</p>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-700">Accuracy Score</h3>
                  <span className="text-2xl">🎯</span>
                </div>
                <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                  96%
                </p>
                <p className="text-sm text-gray-600 mt-1">Verified by coach</p>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-700">Practice Sessions</h3>
                  <span className="text-2xl">💪</span>
                </div>
                <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                  8
                </p>
                <p className="text-sm text-gray-600 mt-1">Completed</p>
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
                  <h3 className="font-semibold mb-1">Scout Current Match</h3>
                  <p className="text-sm text-gray-600">Begin your assigned match</p>
                </button>

                <button
                  onClick={() => setActivePage("practice")}
                  className="p-4 border-2 border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 text-left transition-colors"
                >
                  <div className="text-2xl mb-2">🎯</div>
                  <h3 className="font-semibold mb-1">Practice Scouting</h3>
                  <p className="text-sm text-gray-600">Improve your accuracy</p>
                </button>
              </div>
            </div>

            {/* RECENT ACTIVITY */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-xl font-semibold mb-4">Your Recent Activity</h2>
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="text-xl">✅</span>
                  <div className="flex-1">
                    <p className="font-medium">Scouted Team 5678</p>
                    <p className="text-sm text-gray-600">Qualification Match 67 • 2 hours ago</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="text-xl">✅</span>
                  <div className="flex-1">
                    <p className="font-medium">Scouted Team 9012</p>
                    <p className="text-sm text-gray-600">Qualification Match 66 • 3 hours ago</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="text-xl">🎯</span>
                  <div className="flex-1">
                    <p className="font-medium">Completed practice session</p>
                    <p className="text-sm text-gray-600">Accuracy: 97% • Yesterday</p>
                  </div>
                </div>
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
                    <p className="text-4xl font-bold" style={{ color: "#c42221" }}>96%</p>
                    <p className="text-sm text-gray-600 mt-1">Based on 8 practice sessions</p>
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

            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-xl font-semibold mb-4">Practice History</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium">Practice Session #8</p>
                    <p className="text-sm text-gray-600">Team 1234 • Yesterday</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold" style={{ color: "#c42221" }}>97%</p>
                    <p className="text-xs text-gray-600">Accuracy</p>
                  </div>
                </div>
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium">Practice Session #7</p>
                    <p className="text-sm text-gray-600">Team 5678 • 2 days ago</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold" style={{ color: "#c42221" }}>94%</p>
                    <p className="text-xs text-gray-600">Accuracy</p>
                  </div>
                </div>
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium">Practice Session #6</p>
                    <p className="text-sm text-gray-600">Team 9012 • 3 days ago</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold" style={{ color: "#c42221" }}>98%</p>
                    <p className="text-xs text-gray-600">Accuracy</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}