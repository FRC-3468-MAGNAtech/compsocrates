"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { entryMatchesAnalyticsFilters, getEventOptionsForEntries, isPracticeScoutedEntry, type AnalyticsGame } from "@/app/utils/analyticsEvents";
import { useAuth } from "@/app/AuthContext";

type PitEntry = {
  id: string;
  game?: string;
  eventKey?: string;
  createdAt?: number;
  submittedAt?: number;
  timestamp?: number;
  teamNumber?: string;
  scoutName?: string;
  robotPictureUrl?: string;
  pitDisposition?: boolean;
  driveDisposition?: boolean;
  driveBaseType?: string;
  centerOfGravity?: string;
  collectCoralStation?: boolean;
  collectCoralGround?: boolean;
  coralL4?: boolean;
  coralL3?: boolean;
  coralL2?: boolean;
  coralL1?: boolean;
  collectAlgaeReef?: boolean;
  collectAlgaeGround?: boolean;
  scoreProcessor?: boolean;
  scoreNetRobot?: boolean;
  bargeCapability?: string;
  autoCapabilities?: string;
  fuelPreloadCapacity?: number;
  fuelBallsPerSecond?: number;
  fuelCarryingCapacity?: number;
  climbLevel1?: boolean;
  climbLevel2?: boolean;
  climbLevel3?: boolean;
  typicalFuelCycleTime?: string;
  typicalClimbTime?: string;
  autoCycleDescription?: string;
  startingOpposite?: boolean;
  startingMiddle?: boolean;
  startingProcessor?: boolean;
  betterAt?: string;
  rating?: number;
  notes?: string;
  matchType?: string;
  practiceMode?: string;
  isPracticeScouting?: boolean;
};

function isPracticeEntry(entry: PitEntry) {
  return isPracticeScoutedEntry(entry);
}

