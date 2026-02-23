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

type HelperEntry = {
  id: string;
  game?: string;
  eventKey?: string;
  createdAt?: number;
  submittedAt?: number;
  timestamp?: number;
  helperName?: string;
  assistedTeamNumber?: string;
  wasSuccessful?: boolean;
  issueSolved?: string;
  notes?: string;
  matchType?: string;
  practiceMode?: string;
  isPracticeScouting?: boolean;
};

function HelperAnalyticsContent() {
  const { userData } = useAuth();
  const canDeleteEntries = userData?.role === "coach" || Boolean(userData?.isTeamAdmin);
  const canImportCsv = canDeleteEntries;
  const canExportCsv = canDeleteEntries;
  const canCleanBlankRows = canDeleteEntries;
  const [entries, setEntries] = useState<HelperEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REBUILT");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [cleaningBlankRows, setCleaningBlankRows] = useState(false);

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
        const snap = await getDocs(collection(db, "helperReports"));
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as HelperEntry[]);
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

  async function handleDeleteEntry(entry: HelperEntry) {
    if (!canDeleteEntries) {
      alert("Only coaches or team admins can delete entries.");
      return;
    }
    const ok = window.confirm("Delete this helper report entry?");
    if (!ok) return;
    await deleteDoc(doc(db, "helperReports", entry.id));
    setEntries((prev) => prev.filter((row) => row.id !== entry.id));
  }

  function isBlankEntry(entry: HelperEntry) {
    const hasText = [entry.helperName, entry.assistedTeamNumber, entry.issueSolved, entry.notes]
      .some((value) => String(value || "").trim().length > 0);
    return !hasText && !entry.wasSuccessful;
  }

  async function handleCleanBlankEntries() {
    if (!canCleanBlankRows) {
      alert("Only coaches or team admins can clean blank rows.");
      return;
    }
    const blankRows = entries.filter((entry) => isBlankEntry(entry));
    if (blankRows.length === 0) {
      alert("No blank rows found.");
      return;
    }
    const ok = window.confirm(`Delete ${blankRows.length} blank rows?`);
    if (!ok) return;
    setCleaningBlankRows(true);
    try {
      await Promise.all(blankRows.map((entry) => deleteDoc(doc(db, "helperReports", entry.id))));
      const snap = await getDocs(collection(db, "helperReports"));
      setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as HelperEntry[]);
      alert(`Deleted ${blankRows.length} blank rows.`);
    } finally {
      setCleaningBlankRows(false);
    }
  }

  function exportToCSV() {
    if (!canExportCsv) {
      alert("Only coaches or team admins can export CSV files.");
      return;
    }
    const header = ["Helper", "Team Helped", "Successful", "Issue Solved", "Notes", "Game", "Event Key"];
    const lines = filtered.map((entry) =>
      [
        entry.helperName || "",
        entry.assistedTeamNumber || "",
        entry.wasSuccessful ? "Y" : "N",
        entry.issueSolved || "",
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
    a.download = `helper-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
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
        const get = (cells: string[], index: number) => (index >= 0 ? String(cells[index] || "").trim() : "");

        const idxHelper = idx("helper");
        const idxTeam = headers.findIndex((h) => h === "teamhelped" || h === "assistedteamnumber");
        const idxSuccessful = headers.findIndex((h) => h === "successful" || h === "wassuccessful");
        const idxIssueSolved = headers.findIndex((h) => h === "issuesolved");
        const idxNotes = headers.findIndex((h) => h === "notes" || h === "comments");
        const idxGame = idx("game");
        const idxEvent = idx("eventkey");

        let imported = 0;
        for (let i = 1; i < lines.length; i += 1) {
          const cells = parseCsvLine(lines[i]);
          const helperName = get(cells, idxHelper);
          const assistedTeamNumber = get(cells, idxTeam);
          if (!helperName && !assistedTeamNumber) continue;
          const now = Date.now();
          await addDoc(collection(db, "helperReports"), {
            helperName,
            assistedTeamNumber,
            wasSuccessful: toBoolean(get(cells, idxSuccessful)),
            issueSolved: get(cells, idxIssueSolved),
            notes: get(cells, idxNotes),
            game: get(cells, idxGame) || selectedGame,
            eventKey: get(cells, idxEvent) || selectedEvent,
            submittedAt: now,
            timestamp: now,
          });
          imported += 1;
        }
        const snap = await getDocs(collection(db, "helperReports"));
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as HelperEntry[]);
        alert(`Imported ${imported} helper rows.`);
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
      <h1 className="text-3xl font-bold mb-2 theme-text">Helper Report Analytics</h1>
      <p className="text-gray-600 mb-4">Support reports from helper form submissions.</p>
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
        <button
          className="px-3 py-1.5 text-sm rounded bg-red-600 text-white disabled:opacity-60"
          onClick={() => void handleCleanBlankEntries()}
          disabled={cleaningBlankRows || !canCleanBlankRows}
          title={canCleanBlankRows ? undefined : "Only coaches or team admins can clean blank rows."}
        >
          {cleaningBlankRows ? "Cleaning..." : "Clean Blank Rows"}
        </button>
      </div>
      {loading ? (
        <LoadingSpinner message="Loading helper report analytics..." />
      ) : (
        <div className="bg-white rounded-xl shadow h-[calc(100vh-270px)] table-scroll">
          <table>
            <thead className="sticky-header">
              <tr>
                <th className="bg-red-300 text-center" colSpan={2}>Information</th>
                <th className="bg-green-300 text-center" colSpan={2}>Outcome</th>
                <th className="bg-pink-300 text-center" colSpan={2}>General</th>
              </tr>
              <tr>
                <th className="bg-red-200 text-center" colSpan={2}>Information</th>
                <th className="bg-green-200 text-center" colSpan={2}>Outcome</th>
                <th className="bg-pink-200 text-center" colSpan={1}>Notes</th>
                <th className="bg-pink-200 text-center" colSpan={1}>Actions</th>
              </tr>
              <tr>
                <th className="text-center">Helper</th>
                <th className="text-center">Team Helped</th>
                <th className="text-center">Successful</th>
                <th className="text-center">Issue Solved</th>
                <th className="text-center">Notes</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id}>
                  <td className="font-semibold">{entry.helperName || "-"}</td>
                  <td>{entry.assistedTeamNumber || "-"}</td>
                  <td>{entry.wasSuccessful ? "Y" : "N"}</td>
                  <td>{formatAnalyticsText(entry.issueSolved)}</td>
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

export default function HelperAnalyticsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <HelperAnalyticsContent />
    </ProtectedRoute>
  );
}
