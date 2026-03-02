"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { entryMatchesAnalyticsFilters, getEventOptionsForEntries, isPracticeScoutedEntry, type AnalyticsGame } from "@/app/utils/analyticsEvents";

type ScoutingEntry = {
  eventKey?: string;
  submittedAt?: number;
  timestamp?: number;
  game?: string;
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
  penaltyPoints?: number;
  auto?: {
    estimatedFuel?: number;
    successfulClimb?: boolean;
    preloadScale?: number;
    bpsScale?: number;
    carryingScale?: number;
  };
  teleop?: {
    estimatedFuel?: number;
    bpsScale?: number;
    carryingScale?: number;
  };
  endgame?: {
    status?: string;
  };
  matchType?: string;
  practiceMode?: string;
  isPracticeScouting?: boolean;
};

type TeamSummary = {
  teamNumber: string;
  avgScore: number;
  matches: number;
  lastSeen: number;
};

function isPracticeEntry(entry: ScoutingEntry) {
  return isPracticeScoutedEntry(entry);
}

function scoreEntry(entry: ScoutingEntry, game: AnalyticsGame): number {
  if (game === "REBUILT") {
    const autoFuel = Number(entry.auto?.estimatedFuel || 0);
    const teleFuel = Number(entry.teleop?.estimatedFuel || 0);
    const autoClimb = entry.auto?.successfulClimb ? 15 : 0;
    const endStatus = String(entry.endgame?.status || "").toLowerCase();
    const endgameClimb = endStatus === "level-1" ? 10 : endStatus === "level-2" ? 20 : endStatus === "level-3" ? 30 : 0;
    return autoFuel + teleFuel + autoClimb + endgameClimb;
  }
  return (
    (entry.leftStartingZone ? 3 : 0) +
    (entry.autoCoralL1 || 0) * 3 +
    (entry.autoCoralL2 || 0) * 4 +
    (entry.autoCoralL3 || 0) * 6 +
    (entry.autoCoralL4 || 0) * 7 +
    (entry.autoAlgaeProcessorScored || 0) * 6 +
    (entry.autoAlgaeNetScored || 0) * 4 +
    (entry.teleopCoralL1 || 0) * 2 +
    (entry.teleopCoralL2 || 0) * 3 +
    (entry.teleopCoralL3 || 0) * 4 +
    (entry.teleopCoralL4 || 0) * 5 +
    (entry.teleopProcessorScored || 0) * 6 +
    (entry.teleopNetRobotScored || 0) * 4 +
    (entry.teleopNetHumanScored || 0) * 4 +
    Number(entry.penaltyPoints || 0)
  );
}

function TeamBreakdownContent() {
  const [entries, setEntries] = useState<ScoutingEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REEFSCAPE");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedGame = localStorage.getItem("analytics-selected-game");
    const savedEvent = localStorage.getItem("analytics-selected-event");
    const savedPractice = localStorage.getItem("analytics-practice-matches-only");
    if (savedGame === "REEFSCAPE" || savedGame === "REBUILT") setSelectedGame(savedGame);
    if (savedEvent) setSelectedEvent(savedEvent);
    if (savedPractice !== null) setPracticeMatchesOnly(savedPractice === "true");
  }, []);

  useEffect(() => {
    localStorage.setItem("analytics-selected-game", selectedGame);
    localStorage.setItem("analytics-selected-event", selectedEvent);
    localStorage.setItem("analytics-practice-matches-only", String(practiceMatchesOnly));
  }, [selectedGame, selectedEvent, practiceMatchesOnly]);

  useEffect(() => {
    async function loadEntries() {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "scouting"));
        setEntries(snap.docs.map((d) => d.data() as ScoutingEntry));
      } finally {
        setLoading(false);
      }
    }
    void loadEntries();
  }, []);

  const filteredEntries = useMemo(() => {
    const gameFiltered = entries.filter((entry) => entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent));
    return gameFiltered.filter((entry) => (practiceMatchesOnly ? isPracticeEntry(entry) : !isPracticeEntry(entry)));
  }, [entries, selectedEvent, selectedGame, practiceMatchesOnly]);

  const teamRows = useMemo(() => {
    const grouped: Record<string, { scores: number[]; lastSeen: number }> = {};
    filteredEntries.forEach((entry) => {
      const teamNumber = String(entry.teamNumber || "").trim();
      if (!teamNumber) return;
      if (!grouped[teamNumber]) grouped[teamNumber] = { scores: [], lastSeen: 0 };
      grouped[teamNumber].scores.push(scoreEntry(entry, selectedGame));
      const time = Number(entry.submittedAt || entry.timestamp || 0);
      grouped[teamNumber].lastSeen = Math.max(grouped[teamNumber].lastSeen, time);
    });

    const rows: TeamSummary[] = Object.entries(grouped).map(([teamNumber, value]) => ({
      teamNumber,
      avgScore: value.scores.length > 0 ? Math.round(value.scores.reduce((a, b) => a + b, 0) / value.scores.length) : 0,
      matches: value.scores.length,
      lastSeen: value.lastSeen,
    }));
    return rows.sort((a, b) => b.avgScore - a.avgScore);
  }, [filteredEntries, selectedGame]);

  return (
    <AnalyticsShell
      entriesCount={filteredEntries.length}
      selectedGame={selectedGame}
      onSelectedGameChange={(game) => setSelectedGame(game as AnalyticsGame)}
      practiceMatchesOnly={practiceMatchesOnly}
      onPracticeMatchesOnlyChange={setPracticeMatchesOnly}
      selectedEvent={selectedEvent}
      eventOptions={[{ id: "all", name: "All Events" }, ...getEventOptionsForEntries(entries, selectedGame)]}
      onSelectedEventChange={setSelectedEvent}
    >
      <h1 className="text-3xl font-bold mb-2 theme-text">Team Breakdown</h1>
      <p className="text-gray-600 mb-6">Open any team for cross-form details, event history, and capability comparisons.</p>

      {loading ? (
        <LoadingSpinner message="Loading team breakdown..." />
      ) : (
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg Score</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scouted Matches</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {teamRows.map((row) => (
                <tr key={row.teamNumber} data-analytics-search-item="true" className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-semibold">
                    <Link href={`/analytics/team-breakdown/${row.teamNumber}`} className="text-blue-700 hover:underline">
                      Team {row.teamNumber}
                    </Link>
                  </td>
                  <td className="px-6 py-4">{row.avgScore}</td>
                  <td className="px-6 py-4">{row.matches}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {row.lastSeen > 0 ? new Date(row.lastSeen).toLocaleString() : "-"}
                  </td>
                </tr>
              ))}
              {teamRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">
                    No teams match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </AnalyticsShell>
  );
}

export default function TeamBreakdownPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <TeamBreakdownContent />
    </ProtectedRoute>
  );
}
