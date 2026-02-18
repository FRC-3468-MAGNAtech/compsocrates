"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import { useAuth } from "@/app/AuthContext";
import { entryMatchesAnalyticsFilters, getEventsForGame, normalizeMatchLabel, type AnalyticsGame } from "@/app/utils/analyticsEvents";

type Entry = {
  id: string;
  matchNumber?: string;
  matchType?: "qualification" | "practice" | "finals";
  matchId?: string;
  eventKey?: string;
  eventName?: string;
  game?: string;
  teamNumber: string;
  scoutName: string;
  startingPosition: string;
  leftStartingZone: boolean;
  submittedAt?: number;
  autoCoralMissed: number;
  autoCoralL1: number;
  autoCoralL2: number;
  autoCoralL3: number;
  autoCoralL4: number;
  autoAlgaeProcessorMissed: number;
  autoAlgaeProcessorScored: number;
  autoAlgaeNetMissed: number;
  autoAlgaeNetScored: number;
  teleopCoralMissed: number;
  teleopCoralL1: number;
  teleopCoralL2: number;
  teleopCoralL3: number;
  teleopCoralL4: number;
  teleopAlgaeRemoved: boolean;
  teleopProcessorMissed: number;
  teleopProcessorScored: number;
  teleopNetRobotMissed: number;
  teleopNetRobotScored: number;
  teleopNetHumanMissed: number;
  teleopNetHumanScored: number;
  failedClimb: number;
  stageStatus: string;
  incidents: string[];
  notes: string;
  timestamp: number;
};

const INCIDENT_LABELS: Record<string, string> = {
  died: "Died During Match",
  "never-started": "Never Started Match",
  disabled: "Disabled by FRC",
  recovered: "Recovered from Freeze",
  tipped: "Tipped Over",
  "yellow-card": "Yellow Card",
  "red-card": "Red Card",
};

const PTS = {
  LEAVE: 3,
  AUTO_CORAL_L1: 3,
  AUTO_CORAL_L2: 4,
  AUTO_CORAL_L3: 6,
  AUTO_CORAL_L4: 7,
  AUTO_ALGAE_PROC: 6,
  AUTO_ALGAE_NET: 4,
  TELE_CORAL_L1: 2,
  TELE_CORAL_L2: 3,
  TELE_CORAL_L3: 4,
  TELE_CORAL_L4: 5,
  TELE_ALGAE_PROC: 6,
  TELE_ALGAE_NET_R: 4,
  TELE_ALGAE_NET_H: 4,
  CLIMB_PARK: 2,
  CLIMB_SHALLOW: 6,
  CLIMB_DEEP: 12,
};

function scoreEntry(e: Entry) {
  let s = 0;
  if (e.leftStartingZone) s += PTS.LEAVE;
  s += e.autoCoralL1 * PTS.AUTO_CORAL_L1;
  s += e.autoCoralL2 * PTS.AUTO_CORAL_L2;
  s += e.autoCoralL3 * PTS.AUTO_CORAL_L3;
  s += e.autoCoralL4 * PTS.AUTO_CORAL_L4;
  s += e.autoAlgaeProcessorScored * PTS.AUTO_ALGAE_PROC;
  s += e.autoAlgaeNetScored * PTS.AUTO_ALGAE_NET;
  s += e.teleopCoralL1 * PTS.TELE_CORAL_L1;
  s += e.teleopCoralL2 * PTS.TELE_CORAL_L2;
  s += e.teleopCoralL3 * PTS.TELE_CORAL_L3;
  s += e.teleopCoralL4 * PTS.TELE_CORAL_L4;
  s += e.teleopProcessorScored * PTS.TELE_ALGAE_PROC;
  s += e.teleopNetRobotScored * PTS.TELE_ALGAE_NET_R;
  s += e.teleopNetHumanScored * PTS.TELE_ALGAE_NET_H;
  if (e.teleopAlgaeRemoved) s += 2;
  const end = e.stageStatus.toLowerCase();
  if (end.includes("deep")) s += PTS.CLIMB_DEEP;
  else if (end.includes("shallow")) s += PTS.CLIMB_SHALLOW;
  else if (end.includes("park") || end.includes("barge")) s += PTS.CLIMB_PARK;
  return s;
}

