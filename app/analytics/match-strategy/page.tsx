"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import ExpandableNotesCell from "@/app/components/ExpandableNotesCell";
import { entryMatchesAnalyticsFilters, getEventOptionsForEntries, isPracticeScoutedEntry, type AnalyticsGame } from "@/app/utils/analyticsEvents";
import { formatAnalyticsText } from "@/app/utils/displayFormat";
import { useAuth } from "@/app/AuthContext";
import { csvEscape, normalizeHeader, parseCsvLine, splitCsvRecords, toBoolean } from "@/app/utils/csvHelpers";
import { compareMatchLabels, compareSortValues, sortLabel, type SortDir } from "@/app/utils/sortHelpers";

type MatchStrategyEntry = {
  id: string;
  game?: string;
  eventKey?: string;
  createdAt?: number;
  submittedAt?: number;
  timestamp?: number;
  matchLabel?: string;
  scoutName?: string;
  robots?: Array<{ teamNumber?: string; startingPosition?: string; role?: string; autoClimb?: boolean; endgameClimb?: string }>;
  notes?: string;
  matchType?: string;
  practiceMode?: string;
  isPracticeScouting?: boolean;
};

function MatchStrategyAnalyticsContent() {
  const { userData } = useAuth();
  const canDeleteEntries = userData?.role === "coach" || Boolean(userData?.isTeamAdmin);
  const canImportCsv = canDeleteEntries;
  const canExportCsv = canDeleteEntries;
  const csvDisabledReason = "Temporarily disabled due to bugs.";
  const [entries, setEntries] = useState<MatchStrategyEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REBUILT");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [sortKey, setSortKey] = useState<
    | "matchLabel"
    | "scoutName"
    | "r1Team"
    | "r1Starting"
    | "r1Role"
    | "r1Auto"
    | "r1End"
    | "r2Team"
    | "r2Starting"
    | "r2Role"
    | "r2Auto"
    | "r2End"
    | "r3Team"
    | "r3Starting"
    | "r3Role"
    | "r3Auto"
    | "r3End"
    | "notes"
    | "id"
  >("matchLabel");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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
        const snap = await getDocs(collection(db, "matchStrategyPlans"));
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as MatchStrategyEntry[]);
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

  const sorted = useMemo(() => {
    const getValue = (entry: MatchStrategyEntry) => {
      const r1 = entry.robots?.[0];
      const r2 = entry.robots?.[1];
      const r3 = entry.robots?.[2];
      switch (sortKey) {
        case "matchLabel":
          return entry.matchLabel || "";
        case "scoutName":
          return entry.scoutName || "";
        case "r1Team":
          return r1?.teamNumber || "";
        case "r1Starting":
          return r1?.startingPosition || "";
        case "r1Role":
          return r1?.role || "";
        case "r1Auto":
          return r1?.autoClimb ? 1 : 0;
        case "r1End":
          return r1?.endgameClimb || "";
        case "r2Team":
          return r2?.teamNumber || "";
        case "r2Starting":
          return r2?.startingPosition || "";
        case "r2Role":
          return r2?.role || "";
        case "r2Auto":
          return r2?.autoClimb ? 1 : 0;
        case "r2End":
          return r2?.endgameClimb || "";
        case "r3Team":
          return r3?.teamNumber || "";
        case "r3Starting":
          return r3?.startingPosition || "";
        case "r3Role":
          return r3?.role || "";
        case "r3Auto":
          return r3?.autoClimb ? 1 : 0;
        case "r3End":
          return r3?.endgameClimb || "";
        case "notes":
          return entry.notes || "";
        case "id":
        default:
          return entry.id;
      }
    };

    return [...filtered].sort((a, b) => {
      if (sortKey === "matchLabel") {
        return compareMatchLabels(a.matchLabel || "", b.matchLabel || "", sortDir);
      }
      return compareSortValues(getValue(a), getValue(b), sortDir);
    });
  }, [filtered, sortDir, sortKey]);

  function handleSort(key: typeof sortKey) {
    setSortDir((prev) => (key === sortKey ? (prev === "asc" ? "desc" : "asc") : "asc"));
    setSortKey(key);
  }

  async function handleDeleteEntry(entry: MatchStrategyEntry) {
    if (!canDeleteEntries) {
      alert("Only coaches or team admins can delete entries.");
      return;
    }
    const ok = window.confirm("Delete this match strategy entry?");
    if (!ok) return;
    await deleteDoc(doc(db, "matchStrategyPlans", entry.id));
    setEntries((prev) => prev.filter((row) => row.id !== entry.id));
  }

  function exportToCSV() {
    if (!canExportCsv) {
      alert("Only coaches or team admins can export CSV files.");
      return;
    }
    const header = [
      "Match",
      "Scout",
      "R1 Team",
      "R1 Starting Position",
      "R1 Role",
      "R1 Auto Climb",
      "R1 Endgame Climb",
      "R2 Team",
      "R2 Starting Position",
      "R2 Role",
      "R2 Auto Climb",
      "R2 Endgame Climb",
      "R3 Team",
      "R3 Starting Position",
      "R3 Role",
      "R3 Auto Climb",
      "R3 Endgame Climb",
      "Notes",
      "Game",
      "Event Key",
    ];
    const lines = filtered.map((entry) => {
      const r1 = entry.robots?.[0];
      const r2 = entry.robots?.[1];
      const r3 = entry.robots?.[2];
      return [
        entry.matchLabel || "",
        entry.scoutName || "",
        r1?.teamNumber || "",
        r1?.startingPosition || "",
        r1?.role || "",
        r1?.autoClimb ? "Y" : "N",
        r1?.endgameClimb || "",
        r2?.teamNumber || "",
        r2?.startingPosition || "",
        r2?.role || "",
        r2?.autoClimb ? "Y" : "N",
        r2?.endgameClimb || "",
        r3?.teamNumber || "",
        r3?.startingPosition || "",
        r3?.role || "",
        r3?.autoClimb ? "Y" : "N",
        r3?.endgameClimb || "",
        entry.notes || "",
        entry.game || selectedGame,
        entry.eventKey || selectedEvent,
      ].map(csvEscape).join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `match-strategy-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
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

        const idxMatch = idx("match");
        const idxScout = idx("scout");
        const idxR1Team = idx("r1team");
        const idxR1Starting = idx("r1startingposition");
        const idxR1Role = idx("r1role");
        const idxR1Auto = idx("r1autoclimb");
        const idxR1End = idx("r1endgameclimb");
        const idxR2Team = idx("r2team");
        const idxR2Starting = idx("r2startingposition");
        const idxR2Role = idx("r2role");
        const idxR2Auto = idx("r2autoclimb");
        const idxR2End = idx("r2endgameclimb");
        const idxR3Team = idx("r3team");
        const idxR3Starting = idx("r3startingposition");
        const idxR3Role = idx("r3role");
        const idxR3Auto = idx("r3autoclimb");
        const idxR3End = idx("r3endgameclimb");
        const idxNotes = idx("notes");
        const idxGame = idx("game");
        const idxEvent = idx("eventkey");

        let imported = 0;
        for (let i = 1; i < lines.length; i += 1) {
          const cells = parseCsvLine(lines[i]);
          const matchLabel = get(cells, idxMatch);
          const scoutName = get(cells, idxScout);
          if (!matchLabel && !scoutName) continue;
          const now = Date.now();
          await addDoc(collection(db, "matchStrategyPlans"), {
            matchLabel,
            scoutName,
            robots: [
              {
                teamNumber: get(cells, idxR1Team),
                startingPosition: get(cells, idxR1Starting),
                role: get(cells, idxR1Role),
                autoClimb: toBoolean(get(cells, idxR1Auto)),
                endgameClimb: get(cells, idxR1End),
              },
              {
                teamNumber: get(cells, idxR2Team),
                startingPosition: get(cells, idxR2Starting),
                role: get(cells, idxR2Role),
                autoClimb: toBoolean(get(cells, idxR2Auto)),
                endgameClimb: get(cells, idxR2End),
              },
              {
                teamNumber: get(cells, idxR3Team),
                startingPosition: get(cells, idxR3Starting),
                role: get(cells, idxR3Role),
                autoClimb: toBoolean(get(cells, idxR3Auto)),
                endgameClimb: get(cells, idxR3End),
              },
            ],
            notes: get(cells, idxNotes),
            game: get(cells, idxGame) || selectedGame,
            eventKey: get(cells, idxEvent) || selectedEvent,
            submittedAt: now,
            timestamp: now,
          });
          imported += 1;
        }
        const snap = await getDocs(collection(db, "matchStrategyPlans"));
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as MatchStrategyEntry[]);
        alert(`Imported ${imported} match strategy rows.`);
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
      <h1 className="text-3xl font-bold mb-2 theme-text">Match Strategy Analytics</h1>
      <p className="text-gray-600 mb-4">Per-match strategic plans.</p>
      <div className="bg-white rounded-xl shadow p-4 mb-4 flex flex-wrap items-center gap-4">
        <button
          className="px-3 py-1.5 text-sm rounded bg-gray-400 text-white cursor-not-allowed disabled:opacity-100"
          onClick={exportToCSV}
          disabled
          title={csvDisabledReason}
        >
          Export CSV
        </button>
        <label
          className="px-3 py-1.5 text-sm rounded text-white bg-gray-400 cursor-not-allowed"
          title={csvDisabledReason}
        >
          {importing ? "Importing..." : "Import CSV"}
          <input type="file" accept=".csv" onChange={handleImportFilePick} className="hidden" disabled />
        </label>
      </div>
      {loading ? (
        <LoadingSpinner message="Loading match strategy analytics..." />
      ) : (
        <div className="bg-white rounded-xl shadow h-[calc(100vh-270px)] table-scroll">
          <table>
            <thead className="sticky-header">
              <tr>
                <th className="bg-red-300 text-center" colSpan={2}>Information</th>
                <th className="bg-blue-300 text-center" colSpan={15}>Robots</th>
                <th className="bg-pink-300 text-center" colSpan={2}>General</th>
              </tr>
              <tr>
                <th className="bg-red-200 text-center" colSpan={2}>Information</th>
                <th className="bg-blue-200 text-center" colSpan={5}>Robot 1</th>
                <th className="bg-blue-200 text-center" colSpan={5}>Robot 2</th>
                <th className="bg-blue-200 text-center" colSpan={5}>Robot 3</th>
                <th className="bg-pink-200 text-center" colSpan={1}>Notes</th>
                <th className="bg-pink-200 text-center" colSpan={1}>Actions</th>
              </tr>
              <tr>
                <th className="cursor-pointer text-center" onClick={() => handleSort("matchLabel")}>
                  {sortLabel(sortKey, sortDir, "matchLabel", "Match")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("scoutName")}>
                  {sortLabel(sortKey, sortDir, "scoutName", "Scout")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r1Team")}>
                  {sortLabel(sortKey, sortDir, "r1Team", "Team Number")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r1Starting")}>
                  {sortLabel(sortKey, sortDir, "r1Starting", "Starting Position")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r1Role")}>
                  {sortLabel(sortKey, sortDir, "r1Role", "Role")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r1Auto")}>
                  {sortLabel(sortKey, sortDir, "r1Auto", "Auto Climb")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r1End")}>
                  {sortLabel(sortKey, sortDir, "r1End", "Endgame Climb")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r2Team")}>
                  {sortLabel(sortKey, sortDir, "r2Team", "Team Number")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r2Starting")}>
                  {sortLabel(sortKey, sortDir, "r2Starting", "Starting Position")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r2Role")}>
                  {sortLabel(sortKey, sortDir, "r2Role", "Role")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r2Auto")}>
                  {sortLabel(sortKey, sortDir, "r2Auto", "Auto Climb")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r2End")}>
                  {sortLabel(sortKey, sortDir, "r2End", "Endgame Climb")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r3Team")}>
                  {sortLabel(sortKey, sortDir, "r3Team", "Team Number")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r3Starting")}>
                  {sortLabel(sortKey, sortDir, "r3Starting", "Starting Position")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r3Role")}>
                  {sortLabel(sortKey, sortDir, "r3Role", "Role")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r3Auto")}>
                  {sortLabel(sortKey, sortDir, "r3Auto", "Auto Climb")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r3End")}>
                  {sortLabel(sortKey, sortDir, "r3End", "Endgame Climb")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("notes")}>
                  {sortLabel(sortKey, sortDir, "notes", "Notes")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("id")}>
                  {sortLabel(sortKey, sortDir, "id", "Actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => {
                const r1 = entry.robots?.[0];
                const r2 = entry.robots?.[1];
                const r3 = entry.robots?.[2];
                return (
                  <tr key={entry.id}>
                    <td className="font-semibold">{entry.matchLabel || "-"}</td>
                    <td>{entry.scoutName || "-"}</td>
                    <td>{r1?.teamNumber || "-"}</td>
                    <td>{formatAnalyticsText(r1?.startingPosition)}</td>
                    <td>{formatAnalyticsText(r1?.role)}</td>
                    <td>{r1?.autoClimb ? "Y" : "N"}</td>
                    <td>{formatAnalyticsText(r1?.endgameClimb)}</td>
                    <td>{r2?.teamNumber || "-"}</td>
                    <td>{formatAnalyticsText(r2?.startingPosition)}</td>
                    <td>{formatAnalyticsText(r2?.role)}</td>
                    <td>{r2?.autoClimb ? "Y" : "N"}</td>
                    <td>{formatAnalyticsText(r2?.endgameClimb)}</td>
                    <td>{r3?.teamNumber || "-"}</td>
                    <td>{formatAnalyticsText(r3?.startingPosition)}</td>
                    <td>{formatAnalyticsText(r3?.role)}</td>
                    <td>{r3?.autoClimb ? "Y" : "N"}</td>
                    <td>{formatAnalyticsText(r3?.endgameClimb)}</td>
                    <td className="align-top" style={{ minWidth: "220px", maxWidth: "360px" }}>
                      <ExpandableNotesCell text={entry.notes} />
                    </td>
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AnalyticsShell>
  );
}

export default function MatchStrategyAnalyticsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <MatchStrategyAnalyticsContent />
    </ProtectedRoute>
  );
}
