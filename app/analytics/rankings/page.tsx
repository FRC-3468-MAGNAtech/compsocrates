"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { entryMatchesAnalyticsFilters, getEventOptionsForEntries, isPracticeScoutedEntry, type AnalyticsGame } from "@/app/utils/analyticsEvents";
import { dedupeEntriesByMatchTeam } from "@/app/utils/entryDeduping";

type TeamRanking = {
  teamNumber: string;
  avgScore: number;
  highScore: number;
  matches: number;
};

type ScoutingEntry = {
  id?: string;
  eventKey?: string;
  submittedAt?: number;
  timestamp?: number;
  accuracy?: number;
  game?: string;
  teamNumber?: string;
  scoutName?: string;
  scoutId?: string;
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
  excludeFromStats?: boolean;
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

function RankingsContent() {
  const [entries, setEntries] = useState<ScoutingEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REEFSCAPE");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeScoutTeam, setActiveScoutTeam] = useState<string | null>(null);
  const eventOptions = useMemo(() => getEventOptionsForEntries(entries, selectedGame), [entries, selectedGame]);

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
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } finally {
        setLoading(false);
      }
    }
    loadEntries();
  }, []);

  const filteredEntries = useMemo(() => {
    const gameFiltered = entries.filter((entry) =>
      entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent, eventOptions)
    );
    return gameFiltered
      .filter((entry) => (practiceMatchesOnly ? isPracticeEntry(entry) : !isPracticeEntry(entry)))
      .filter((entry) => !entry.excludeFromStats);
  }, [entries, selectedEvent, selectedGame, practiceMatchesOnly, eventOptions]);

  const dedupedEntries = useMemo(
    () =>
      dedupeEntriesByMatchTeam(filteredEntries, {
        game: selectedGame,
        eventOptions,
        selectedEvent,
        preferLatest: true,
      }),
    [filteredEntries, selectedGame, eventOptions, selectedEvent]
  );

  const rankings = useMemo(() => {
    const teamScores: Record<string, number[]> = {};
    dedupedEntries.forEach((e) => {
      const team = e.teamNumber;
      if (!team) return;
      const score = scoreEntry(e, selectedGame);
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
  }, [dedupedEntries, selectedGame]);

  const scoutBreakdown = useMemo(() => {
    const map = new Map<string, { total: number; scouts: Map<string, number> }>();
    filteredEntries.forEach((entry) => {
      const team = String(entry.teamNumber || "").trim();
      if (!team) return;
      const scout = String(entry.scoutName || "Unknown").trim() || "Unknown";
      const existing = map.get(team) || { total: 0, scouts: new Map<string, number>() };
      existing.total += 1;
      existing.scouts.set(scout, (existing.scouts.get(scout) || 0) + 1);
      map.set(team, existing);
    });
    return map;
  }, [filteredEntries]);

  const activeScoutBreakdown = activeScoutTeam ? scoutBreakdown.get(activeScoutTeam) || null : null;

  return (
    <AnalyticsShell
      entriesCount={dedupedEntries.length}
      selectedGame={selectedGame}
      onSelectedGameChange={(game) => setSelectedGame(game as AnalyticsGame)}
      practiceMatchesOnly={practiceMatchesOnly}
      onPracticeMatchesOnlyChange={setPracticeMatchesOnly}
      selectedEvent={selectedEvent}
      eventOptions={[{ id: "all", name: "All Events" }, ...eventOptions]}
      onSelectedEventChange={setSelectedEvent}
    >
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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scouts</th>
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
                  <td className="px-6 py-4">
                    <button
                      type="button"
                      onClick={() => setActiveScoutTeam(team.teamNumber)}
                      className="px-3 py-1.5 rounded border text-sm hover:bg-gray-50"
                    >
                      Scouts
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeScoutTeam && (
        <div className="fixed inset-0 bg-black/45 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Team {activeScoutTeam} Scouts</h2>
              <button
                type="button"
                onClick={() => setActiveScoutTeam(null)}
                className="px-3 py-1 rounded border hover:bg-gray-50"
              >
                Close
              </button>
            </div>
            {activeScoutBreakdown ? (
              <div className="space-y-2">
                {Array.from(activeScoutBreakdown.scouts.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([scout, count]) => {
                    const percent = activeScoutBreakdown.total
                      ? Math.round((count / activeScoutBreakdown.total) * 100)
                      : 0;
                    return (
                      <div key={scout} className="flex items-center justify-between border rounded-lg px-3 py-2">
                        <div>
                          <p className="font-medium">{scout}</p>
                          <p className="text-xs text-gray-500">{count} scout(s)</p>
                        </div>
                        <div className="text-sm font-semibold text-gray-700">{percent}%</div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <p className="text-sm text-gray-600">No scout data found for this team.</p>
            )}
          </div>
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
