"use client";

import { useState, useEffect } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { Trophy, TrendingUp } from "lucide-react";

interface TeamRanking {
  teamNumber: string;
  avgScore: number;
  matchesPlayed: number;
  highScore: number;
  winRate: number;
}

function RankingsContent() {
  const [rankings, setRankings] = useState<TeamRanking[]>([]);
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
    loadRankings();
  }, [selectedGame, selectedEvent, showPractice]);

  async function loadRankings() {
    setLoading(true);
    try {
      const entriesSnap = await getDocs(collection(db, "scouting"));
      const entries = entriesSnap.docs.map(doc => doc.data());

      // Filter
      const filtered = entries.filter(e => {
        // NOTE: No game field yet - all entries are REEFSCAPE
        // if (e.game !== selectedGame) return false;
        if (!showPractice && e.matchType === "practice") return false;
        // Add event filtering logic here
        return true;
      });

      // Group by team
      const teamStats: { [team: string]: any } = {};
      
      filtered.forEach(entry => {
        const team = entry.teamNumber;
        if (!teamStats[team]) {
          teamStats[team] = {
            scores: [],
            wins: 0,
            total: 0
          };
        }
        
        // Calculate score
        const score = calculateScore(entry);
        teamStats[team].scores.push(score);
        teamStats[team].total++;
      });

      // Convert to rankings
      const rankingsList: TeamRanking[] = Object.entries(teamStats).map(([team, stats]) => ({
        teamNumber: team,
        avgScore: Math.round(stats.scores.reduce((a: number, b: number) => a + b, 0) / stats.scores.length),
        matchesPlayed: stats.total,
        highScore: Math.max(...stats.scores),
        winRate: 0 // Calculate if win/loss data available
      }));

      rankingsList.sort((a, b) => b.avgScore - a.avgScore);
      setRankings(rankingsList);
    } catch (error) {
      console.error("Error loading rankings:", error);
    } finally {
      setLoading(false);
    }
  }

  function calculateScore(entry: any): number {
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
    
    const stage = (entry.stageStatus || "").toLowerCase();
    if (stage.includes("deep")) score += 12;
    else if (stage.includes("shallow")) score += 6;
    else if (stage.includes("park")) score += 2;
    
    return score;
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
            Team Rankings
          </h1>
          <p className="text-gray-600 mb-8">
            Team performance rankings based on average scores
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

          {/* Rankings Table */}
          {loading ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <div className="text-4xl mb-4">⏳</div>
              <p className="text-gray-600">Loading rankings...</p>
            </div>
          ) : rankings.length === 0 ? (
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
                      Rank
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Team
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Avg Score
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      High Score
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Matches
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {rankings.map((team, index) => (
                    <tr key={team.teamNumber} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {index < 3 ? (
                            <Trophy
                              size={20}
                              className={
                                index === 0 ? "text-yellow-500" :
                                index === 1 ? "text-gray-400" :
                                "text-orange-600"
                              }
                            />
                          ) : (
                            <span className="text-gray-600">#{index + 1}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-semibold text-lg">
                          {team.teamNumber}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-2xl font-bold" style={{ color: "#c42221" }}>
                          {team.avgScore}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <TrendingUp size={16} className="text-green-600" />
                          <span className="font-semibold">{team.highScore}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                        {team.matchesPlayed}
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

export default function RankingsPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <RankingsContent />
    </ProtectedRoute>
  );
}
