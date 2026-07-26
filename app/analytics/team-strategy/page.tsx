"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import ExpandableNotesCell from "@/app/components/ExpandableNotesCell";
import AnalyticsConfigModal from "@/app/components/AnalyticsConfigModal";
import { entryMatchesAnalyticsFilters, getEventOptionsForEntries, isPracticeScoutedEntry, getStoredAnalyticsGame, type AnalyticsGame } from "@/app/utils/analyticsEvents";
import { formatAnalyticsText } from "@/app/utils/displayFormat";
import { useAuth } from "@/app/AuthContext";
import { csvEscape, normalizeHeader, parseCsvLine, splitCsvRecords, toBoolean } from "@/app/utils/csvHelpers";
import { compareSortValues, sortLabel, type SortDir } from "@/app/utils/sortHelpers";
import { getUserRoles } from "@/app/utils/roles";

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
  excludeFromStats?: boolean;
};

function TeamStrategyAnalyticsContent() {
  const { userData } = useAuth();
  const userRoles = getUserRoles(userData);
  const isCoach = userData?.role === "coach";
  const isTeamCoach = String(userData?.role || "").toLowerCase() === "team-coach" || (userData?.roles || []).includes("team-coach");
  const isTeamAdmin = Boolean(userData?.isTeamAdmin);
  const isLeadStrategist = userRoles.includes("lead-strategist");
  const canViewAdminColumns = isCoach || isTeamCoach || isTeamAdmin || isLeadStrategist;
  const canDeleteEntries = isCoach || isTeamCoach || isTeamAdmin || isLeadStrategist;
  const canManageConfig = canDeleteEntries || userRoles.includes("lead-scout");
  const canViewScoutNames =
    isCoach || isTeamCoach || isTeamAdmin || isLeadStrategist || userRoles.includes("lead-scout");
  const canImportCsv = canDeleteEntries;
  const canExportCsv = canDeleteEntries;
  const csvDisabledReason = "Temporarily disabled due to bugs.";
  const canShowActions = canManageConfig || canDeleteEntries;
  const [entries, setEntries] = useState<TeamStrategyEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>(() => getStoredAnalyticsGame("REBUILT"));
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [sortKey, setSortKey] = useState<
    | "teamNumber"
    | "scoutName"
    | "preferredStartingPosition"
    | "bestAt"
    | "clearsBump"
    | "clearsTrench"
    | "canShootWhileIntaking"
    | "canMoveAndShootSimultaneously"
    | "notes"
    | "id"
  >("teamNumber");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [configEntry, setConfigEntry] = useState<TeamStrategyEntry | null>(null);
  const [hideNames, setHideNames] = useState(false);

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

  const sorted = useMemo(() => {
    const getValue = (entry: TeamStrategyEntry) => {
      switch (sortKey) {
        case "teamNumber":
          return entry.teamNumber || "";
        case "scoutName":
          return entry.scoutName || "";
        case "preferredStartingPosition":
          return entry.preferredStartingPosition || "";
        case "bestAt":
          return entry.bestAt || "";
        case "clearsBump":
          return entry.clearsBump ? 1 : 0;
        case "clearsTrench":
          return entry.clearsTrench ? 1 : 0;
        case "canShootWhileIntaking":
          return entry.canShootWhileIntaking ? 1 : 0;
        case "canMoveAndShootSimultaneously":
          return entry.canMoveAndShootSimultaneously ? 1 : 0;
        case "notes":
          return entry.notes || "";
        case "id":
        default:
          return entry.id;
      }
    };
    return [...filtered].sort((a, b) => compareSortValues(getValue(a), getValue(b), sortDir));
  }, [filtered, sortDir, sortKey]);

  function handleSort(key: typeof sortKey) {
    setSortDir((prev) => (key === sortKey ? (prev === "asc" ? "desc" : "asc") : "asc"));
    setSortKey(key);
  }

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
      extraControls={
        canViewScoutNames ? (
          <label className="text-sm text-gray-600 flex items-center gap-2 mr-3">
            <input
              type="checkbox"
              checked={hideNames}
              onChange={(event) => setHideNames(event.target.checked)}
            />
            Hide Names
          </label>
        ) : null
      }
    >
      <h1 className="text-3xl font-bold mb-2 theme-text">Team Strategy Analytics</h1>
      <p className="text-gray-600 mb-4">Team strategy scouting responses.</p>
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
        <LoadingSpinner message="Loading team strategy analytics..." />
      ) : (
        <div className="bg-white rounded-xl shadow h-[calc(100vh-270px)] table-scroll">
          <table>
            <thead className="sticky-header">
              <tr>
                <th className="sticky-left-group sticky-row-1 bg-red-300 text-center" colSpan={2}>Information</th>
                <th className="bg-yellow-300 text-center" colSpan={2}>Approach</th>
                <th className="bg-blue-300 text-center" colSpan={4}>Capabilities</th>
                <th className="bg-pink-300 text-center" colSpan={canShowActions ? 2 : 1}>General</th>
              </tr>
              <tr>
                <th className="sticky-left-group sticky-row-2 bg-red-200 text-center" colSpan={2}>Information</th>
                <th className="bg-yellow-200 text-center" colSpan={2}>Approach</th>
                <th className="bg-blue-200 text-center" colSpan={4}>Capabilities</th>
                <th className="bg-pink-200 text-center" colSpan={1}>Notes</th>
                {canShowActions && <th className="bg-pink-200 text-center" colSpan={1}>Actions</th>}
              </tr>
              <tr>
                <th className="sticky-left-0 sticky-row-3 cursor-pointer text-center" onClick={() => handleSort("teamNumber")}>
                  {sortLabel(sortKey, sortDir, "teamNumber", "Team")}
                </th>
                <th className="sticky-left-1 sticky-row-3 cursor-pointer text-center" onClick={() => handleSort("scoutName")}>
                  {sortLabel(sortKey, sortDir, "scoutName", "Scout")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("preferredStartingPosition")}>
                  {sortLabel(sortKey, sortDir, "preferredStartingPosition", "Start")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("bestAt")}>
                  {sortLabel(sortKey, sortDir, "bestAt", "Best At")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("clearsBump")}>
                  {sortLabel(sortKey, sortDir, "clearsBump", "Clears Bump")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("clearsTrench")}>
                  {sortLabel(sortKey, sortDir, "clearsTrench", "Clears Trench")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("canShootWhileIntaking")}>
                  {sortLabel(sortKey, sortDir, "canShootWhileIntaking", "Shoot+Intake")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("canMoveAndShootSimultaneously")}>
                  {sortLabel(sortKey, sortDir, "canMoveAndShootSimultaneously", "Move+Shoot")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("notes")}>
                  {sortLabel(sortKey, sortDir, "notes", "Notes")}
                </th>
                {canShowActions && (
                  <th className="cursor-pointer text-center" onClick={() => handleSort("id")}>
                    {sortLabel(sortKey, sortDir, "id", "Actions")}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
                {sorted.map((entry) => (
                  <tr key={entry.id} className={entry.excludeFromStats ? "line-through text-gray-500" : ""}>
                    <td className="sticky-left-0 font-semibold">{entry.teamNumber || "-"}</td>
                    <td className="sticky-left-1">
                      {canViewScoutNames && !hideNames ? entry.scoutName || "-" : "-"}
                    </td>
                    <td>{formatAnalyticsText(entry.preferredStartingPosition)}</td>
                    <td>{formatAnalyticsText(entry.bestAt)}</td>
                  <td>{entry.clearsBump ? "Y" : "N"}</td>
                  <td>{entry.clearsTrench ? "Y" : "N"}</td>
                  <td>{entry.canShootWhileIntaking ? "Y" : "N"}</td>
                  <td>{entry.canMoveAndShootSimultaneously ? "Y" : "N"}</td>
                  <td className="align-top" style={{ minWidth: "220px", maxWidth: "360px" }}>
                    <ExpandableNotesCell text={entry.notes} />
                  </td>
                    {canShowActions && (
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          {canManageConfig && (
                            <button
                              type="button"
                              onClick={() => setConfigEntry(entry)}
                              className="px-2 py-1 rounded border border-gray-300 bg-gray-50 text-gray-800 text-xs disabled:opacity-50"
                            >
                              Config
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleDeleteEntry(entry)}
                            className="px-3 py-1 rounded text-white text-sm touch-manipulation disabled:opacity-60"
                            style={{ backgroundColor: "#dc2626" }}
                            disabled={!canDeleteEntries}
                            title={canDeleteEntries ? undefined : "Only coaches or team admins can delete entries."}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {configEntry && canManageConfig && (
        <AnalyticsConfigModal
          open={Boolean(configEntry)}
          onClose={() => setConfigEntry(null)}
          entryId={configEntry.id}
          entryLabel={`Team ${configEntry.teamNumber || "-"}`}
          entrySubtitle={configEntry.scoutName ? `Scout: ${configEntry.scoutName}` : undefined}
          collectionName="strategyScouting"
          entityType="strategyScouting"
          excludeFromStats={Boolean(configEntry.excludeFromStats)}
          onExcludeChange={(excluded) => {
            setEntries((prev) =>
              prev.map((row) => (row.id === configEntry.id ? { ...row, excludeFromStats: excluded } : row))
            );
            setConfigEntry((prev) => (prev ? { ...prev, excludeFromStats: excluded } : prev));
          }}
        />
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

