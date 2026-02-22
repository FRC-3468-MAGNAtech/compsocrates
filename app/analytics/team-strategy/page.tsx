"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { entryMatchesAnalyticsFilters, getEventOptionsForEntries, isPracticeScoutedEntry, type AnalyticsGame } from "@/app/utils/analyticsEvents";
import { useAuth } from "@/app/AuthContext";

type TeamStrategyEntry = {
  id: string;
  game?: string;
  eventKey?: string;
  createdAt?: number;
  submittedAt?: number;
  timestamp?: number;
  teamNumber?: string;
  scoutName?: string;
  preferredStartingPosition?: string;
  bestAt?: string;
  clearsBump?: boolean;
  clearsTrench?: boolean;
  canShootWhileIntaking?: boolean;
  canMoveAndShootSimultaneously?: boolean;
  notes?: string;
  matchType?: string;
  practiceMode?: string;
  isPracticeScouting?: boolean;
};

function TeamStrategyAnalyticsContent() {
  const { userData } = useAuth();
  const canDeleteEntries = userData?.role === "coach" || Boolean(userData?.isTeamAdmin);
  const [entries, setEntries] = useState<TeamStrategyEntry[]>([]);
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
    async function load() {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "strategyScouting"));
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as TeamStrategyEntry[]);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const normalized = useMemo(
    () =>
      entries.map((entry) => ({
        ...entry,
        game: entry.game || "REBUILT",
        timestamp: entry.createdAt || entry.timestamp || entry.submittedAt || 0,
      })),
    [entries]
  );

  const filtered = useMemo(() => {
    const gameFiltered = normalized.filter((entry) => entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent));
    return gameFiltered.filter((entry) => (practiceMatchesOnly ? isPracticeScoutedEntry(entry) : !isPracticeScoutedEntry(entry)));
  }, [normalized, selectedEvent, selectedGame, practiceMatchesOnly]);

  async function handleDeleteEntry(entry: TeamStrategyEntry) {
    if (!canDeleteEntries) {
      alert("Only coaches or team admins can delete entries.");
      return;
    }
    const ok = window.confirm("Delete this team strategy entry?");
    if (!ok) return;
    await deleteDoc(doc(db, "strategyScouting", entry.id));
    setEntries((prev) => prev.filter((row) => row.id !== entry.id));
  }

  return (
    <AnalyticsShell
      entriesCount={filtered.length}
      selectedGame={selectedGame}
      onSelectedGameChange={(game) => setSelectedGame(game as AnalyticsGame)}
      practiceMatchesOnly={practiceMatchesOnly}
      onPracticeMatchesOnlyChange={setPracticeMatchesOnly}
      selectedEvent={selectedEvent}
      eventOptions={[{ id: "all", name: "All Events" }, ...getEventOptionsForEntries(normalized, selectedGame)]}
      onSelectedEventChange={setSelectedEvent}
    >
      <h1 className="text-3xl font-bold mb-2 theme-text">Team Strategy Analytics</h1>
      <p className="text-gray-600 mb-4">Team strategy scouting responses.</p>
      {loading ? (
        <LoadingSpinner message="Loading team strategy analytics..." />
      ) : (
        <div className="bg-white rounded-xl shadow h-[calc(100vh-270px)] table-scroll">
          <table>
            <thead className="sticky-header">
              <tr>
                <th className="bg-red-300 text-center" colSpan={2}>Information</th>
                <th className="bg-yellow-300 text-center" colSpan={2}>Approach</th>
                <th className="bg-blue-300 text-center" colSpan={4}>Capabilities</th>
                <th className="bg-pink-300 text-center" colSpan={2}>General</th>
              </tr>
              <tr>
                <th className="bg-red-200 text-center" colSpan={2}>Information</th>
                <th className="bg-yellow-200 text-center" colSpan={2}>Approach</th>
                <th className="bg-blue-200 text-center" colSpan={4}>Capabilities</th>
                <th className="bg-pink-200 text-center" colSpan={1}>Notes</th>
                <th className="bg-pink-200 text-center" colSpan={1}>Actions</th>
              </tr>
              <tr>
                <th className="text-center">Team</th>
                <th className="text-center">Scout</th>
                <th className="text-center">Start</th>
                <th className="text-center">Best At</th>
                <th className="text-center">Clears Bump</th>
                <th className="text-center">Clears Trench</th>
                <th className="text-center">Shoot+Intake</th>
                <th className="text-center">Move+Shoot</th>
                <th className="text-center">Notes</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id}>
                  <td className="font-semibold">{entry.teamNumber || "-"}</td>
                  <td>{entry.scoutName || "-"}</td>
                  <td>{entry.preferredStartingPosition || "-"}</td>
                  <td>{entry.bestAt || "-"}</td>
                  <td>{entry.clearsBump ? "Y" : "N"}</td>
                  <td>{entry.clearsTrench ? "Y" : "N"}</td>
                  <td>{entry.canShootWhileIntaking ? "Y" : "N"}</td>
                  <td>{entry.canMoveAndShootSimultaneously ? "Y" : "N"}</td>
                  <td>{entry.notes || "-"}</td>
                  <td className="text-center">
                    <button
                      type="button"
                      onClick={() => void handleDeleteEntry(entry)}
                      className="px-3 py-1 rounded text-white text-sm disabled:opacity-60"
                      style={{ backgroundColor: "#dc2626" }}
                      disabled={!canDeleteEntries}
                      title={canDeleteEntries ? undefined : "Only coaches or team admins can delete entries."}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AnalyticsShell>
  );
}

export default function TeamStrategyAnalyticsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <TeamStrategyAnalyticsContent />
    </ProtectedRoute>
  );
}
