"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { sortMatches } from "@/app/utils/matchSorting";

type MatchEntry = {
  matchId: string;
  teamNumber: string;
  scoutName: string;
  totalScore: number;
};

type ScoutingEntry = {
  matchId?: string;
  matchNumber?: string;
  matchType?: string;
  teamNumber?: string;
  scoutName?: string;
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

function formatMatchLabel(matchId: string): string {
  const id = matchId.toLowerCase();
  const num = id.replace(/\D/g, "");
  if (id.startsWith("p")) return `Practice ${num}`;
  if (id.startsWith("q")) return `Qualification ${num}`;
  if (id.startsWith("f")) return `Finals ${num}`;
  return `Match ${matchId}`;
}

function MatchBreakdownContent() {
  const [entries, setEntries] = useState<ScoutingEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState("REEFSCAPE");
  const [selectedMatch, setSelectedMatch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadEntries() {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "scouting"));
        const rows = snap.docs.map((d) => d.data());
        setEntries(rows);
      } finally {
        setLoading(false);
      }
    }
    loadEntries();
  }, []);

  const matches = useMemo(() => {
    const ids = entries
      .map((e) => {
        if (e.matchId) return String(e.matchId).toLowerCase();
        const num = String(e.matchNumber || "").replace(/\D/g, "");
        const prefix = e.matchType === "practice" ? "p" : e.matchType === "finals" ? "f" : "q";
        return num ? `${prefix}${num}` : "";
      })
      .filter(Boolean);
    return sortMatches([...new Set(ids)].map((matchId) => ({ matchId }))).map((m) => m.matchId);
  }, [entries]);

  useEffect(() => {
    if (!selectedMatch && matches.length > 0) {
      setSelectedMatch(matches[0]);
    }
  }, [matches, selectedMatch]);

  const matchRows = useMemo<MatchEntry[]>(() => {
    if (!selectedMatch) return [];
    return entries
      .filter((e) => {
        const id = e.matchId
          ? String(e.matchId).toLowerCase()
          : `${e.matchType === "practice" ? "p" : e.matchType === "finals" ? "f" : "q"}${String(e.matchNumber || "").replace(/\D/g, "")}`;
        return id === selectedMatch;
      })
      .map((e) => ({
        matchId: selectedMatch,
        teamNumber: e.teamNumber || "-",
        scoutName: e.scoutName || "-",
        totalScore:
          (e.leftStartingZone ? 3 : 0) +
          (e.autoCoralL1 || 0) * 3 +
          (e.autoCoralL2 || 0) * 4 +
          (e.autoCoralL3 || 0) * 6 +
          (e.autoCoralL4 || 0) * 7 +
          (e.teleopCoralL1 || 0) * 2 +
          (e.teleopCoralL2 || 0) * 3 +
          (e.teleopCoralL3 || 0) * 4 +
          (e.teleopCoralL4 || 0) * 5,
      }));
  }, [entries, selectedMatch]);

  return (
    <AnalyticsShell entriesCount={entries.length} selectedGame={selectedGame} onSelectedGameChange={setSelectedGame}>
      <h1 className="text-3xl font-bold mb-2 theme-text">Match Breakdown</h1>
      <p className="text-gray-600 mb-6">Detailed view by selected match.</p>

      <div className="bg-white rounded-xl shadow-md p-4 mb-4">
        <label className="text-sm text-gray-600 mr-2">Select Match:</label>
        <select
          value={selectedMatch}
          onChange={(e) => setSelectedMatch(e.target.value)}
          className="border rounded px-3 py-2"
        >
          {matches.map((m) => (
            <option key={m} value={m}>
              {formatMatchLabel(m)}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <LoadingSpinner message="Loading match data..." />
      ) : (
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scout</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {matchRows.map((row, idx) => (
                <tr key={`${row.teamNumber}-${idx}`}>
                  <td className="px-6 py-4 font-semibold">{row.teamNumber}</td>
                  <td className="px-6 py-4">{row.scoutName}</td>
                  <td className="px-6 py-4 text-xl font-bold theme-text">{row.totalScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AnalyticsShell>
  );
}

export default function MatchBreakdownPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <MatchBreakdownContent />
    </ProtectedRoute>
  );
}
