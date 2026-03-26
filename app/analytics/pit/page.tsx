"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import ExpandableNotesCell from "@/app/components/ExpandableNotesCell";
import AnalyticsConfigModal from "@/app/components/AnalyticsConfigModal";
import { entryMatchesAnalyticsFilters, getEventOptionsForEntries, getEventsForGame, isPracticeScoutedEntry, type AnalyticsGame } from "@/app/utils/analyticsEvents";
import { formatAnalyticsText } from "@/app/utils/displayFormat";
import { useAuth } from "@/app/AuthContext";
import { csvEscape, normalizeHeader, parseCsvLine, splitCsvRecords, toBoolean, toNumber } from "@/app/utils/csvHelpers";
import { compareSortValues, sortLabel, type SortDir } from "@/app/utils/sortHelpers";
import { getUserRoles } from "@/app/utils/roles";

type PitEntry = {
  id: string;
  game?: string;
  eventKey?: string;
  createdAt?: number;
  submittedAt?: number;
  timestamp?: number;
  teamNumber?: string;
  scoutName?: string;
  robotWeight?: string;
  robotPictureUrl?: string;
  pitDisposition?: boolean | string;
  driveDisposition?: boolean | string;
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
  fuelPreloadCapacity?: number | string;
  fuelBallsPerSecond?: number | string;
  fuelCarryingCapacity?: number | string;
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
  excludeFromStats?: boolean;
};

function isPracticeEntry(entry: PitEntry) {
  return isPracticeScoutedEntry(entry);
}

function dispositionToCsv(value: PitEntry["pitDisposition"]) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return value ? "Yes" : "";
}

function dispositionToCell(value: PitEntry["pitDisposition"]) {
  if (typeof value === "string" && value.trim()) return formatAnalyticsText(value.trim());
  return value ? "Yes" : "No";
}

function normalizeFuelScaleValue(value: number | string | undefined): number {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "x") return -1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : -1;
}

function fuelScaleDisplay(value: number | string | undefined): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "x") return "x";
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? String(parsed) : "x";
}