function PitAnalyticsContent() {
  const { userData } = useAuth();
  const canDeleteEntries = userData?.role === "coach" || Boolean(userData?.isTeamAdmin);
  const [entries, setEntries] = useState<PitEntry[]>([]);
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
    async function loadPitEntries() {
      setLoading(true);
      try {
        const snapshot = await getDocs(collection(db, "pitScouting"));
        const rows = snapshot.docs.map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() })) as PitEntry[];
        setEntries(rows);
      } finally {
        setLoading(false);
      }
    }
    loadPitEntries();
  }, []);

  const normalized = useMemo(
    () =>
      entries.map((entry) => ({
        ...entry,
        game: entry.game || "REEFSCAPE",
        timestamp: entry.createdAt || entry.timestamp || entry.submittedAt || 0,
      })),
    [entries]
  );

  const filtered = useMemo(() => {
    const gameFiltered = normalized.filter((entry) => entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent));
    return gameFiltered.filter((entry) => (practiceMatchesOnly ? isPracticeEntry(entry) : !isPracticeEntry(entry)));
  }, [normalized, selectedEvent, selectedGame, practiceMatchesOnly]);

  async function handleDeleteEntry(entry: PitEntry) {
    if (!canDeleteEntries) {
      alert("Only coaches or team admins can delete entries.");
      return;
    }
    const ok = window.confirm("Delete this pit scouting entry?");
    if (!ok) return;
    await deleteDoc(doc(db, "pitScouting", entry.id));
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
      <h1 className="text-3xl font-bold mb-2 theme-text">Pit Analytics</h1>
      <p className="text-gray-600 mb-4">Pit scouting breakdown with sticky team/scout columns.</p>

      {loading ? (
        <LoadingSpinner message="Loading pit analytics..." />
      ) : (
        <div className="bg-white rounded-xl shadow h-[calc(100vh-270px)] table-scroll">
          {selectedGame === "REBUILT" ? (
            <table>
              <thead className="sticky-header">
                <tr>
                  <th className="sticky-left-0 text-center">Team</th>
                  <th className="sticky-left-1 text-center">Scout</th>
                  <th>Robot Picture</th>
                  <th>Pit Disposition</th>
                  <th>Drive Disposition</th>
                  <th>Preload</th>
                  <th>Balls/Sec</th>
                  <th>Carrying</th>
                  <th>Climb L1</th>
                  <th>Climb L2</th>
                  <th>Climb L3</th>
                  <th>Fuel Cycle Time</th>
                  <th>Climb Time</th>
                  <th>Auto Cycle</th>
                  <th>Comments</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.id}>
                    <td className="sticky-left-0 bg-white font-semibold">{entry.teamNumber || "-"}</td>
                    <td className="sticky-left-1 bg-white">{entry.scoutName || "-"}</td>
                    <td>{entry.robotPictureUrl ? "Yes" : "No"}</td>
                    <td>{entry.pitDisposition ? "Yes" : "No"}</td>
                    <td>{entry.driveDisposition ? "Yes" : "No"}</td>
                    <td>{Number(entry.fuelPreloadCapacity || 0) || "-"}</td>
                    <td>{Number(entry.fuelBallsPerSecond || 0) || "-"}</td>
                    <td>{Number(entry.fuelCarryingCapacity || 0) || "-"}</td>
                    <td>{entry.climbLevel1 ? "Y" : "N"}</td>
                    <td>{entry.climbLevel2 ? "Y" : "N"}</td>
                    <td>{entry.climbLevel3 ? "Y" : "N"}</td>
                    <td>{entry.typicalFuelCycleTime || "-"}</td>
                    <td>{entry.typicalClimbTime || "-"}</td>
                    <td>{entry.autoCycleDescription || "-"}</td>
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
          ) : (
            <table>
              <thead className="sticky-header">
                <tr>
                  <th className="sticky-left-0 text-center">Team</th>
                  <th className="sticky-left-1 text-center">Scout</th>
                  <th>Robot Picture</th>
                  <th>Pit Disposition</th>
                  <th>Drive Disposition</th>
                  <th>Drive Base</th>
                  <th>Center of Gravity</th>
                  <th>Coral Collecting</th>
                  <th>Coral Scoring</th>
                  <th>Algae Collecting</th>
                  <th>Algae Scoring</th>
                  <th>Barge</th>
                  <th>Auto</th>
                  <th>Starting Positions</th>
                  <th>Better At</th>
                  <th>Rating</th>
                  <th>Comments</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.id}>
                    <td className="sticky-left-0 bg-white font-semibold">{entry.teamNumber || "-"}</td>
                    <td className="sticky-left-1 bg-white">{entry.scoutName || "-"}</td>
                    <td>{entry.robotPictureUrl ? "Yes" : "No"}</td>
                    <td>{entry.pitDisposition ? "Yes" : "No"}</td>
                    <td>{entry.driveDisposition ? "Yes" : "No"}</td>
                    <td>{entry.driveBaseType || "-"}</td>
                    <td>{entry.centerOfGravity || "-"}</td>
                    <td>{[entry.collectCoralStation && "Station", entry.collectCoralGround && "Ground"].filter(Boolean).join(", ") || "-"}</td>
                    <td>{[entry.coralL4 && "L4", entry.coralL3 && "L3", entry.coralL2 && "L2", entry.coralL1 && "L1"].filter(Boolean).join(", ") || "-"}</td>
                    <td>{[entry.collectAlgaeReef && "Reef", entry.collectAlgaeGround && "Ground"].filter(Boolean).join(", ") || "-"}</td>
                    <td>{[entry.scoreProcessor && "Processor", entry.scoreNetRobot && "Net"].filter(Boolean).join(", ") || "-"}</td>
                    <td>{entry.bargeCapability || "-"}</td>
                    <td>{entry.autoCapabilities || "-"}</td>
                    <td>{[entry.startingOpposite && "Opposite", entry.startingMiddle && "Middle", entry.startingProcessor && "Processor"].filter(Boolean).join(", ") || "-"}</td>
                    <td>{entry.betterAt || "-"}</td>
                    <td>{entry.rating || "-"}</td>
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
          )}
        </div>
      )}
    </AnalyticsShell>
  );
}

export default function PitAnalyticsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <PitAnalyticsContent />
    </ProtectedRoute>
  );
}
