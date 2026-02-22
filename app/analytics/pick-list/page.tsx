"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { useAuth } from "@/app/AuthContext";
import { entryMatchesAnalyticsFilters, getEventOptionsForEntries, isPracticeScoutedEntry, type AnalyticsGame } from "@/app/utils/analyticsEvents";

type TeamPick = {
  teamNumber: string;
  avgScore: number;
  highScore: number;
  picked: boolean;
  pickOrder?: number;
};

type ScoutingEntry = {
  eventKey?: string;
  submittedAt?: number;
  timestamp?: number;
  game?: string;
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
    const end = String(entry.endgame?.status || "").toLowerCase();
    const endgameClimb = end === "level-1" ? 10 : end === "level-2" ? 20 : end === "level-3" ? 30 : 0;
    return autoFuel + teleFuel + autoClimb + endgameClimb;
  }
  return (
    (entry.leftStartingZone ? 3 : 0) +
    (entry.autoCoralL1 || 0) * 3 +
    (entry.autoCoralL2 || 0) * 4 +
    (entry.autoCoralL3 || 0) * 6 +
    (entry.autoCoralL4 || 0) * 7 +
    (entry.teleopCoralL1 || 0) * 2 +
    (entry.teleopCoralL2 || 0) * 3 +
    (entry.teleopCoralL3 || 0) * 4 +
    (entry.teleopCoralL4 || 0) * 5 +
    Number(entry.penaltyPoints || 0)
  );
}

function PickListContent() {
  const { userData } = useAuth();
  const isCoach = userData?.role === "coach";
  const [entries, setEntries] = useState<ScoutingEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REEFSCAPE");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [pickedTeams, setPickedTeams] = useState<TeamPick[]>([]);
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

  useEffect(() => {
    if (!userData?.uid) return;
    const saved = localStorage.getItem(`pick-list-${userData.uid}`);
    if (!saved) return;
    try {
      setPickedTeams(JSON.parse(saved));
    } catch {
      setPickedTeams([]);
    }
  }, [userData?.uid]);

  useEffect(() => {
    if (!userData?.uid) return;
    localStorage.setItem(`pick-list-${userData.uid}`, JSON.stringify(pickedTeams));
  }, [pickedTeams, userData?.uid]);

  const filteredEntries = useMemo(() => {
    const gameFiltered = entries.filter((entry) => entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent));
    return gameFiltered.filter((entry) => (practiceMatchesOnly ? isPracticeEntry(entry) : !isPracticeEntry(entry)));
  }, [entries, selectedEvent, selectedGame, practiceMatchesOnly]);

  const teams = useMemo(() => {
    const grouped: Record<string, number[]> = {};
    filteredEntries.forEach((e) => {
      if (!e.teamNumber) return;
      const score = scoreEntry(e, selectedGame);
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
  }, [filteredEntries, pickedTeams, selectedGame]);

  function pickTeam(team: TeamPick) {
    if (!isCoach) return;
    if (pickedTeams.some((p) => p.teamNumber === team.teamNumber)) return;
    setPickedTeams((prev) => [...prev, { ...team, picked: true, pickOrder: prev.length + 1 }]);
  }

  function removeTeam(teamNumber: string) {
    if (!isCoach) return;
    const next = pickedTeams.filter((p) => p.teamNumber !== teamNumber).map((p, i) => ({ ...p, pickOrder: i + 1 }));
    setPickedTeams(next);
  }

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
      <h1 className="text-3xl font-bold mb-2 theme-text">Pick List</h1>
      <p className="text-gray-600 mb-6">Build and reorder your preferred alliance picks.</p>
      {!isCoach && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-6">
          View only: only coaches can add or remove teams from the pick list.
        </p>
      )}

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
                  {isCoach ? (
                    <button onClick={() => pickTeam(team)} className="px-3 py-1.5 rounded theme-primary text-sm">
                      Pick
                    </button>
                  ) : (
                    <span className="text-xs text-gray-500">Coach only</span>
                  )}
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
                  {isCoach ? (
                    <button
                      onClick={() => removeTeam(team.teamNumber)}
                      className="px-3 py-1.5 rounded bg-red-100 text-red-700 text-sm"
                    >
                      Remove
                    </button>
                  ) : (
                    <span className="text-xs text-gray-500">Coach only</span>
                  )}
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
