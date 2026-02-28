"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { entryMatchesAnalyticsFilters, getEventOptionsForEntries, isPracticeScoutedEntry, type AnalyticsGame } from "@/app/utils/analyticsEvents";

type TeamAverage = {
  teamNumber: string;
  matchCount: number;
  avgAuto: number;
  avgTeleop: number;
  avgEndgame: number;
  avgTotal: number;
};

type ScoutingEntry = {
  eventKey?: string;
  submittedAt?: number;
  timestamp?: number;
  game?: string;
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
  penaltyPoints?: number;
  estimatedScore?: number;
  auto?: {
    estimatedFuel?: number;
    successfulClimb?: boolean;
  };
  teleop?: {
    estimatedFuel?: number;
  };
  endgame?: {
    status?: string;
  };
  matchType?: string;
  practiceMode?: string;
  isPracticeScouting?: boolean;
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

  const auto =
    (entry.autoCoralL1 || 0) * 3 +
    (entry.autoCoralL2 || 0) * 4 +
    (entry.autoCoralL3 || 0) * 6 +
    (entry.autoCoralL4 || 0) * 7 +
    (entry.autoAlgaeProcessorScored || 0) * 6 +
    (entry.autoAlgaeNetScored || 0) * 4 +
    (entry.leftStartingZone ? 3 : 0);
  const tele =
    (entry.teleopCoralL1 || 0) * 2 +
    (entry.teleopCoralL2 || 0) * 3 +
    (entry.teleopCoralL3 || 0) * 4 +
    (entry.teleopCoralL4 || 0) * 5 +
    (entry.teleopProcessorScored || 0) * 6 +
    (entry.teleopNetRobotScored || 0) * 4 +
    (entry.teleopNetHumanScored || 0) * 4 +
    (entry.teleopAlgaeRemoved ? 2 : 0);
  const stage = String(entry.stageStatus || "").toLowerCase();
  const end = stage.includes("deep") ? 12 : stage.includes("shallow") ? 6 : stage.includes("park") ? 2 : 0;
  return auto + tele + end + Number(entry.penaltyPoints || 0);
}

function TeamAveragesContent() {
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
        setEntries(snap.docs.map((d) => d.data()));
      } finally {
        setLoading(false);
      }
    }
    loadEntries();
  }, []);

  const filteredEntries = useMemo(() => {
    const gameFiltered = entries.filter((entry) => entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent));
    return gameFiltered.filter((entry) => (practiceMatchesOnly ? isPracticeEntry(entry) : !isPracticeEntry(entry)));
  }, [entries, selectedEvent, selectedGame, practiceMatchesOnly]);

  const averages = useMemo(() => {
    const teamData: Record<string, number[]> = {};
    filteredEntries.forEach((e) => {
      const team = e.teamNumber;
      if (!team) return;
      const total = scoreEntry(e, selectedGame);
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
