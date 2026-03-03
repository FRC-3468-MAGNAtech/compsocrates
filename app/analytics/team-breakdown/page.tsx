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
  };
  teleop?: {
    estimatedFuel?: number;
  };
  endgame?: {
    status?: string;
  };
  isPracticeScouting?: boolean;
  practiceMode?: string;
  practiceSessionId?: string;
};

type PitEntry = {
  eventKey?: string;
  game?: string;
  teamNumber?: string;
  createdAt?: number;
};

type StrategyOrDriveEntry = {
  eventKey?: string;
  game?: string;
  createdAt?: number;
  robots?: Array<{ teamNumber?: string }>;
};

type TeamSummary = {
  teamNumber: string;
  avgScore: number | null;
  matches: number;
  lastSeen: number;
};

function normalizeTeamNumber(value: unknown) {
  return String(value || "").replace(/[^\d]/g, "");
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

function isPracticeEntry(entry: ScoutingEntry) {
  return isPracticeScoutedEntry(entry);
}

function gameForAuxEntry(rawGame: unknown): AnalyticsGame {
  return String(rawGame || "").toUpperCase() === "REEFSCAPE" ? "REEFSCAPE" : "REBUILT";
}

function TeamBreakdownContent() {
  const [scoutingEntries, setScoutingEntries] = useState<ScoutingEntry[]>([]);
  const [pitEntries, setPitEntries] = useState<PitEntry[]>([]);
  const [strategyEntries, setStrategyEntries] = useState<StrategyOrDriveEntry[]>([]);
  const [driveEntries, setDriveEntries] = useState<StrategyOrDriveEntry[]>([]);
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
        const [scoutingSnap, pitSnap, strategySnap, driveSnap] = await Promise.all([
          getDocs(collection(db, "scouting")),
          getDocs(collection(db, "pitScouting")),
          getDocs(collection(db, "matchStrategyPlans")),
          getDocs(collection(db, "driveScouting")),
        ]);
        setScoutingEntries(scoutingSnap.docs.map((d) => d.data() as ScoutingEntry));
        setPitEntries(pitSnap.docs.map((d) => d.data() as PitEntry));
        setStrategyEntries(strategySnap.docs.map((d) => d.data() as StrategyOrDriveEntry));
        setDriveEntries(driveSnap.docs.map((d) => d.data() as StrategyOrDriveEntry));
      } finally {
        setLoading(false);
      }
    }
    void loadEntries();
  }, []);

  const filteredScoutingEntries = useMemo(() => {
    const gameFiltered = scoutingEntries.filter((entry) => entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent));
    return gameFiltered.filter((entry) => (practiceMatchesOnly ? isPracticeEntry(entry) : !isPracticeEntry(entry)));
  }, [scoutingEntries, selectedEvent, selectedGame, practiceMatchesOnly]);

  const filteredPitEntries = useMemo(() => {
    return pitEntries.filter((entry) => {
      if (gameForAuxEntry(entry.game) !== selectedGame) return false;
      if (selectedEvent !== "all" && String(entry.eventKey || "").trim() !== selectedEvent) return false;
      return true;
    });
  }, [pitEntries, selectedEvent, selectedGame]);

  const filteredStrategyEntries = useMemo(() => {
    if (selectedGame === "REEFSCAPE") return [] as StrategyOrDriveEntry[];
    return strategyEntries.filter((entry) => {
      if (gameForAuxEntry(entry.game) !== selectedGame) return false;
      if (selectedEvent !== "all" && String(entry.eventKey || "").trim() !== selectedEvent) return false;
      return true;
    });
  }, [strategyEntries, selectedEvent, selectedGame]);

  const filteredDriveEntries = useMemo(() => {
    if (selectedGame === "REEFSCAPE") return [] as StrategyOrDriveEntry[];
    return driveEntries.filter((entry) => {
      if (gameForAuxEntry(entry.game) !== selectedGame) return false;
      if (selectedEvent !== "all" && String(entry.eventKey || "").trim() !== selectedEvent) return false;
      return true;
    });
  }, [driveEntries, selectedEvent, selectedGame]);

  const eventSeedEntries = useMemo(
    () => [
      ...scoutingEntries,
      ...pitEntries.map((entry) => ({ eventKey: entry.eventKey, game: gameForAuxEntry(entry.game) })),
      ...strategyEntries.map((entry) => ({ eventKey: entry.eventKey, game: gameForAuxEntry(entry.game) })),
      ...driveEntries.map((entry) => ({ eventKey: entry.eventKey, game: gameForAuxEntry(entry.game) })),
    ],
    [scoutingEntries, pitEntries, strategyEntries, driveEntries]
  );

  const teamRows = useMemo(() => {
    const grouped = new Map<string, { scores: number[]; matches: number; lastSeen: number }>();

    filteredScoutingEntries.forEach((entry) => {
      const teamNumber = normalizeTeamNumber(entry.teamNumber);
      if (!teamNumber) return;
      const row = grouped.get(teamNumber) || { scores: [], matches: 0, lastSeen: 0 };
      row.scores.push(scoreEntry(entry, selectedGame));
      row.matches += 1;
      row.lastSeen = Math.max(row.lastSeen, Number(entry.submittedAt || entry.timestamp || 0));
      grouped.set(teamNumber, row);
    });

    filteredPitEntries.forEach((entry) => {
      const teamNumber = normalizeTeamNumber(entry.teamNumber);
      if (!teamNumber) return;
      const row = grouped.get(teamNumber) || { scores: [], matches: 0, lastSeen: 0 };
      row.lastSeen = Math.max(row.lastSeen, Number(entry.createdAt || 0));
      grouped.set(teamNumber, row);
    });

    const mergeRobotRows = (entries: StrategyOrDriveEntry[]) => {
      entries.forEach((entry) => {
        (entry.robots || []).forEach((robot) => {
          const teamNumber = normalizeTeamNumber(robot.teamNumber);
          if (!teamNumber) return;
          const row = grouped.get(teamNumber) || { scores: [], matches: 0, lastSeen: 0 };
          row.lastSeen = Math.max(row.lastSeen, Number(entry.createdAt || 0));
          grouped.set(teamNumber, row);
        });
      });
    };
    mergeRobotRows(filteredStrategyEntries);
    mergeRobotRows(filteredDriveEntries);

    const rows: TeamSummary[] = Array.from(grouped.entries()).map(([teamNumber, value]) => ({
      teamNumber,
      avgScore: value.scores.length > 0 ? Math.round(value.scores.reduce((a, b) => a + b, 0) / value.scores.length) : null,
      matches: value.matches,
      lastSeen: value.lastSeen,
    }));

    return rows.sort((a, b) => Number(a.teamNumber) - Number(b.teamNumber));
  }, [filteredScoutingEntries, filteredPitEntries, filteredStrategyEntries, filteredDriveEntries, selectedGame]);

  return (
    <AnalyticsShell
      entriesCount={filteredScoutingEntries.length + filteredPitEntries.length + filteredStrategyEntries.length + filteredDriveEntries.length}
      selectedGame={selectedGame}
      onSelectedGameChange={(game) => setSelectedGame(game as AnalyticsGame)}
      practiceMatchesOnly={practiceMatchesOnly}
      onPracticeMatchesOnlyChange={setPracticeMatchesOnly}
      selectedEvent={selectedEvent}
      eventOptions={[{ id: "all", name: "All Events" }, ...getEventOptionsForEntries(eventSeedEntries, selectedGame)]}
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
                    <Link
                      href={`/analytics/team-breakdown/${row.teamNumber}`}
                      className="text-blue-700 hover:underline"
                      onClick={() => localStorage.removeItem("analytics-search-term")}
                    >
                      Team {row.teamNumber}
                    </Link>
                  </td>
                  <td className="px-6 py-4">{row.avgScore === null ? "-" : row.avgScore}</td>
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
