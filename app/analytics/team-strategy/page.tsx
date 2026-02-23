"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { entryMatchesAnalyticsFilters, getEventOptionsForEntries, isPracticeScoutedEntry, type AnalyticsGame } from "@/app/utils/analyticsEvents";
import { formatAnalyticsText } from "@/app/utils/displayFormat";
import { useAuth } from "@/app/AuthContext";
import { csvEscape, normalizeHeader, parseCsvLine, splitCsvRecords, toBoolean } from "@/app/utils/csvHelpers";

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
  const canImportCsv = canDeleteEntries;
  const canExportCsv = canDeleteEntries;
  const [entries, setEntries] = useState<TeamStrategyEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REBUILT");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const savedGame = localStorage.getItem("analytics-selected-game");
    const savedEvent = localStorage.getItem("analytics-selected-event");
    const savedPractice = localStorage.getItem("analytics-practice-matches-only");
    if (savedGame === "REBUILT") setSelectedGame("REBUILT");
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

  function exportToCSV() {
    if (!canExportCsv) {
      alert("Only coaches or team admins can export CSV files.");
      return;
    }
    const header = ["Team", "Scout", "Start", "Best At", "Clears Bump", "Clears Trench", "Shoot+Intake", "Move+Shoot", "Notes", "Game", "Event Key"];
    const lines = filtered.map((entry) =>
      [
        entry.teamNumber || "",
        entry.scoutName || "",
        entry.preferredStartingPosition || "",
        entry.bestAt || "",
        entry.clearsBump ? "Y" : "N",
        entry.clearsTrench ? "Y" : "N",
        entry.canShootWhileIntaking ? "Y" : "N",
        entry.canMoveAndShootSimultaneously ? "Y" : "N",
        entry.notes || "",
        entry.game || selectedGame,
        entry.eventKey || selectedEvent,
      ].map(csvEscape).join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `team-strategy-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFilePick(event: React.ChangeEvent<HTMLInputElement>) {
    if (!canImportCsv) {
      alert("Only coaches or team admins can import CSV files.");
      event.target.value = "";
      return;
    }
    const file = event.target.files?.[0];
    if (!file || importing) return;
    setImporting(true);
    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      try {
        const text = String(loadEvent.target?.result || "");
        const lines = splitCsvRecords(text);
        if (lines.length < 2) throw new Error("CSV has no data rows.");

        const headers = parseCsvLine(lines[0]).map(normalizeHeader);
        const idx = (name: string) => headers.findIndex((header) => header === name);
        const idxTeam = idx("team");
        const idxScout = idx("scout");
        const idxStart = headers.findIndex((h) => h === "start" || h === "preferredstartingposition");
        const idxBestAt = headers.findIndex((h) => h === "bestat");
        const idxClearsBump = headers.findIndex((h) => h === "clearsbump");
        const idxClearsTrench = headers.findIndex((h) => h === "clearstrench");
        const idxShootIntake = headers.findIndex((h) => h === "shootintake" || h === "canshootwhileintaking");
        const idxMoveShoot = headers.findIndex((h) => h === "moveshoot");
        const idxNotes = headers.findIndex((h) => h === "notes" || h === "comments");
        const idxGame = headers.findIndex((h) => h === "game");
        const idxEvent = headers.findIndex((h) => h === "eventkey");
        const get = (cells: string[], index: number) => (index >= 0 ? String(cells[index] || "").trim() : "");

        let imported = 0;
        for (let i = 1; i < lines.length; i += 1) {
          const cells = parseCsvLine(lines[i]);
          const teamNumber = get(cells, idxTeam);
          const scoutName = get(cells, idxScout);
          if (!teamNumber && !scoutName) continue;
          const now = Date.now();
          await addDoc(collection(db, "strategyScouting"), {
            teamNumber,
            scoutName,
            preferredStartingPosition: get(cells, idxStart),
            bestAt: get(cells, idxBestAt),
            clearsBump: toBoolean(get(cells, idxClearsBump)),
            clearsTrench: toBoolean(get(cells, idxClearsTrench)),
            canShootWhileIntaking: toBoolean(get(cells, idxShootIntake)),
            canMoveAndShootSimultaneously: toBoolean(get(cells, idxMoveShoot)),
            notes: get(cells, idxNotes),
            game: get(cells, idxGame) || selectedGame,
            eventKey: get(cells, idxEvent) || selectedEvent,
            submittedAt: now,
            timestamp: now,
          });
          imported += 1;
        }

        const snap = await getDocs(collection(db, "strategyScouting"));
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as TeamStrategyEntry[]);
        alert(`Imported ${imported} team strategy rows.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        alert(`Error importing CSV: ${message}`);
      } finally {
        setImporting(false);
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  return (
    <AnalyticsShell
      entriesCount={filtered.length}
      selectedGame={selectedGame}
      onSelectedGameChange={(game) => setSelectedGame(game as AnalyticsGame)}
      allowedGames={["REBUILT"]}
      practiceMatchesOnly={practiceMatchesOnly}
      onPracticeMatchesOnlyChange={setPracticeMatchesOnly}
      selectedEvent={selectedEvent}
      eventOptions={[{ id: "all", name: "All Events" }, ...getEventOptionsForEntries(normalized, selectedGame)]}
      onSelectedEventChange={setSelectedEvent}
    >
      <h1 className="text-3xl font-bold mb-2 theme-text">Team Strategy Analytics</h1>
      <p className="text-gray-600 mb-4">Team strategy scouting responses.</p>
      <div className="bg-white rounded-xl shadow p-4 mb-4 flex flex-wrap items-center gap-4">
        <button
          className="px-3 py-1.5 text-sm rounded bg-green-600 text-white disabled:opacity-60"
          onClick={exportToCSV}
          disabled={!canExportCsv}
          title={canExportCsv ? undefined : "Only coaches or team admins can export CSV files."}
        >
          Export CSV
        </button>
        <label
          className={`px-3 py-1.5 text-sm rounded text-white ${canImportCsv ? "bg-blue-600 cursor-pointer" : "bg-gray-400 cursor-not-allowed"}`}
          title={canImportCsv ? undefined : "Only coaches or team admins can import CSV files."}
        >
          {importing ? "Importing..." : "Import CSV"}
          <input type="file" accept=".csv" onChange={handleImportFilePick} className="hidden" disabled={!canImportCsv || importing} />
        </label>
      </div>
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
                  <td>{formatAnalyticsText(entry.preferredStartingPosition)}</td>
                  <td>{formatAnalyticsText(entry.bestAt)}</td>
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
