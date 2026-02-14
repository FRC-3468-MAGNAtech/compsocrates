"use client";

import { useState, useEffect } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";

interface ScoutStats {
  scoutName: string;
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

  useEffect(() => {
    loadScoutStats();
  }, []);

  async function loadScoutStats() {
    setLoading(true);
    try {
      // Get all team members
      const teamQuery = query(collection(db, "users"), where("teamId", "==", userData?.teamId));
      const teamSnapshot = await getDocs(teamQuery);
      const scouts = teamSnapshot.docs.filter(doc => {
        const role = doc.data().role;
        const specialRole = doc.data().specialRole;
        // Include regular scouts AND coaches with "Lead Scout" special role
        return role === "scout" || (role === "coach" && specialRole === "Lead Scout");
      });

      // Get scouting entries and practice sessions for each scout
      const statsPromises = scouts.map(async (scoutDoc) => {
        const scoutName = scoutDoc.data().displayName;
        
        // Get all scouting entries by this scout
        const entriesQuery = query(collection(db, "scouting"), where("scoutName", "==", scoutName));
        const entriesSnapshot = await getDocs(entriesQuery);
        
        // Get practice sessions from Firebase
        const practiceQuery = query(collection(db, "practiceSessions"), where("scoutName", "==", scoutName));
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
    
    // If they have practiced
    if (accuracy >= 95) {
      return {
        bg: "bg-green-100",
        text: "text-green-800",
        label: "Excellent",
        showWarning: false
      };
    }
    if (accuracy >= 85) {
      return {
        bg: "bg-yellow-100",
        text: "text-yellow-800",
        label: "Good",
        showWarning: false
      };
    }
    return {
      bg: "bg-red-100",
      text: "text-red-800",
      label: "Needs Practice",
      showWarning: true
    };
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
            Track and verify the accuracy of your scouts' data
          </p>

          {loading ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">🔄</div>
              <p className="text-gray-600">Loading scout statistics...</p>
            </div>
          ) : scoutStats.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <div className="text-6xl mb-4">📊</div>
              <h2 className="text-2xl font-semibold mb-2">No Scout Data Yet</h2>
              <p className="text-gray-600">
                Scout accuracy tracking will appear once scouts complete practice sessions.
              </p>
            </div>
          ) : (
            <>
              {/* OVERVIEW STATS */}
              <div className="grid md:grid-cols-4 gap-6 mb-6">
                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Total Scouts</h3>
                    <span className="text-2xl">👥</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {scoutStats.length}
                  </p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Avg. Accuracy</h3>
                    <span className="text-2xl">🎯</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {Math.round(scoutStats.reduce((sum, s) => sum + s.averageAccuracy, 0) / scoutStats.length)}%
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

              {/* SCOUTS LEADERBOARD */}
              <div className="bg-white rounded-xl shadow-md overflow-hidden mb-6">
                <div className="p-6 border-b border-gray-200">
                  <h2 className="text-xl font-semibold">Scout Accuracy Rankings</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Rank
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Scout Name
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Accuracy
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Practice Sessions
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
                        <h2 className="text-2xl font-bold">{selectedScoutData.scoutName}</h2>
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
                        <div className="space-y-2">
                          {selectedScoutData.recentAccuracies.map((accuracy, i) => (
                            <div key={i} className="flex items-center gap-4">
                              <span className="text-sm text-gray-600 w-24">Session {i + 1}</span>
                              <div className="flex-1 bg-gray-200 rounded-full h-8 overflow-hidden">
                                <div
                                  className="h-full flex items-center justify-end pr-3 text-white text-sm font-semibold transition-all"
                                  style={{
                                    width: `${accuracy}%`,
                                    backgroundColor: accuracy >= 95 ? "#10b981" : accuracy >= 85 ? "#f59e0b" : "#ef4444"
                                  }}
                                >
                                  {accuracy}%
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
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
                              {new Date(selectedScoutData.lastPracticeDate).toLocaleDateString()}
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
                            badge.label === "Excellent" ? "border-green-200" :
                            badge.label === "Good" ? "border-yellow-200" :
                            badge.label === "Undetermined" ? "border-gray-200" :
                            "border-red-200"
                          }`}>
                            <h3 className="font-semibold mb-2">
                              {badge.label === "Excellent" ? "✅ Excellent Performance!" :
                               badge.label === "Good" ? "⚠️ Recommendation" :
                               badge.label === "Undetermined" ? "📊 Status Pending" :
                               "🚨 Action Required"}
                            </h3>
                            <p className="text-sm">
                              {badge.label === "Excellent"
                                ? `${selectedScoutData.scoutName} is performing excellently and is ready for competition scouting.`
                                : badge.label === "Good"
                                ? `${selectedScoutData.scoutName} should complete a few more practice sessions to improve accuracy.`
                                : badge.label === "Undetermined"
                                ? `${selectedScoutData.scoutName} has not completed any practice sessions yet. Practice is required before competition scouting.`
                                : `${selectedScoutData.scoutName} needs additional practice before being assigned to competition matches.`}
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