function PitAnalyticsContent() {
  const { userData } = useAuth();
  const userRoles = getUserRoles({ role: userData?.role, roles: userData?.roles });
  const isCoach = userData?.role === "coach";
  const isTeamCoach = String(userData?.role || "").toLowerCase() === "team-coach" || (userData?.roles || []).includes("team-coach");
  const isTeamAdmin = Boolean(userData?.isTeamAdmin);
  const isLeadStrategist = userRoles.includes("lead-strategist");
  const canViewAdminColumns = isCoach || isTeamCoach || isTeamAdmin || isLeadStrategist;
  const canDeleteEntries = isCoach || isTeamCoach || isTeamAdmin || isLeadStrategist;
  const canManageConfig = canDeleteEntries || userRoles.includes("lead-scout");
  const canImportCsv = userData?.role === "coach" || Boolean(userData?.isTeamAdmin) || isLeadStrategist;
  const canExportCsv = canImportCsv;
  const csvDisabledReason = "Temporarily disabled due to bugs.";
  const canShowActions = canManageConfig || canDeleteEntries;
  const [entries, setEntries] = useState<PitEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REEFSCAPE");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importGame, setImportGame] = useState<AnalyticsGame>("REEFSCAPE");
  const [importEvent, setImportEvent] = useState("app-testing");
  const [configEntry, setConfigEntry] = useState<PitEntry | null>(null);
  const [sortKey, setSortKey] = useState<
    | "teamNumber"
    | "scoutName"
    | "robotWeight"
    | "robotPictureUrl"
    | "pitDisposition"
    | "driveDisposition"
    | "fuelPreloadCapacity"
    | "fuelBallsPerSecond"
    | "fuelCarryingCapacity"
    | "climbLevel1"
    | "climbLevel2"
    | "climbLevel3"
    | "typicalFuelCycleTime"
    | "typicalClimbTime"
    | "autoCycleDescription"
    | "driveBaseType"
    | "centerOfGravity"
    | "coralCollecting"
    | "coralScoring"
    | "algaeCollecting"
    | "algaeScoring"
    | "bargeCapability"
    | "autoCapabilities"
    | "startingPositions"
    | "betterAt"
    | "rating"
    | "notes"
    | "id"
  >("teamNumber");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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

  const sorted = useMemo(() => {
    const getValue = (entry: PitEntry) => {
      const coralCollecting = [entry.collectCoralStation && "Station", entry.collectCoralGround && "Ground"]
        .filter(Boolean)
        .join(", ");
      const coralScoring = [entry.coralL4 && "L4", entry.coralL3 && "L3", entry.coralL2 && "L2", entry.coralL1 && "L1"]
        .filter(Boolean)
        .join(", ");
      const algaeCollecting = [entry.collectAlgaeReef && "Reef", entry.collectAlgaeGround && "Ground"]
        .filter(Boolean)
        .join(", ");
      const algaeScoring = [entry.scoreProcessor && "Processor", entry.scoreNetRobot && "Net"].filter(Boolean).join(", ");
      const startingPositions = [entry.startingOpposite && "Opposite", entry.startingMiddle && "Middle", entry.startingProcessor && "Processor"]
        .filter(Boolean)
        .join(", ");

      switch (sortKey) {
        case "teamNumber":
          return entry.teamNumber || "";
        case "scoutName":
          return entry.scoutName || "";
        case "robotWeight":
          return entry.robotWeight || "";
        case "robotPictureUrl":
          return entry.robotPictureUrl ? 1 : 0;
        case "pitDisposition":
          return entry.pitDisposition ?? "";
        case "driveDisposition":
          return entry.driveDisposition ?? "";
        case "fuelPreloadCapacity":
          return normalizeFuelScaleValue(entry.fuelPreloadCapacity);
        case "fuelBallsPerSecond":
          return normalizeFuelScaleValue(entry.fuelBallsPerSecond);
        case "fuelCarryingCapacity":
          return normalizeFuelScaleValue(entry.fuelCarryingCapacity);
        case "climbLevel1":
          return entry.climbLevel1 ? 1 : 0;
        case "climbLevel2":
          return entry.climbLevel2 ? 1 : 0;
        case "climbLevel3":
          return entry.climbLevel3 ? 1 : 0;
        case "typicalFuelCycleTime":
          return entry.typicalFuelCycleTime || "";
        case "typicalClimbTime":
          return entry.typicalClimbTime || "";
        case "autoCycleDescription":
          return entry.autoCycleDescription || "";
        case "driveBaseType":
          return entry.driveBaseType || "";
        case "centerOfGravity":
          return entry.centerOfGravity || "";
        case "coralCollecting":
          return coralCollecting || "";
        case "coralScoring":
          return coralScoring || "";
        case "algaeCollecting":
          return algaeCollecting || "";
        case "algaeScoring":
          return algaeScoring || "";
        case "bargeCapability":
          return entry.bargeCapability || "";
        case "autoCapabilities":
          return entry.autoCapabilities || "";
        case "startingPositions":
          return startingPositions || "";
        case "betterAt":
          return entry.betterAt || "";
        case "rating":
          return entry.rating ?? 0;
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

  const importEventOptions = useMemo(() => getEventsForGame(importGame), [importGame]);

  function exportToCSV() {
    if (!canExportCsv) {
      alert("Only team members can export CSV files.");
      return;
    }
    const header = [
      "Team",
      "Scout",
      "Robot Picture",
      "Robot Weight",
      "Disposition",
      "Drive Base",
      "Center of Gravity",
      "Coral Collecting",
      "Coral Scoring",
      "Algae Collecting",
      "Algae Scoring",
      "Climb",
      "Starting Positions",
      "Capabilities",
      "Better At",
      "Rating",
      "Comments",
      "Game",
      "Event Key",
    ];
    const lines = filtered.map((entry) => {
      const coralCollecting = [entry.collectCoralStation && "Station", entry.collectCoralGround && "Ground"].filter(Boolean).join(", ");
      const coralScoring = [entry.coralL4 && "Level 4", entry.coralL3 && "Level 3", entry.coralL2 && "Level 2", entry.coralL1 && "Level 1"].filter(Boolean).join(", ");
      const algaeCollecting = [entry.collectAlgaeReef && "Station", entry.collectAlgaeGround && "Ground"].filter(Boolean).join(", ");
      const algaeScoring = [entry.scoreProcessor && "Processor", entry.scoreNetRobot && "Net"].filter(Boolean).join(", ");
      const climb = [entry.climbLevel3 && "Can climb deep cage", entry.climbLevel2 && "Can climb shallow cage", entry.climbLevel1 && "Can climb level 1"].filter(Boolean).join(", ");
      const starts = [entry.startingOpposite && "Opposite", entry.startingMiddle && "Middle", entry.startingProcessor && "Processor"].filter(Boolean).join(", ");
      return [
        entry.teamNumber || "",
        entry.scoutName || "",
        entry.robotPictureUrl || "",
        entry.robotWeight || "",
        dispositionToCsv(entry.pitDisposition),
        entry.driveBaseType || "",
        entry.centerOfGravity || "",
        coralCollecting,
        coralScoring,
        algaeCollecting,
        algaeScoring,
        climb,
        starts,
        entry.autoCapabilities || "",
        entry.betterAt || "",
        entry.rating || "",
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
    a.download = `pit-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
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
    if (!file) return;
    setPendingImportFile(file);
    setImportGame(selectedGame);
    setImportEvent(selectedEvent === "all" ? (getEventsForGame(selectedGame)[0]?.id || "app-testing") : selectedEvent);
    setShowImportDialog(true);
    event.target.value = "";
  }

  async function runCSVImport() {
    if (!canImportCsv) {
      alert("Only coaches or team admins can import CSV files.");
      return;
    }
    if (!pendingImportFile || importing) return;
    setImporting(true);

    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      try {
        const text = String(loadEvent.target?.result || "");
        const lines = splitCsvRecords(text);
        if (lines.length < 2) throw new Error("CSV has no data rows.");

        let headerRowIndex = -1;
        for (let i = 0; i < Math.min(lines.length, 8); i += 1) {
          const headers = parseCsvLine(lines[i]).map(normalizeHeader);
          if (headers.includes("team") && headers.includes("scout")) {
            headerRowIndex = i;
            break;
          }
        }
        if (headerRowIndex < 0) throw new Error("Could not detect a valid pit-scout header row.");

        const headersRaw = parseCsvLine(lines[headerRowIndex]);
        const headers = headersRaw.map(normalizeHeader);
        const findNth = (target: string, occurrence: number) => {
          let seen = 0;
          for (let i = 0; i < headers.length; i += 1) {
            if (headers[i] === target) {
              seen += 1;
              if (seen === occurrence) return i;
            }
          }
          return -1;
        };
        const idxTeam = headers.findIndex((h) => h === "team" || h === "teamnumber");
        const idxScout = headers.findIndex((h) => h === "scout" || h === "scoutname");
        const idxRobotPicture = headers.findIndex((h) => h === "robotpicture");
        const idxRobotWeight = headers.findIndex((h) => h === "robotweight");
        const idxDisposition = headers.findIndex((h) => h === "disposition");
        const idxDriveBase = headers.findIndex((h) => h === "drivebase" || h === "drivebasetype");
        const idxCog = headers.findIndex((h) => h === "centerofgravity");
        const idxCoralCollecting = findNth("collecting", 1);
        const idxCoralScoring = findNth("scoring", 1);
        const idxAlgaeCollecting = findNth("collecting", 2);
        const idxAlgaeScoring = findNth("scoring", 2);
        const idxClimb = headers.findIndex((h) => h === "climb");
        const idxStarts = headers.findIndex((h) => h === "startingpositions");
        const idxCapabilities = headers.findIndex((h) => h === "capabilities");
        const idxBetterAt = headers.findIndex((h) => h.includes("betterat"));
        const idxRating = headers.findIndex((h) => h === "15" || h === "rating");
        const idxComments = headers.findIndex((h) => h === "comments" || h === "notes");

        let imported = 0;
        let skipped = 0;
        for (let rowIndex = headerRowIndex + 1; rowIndex < lines.length; rowIndex += 1) {
          const cells = parseCsvLine(lines[rowIndex]);
          const get = (idx: number) => (idx >= 0 ? String(cells[idx] || "").trim() : "");

          const team = get(idxTeam);
          const scout = get(idxScout);
          if (!team && !scout) {
            skipped += 1;
            continue;
          }

          const coralCollecting = get(idxCoralCollecting).toLowerCase();
          const coralScoring = get(idxCoralScoring).toLowerCase();
          const algaeCollecting = get(idxAlgaeCollecting).toLowerCase();
          const algaeScoring = get(idxAlgaeScoring).toLowerCase();
          const climbText = get(idxClimb).toLowerCase();
          const startsText = get(idxStarts).toLowerCase();
          const dispositionRaw = get(idxDisposition);
          const now = Date.now();

          await addDoc(collection(db, "pitScouting"), {
            teamNumber: team,
            scoutName: scout,
            robotPictureUrl: get(idxRobotPicture),
            robotWeight: get(idxRobotWeight),
            pitDisposition: toBoolean(dispositionRaw) || dispositionRaw.length > 0,
            driveDisposition: false,
            driveBaseType: get(idxDriveBase),
            centerOfGravity: get(idxCog),
            collectCoralStation: coralCollecting.includes("station"),
            collectCoralGround: coralCollecting.includes("ground"),
            coralL4: coralScoring.includes("4"),
            coralL3: coralScoring.includes("3"),
            coralL2: coralScoring.includes("2"),
            coralL1: coralScoring.includes("1"),
            collectAlgaeReef: algaeCollecting.includes("station") || algaeCollecting.includes("reef"),
            collectAlgaeGround: algaeCollecting.includes("ground"),
            scoreProcessor: algaeScoring.includes("processor"),
            scoreNetRobot: algaeScoring.includes("net"),
            climbLevel1: climbText.includes("level 1") || climbText.includes("park"),
            climbLevel2: climbText.includes("shallow") || climbText.includes("level 2"),
            climbLevel3: climbText.includes("deep") || climbText.includes("level 3"),
            startingOpposite: startsText.includes("opposite"),
            startingMiddle: startsText.includes("middle"),
            startingProcessor: startsText.includes("processor"),
            autoCapabilities: get(idxCapabilities),
            betterAt: get(idxBetterAt),
            rating: toNumber(get(idxRating)),
            notes: get(idxComments),
            game: importGame,
            eventKey: importEvent,
            timestamp: now,
            submittedAt: now,
          });
          imported += 1;
        }

        alert(`Successfully imported ${imported} entries${skipped ? ` (${skipped} rows skipped)` : ""}.`);
        const snapshot = await getDocs(collection(db, "pitScouting"));
        const rows = snapshot.docs.map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() })) as PitEntry[];
        setEntries(rows);
        setShowImportDialog(false);
        setPendingImportFile(null);
      } catch (error) {
        console.error("Pit CSV import failed:", error);
        const message = error instanceof Error ? error.message : "Unknown error";
        alert(`Error importing CSV: ${message}`);
      } finally {
        setImporting(false);
      }
    };
    reader.readAsText(pendingImportFile);
  }

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
          Import CSV
          <input type="file" accept=".csv" onChange={handleImportFilePick} className="hidden" disabled />
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
                disabled={importing}
                className="flex-1 py-2 rounded bg-blue-600 text-white font-semibold disabled:opacity-60"
              >
                {importing ? "Importing..." : "Import"}
              </button>
              <button
                onClick={() => {
                  setShowImportDialog(false);
                  setPendingImportFile(null);
                }}
                disabled={importing}
                className="flex-1 py-2 rounded border border-gray-300 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <LoadingSpinner message="Loading pit analytics..." />
      ) : (
        <div className="bg-white rounded-xl shadow h-[calc(100vh-270px)] table-scroll">
          {selectedGame === "REBUILT" ? (
            <table>
              <thead className="sticky-header">
                <tr>
                  <th className="sticky-left-group sticky-row-1 bg-red-300 text-center" colSpan={3}>Information</th>
                  <th className="bg-red-300 text-center" colSpan={3}>Friendliness</th>
                  <th className="bg-blue-300 text-center" colSpan={3}>Fuel</th>
                  <th className="bg-purple-300 text-center" colSpan={3}>Climb</th>
                  <th className="bg-yellow-300 text-center" colSpan={3}>Cycles</th>
                  <th className="bg-pink-300 text-center" colSpan={canShowActions ? 2 : 1}>General</th>
                </tr>
                <tr>
                  <th className="sticky-left-group sticky-row-2 bg-red-200 text-center" colSpan={3}>Information</th>
                  <th className="bg-red-200 text-center" colSpan={3}>Friendliness</th>
                  <th className="bg-blue-200 text-center" colSpan={3}>Fuel</th>
                  <th className="bg-purple-200 text-center" colSpan={3}>Climb</th>
                  <th className="bg-yellow-200 text-center" colSpan={3}>Cycles</th>
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
                  <th className="cursor-pointer text-center" onClick={() => handleSort("robotWeight")}>
                    {sortLabel(sortKey, sortDir, "robotWeight", "Robot Weight")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("robotPictureUrl")}>
                    {sortLabel(sortKey, sortDir, "robotPictureUrl", "Robot Picture")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("pitDisposition")}>
                    {sortLabel(sortKey, sortDir, "pitDisposition", "Pit Disposition")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("driveDisposition")}>
                    {sortLabel(sortKey, sortDir, "driveDisposition", "Drive Disposition")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("fuelPreloadCapacity")}>
                    {sortLabel(sortKey, sortDir, "fuelPreloadCapacity", "Preload")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("fuelBallsPerSecond")}>
                    {sortLabel(sortKey, sortDir, "fuelBallsPerSecond", "Balls/Sec")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("fuelCarryingCapacity")}>
                    {sortLabel(sortKey, sortDir, "fuelCarryingCapacity", "Carrying")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("climbLevel1")}>
                    {sortLabel(sortKey, sortDir, "climbLevel1", "Climb L1")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("climbLevel2")}>
                    {sortLabel(sortKey, sortDir, "climbLevel2", "Climb L2")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("climbLevel3")}>
                    {sortLabel(sortKey, sortDir, "climbLevel3", "Climb L3")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("typicalFuelCycleTime")}>
                    {sortLabel(sortKey, sortDir, "typicalFuelCycleTime", "Fuel Cycle Time")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("typicalClimbTime")}>
                    {sortLabel(sortKey, sortDir, "typicalClimbTime", "Climb Time")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("autoCycleDescription")}>
                    {sortLabel(sortKey, sortDir, "autoCycleDescription", "Auto Cycle")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("notes")}>
                    {sortLabel(sortKey, sortDir, "notes", "Comments")}
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
                    <td className="sticky-left-0 bg-white font-semibold">{entry.teamNumber || "-"}</td>
                    <td className="sticky-left-1 bg-white">{entry.scoutName || "-"}</td>
                    <td>{formatAnalyticsText(entry.robotWeight)}</td>
                    <td>{entry.robotPictureUrl ? "Yes" : "No"}</td>
                    <td>{dispositionToCell(entry.pitDisposition)}</td>
                    <td>{dispositionToCell(entry.driveDisposition)}</td>
                    <td>{fuelScaleDisplay(entry.fuelPreloadCapacity)}</td>
                    <td>{fuelScaleDisplay(entry.fuelBallsPerSecond)}</td>
                    <td>{fuelScaleDisplay(entry.fuelCarryingCapacity)}</td>
                    <td>{entry.climbLevel1 ? "Y" : "N"}</td>
                    <td>{entry.climbLevel2 ? "Y" : "N"}</td>
                    <td>{entry.climbLevel3 ? "Y" : "N"}</td>
                    <td>{formatAnalyticsText(entry.typicalFuelCycleTime)}</td>
                    <td>{formatAnalyticsText(entry.typicalClimbTime)}</td>
                    <td>{formatAnalyticsText(entry.autoCycleDescription)}</td>
                    <ExpandableNotesCell text={entry.notes} className="text-left align-top" />
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
          ) : (
            <table>
              <thead className="sticky-header">
                <tr>
                  <th className="sticky-left-group sticky-row-1 bg-red-300 text-center" colSpan={3}>Information</th>
                  <th className="bg-red-300 text-center" colSpan={3}>Friendliness</th>
                  <th className="bg-yellow-300 text-center" colSpan={2}>Drive</th>
                  <th className="bg-orange-300 text-center" colSpan={2}>Coral</th>
                  <th className="bg-green-300 text-center" colSpan={2}>Algae</th>
                  <th className="bg-blue-300 text-center" colSpan={4}>Field Plan</th>
                  <th className="bg-pink-300 text-center" colSpan={canShowActions ? 3 : 2}>General</th>
                </tr>
                <tr>
                  <th className="sticky-left-group sticky-row-2 bg-red-200 text-center" colSpan={3}>Information</th>
                  <th className="bg-red-200 text-center" colSpan={3}>Friendliness</th>
                  <th className="bg-yellow-200 text-center" colSpan={2}>Drive</th>
                  <th className="bg-orange-200 text-center" colSpan={2}>Coral</th>
                  <th className="bg-green-200 text-center" colSpan={2}>Algae</th>
                  <th className="bg-blue-200 text-center" colSpan={4}>Field Plan</th>
                  <th className="bg-pink-200 text-center" colSpan={1}>Rating</th>
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
                  <th className="cursor-pointer text-center" onClick={() => handleSort("robotWeight")}>
                    {sortLabel(sortKey, sortDir, "robotWeight", "Robot Weight")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("robotPictureUrl")}>
                    {sortLabel(sortKey, sortDir, "robotPictureUrl", "Robot Picture")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("pitDisposition")}>
                    {sortLabel(sortKey, sortDir, "pitDisposition", "Pit Disposition")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("driveDisposition")}>
                    {sortLabel(sortKey, sortDir, "driveDisposition", "Drive Disposition")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("driveBaseType")}>
                    {sortLabel(sortKey, sortDir, "driveBaseType", "Drive Base")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("centerOfGravity")}>
                    {sortLabel(sortKey, sortDir, "centerOfGravity", "Center of Gravity")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("coralCollecting")}>
                    {sortLabel(sortKey, sortDir, "coralCollecting", "Coral Collecting")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("coralScoring")}>
                    {sortLabel(sortKey, sortDir, "coralScoring", "Coral Scoring")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("algaeCollecting")}>
                    {sortLabel(sortKey, sortDir, "algaeCollecting", "Algae Collecting")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("algaeScoring")}>
                    {sortLabel(sortKey, sortDir, "algaeScoring", "Algae Scoring")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("bargeCapability")}>
                    {sortLabel(sortKey, sortDir, "bargeCapability", "Barge")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("autoCapabilities")}>
                    {sortLabel(sortKey, sortDir, "autoCapabilities", "Auto")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("startingPositions")}>
                    {sortLabel(sortKey, sortDir, "startingPositions", "Starting Positions")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("betterAt")}>
                    {sortLabel(sortKey, sortDir, "betterAt", "Better At")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("rating")}>
                    {sortLabel(sortKey, sortDir, "rating", "Rating")}
                  </th>
                  <th className="cursor-pointer text-center" onClick={() => handleSort("notes")}>
                    {sortLabel(sortKey, sortDir, "notes", "Comments")}
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
                    <td className="sticky-left-0 bg-white font-semibold">{entry.teamNumber || "-"}</td>
                    <td className="sticky-left-1 bg-white">{entry.scoutName || "-"}</td>
                    <td>{formatAnalyticsText(entry.robotWeight)}</td>
                    <td>{entry.robotPictureUrl ? "Yes" : "No"}</td>
                    <td>{dispositionToCell(entry.pitDisposition)}</td>
                    <td>{dispositionToCell(entry.driveDisposition)}</td>
                    <td>{formatAnalyticsText(entry.driveBaseType)}</td>
                    <td>{formatAnalyticsText(entry.centerOfGravity)}</td>
                    <td>{[entry.collectCoralStation && "Station", entry.collectCoralGround && "Ground"].filter(Boolean).join(", ") || "-"}</td>
                    <td>{[entry.coralL4 && "L4", entry.coralL3 && "L3", entry.coralL2 && "L2", entry.coralL1 && "L1"].filter(Boolean).join(", ") || "-"}</td>
                    <td>{[entry.collectAlgaeReef && "Reef", entry.collectAlgaeGround && "Ground"].filter(Boolean).join(", ") || "-"}</td>
                    <td>{[entry.scoreProcessor && "Processor", entry.scoreNetRobot && "Net"].filter(Boolean).join(", ") || "-"}</td>
                    <td>{formatAnalyticsText(entry.bargeCapability)}</td>
                    <td>{formatAnalyticsText(entry.autoCapabilities)}</td>
                    <td>{[entry.startingOpposite && "Opposite", entry.startingMiddle && "Middle", entry.startingProcessor && "Processor"].filter(Boolean).join(", ") || "-"}</td>
                    <td>{formatAnalyticsText(entry.betterAt)}</td>
                    <td>{entry.rating || "-"}</td>
                    <ExpandableNotesCell text={entry.notes} className="text-left align-top" />
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
          )}
        </div>
      )}
      {configEntry && canManageConfig && (
        <AnalyticsConfigModal
          open={Boolean(configEntry)}
          onClose={() => setConfigEntry(null)}
          entryId={configEntry.id}
          entryLabel={`Team ${configEntry.teamNumber || "-"}`}
          entrySubtitle={configEntry.scoutName ? `Scout: ${configEntry.scoutName}` : undefined}
          collectionName="pitScouting"
          entityType="pitScouting"
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

export default function PitAnalyticsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <PitAnalyticsContent />
    </ProtectedRoute>
  );
}
