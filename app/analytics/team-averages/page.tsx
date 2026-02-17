"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";

type TeamAverage = {
  teamNumber: string;
  matchCount: number;
  avgAuto: number;
  avgTeleop: number;
  avgEndgame: number;
  avgTotal: number;
};

type ScoutingEntry = {
  teamNumber?: string;
  leftStartingZone?: boolean;
  stageStatus?: string;
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
  teleopAlgaeRemoved?: boolean;
};

function TeamAveragesContent() {
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

  const averages = useMemo(() => {
    const teamData: Record<string, number[]> = {};
    entries.forEach((e) => {
      const team = e.teamNumber;
      if (!team) return;
      const auto = (e.autoCoralL1 || 0) * 3 + (e.autoCoralL2 || 0) * 4 + (e.autoCoralL3 || 0) * 6 + (e.autoCoralL4 || 0) * 7 + (e.autoAlgaeProcessorScored || 0) * 6 + (e.autoAlgaeNetScored || 0) * 4 + (e.leftStartingZone ? 3 : 0);
      const tele = (e.teleopCoralL1 || 0) * 2 + (e.teleopCoralL2 || 0) * 3 + (e.teleopCoralL3 || 0) * 4 + (e.teleopCoralL4 || 0) * 5 + (e.teleopProcessorScored || 0) * 6 + (e.teleopNetRobotScored || 0) * 4 + (e.teleopNetHumanScored || 0) * 4 + (e.teleopAlgaeRemoved ? 2 : 0);
      const stage = String(e.stageStatus || "").toLowerCase();
      const end = stage.includes("deep") ? 12 : stage.includes("shallow") ? 6 : stage.includes("park") ? 2 : 0;
      const total = auto + tele + end;
      if (!teamData[team]) teamData[team] = [];
      teamData[team].push(total);
    });

    const rows: TeamAverage[] = Object.entries(teamData).map(([teamNumber, totals]) => {
      const avgTotal = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
      return {
        teamNumber,
        matchCount: totals.length,
        avgAuto: 0,
        avgTeleop: 0,
        avgEndgame: 0,
        avgTotal,
      };
    });
    return rows.sort((a, b) => b.avgTotal - a.avgTotal);
  }, [entries]);

  return (
    <AnalyticsShell entriesCount={entries.length} selectedGame={selectedGame} onSelectedGameChange={setSelectedGame}>
      <h1 className="text-3xl font-bold mb-2 theme-text">Team Averages</h1>
      <p className="text-gray-600 mb-6">Average performance by team.</p>

      {loading ? (
        <LoadingSpinner message="Loading team averages..." />
      ) : (
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Matches</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {averages.map((team) => (
                <tr key={team.teamNumber}>
                  <td className="px-6 py-4 font-semibold">{team.teamNumber}</td>
                  <td className="px-6 py-4">{team.matchCount}</td>
                  <td className="px-6 py-4 text-xl font-bold theme-text">{team.avgTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AnalyticsShell>
  );
}

export default function TeamAveragesPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <TeamAveragesContent />
    </ProtectedRoute>
  );
}
