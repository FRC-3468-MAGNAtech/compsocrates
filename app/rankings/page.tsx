"use client";

import { useState, useEffect } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, Trophy } from "lucide-react";

interface TeamRanking {
  rank: number;
  teamNumber: string;
  avgScore: number;
  autoPoints: number;
  teleopPoints: number;
  climbRate: number;
  matchesPlayed: number;
}

type SortKey = "avgScore" | "autoPoints" | "teleopPoints" | "climbRate" | "matchesPlayed";

function RankingsContent() {
  const router = useRouter();
  const [rankings, setRankings] = useState<TeamRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("avgScore");
  const [sortDesc, setSortDesc] = useState(true);

  useEffect(() => {
    loadRankings();
  }, []);

  async function loadRankings() {
    setLoading(true);
    try {
      const entriesSnap = await getDocs(collection(db, "scoutingEntries"));
      const entries = entriesSnap.docs.map(doc => doc.data());

      // Group by team
      const teamMap: Record<string, any[]> = {};
      entries.forEach(e => {
        if (!teamMap[e.teamNumber]) teamMap[e.teamNumber] = [];
        teamMap[e.teamNumber].push(e);
      });

      // Calculate stats for each team
      const teamRankings: TeamRanking[] = Object.entries(teamMap).map(([teamNumber, teamEntries]) => {
        const totalAuto = teamEntries.reduce((sum, e) => {
          let auto = 0;
          if (e.leftStartingZone) auto += 3;
          auto += (e.autoCoralL1 || 0) * 3;
          auto += (e.autoCoralL2 || 0) * 4;
          auto += (e.autoCoralL3 || 0) * 6;
          auto += (e.autoCoralL4 || 0) * 7;
          auto += (e.autoAlgaeProcessorScored || 0) * 6;
          auto += (e.autoAlgaeNetScored || 0) * 4;
          return sum + auto;
        }, 0);

        const totalTeleop = teamEntries.reduce((sum, e) => {
          let teleop = 0;
          teleop += (e.teleopCoralL1 || 0) * 2;
          teleop += (e.teleopCoralL2 || 0) * 3;
          teleop += (e.teleopCoralL3 || 0) * 4;
          teleop += (e.teleopCoralL4 || 0) * 5;
          teleop += (e.teleopProcessorScored || 0) * 6;
          teleop += (e.teleopNetRobotScored || 0) * 4;
          teleop += (e.teleopNetHumanScored || 0) * 4;
          if (e.teleopAlgaeRemoved) teleop += 2;
          return sum + teleop;
        }, 0);

        const totalEndgame = teamEntries.reduce((sum, e) => {
          let endgame = 0;
          if (e.stageStatus?.toLowerCase().includes("deep")) endgame = 12;
          else if (e.stageStatus?.toLowerCase().includes("shallow")) endgame = 6;
          else if (e.stageStatus?.toLowerCase().includes("park")) endgame = 2;
          return sum + endgame;
        }, 0);

        const climbSuccesses = teamEntries.filter(e => 
          e.stageStatus && !e.stageStatus.toLowerCase().includes("none")
        ).length;

        const avgScore = (totalAuto + totalTeleop + totalEndgame) / teamEntries.length;
        const autoPoints = totalAuto / teamEntries.length;
        const teleopPoints = totalTeleop / teamEntries.length;
        const climbRate = (climbSuccesses / teamEntries.length) * 100;

        return {
          rank: 0,
          teamNumber,
          avgScore,
          autoPoints,
          teleopPoints,
          climbRate,
          matchesPlayed: teamEntries.length,
        };
      });

      // Sort by avgScore descending by default
      teamRankings.sort((a, b) => b.avgScore - a.avgScore);
      
      // Assign ranks
      teamRankings.forEach((team, i) => {
        team.rank = i + 1;
      });

      setRankings(teamRankings);
    } catch (error) {
      console.error("Error loading rankings:", error);
    } finally {
      setLoading(false);
    }
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }

    const sorted = [...rankings].sort((a, b) => {
      const aVal = a[key];
      const bVal = b[key];
      return sortDesc ? aVal - bVal : bVal - aVal;
    });

    // Reassign ranks
    sorted.forEach((team, i) => {
      team.rank = i + 1;
    });

    setRankings(sorted);
  }

  function SortHeader({ label, sortKey: key }: { label: string; sortKey: SortKey }) {
    const isActive = sortKey === key;
    return (
      <th
        onClick={() => handleSort(key)}
        className="px-4 py-3 text-left cursor-pointer hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold">{label}</span>
          {isActive && (
            sortDesc ? <ChevronDown size={16} /> : <ChevronUp size={16} />
          )}
        </div>
      </th>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
          Team Rankings
        </h1>
        <p className="text-gray-600 mb-6">Sortable rankings of all scouted teams</p>

        {loading ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-4 animate-spin">🔄</div>
            <p className="text-gray-600">Loading rankings...</p>
          </div>
        ) : rankings.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md p-8 text-center">
            <p className="text-gray-600">No teams have been scouted yet</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b-2 border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold w-20">Rank</th>
                    <th className="px-4 py-3 text-left font-semibold">Team</th>
                    <SortHeader label="Avg Score" sortKey="avgScore" />
                    <SortHeader label="Auto" sortKey="autoPoints" />
                    <SortHeader label="Teleop" sortKey="teleopPoints" />
                    <SortHeader label="Climb %" sortKey="climbRate" />
                    <SortHeader label="Matches" sortKey="matchesPlayed" />
                  </tr>
                </thead>
                <tbody>
                  {rankings.map((team) => (
                    <tr
                      key={team.teamNumber}
                      onClick={() => router.push(`/analytics/team-averages?team=${team.teamNumber}`)}
                      className="border-b border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          {team.rank <= 3 && (
                            <Trophy
                              size={20}
                              className={
                                team.rank === 1 ? "text-yellow-500" :
                                team.rank === 2 ? "text-gray-400" :
                                "text-amber-600"
                              }
                            />
                          )}
                          <span className="font-bold text-lg">{team.rank}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className="font-semibold text-lg">Team {team.teamNumber}</span>
                      </td>
                      <td className="px-4 py-4">
                        <span className="font-bold" style={{ color: "#c42221" }}>
                          {team.avgScore.toFixed(1)}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-gray-700">{team.autoPoints.toFixed(1)}</td>
                      <td className="px-4 py-4 text-gray-700">{team.teleopPoints.toFixed(1)}</td>
                      <td className="px-4 py-4">
                        <span className={`font-semibold ${
                          team.climbRate >= 80 ? "text-green-600" :
                          team.climbRate >= 50 ? "text-yellow-600" :
                          "text-red-600"
                        }`}>
                          {team.climbRate.toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-4 py-4 text-gray-700">{team.matchesPlayed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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