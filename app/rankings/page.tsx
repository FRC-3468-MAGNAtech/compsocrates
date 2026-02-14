// FILE: app/rankings/page.tsx
// COMPLETE REWRITE - Uses AnalyticsLayout, proper sorting

"use client";

import { useState, useEffect } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsLayout from "@/app/components/AnalyticsLayout";
import { Trophy, TrendingUp } from "lucide-react";
import { calculateScoutedScore } from "@/app/utils/practiceTypes";

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

  useEffect(() => {
    loadRankings();
  }, [selectedGame, selectedEvent, showPractice]);

  async function loadRankings() {
    setLoading(true);
    try {
      const entriesSnap = await getDocs(collection(db, "scouting"));
      const entries = entriesSnap.docs.map(doc => doc.data());

      const filtered = entries.filter(e => {
        if (e.game !== selectedGame) return false;
        if (!showPractice && e.matchType === "practice") return false;
        return true;
      });

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
        
        const score = calculateScoutedScore(entry);
        teamStats[team].scores.push(score);
        teamStats[team].total++;
      });

      const rankingsList: TeamRanking[] = Object.entries(teamStats).map(([team, stats]) => ({
        teamNumber: team,
        avgScore: Math.round(stats.scores.reduce((a: number, b: number) => a + b, 0) / stats.scores.length),
        matchesPlayed: stats.total,
        highScore: Math.max(...stats.scores),
        winRate: 0
      }));

      rankingsList.sort((a, b) => b.avgScore - a.avgScore);
      setRankings(rankingsList);
    } catch (error) {
      console.error("Error loading rankings:", error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AnalyticsLayout
      currentPage="rankings"
      title="Rankings"
      entryCount={rankings.reduce((sum, t) => sum + t.matchesPlayed, 0)}
      loading={loading}
      selectedGame={selectedGame}
      onGameChange={setSelectedGame}
      selectedEvent={selectedEvent}
      onEventChange={setSelectedEvent}
      showPractice={showPractice}
      onPracticeToggle={setShowPractice}
    >
      {rankings.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md p-12 text-center">
          <div className="text-6xl mb-4">📊</div>
          <h2 className="text-2xl font-semibold mb-2">No Data Available</h2>
          <p className="text-gray-600">
            No scouting data found for the selected filters.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rank</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg Score</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">High Score</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Matches</th>
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
                    <span className="font-semibold text-lg">{team.teamNumber}</span>
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
    </AnalyticsLayout>
  );
}

export default function RankingsPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <RankingsContent />
    </ProtectedRoute>
  );
}
