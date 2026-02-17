"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";

type TeamPick = {
  teamNumber: string;
  avgScore: number;
  highScore: number;
  picked: boolean;
  pickOrder?: number;
};

type ScoutingEntry = {
  teamNumber?: string;
  matchType?: string;
  leftStartingZone?: boolean;
  autoCoralL1?: number;
  autoCoralL2?: number;
  autoCoralL3?: number;
  autoCoralL4?: number;
  teleopCoralL1?: number;
  teleopCoralL2?: number;
  teleopCoralL3?: number;
  teleopCoralL4?: number;
};

function PickListContent() {
  const [entries, setEntries] = useState<ScoutingEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState("REEFSCAPE");
  const [pickedTeams, setPickedTeams] = useState<TeamPick[]>([]);
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

  const teams = useMemo(() => {
    const grouped: Record<string, number[]> = {};
    entries.forEach((e) => {
      if (!e.teamNumber || e.matchType === "practice") return;
      const score =
        (e.leftStartingZone ? 3 : 0) +
        (e.autoCoralL1 || 0) * 3 +
        (e.autoCoralL2 || 0) * 4 +
        (e.autoCoralL3 || 0) * 6 +
        (e.autoCoralL4 || 0) * 7 +
        (e.teleopCoralL1 || 0) * 2 +
        (e.teleopCoralL2 || 0) * 3 +
        (e.teleopCoralL3 || 0) * 4 +
        (e.teleopCoralL4 || 0) * 5;
      if (!grouped[e.teamNumber]) grouped[e.teamNumber] = [];
      grouped[e.teamNumber].push(score);
    });

    return Object.entries(grouped)
      .map(([teamNumber, scores]) => ({
        teamNumber,
        avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        highScore: Math.max(...scores),
        picked: pickedTeams.some((p) => p.teamNumber === teamNumber),
        pickOrder: pickedTeams.find((p) => p.teamNumber === teamNumber)?.pickOrder,
      }))
      .sort((a, b) => b.avgScore - a.avgScore);
  }, [entries, pickedTeams]);

  function pickTeam(team: TeamPick) {
    if (pickedTeams.some((p) => p.teamNumber === team.teamNumber)) return;
    setPickedTeams((prev) => [...prev, { ...team, picked: true, pickOrder: prev.length + 1 }]);
  }

  function removeTeam(teamNumber: string) {
    const next = pickedTeams.filter((p) => p.teamNumber !== teamNumber).map((p, i) => ({ ...p, pickOrder: i + 1 }));
    setPickedTeams(next);
  }

  return (
    <AnalyticsShell entriesCount={entries.length} selectedGame={selectedGame} onSelectedGameChange={setSelectedGame}>
      <h1 className="text-3xl font-bold mb-2 theme-text">Pick List</h1>
      <p className="text-gray-600 mb-6">Build and reorder your preferred alliance picks.</p>

      {loading ? (
        <LoadingSpinner message="Loading pick list..." />
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            <div className="p-4 border-b border-gray-200">
              <h2 className="font-semibold">Available Teams</h2>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {teams.filter((t) => !t.picked).map((team) => (
                <div key={team.teamNumber} className="p-4 border-b flex items-center justify-between">
                  <div>
                    <p className="font-semibold">Team {team.teamNumber}</p>
                    <p className="text-sm text-gray-600">Avg {team.avgScore} | High {team.highScore}</p>
                  </div>
                  <button onClick={() => pickTeam(team)} className="px-3 py-1.5 rounded theme-primary text-sm">
                    Pick
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            <div className="p-4 border-b border-gray-200">
              <h2 className="font-semibold">Selected Picks ({pickedTeams.length})</h2>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {pickedTeams.map((team) => (
                <div key={team.teamNumber} className="p-4 border-b flex items-center justify-between">
                  <div>
                    <p className="font-semibold">
                      {team.pickOrder}. Team {team.teamNumber}
                    </p>
                    <p className="text-sm text-gray-600">Avg {team.avgScore} | High {team.highScore}</p>
                  </div>
                  <button
                    onClick={() => removeTeam(team.teamNumber)}
                    className="px-3 py-1.5 rounded bg-red-100 text-red-700 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </AnalyticsShell>
  );
}

export default function PickListAnalyticsPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <PickListContent />
    </ProtectedRoute>
  );
}
