"use client";

import { useState, useEffect } from "react";
import { collection, getDocs, query, where, deleteDoc, doc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { Users, Target, ClipboardList } from "lucide-react";
import { getEventsForGame } from "@/app/utils/analyticsEvents";

interface ScoutStats {
  scoutName: string;
  role: string;
  specialRole?: string;
  specialRoles?: string[];
  totalEntries: number;
  practiceSessionsCompleted: number;
  averageAccuracy: number;
  lastPracticeDate: number;
  recentAccuracies: number[];
}

type ScoutingEntry = {
  scoutName?: string;
  eventKey?: string;
  matchType?: string;
  game?: string;
  matchId?: string;
  teamNumber?: string;
  leftStartingZone?: boolean;
  autoCoralL1?: number;
  autoCoralL2?: number;
  autoCoralL3?: number;
  autoCoralL4?: number;
  autoAlgaeProcessorScored?: number;
  autoAlgaeNetScored?: number;
  teleopCoralL1?: number;
  teleopCoralL2?: number;
  teleopCoralL3?: number;
  teleopCoralL4?: number;
  teleopAlgaeRemoved?: boolean;
  teleopProcessorScored?: number;
  teleopNetRobotScored?: number;
  teleopNetHumanScored?: number;
  stageStatus?: string;
};

function scoreScoutingEntry(entry: ScoutingEntry): number {
  let score = 0;
  if (entry.leftStartingZone) score += 3;
  score += (entry.autoCoralL1 || 0) * 3;
  score += (entry.autoCoralL2 || 0) * 4;
  score += (entry.autoCoralL3 || 0) * 6;
  score += (entry.autoCoralL4 || 0) * 7;
  score += (entry.autoAlgaeProcessorScored || 0) * 6;
  score += (entry.autoAlgaeNetScored || 0) * 4;
  score += (entry.teleopCoralL1 || 0) * 2;
  score += (entry.teleopCoralL2 || 0) * 3;
  score += (entry.teleopCoralL3 || 0) * 4;
  score += (entry.teleopCoralL4 || 0) * 5;
  score += (entry.teleopProcessorScored || 0) * 6;
  score += (entry.teleopNetRobotScored || 0) * 4;
  score += (entry.teleopNetHumanScored || 0) * 4;
  if (entry.teleopAlgaeRemoved) score += 2;
  const end = (entry.stageStatus || "").toLowerCase();
  if (end.includes("deep")) score += 12;
  else if (end.includes("shallow")) score += 6;
  else if (end.includes("park") || end.includes("barge")) score += 2;
  return score;
}

function ScoutAccuracyContent() {
  const { userData } = useAuth();
  const [scoutStats, setScoutStats] = useState<ScoutStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedScout, setSelectedScout] = useState<string | null>(null);
  const [accuracyView, setAccuracyView] = useState<"practice" | "competition">("practice");
  const [selectedMode, setSelectedMode] = useState<"trial" | "competitive">("trial");
  const [selectedCompetitionEvent, setSelectedCompetitionEvent] = useState("all");

  useEffect(() => {
    loadScoutStats();
  }, [selectedMode, accuracyView, selectedCompetitionEvent, userData?.teamId]);

  const normalize = (value: string | null | undefined) =>
    (value || "").toLowerCase().replace(/\s+/g, "-");

  const hasSpecialRole = (scout: ScoutStats, role: string) =>
    normalize(scout.specialRole) === role ||
    (Array.isArray(scout.specialRoles) && scout.specialRoles.map(normalize).includes(role));

  async function loadScoutStats() {
    setLoading(true);
    try {
      // Get ALL team members (no filtering)
      const teamQuery = query(collection(db, "users"), where("teamId", "==", userData?.teamId));
      const teamSnapshot = await getDocs(teamQuery);
      const allMembers = teamSnapshot.docs;
      const memberData = allMembers.map((memberDoc) => {
        const data = memberDoc.data();
        return {
          scoutName: data.displayName as string,
          role: data.role as string,
          specialRole: data.specialRole as string | undefined,
          specialRoles: (data.specialRoles || []) as string[],
        };
      });
      const scoutNames = memberData.map((member) => member.scoutName);

      const scoutEntrySnapshots = await Promise.all(
        scoutNames.map((scoutName) => getDocs(query(collection(db, "scouting"), where("scoutName", "==", scoutName))))
      );
      const entriesByScout = scoutNames.reduce<Record<string, ScoutingEntry[]>>((acc, scoutName, index) => {
        acc[scoutName] = scoutEntrySnapshots[index].docs.map((entryDoc) => entryDoc.data() as ScoutingEntry);
        return acc;
      }, {});

      const statsPromises = memberData.map(async (member) => {
        const entries = entriesByScout[member.scoutName] || [];

        if (accuracyView === "competition") {
          const allCompetitionEntries = Object.values(entriesByScout)
            .flat()
            .filter((entry) => entry.matchType !== "practice" && entry.game === "REEFSCAPE")
            .filter((entry) => selectedCompetitionEvent === "all" || entry.eventKey === selectedCompetitionEvent);

          const baselineByMatch = allCompetitionEntries.reduce<Record<string, number[]>>((acc, entry) => {
            const key = `${entry.matchId || "unknown"}-${entry.teamNumber || "unknown"}`;
            if (!acc[key]) acc[key] = [];
            acc[key].push(scoreScoutingEntry(entry));
            return acc;
          }, {});

          const scoutCompetitionEntries = entries
            .filter((entry) => entry.matchType !== "practice" && entry.game === "REEFSCAPE")
            .filter((entry) => selectedCompetitionEvent === "all" || entry.eventKey === selectedCompetitionEvent);
          const competitionAccuracies = scoutCompetitionEntries.map((entry) => {
            const key = `${entry.matchId || "unknown"}-${entry.teamNumber || "unknown"}`;
            const baselineScores = baselineByMatch[key] || [];
            const baseline = baselineScores.length
              ? baselineScores.reduce((sum, value) => sum + value, 0) / baselineScores.length
              : 0;
            const score = scoreScoutingEntry(entry);
            if (baseline <= 0) return 0;
            return Math.max(0, Math.round((1 - Math.abs(score - baseline) / baseline) * 100));
          });
          const averageAccuracy = competitionAccuracies.length
            ? Math.round(competitionAccuracies.reduce((sum, value) => sum + value, 0) / competitionAccuracies.length)
            : 0;

          return {
            scoutName: member.scoutName,
            role: member.role,
            specialRole: member.specialRole,
            specialRoles: member.specialRoles,
            totalEntries: entries.length,
            practiceSessionsCompleted: competitionAccuracies.length,
            averageAccuracy,
            lastPracticeDate: Date.now(),
            recentAccuracies: competitionAccuracies.slice(-5).reverse(),
          };
        }

        const practiceQuery = query(
          collection(db, "practiceSessions"),
          where("scoutName", "==", member.scoutName),
          where("mode", "==", selectedMode)
        );
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
        recentAccuracies = recentAccuracies.sort((a, b) => b - a).slice(0, 5);
        const averageAccuracy = practiceSnapshot.size > 0 ? Math.round(totalAccuracy / practiceSnapshot.size) : 0;

        return {
          scoutName: member.scoutName,
          role: member.role,
          specialRole: member.specialRole,
          specialRoles: member.specialRoles,
          totalEntries: entries.length,
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

  // Count active scouts only: base scouts + lead scouts (all roles still shown in leaderboard)
  const actualScoutCount = scoutStats.filter(s => 
    s.role === "scout" || hasSpecialRole(s, "lead-scout")
  ).length;
  const scoutOnlyStats = scoutStats.filter((s) => s.role === "scout" || hasSpecialRole(s, "lead-scout"));

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
    
    if (accuracy >= 90) {
      return {
        bg: "bg-green-100",
        text: "text-green-700",
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
    const normalized = normalize(specialRole);
    if (normalized === "lead-scout") {
      return { bg: "bg-purple-100", text: "text-purple-800", label: "Lead Scout" };
    }
    if (normalized === "pit-scout") {
      return { bg: "bg-indigo-100", text: "text-indigo-800", label: "Pit Scout" };
    }
    if (normalized === "lead-strategist") {
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
  const canResetScoutData = Boolean(userData?.isTeamAdmin);

  async function resetScoutSessions(scoutName: string) {
    if (!canResetScoutData) {
      alert("Only team admins can reset scout data.");
      return;
    }
    if (!confirm(`Hard reset all scouting/practice data for ${scoutName}? This cannot be undone.`)) return;
    try {
      const sessionsQuery = query(
        collection(db, "practiceSessions"),
        where("scoutName", "==", scoutName)
      );
      const sessionsSnap = await getDocs(sessionsQuery);
      await Promise.all(sessionsSnap.docs.map((d) => deleteDoc(doc(db, "practiceSessions", d.id))));

      const entriesQuery = query(
        collection(db, "scouting"),
        where("scoutName", "==", scoutName)
      );
      const entriesSnap = await getDocs(entriesQuery);
      await Promise.all(entriesSnap.docs.map((d) => deleteDoc(doc(db, "scouting", d.id))));

      await loadScoutStats();
      setSelectedScout(null);
      alert("Hard reset complete.");
    } catch (error) {
      console.error("Error resetting scout sessions:", error);
      alert("Failed to hard reset scout data.");
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
            Scout Accuracy
          </h1>
          <p className="text-gray-600 mb-8">
            Track and verify the accuracy of your team members&apos; data
            <span className="text-sm text-gray-500 ml-2">
              ({accuracyView === "practice" ? `Showing ${selectedMode === "trial" ? "Trial" : "Competitive"} practice mode` : "Showing competition mode"})
            </span>
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
                Scout accuracy tracking will appear once team members complete sessions.
              </p>
            </div>
          ) : (
            <>

          {/* MODE TABS */}
          <div className="bg-white rounded-xl shadow-md p-2 mb-6 flex gap-2">
            <button
              onClick={() => {
                setAccuracyView("practice");
                setSelectedMode("trial");
              }}
              className={`flex-1 px-4 py-2 rounded font-medium transition-colors ${
                accuracyView === "practice" && selectedMode === "trial"
                  ? "bg-red-600 text-white" 
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Trial Mode
            </button>
            <button
              onClick={() => {
                setAccuracyView("practice");
                setSelectedMode("competitive");
              }}
              className={`flex-1 px-4 py-2 rounded font-medium transition-colors ${
                accuracyView === "practice" && selectedMode === "competitive"
                  ? "bg-red-600 text-white" 
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Competitive Mode
            </button>
            <button
              onClick={() => setAccuracyView("competition")}
              className={`flex-1 px-4 py-2 rounded font-medium transition-colors ${
                accuracyView === "competition"
                  ? "bg-red-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Competition Accuracy
            </button>
          </div>
          {accuracyView === "competition" && (
            <div className="bg-white rounded-xl shadow-md p-4 mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Competition</label>
              <select
                value={selectedCompetitionEvent}
                onChange={(event) => setSelectedCompetitionEvent(event.target.value)}
                className="w-full md:w-96 border rounded p-2"
              >
                <option value="all">All Competitions</option>
                {getEventsForGame("REEFSCAPE").map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </select>
            </div>
          )}
              {/* OVERVIEW STATS */}
              <div className="grid md:grid-cols-4 gap-6 mb-6">
                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Scouts / Members</h3>
                    <Users size={22} className="text-gray-500" />
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
                    <Target size={22} className="text-gray-500" />
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {scoutOnlyStats.length > 0 
                      ? Math.round(scoutOnlyStats.reduce((sum, s) => sum + s.averageAccuracy, 0) / scoutOnlyStats.length)
                      : 0}%
                  </p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">{accuracyView === "competition" ? "Competition Matches" : "Practice Sessions"}</h3>
                    <ClipboardList size={22} className="text-gray-500" />
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {scoutStats.reduce((sum, s) => sum + s.practiceSessionsCompleted, 0)}
                  </p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Total Entries</h3>
                    <ClipboardList size={22} className="text-gray-500" />
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
                            <p className="text-sm text-gray-600 mb-1">{accuracyView === "competition" ? "Competition Matches" : "Practice Sessions"}</p>
                            <p className="text-4xl font-bold" style={{ color: "#c42221" }}>{selectedScoutData.practiceSessionsCompleted}</p>
                          </div>
                        </div>
                      </div>

                      {/* RECENT ACCURACY SCORES */}
                      <div>
                        <h3 className="text-lg font-semibold mb-4">{accuracyView === "competition" ? "Recent Competition Accuracy" : "Recent Practice Scores"}</h3>
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
                          <p className="text-gray-500 text-center py-4">No sessions completed yet</p>
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
                        <button
                          onClick={() => resetScoutSessions(selectedScoutData.scoutName)}
                          disabled={!canResetScoutData}
                          className="mt-4 px-3 py-2 rounded bg-red-100 text-red-700 hover:bg-red-200 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Hard Reset Scout Data
                        </button>
                        {!canResetScoutData && (
                          <p className="text-xs text-gray-500 mt-2">Only team admins can reset scout data.</p>
                        )}
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
                            badge.label === "Good" ? "border-green-700" :
                            badge.label === "Student Intervention" ? "border-orange-200" :
                            badge.label === "Undetermined" ? "border-gray-200" :
                            "border-red-200"
                          }`}>
                            <h3 className="font-semibold mb-2">
                              {badge.label === "Excellent" ? "Excellent Performance" :
                               badge.label === "Good" ? "Good Performance" :
                               badge.label === "Student Intervention" ? "Needs Improvement" :
                               badge.label === "Undetermined" ? "Status Pending" :
                               "Immediate Action Required"}
                            </h3>
                            <p className="text-sm">
                              {badge.label === "Excellent"
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