function matchPriority(type?: string) {
  if (type === "practice") return 0;
  if (type === "qualification") return 1;
  if (type === "finals") return 2;
  return 999;
}

function matchNumberValue(value?: string) {
  if (!value) return 0;
  return parseInt(String(value).replace(/\D/g, ""), 10) || 0;
}

function matchLabel(entry: Entry) {
  const num = entry.matchNumber || "-";
  if (entry.matchType === "practice") return `P${num}`;
  if (entry.matchType === "qualification") return `Q${num}`;
  if (entry.matchType === "finals") return `F${num}`;
  return num;
}

type SortKey = keyof Entry | "score";
type SortDir = "asc" | "desc";

function AnalyticsPageContent() {
  const { userData } = useAuth();
  const [rawData, setRawData] = useState<Entry[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("matchNumber");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>(() => {
    if (typeof window === "undefined") return "REBUILT";
    const saved = localStorage.getItem("analytics-selected-game");
    return saved === "REEFSCAPE" || saved === "REBUILT" ? saved : "REBUILT";
  });
  const [selectedEvent, setSelectedEvent] = useState(() => {
    if (typeof window === "undefined") return "all";
    return localStorage.getItem("analytics-selected-event") || "all";
  });
  const [showPractice, setShowPractice] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importGame, setImportGame] = useState<AnalyticsGame>(() => {
    if (typeof window === "undefined") return "REBUILT";
    const saved = localStorage.getItem("analytics-selected-game");
    return saved === "REEFSCAPE" || saved === "REBUILT" ? saved : "REBUILT";
  });
  const [importEvent, setImportEvent] = useState("app-testing");

  const isCoach = userData?.role === "coach";
  const eventOptions = useMemo(() => [{ id: "all", name: "All Events" }, ...getEventsForGame(selectedGame)], [selectedGame]);
  const importEventOptions = useMemo(() => getEventsForGame(importGame), [importGame]);

  useEffect(() => {
    localStorage.setItem("analytics-selected-game", selectedGame);
    localStorage.setItem("analytics-selected-event", selectedEvent);
  }, [selectedGame, selectedEvent]);

  function handleGameChange(nextGame: AnalyticsGame) {
    const validEvents = getEventsForGame(nextGame).map((event) => event.id);
    setSelectedGame(nextGame);
    setImportGame(nextGame);
    if (selectedEvent !== "all" && !validEvents.includes(selectedEvent)) {
      setSelectedEvent("all");
    }
  }

  async function loadData() {
    const snapshot = await getDocs(collection(db, "scouting"));
    const entries = snapshot.docs.map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() })) as Entry[];
    setRawData(entries);
  }

  useEffect(() => {
    getDocs(collection(db, "scouting")).then((snapshot) => {
      const entries = snapshot.docs.map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() })) as Entry[];
      setRawData(entries);
    });
  }, []);

  const filtered = useMemo(() => {
    const byGameAndEvent = rawData.filter((entry) =>
      entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent)
    );
    const byPractice = showPractice
      ? byGameAndEvent.filter((entry) => entry.matchType === "practice")
      : byGameAndEvent.filter((entry) => entry.matchType !== "practice");
    return byPractice;
  }, [rawData, selectedEvent, selectedGame, showPractice]);

  const data = useMemo(() => {
    const withScore = filtered.map((entry) => ({ ...entry, score: scoreEntry(entry) }));
    return withScore.sort((a, b) => {
      if (sortKey === "matchNumber") {
        const typeDiff = matchPriority(a.matchType) - matchPriority(b.matchType);
        if (typeDiff !== 0) return sortDir === "asc" ? typeDiff : -typeDiff;
        const numDiff = matchNumberValue(a.matchNumber) - matchNumberValue(b.matchNumber);
        return sortDir === "asc" ? numDiff : -numDiff;
      }
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const as = String(av ?? "").toLowerCase();
      const bs = String(bv ?? "").toLowerCase();
      if (as < bs) return sortDir === "asc" ? -1 : 1;
      if (as > bs) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filtered, sortDir, sortKey]);

  async function handleDelete(id: string) {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm(null), 3000);
      return;
    }
    await deleteDoc(doc(db, "scouting", id));
    setDeleteConfirm(null);
    await loadData();
  }

  function handleSort(key: SortKey) {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevKey;
      }
      setSortDir("asc");
      return key;
    });
  }

  function sortLabel(key: SortKey, label: string) {
    if (sortKey !== key) return label;
    return sortDir === "asc" ? `${label} ▲` : `${label} ▼`;
  }

  function exportToCSV() {
    if (filtered.length === 0) {
      alert("No data to export");
      return;
    }
    const headers = ["Match", "Type", "Team", "Scout", "Position", "Left Zone", "Notes", "Timestamp"];
    const rows = filtered.map((entry) => [
      entry.matchNumber || "",
      entry.matchType || "",
      entry.teamNumber || "",
      entry.scoutName || "",
      entry.startingPosition || "",
      entry.leftStartingZone ? "Y" : "N",
      (entry.notes || "").replace(/,/g, ";"),
      entry.timestamp || "",
    ]);
    const csv = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => (String(cell).includes(",") ? `"${cell}"` : cell)).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFilePick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPendingImportFile(file);
    setShowImportDialog(true);
    event.target.value = "";
  }

  async function runCSVImport() {
    if (!pendingImportFile) return;

    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      try {
        const text = loadEvent.target?.result as string;
        const lines = text.split("\n");
        let imported = 0;
        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const values = lines[i].split(",").map((value) => value.trim());
          const match = normalizeMatchLabel(values[0] || values[1] || "");
          const now = Date.now();
          await addDoc(collection(db, "scouting"), {
            matchId: match.matchId,
            matchNumber: match.matchNumber,
            matchType: match.matchType,
            teamNumber: values[2],
            scoutName: values[3],
            startingPosition: values[4],
            leftStartingZone: values[5] === "Y",
            notes: values[6]?.replace(/"/g, "").replace(/;/g, ",") || "",
            eventKey: importEvent,
            eventName: importEventOptions.find((option) => option.id === importEvent)?.name || "App Testing",
            game: importGame,
            timestamp: now,
            submittedAt: now,
          });
          imported += 1;
        }
        alert(`Successfully imported ${imported} entries`);
        await loadData();
        setShowImportDialog(false);
        setPendingImportFile(null);
      } catch (error) {
        console.error("Import failed:", error);
        alert("Error importing CSV");
      }
    };
    reader.readAsText(pendingImportFile);
  }

  return (
    <AnalyticsShell
      entriesCount={data.length}
      selectedGame={selectedGame}
      onSelectedGameChange={(game) => handleGameChange(game as AnalyticsGame)}
      selectedEvent={selectedEvent}
      eventOptions={eventOptions}
      onSelectedEventChange={setSelectedEvent}
    >
      <div className="bg-white rounded-xl shadow p-4 mb-4 flex flex-wrap items-center gap-4">
        <label className="text-sm text-gray-600 flex items-center gap-2">
          <input type="checkbox" checked={showPractice} onChange={(e) => setShowPractice(e.target.checked)} />
          Show Practice Matches
        </label>
        <button className="px-3 py-1.5 text-sm rounded bg-green-600 text-white" onClick={exportToCSV}>
          Export CSV
        </button>
        <label className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white cursor-pointer">
          Import CSV
          <input type="file" accept=".csv" onChange={handleImportFilePick} className="hidden" />
        </label>
      </div>

      {showImportDialog && (
        <div className="fixed inset-0 bg-black/45 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-semibold mb-4">Import CSV</h2>
            <p className="text-sm text-gray-600 mb-4">
              Choose the game and event for this import.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Game</label>
                <select
                  value={importGame}
                  onChange={(event) => {
                    const next = event.target.value as AnalyticsGame;
                    setImportGame(next);
                    setImportEvent(getEventsForGame(next)[0]?.id || "app-testing");
                  }}
                  className="w-full border rounded p-2"
                >
                  <option value="REEFSCAPE">REEFSCAPE</option>
                  <option value="REBUILT">REBUILT</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Event</label>
                <select
                  value={importEvent}
                  onChange={(event) => setImportEvent(event.target.value)}
                  className="w-full border rounded p-2"
                >
                  {importEventOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <button
                onClick={runCSVImport}
                className="flex-1 py-2 rounded bg-blue-600 text-white font-semibold"
              >
                Import
              </button>
              <button
                onClick={() => {
                  setShowImportDialog(false);
                  setPendingImportFile(null);
                }}
                className="flex-1 py-2 rounded border border-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow h-[calc(100vh-270px)] table-scroll">
        <table>
          <thead className="sticky-header">
            <tr>
              <th className="sticky-left-0 bg-red-300 text-center" colSpan={2}>Information</th>
              <th className="bg-yellow-300 text-center" colSpan={2}>Pre-Match</th>
              <th className="bg-green-300 text-center" colSpan={10}>Autonomous</th>
              <th className="bg-blue-300 text-center" colSpan={13}>Teleoperated</th>
              <th className="bg-purple-300 text-center" colSpan={2}>Endgame</th>
              <th className="bg-pink-300 text-center" colSpan={3}>General</th>
              {isCoach && <th className="bg-orange-300 text-center" colSpan={1}>Actions</th>}
            </tr>
            <tr>
              <th className="sticky-left-0 bg-red-200 text-center" colSpan={2}>Information</th>
              <th className="bg-yellow-200 text-center" colSpan={2}>Pre-Match</th>
              <th className="bg-green-200 text-center" colSpan={1}>Leave</th>
              <th className="bg-green-200 text-center" colSpan={5}>Coral</th>
              <th className="bg-green-200 text-center" colSpan={2}>Algae Processor</th>
              <th className="bg-green-200 text-center" colSpan={2}>Algae Net</th>
              <th className="bg-blue-200 text-center" colSpan={5}>Coral</th>
              <th className="bg-blue-200 text-center" colSpan={1}>Algae Collection</th>
              <th className="bg-blue-200 text-center" colSpan={2}>Algae Processor</th>
              <th className="bg-blue-200 text-center" colSpan={2}>Algae Net (Robot)</th>
              <th className="bg-blue-200 text-center" colSpan={2}>Algae Net (Human)</th>
              <th className="bg-purple-200 text-center" colSpan={1}>Climb</th>
              <th className="bg-purple-200 text-center" colSpan={1}>End Place</th>
              <th className="bg-pink-200 text-center" colSpan={1}>Misc</th>
              <th className="bg-pink-200 text-center" colSpan={1}>Comments</th>
              <th className="bg-pink-200 text-center" colSpan={1}>Score</th>
              {isCoach && <th className="bg-orange-200 text-center">Delete</th>}
            </tr>
            <tr>
              <th className="sticky-left-0 cursor-pointer text-center" onClick={() => handleSort("matchNumber")}>{sortLabel("matchNumber", "Match")}</th>
              <th className="sticky-left-1 cursor-pointer text-center" onClick={() => handleSort("teamNumber")}>{sortLabel("teamNumber", "Team")}</th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("scoutName")}>{sortLabel("scoutName", "Scout")}</th>
              <th className="text-center">Starting Position</th>
              <th className="text-center">Leave</th>
              <th className="text-center">Missed</th>
              <th className="text-center">L1</th>
              <th className="text-center">L2</th>
              <th className="text-center">L3</th>
              <th className="text-center">L4</th>
              <th className="text-center">Missed</th>
              <th className="text-center">Scored</th>
              <th className="text-center">Missed</th>
              <th className="text-center">Scored</th>
              <th className="text-center">Missed</th>
              <th className="text-center">L1</th>
              <th className="text-center">L2</th>
              <th className="text-center">L3</th>
              <th className="text-center">L4</th>
              <th className="text-center">Removed Reef</th>
              <th className="text-center">Missed</th>
              <th className="text-center">Scored</th>
              <th className="text-center">Missed</th>
              <th className="text-center">Scored</th>
              <th className="text-center">Missed</th>
              <th className="text-center">Scored</th>
              <th className="text-center">Failed</th>
              <th className="text-center">End Place</th>
              <th className="text-center">Incidents</th>
              <th className="text-center">Comments</th>
              <th className="cursor-pointer text-center" onClick={() => handleSort("score")}>{sortLabel("score", "Score")}</th>
              {isCoach && <th className="text-center">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((entry) => (
              <tr key={entry.id}>
                <td className="sticky-left-0 bg-white font-semibold text-center">{matchLabel(entry)}</td>
                <td className="sticky-left-1 bg-white font-semibold text-center">{entry.teamNumber || "-"}</td>
                <td className="text-center">{entry.scoutName || "-"}</td>
                <td className="text-center">{entry.startingPosition || "-"}</td>
                <td className="text-center">{entry.leftStartingZone ? "Y" : "N"}</td>
                <td className="text-center">{entry.autoCoralMissed || 0}</td>
                <td className="text-center">{entry.autoCoralL1 || 0}</td>
                <td className="text-center">{entry.autoCoralL2 || 0}</td>
                <td className="text-center">{entry.autoCoralL3 || 0}</td>
                <td className="text-center">{entry.autoCoralL4 || 0}</td>
                <td className="text-center">{entry.autoAlgaeProcessorMissed || 0}</td>
                <td className="text-center">{entry.autoAlgaeProcessorScored || 0}</td>
                <td className="text-center">{entry.autoAlgaeNetMissed || 0}</td>
                <td className="text-center">{entry.autoAlgaeNetScored || 0}</td>
                <td className="text-center">{entry.teleopCoralMissed || 0}</td>
                <td className="text-center">{entry.teleopCoralL1 || 0}</td>
                <td className="text-center">{entry.teleopCoralL2 || 0}</td>
                <td className="text-center">{entry.teleopCoralL3 || 0}</td>
                <td className="text-center">{entry.teleopCoralL4 || 0}</td>
                <td className="text-center">{entry.teleopAlgaeRemoved ? "Y" : "N"}</td>
                <td className="text-center">{entry.teleopProcessorMissed || 0}</td>
                <td className="text-center">{entry.teleopProcessorScored || 0}</td>
                <td className="text-center">{entry.teleopNetRobotMissed || 0}</td>
                <td className="text-center">{entry.teleopNetRobotScored || 0}</td>
                <td className="text-center">{entry.teleopNetHumanMissed || 0}</td>
                <td className="text-center">{entry.teleopNetHumanScored || 0}</td>
                <td className="text-center">{entry.failedClimb || 0}</td>
                <td className="text-center">{entry.stageStatus || "-"}</td>
                <td className="text-center">
                  {entry.incidents?.map((incident) => INCIDENT_LABELS[incident] || incident).join(", ") || "-"}
                </td>
                <td className="text-center">{entry.notes || "-"}</td>
                <td className="text-center font-bold">{scoreEntry(entry)}</td>
                {isCoach && (
                  <td className="text-center">
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className={`px-2 py-1 text-xs rounded ${
                        deleteConfirm === entry.id ? "bg-red-700 text-white" : "bg-red-500 text-white"
                      }`}
                    >
                      {deleteConfirm === entry.id ? "Confirm?" : "Delete"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AnalyticsShell>
  );
}

export default function AnalyticsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <AnalyticsPageContent />
    </ProtectedRoute>
  );
}
