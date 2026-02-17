"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";

type TeamRanking = {
  teamNumber: string;
  avgScore: number;
  highScore: number;
  matches: number;
};

type ScoutingEntry = {
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
  teleopProcessorScored?: number;
  teleopNetRobotScored?: number;
  teleopNetHumanScored?: number;
};

function RankingsContent() {
  const [entries, setEntries] = useState<ScoutingEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState("REEFSCAPE");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadEntries() {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "scouting"));
        setEntries(snap.docs.map((d) => d.data()));
      } finally {
        setLoading(false);
      }
    }
    loadEntries();
  }, []);

  const rankings = useMemo(() => {
    const teamScores: Record<string, number[]> = {};
    entries.forEach((e) => {
      const team = e.teamNumber;
      if (!team) return;
      const score =
        (e.leftStartingZone ? 3 : 0) +
        (e.autoCoralL1 || 0) * 3 +
        (e.autoCoralL2 || 0) * 4 +
        (e.autoCoralL3 || 0) * 6 +
        (e.autoCoralL4 || 0) * 7 +
        (e.autoAlgaeProcessorScored || 0) * 6 +
        (e.autoAlgaeNetScored || 0) * 4 +
        (e.teleopCoralL1 || 0) * 2 +
        (e.teleopCoralL2 || 0) * 3 +
        (e.teleopCoralL3 || 0) * 4 +
        (e.teleopCoralL4 || 0) * 5 +
        (e.teleopProcessorScored || 0) * 6 +
        (e.teleopNetRobotScored || 0) * 4 +
        (e.teleopNetHumanScored || 0) * 4;
      if (!teamScores[team]) teamScores[team] = [];
      teamScores[team].push(score);
    });

    const rows: TeamRanking[] = Object.entries(teamScores).map(([teamNumber, scores]) => ({
      teamNumber,
      avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      highScore: Math.max(...scores),
      matches: scores.length,
    }));
    return rows.sort((a, b) => b.avgScore - a.avgScore);
  }, [entries]);

  return (
    <AnalyticsShell entriesCount={entries.length} selectedGame={selectedGame} onSelectedGameChange={setSelectedGame}>
      <h1 className="text-3xl font-bold mb-2 theme-text">Rankings</h1>
      <p className="text-gray-600 mb-6">Teams ranked by average score.</p>

      {loading ? (
        <LoadingSpinner message="Loading rankings..." />
      ) : (
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rank</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">High</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Matches</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rankings.map((team, i) => (
                <tr key={team.teamNumber}>
                  <td className="px-6 py-4">#{i + 1}</td>
                  <td className="px-6 py-4 font-semibold">{team.teamNumber}</td>
                  <td className="px-6 py-4 text-xl font-bold theme-text">{team.avgScore}</td>
                  <td className="px-6 py-4">{team.highScore}</td>
                  <td className="px-6 py-4">{team.matches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AnalyticsShell>
  );
}

export default function RankingsPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <RankingsContent />
    </ProtectedRoute>
  );
}
