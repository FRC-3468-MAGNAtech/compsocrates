"use client";

import { useState, useEffect } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import LoadingSpinner from "@/app/components/LoadingSpinner";

interface ScoutStats {
  scoutName: string;
  role: string;
  specialRole?: string;
  totalEntries: number;
  practiceSessionsCompleted: number;
  averageAccuracy: number;
  lastPracticeDate: number;
  recentAccuracies: number[];
}

function ScoutAccuracyContent() {
  const { userData } = useAuth();
  const [scoutStats, setScoutStats] = useState<ScoutStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedScout, setSelectedScout] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<"all" | "trial" | "competitive">("all");

  useEffect(() => {
    loadScoutStats();
  }, []);

  // Reload when mode changes
  useEffect(() => {
    if (selectedMode) {
      loadScoutStats();
    }
  }, [selectedMode]);

  async function loadScoutStats() {
    setLoading(true);
    try {
      // Get ALL team members (no filtering)
      const teamQuery = query(collection(db, "users"), where("teamId", "==", userData?.teamId));
      const teamSnapshot = await getDocs(teamQuery);
      const allMembers = teamSnapshot.docs;

      // Get scouting entries and practice sessions for EVERY team member
      const statsPromises = allMembers.map(async (memberDoc) => {
        const memberData = memberDoc.data();
        const scoutName = memberData.displayName;
        const role = memberData.role;
        const specialRole = memberData.specialRole;
        
        // Get all scouting entries by this person
        const entriesQuery = query(collection(db, "scouting"), where("scoutName", "==", scoutName));
        const entriesSnapshot = await getDocs(entriesQuery);
        
        // Get practice sessions from Firebase (filtered by mode)
        let practiceQuery = query(collection(db, "practiceSessions"), where("scoutName", "==", scoutName));
        
        // Filter by mode if not "all"
        if (selectedMode !== "all") {
          practiceQuery = query(
            collection(db, "practiceSessions"),
            where("scoutName", "==", scoutName),
            where("mode", "==", selectedMode)
          );
        }
        
        const practiceSnapshot = await getDocs(practiceQuery);
        
        let totalAccuracy = 0;
        let recentAccuracies: number[] = [];
        let lastPracticeDate = 0;
        
        practiceSnapshot.forEach((doc) => {
          const data = doc.data();
          if (data.accuracy !== undefined) {
            totalAccuracy += data.accuracy;
            recentAccuracies.push(data.accuracy);
          }
          if (data.timestamp > lastPracticeDate) {
            lastPracticeDate = data.timestamp;
          }
        });
        
        // Sort recent accuracies and take last 5
        recentAccuracies = recentAccuracies.sort((a, b) => b - a).slice(0, 5);
        
        const averageAccuracy = practiceSnapshot.size > 0 ? Math.round(totalAccuracy / practiceSnapshot.size) : 0;

        return {
          scoutName,
          role,
          specialRole,
          totalEntries: entriesSnapshot.size,
          practiceSessionsCompleted: practiceSnapshot.size,
          averageAccuracy,
          lastPracticeDate: lastPracticeDate || Date.now(),
          recentAccuracies,
        };
      });

      const stats = await Promise.all(statsPromises);
      setScoutStats(stats.sort((a, b) => b.averageAccuracy - a.averageAccuracy));
    } catch (error) {
      console.error("Error loading scout stats:", error);
    } finally {
      setLoading(false);
    }
  }

  // Calculate TRUE scout count (scouts + Lead Scouts + Pit Scouts)
  const actualScoutCount = scoutStats.filter(s => 
    s.role === "scout" || 
    s.specialRole === "Lead Scout" || 
    s.specialRole === "Pit Scout"
  ).length;

  function getAccuracyColor(accuracy: number): string {
    if (accuracy >= 95) return "text-green-600";
    if (accuracy >= 85) return "text-yellow-600";
    return "text-red-600";
  }

  function getAccuracyBadge(
    accuracy: number,
    practiceSessions: number
  ): { bg: string; text: string; label: string; showWarning: boolean } {
    // If no practice sessions, status is undetermined
    if (practiceSessions === 0) {
      return {
        bg: "bg-gray-100",
        text: "text-gray-700",
        label: "Undetermined",
        showWarning: false
      };
    }
    
    // New status thresholds per your requirements:
    // 0 = Undetermined (handled above)
    // 1-49 = Mentor Intervention
    // 50-79 = Student Intervention  
    // 80-89 = Good
    // 90-99 = Excellent
    // 100 = Perfect (implied)
    
    if (accuracy === 100) {
      return {
        bg: "bg-purple-100",
        text: "text-purple-800",
        label: "Perfect! ⭐",
        showWarning: false
      };
    }
    if (accuracy >= 90) {
      return {
        bg: "bg-green-100",
        text: "text-green-800",
        label: "Excellent",
        showWarning: false
      };
    }
    if (accuracy >= 80) {
      return {
        bg: "bg-green-700",
        text: "text-white",
        label: "Good",
        showWarning: false
      };
    }
    if (accuracy >= 50) {
      return {
        bg: "bg-orange-100",
        text: "text-orange-800",
        label: "Student Intervention",
        showWarning: true
      };
    }
    // 1-49
    return {
      bg: "bg-red-100",
      text: "text-red-800",
      label: "Mentor Intervention",
      showWarning: true
    };
  }

  function getRoleBadge(role: string, specialRole?: string) {
    // Special roles ALWAYS take priority
    if (specialRole === "Lead Scout") {
      return { bg: "bg-purple-100", text: "text-purple-800", label: "Lead Scout" };
    }
    if (specialRole === "Pit Scout") {
      return { bg: "bg-indigo-100", text: "text-indigo-800", label: "Pit Scout" };
    }
    if (specialRole === "Lead Strategist") {
      return { bg: "bg-pink-100", text: "text-pink-800", label: "Lead Strategist" };
    }
    
    // Then check base role
    if (role === "scout") {
      return { bg: "bg-blue-100", text: "text-blue-800", label: "Scout" };
    }
    if (role === "coach") {
      return { bg: "bg-yellow-100", text: "text-yellow-800", label: "Coach" };
    }
    return { bg: "bg-gray-100", text: "text-gray-800", label: role };
  }

  const selectedScoutData = scoutStats.find(s => s.scoutName === selectedScout);

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
            Scout Accuracy
          </h1>
          <p className="text-gray-600 mb-8">
            Track and verify the accuracy of your team members' data
            {selectedMode !== "all" && (
              <span className="text-sm text-gray-500 ml-2">
                (Showing {selectedMode === "trial" ? "Trial" : "Competitive"} mode only)
              </span>
            )}
          </p>

          {loading ? (
            <div className="text-center py-12">
              <LoadingSpinner />
              <p className="text-gray-600 mt-4">Loading statistics...</p>
            </div>
          ) : scoutStats.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <div className="text-6xl mb-4">📊</div>
              <h2 className="text-2xl font-semibold mb-2">No Data Yet</h2>
              <p className="text-gray-600">
                Scout accuracy tracking will appear once team members complete practice sessions.
              </p>
            </div>
          ) : (
            <>

          {/* MODE TABS */}
          <div className="bg-white rounded-xl shadow-md p-2 mb-6 flex gap-2">
            <button
              onClick={() => setSelectedMode("all")}
              className={`flex-1 px-4 py-2 rounded font-medium transition-colors ${
                selectedMode === "all" 
                  ? "bg-red-600 text-white" 
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              All Practice
            </button>
            <button
              onClick={() => setSelectedMode("trial")}
              className={`flex-1 px-4 py-2 rounded font-medium transition-colors ${
                selectedMode === "trial" 
                  ? "bg-red-600 text-white" 
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Trial Mode
            </button>
            <button
              onClick={() => setSelectedMode("competitive")}
              className={`flex-1 px-4 py-2 rounded font-medium transition-colors ${
                selectedMode === "competitive" 
                  ? "bg-red-600 text-white" 
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Competitive Mode
            </button>
          </div>
              {/* OVERVIEW STATS */}
              <div className="grid md:grid-cols-4 gap-6 mb-6">
                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Scouts / Members</h3>
                    <span className="text-2xl">👥</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {actualScoutCount} / {scoutStats.length}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {actualScoutCount} scout{actualScoutCount !== 1 ? 's' : ''}, {scoutStats.length - actualScoutCount} other role{scoutStats.length - actualScoutCount !== 1 ? 's' : ''}
                  </p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Avg. Accuracy</h3>
                    <span className="text-2xl">🎯</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {scoutStats.length > 0 
                      ? Math.round(scoutStats.reduce((sum, s) => sum + s.averageAccuracy, 0) / scoutStats.length)
                      : 0}%
                  </p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Practice Sessions</h3>
                    <span className="text-2xl">💪</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {scoutStats.reduce((sum, s) => sum + s.practiceSessionsCompleted, 0)}
                  </p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Total Entries</h3>
                    <span className="text-2xl">📝</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {scoutStats.reduce((sum, s) => sum + s.totalEntries, 0)}
                  </p>
                </div>
              </div>

              {/* LEADERBOARD */}
              <div className="bg-white rounded-xl shadow-md overflow-hidden mb-6">
                <div className="p-6 border-b border-gray-200">
                  <h2 className="text-xl font-semibold">Team Member Accuracy Rankings</h2>
                  <p className="text-sm text-gray-500 mt-1">All team members ranked by practice accuracy</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Rank
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Name
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Role
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Accuracy
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Practice
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Total Entries
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {scoutStats.map((scout, index) => {
                        const badge = getAccuracyBadge(scout.averageAccuracy, scout.practiceSessionsCompleted);
                        const roleBadge = getRoleBadge(scout.role, scout.specialRole);
                        return (
                          <tr key={scout.scoutName} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="text-2xl">
                                #{index + 1}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="font-semibold">{scout.scoutName}</span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${roleBadge.bg} ${roleBadge.text}`}>
                                {roleBadge.label}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`text-2xl font-bold ${getAccuracyColor(scout.averageAccuracy)}`}>
                                {scout.averageAccuracy}%
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${badge.bg} ${badge.text}`}>
                                {badge.label}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                              {scout.practiceSessionsCompleted}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                              {scout.totalEntries}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <button
                                onClick={() => setSelectedScout(scout.scoutName)}
                                className="text-sm font-medium hover:underline"
                                style={{ color: "#c42221" }}
                              >
                                View Details →
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SCOUT DETAIL MODAL */}
              {selectedScoutData && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                    <div className="p-6 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-2xl font-bold">{selectedScoutData.scoutName}</h2>
                          <span className={`inline-block px-2 py-1 rounded text-xs font-medium mt-2 ${getRoleBadge(selectedScoutData.role, selectedScoutData.specialRole).bg} ${getRoleBadge(selectedScoutData.role, selectedScoutData.specialRole).text}`}>
                            {getRoleBadge(selectedScoutData.role, selectedScoutData.specialRole).label}
                          </span>
                        </div>
                        <button
                          onClick={() => setSelectedScout(null)}
                          className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 font-medium"
                        >
                          Close
                        </button>
                      </div>
                    </div>

                    <div className="p-6 space-y-6">
                      {/* ACCURACY OVERVIEW */}
                      <div>
                        <h3 className="text-lg font-semibold mb-4">Accuracy Overview</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="p-4 bg-gray-50 rounded-lg">
                            <p className="text-sm text-gray-600 mb-1">Average Accuracy</p>
                            <p className={`text-4xl font-bold ${getAccuracyColor(selectedScoutData.averageAccuracy)}`}>
                              {selectedScoutData.averageAccuracy}%
                            </p>
                          </div>
                          <div className="p-4 bg-gray-50 rounded-lg">
                            <p className="text-sm text-gray-600 mb-1">Practice Sessions</p>
                            <p className="text-4xl font-bold" style={{ color: "#c42221" }}>
                              {selectedScoutData.practiceSessionsCompleted}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* RECENT ACCURACY SCORES */}
                      <div>
                        <h3 className="text-lg font-semibold mb-4">Recent Practice Scores</h3>
                        {selectedScoutData.recentAccuracies.length > 0 ? (
                          <div className="space-y-2">
                            {selectedScoutData.recentAccuracies.map((accuracy, i) => (
                              <div key={i} className="flex items-center gap-4">
                                <span className="text-sm text-gray-600 w-24">Session {i + 1}</span>
                                <div className="flex-1 bg-gray-200 rounded-full h-8 overflow-hidden">
                                  <div
                                    className="h-full flex items-center justify-end pr-3 text-white text-sm font-semibold transition-all"
                                    style={{
                                      width: `${accuracy}%`,
                                      backgroundColor: 
                                        accuracy === 100 ? "#9333ea" :
                                        accuracy >= 90 ? "#10b981" : 
                                        accuracy >= 80 ? "#15803d" :
                                        accuracy >= 50 ? "#f97316" : "#ef4444"
                                    }}
                                  >
                                    {accuracy}%
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-gray-500 text-center py-4">No practice sessions completed yet</p>
                        )}
                      </div>

                      {/* STATS */}
                      <div>
                        <h3 className="text-lg font-semibold mb-4">Statistics</h3>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <span className="text-gray-700">Total Match Entries</span>
                            <span className="font-bold">{selectedScoutData.totalEntries}</span>
                          </div>
                          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <span className="text-gray-700">Last Practice</span>
                            <span className="font-bold">
                              {selectedScoutData.practiceSessionsCompleted > 0
                                ? new Date(selectedScoutData.lastPracticeDate).toLocaleDateString()
                                : "Never"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* RECOMMENDATIONS */}
                      {(() => {
                        const badge = getAccuracyBadge(
                          selectedScoutData.averageAccuracy,
                          selectedScoutData.practiceSessionsCompleted
                        );
                        
                        return (
                          <div className={`p-4 rounded-lg ${badge.bg} border ${
                            badge.label.includes("Perfect") || badge.label === "Excellent" ? "border-green-200" :
                            badge.label === "Good" ? "border-green-700" :
                            badge.label === "Student Intervention" ? "border-orange-200" :
                            badge.label === "Undetermined" ? "border-gray-200" :
                            "border-red-200"
                          }`}>
                            <h3 className="font-semibold mb-2">
                              {badge.label.includes("Perfect") ? "🌟 Perfect Score!" :
                               badge.label === "Excellent" ? "✅ Excellent Performance!" :
                               badge.label === "Good" ? "✓ Good Performance" :
                               badge.label === "Student Intervention" ? "⚠️ Needs Improvement" :
                               badge.label === "Undetermined" ? "📊 Status Pending" :
                               "🚨 Immediate Action Required"}
                            </h3>
                            <p className="text-sm">
                              {badge.label.includes("Perfect")
                                ? `${selectedScoutData.scoutName} achieved perfect accuracy! Outstanding performance.`
                                : badge.label === "Excellent"
                                ? `${selectedScoutData.scoutName} is performing excellently and is ready for competition scouting.`
                                : badge.label === "Good"
                                ? `${selectedScoutData.scoutName} is performing well. Consider a few more practice sessions to reach excellent status.`
                                : badge.label === "Student Intervention"
                                ? `${selectedScoutData.scoutName} needs additional practice. Recommend peer mentoring and focused practice sessions.`
                                : badge.label === "Undetermined"
                                ? `${selectedScoutData.scoutName} has not completed any practice sessions yet. Practice is required before competition scouting.`
                                : `${selectedScoutData.scoutName} requires immediate mentor intervention and intensive practice before being assigned to matches.`}
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ScoutAccuracyPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach"]}>
      <ScoutAccuracyContent />
    </ProtectedRoute>
  );
}
