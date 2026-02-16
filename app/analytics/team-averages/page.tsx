"use client";

import { useState, useEffect } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { LoadingSpinner } from "@/app/components/LoadingSpinner";

interface TeamAverage {
  teamNumber: string;
  matchCount: number;
  avgAuto: number;
  avgTeleop: number;
  avgEndgame: number;
  avgTotal: number;
  consistency: number; // Standard deviation
}

function TeamAveragesContent() {
  const [teamAverages, setTeamAverages] = useState<TeamAverage[]>([]);
  const [selectedGame, setSelectedGame] = useState("REEFSCAPE");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [showPractice, setShowPractice] = useState(false);
  const [loading, setLoading] = useState(true);

  const events = [
    { key: "all", name: "All Events" },
    { key: "app-testing", name: "App Testing" },
    { key: "rocketCity", name: "Rocket City Regional" },
    { key: "bayou", name: "Bayou Regional" },
  ];

  useEffect(() => {
    loadAverages();
  }, [selectedGame, selectedEvent, showPractice]);

  async function loadAverages() {
    setLoading(true);
    try {
      const entriesSnap = await getDocs(collection(db, "scouting"));
      const entries = entriesSnap.docs.map(doc => doc.data());

      // Filter
      const filtered = entries.filter(e => {
        // NOTE: No game field yet - all entries are REEFSCAPE
        // if (e.game !== selectedGame) return false;
        if (!showPractice && e.matchType === "practice") return false;
        return true;
      });

      // Group by team
      const teamData: { [team: string]: any[] } = {};
      
      filtered.forEach(entry => {
        const team = entry.teamNumber;
        if (!teamData[team]) teamData[team] = [];
        
        const auto = calculateAutoScore(entry);
        const teleop = calculateTeleopScore(entry);
        const endgame = calculateEndgameScore(entry);
        
        teamData[team].push({
          auto,
          teleop,
          endgame,
          total: auto + teleop + endgame
        });
      });

      // Calculate averages
      const averages: TeamAverage[] = Object.entries(teamData).map(([team, matches]) => {
        const avgAuto = Math.round(matches.reduce((sum, m) => sum + m.auto, 0) / matches.length);
        const avgTeleop = Math.round(matches.reduce((sum, m) => sum + m.teleop, 0) / matches.length);
        const avgEndgame = Math.round(matches.reduce((sum, m) => sum + m.endgame, 0) / matches.length);
        const avgTotal = avgAuto + avgTeleop + avgEndgame;
        
        // Calculate consistency (std deviation)
        const totals = matches.map(m => m.total);
        const mean = avgTotal;
        const variance = totals.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / totals.length;
        const consistency = Math.round(Math.sqrt(variance));

        return {
          teamNumber: team,
          matchCount: matches.length,
          avgAuto,
          avgTeleop,
          avgEndgame,
          avgTotal,
          consistency
        };
      });

      averages.sort((a, b) => b.avgTotal - a.avgTotal);
      setTeamAverages(averages);
    } catch (error) {
      console.error("Error loading averages:", error);
    } finally {
      setLoading(false);
    }
  }

  function calculateAutoScore(e: any): number {
    let score = 0;
    if (e.leftStartingZone) score += 3;
    score += (e.autoCoralL1 || 0) * 3;
    score += (e.autoCoralL2 || 0) * 4;
    score += (e.autoCoralL3 || 0) * 6;
    score += (e.autoCoralL4 || 0) * 7;
    score += (e.autoAlgaeProcessorScored || 0) * 6;
    score += (e.autoAlgaeNetScored || 0) * 4;
    return score;
  }

  function calculateTeleopScore(e: any): number {
    let score = 0;
    score += (e.teleopCoralL1 || 0) * 2;
    score += (e.teleopCoralL2 || 0) * 3;
    score += (e.teleopCoralL3 || 0) * 4;
    score += (e.teleopCoralL4 || 0) * 5;
    score += (e.teleopProcessorScored || 0) * 6;
    score += (e.teleopNetRobotScored || 0) * 4;
    score += (e.teleopNetHumanScored || 0) * 4;
    if (e.teleopAlgaeRemoved) score += 2;
    return score;
  }

  function calculateEndgameScore(e: any): number {
    const stage = (e.stageStatus || "").toLowerCase();
    if (stage.includes("deep")) return 12;
    if (stage.includes("shallow")) return 6;
    if (stage.includes("park")) return 2;
    return 0;
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
            Team Averages
          </h1>
          <p className="text-gray-600 mb-8">
            Average performance breakdown by team
          </p>

          {/* Filters */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Game
                </label>
                <select
                  value={selectedGame}
                  onChange={(e) => setSelectedGame(e.target.value)}
                  className="w-full border rounded p-2"
                >
                  <option value="REEFSCAPE">REEFSCAPE</option>
                  <option value="REBUILT">REBUILT</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Event
                </label>
                <select
                  value={selectedEvent}
                  onChange={(e) => setSelectedEvent(e.target.value)}
                  className="w-full border rounded p-2"
                >
                  {events.map(event => (
                    <option key={event.key} value={event.key}>
                      {event.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showPractice}
                    onChange={(e) => setShowPractice(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Include Practice Matches
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Averages Table */}
          {loading ? (
            <div className="text-center py-12">
              <LoadingSpinner />
              <p className="text-gray-600 mt-4">Loading team averages...</p>
            </div>
          ) : teamAverages.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <div className="text-6xl mb-4">📊</div>
              <h2 className="text-2xl font-semibold mb-2">No Data Available</h2>
              <p className="text-gray-600">
                No scouting data found for the selected game and filters.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Team
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Matches
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Avg Auto
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Avg Teleop
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Avg Endgame
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Avg Total
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Consistency (±)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {teamAverages.map(team => (
                    <tr key={team.teamNumber} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-semibold text-lg">{team.teamNumber}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                        {team.matchCount}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-semibold text-green-600">{team.avgAuto}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-semibold text-blue-600">{team.avgTeleop}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-semibold text-yellow-600">{team.avgEndgame}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-2xl font-bold" style={{ color: "#c42221" }}>
                          {team.avgTotal}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-600">±{team.consistency}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TeamAveragesPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <TeamAveragesContent />
    </ProtectedRoute>
  );
}
