"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs } from "firebase/firestore";
import { Boxes, ClipboardList, Database, StickyNote, Users, X } from "lucide-react";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import ExpandableNotesCell from "@/app/components/ExpandableNotesCell";
import AnalyticsConfigModal from "@/app/components/AnalyticsConfigModal";
import { AnalyticsNotesProvider, useAnalyticsNotesSettings } from "@/app/components/AnalyticsNotesContext";
import {
  entryMatchesAnalyticsFilters,
  getEventOptionsForEntries,
  getEventsForGame,
  isPracticeScoutedEntry,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";
import { formatAnalyticsText } from "@/app/utils/displayFormat";
import { useAuth } from "@/app/AuthContext";
import { csvEscape, normalizeHeader, parseCsvLine, splitCsvRecords, toBoolean, toNumber } from "@/app/utils/csvHelpers";
import { compareSortValues, sortLabel, type SortDir } from "@/app/utils/sortHelpers";
import { getUserRoles } from "@/app/utils/roles";
import { Action, Chip, CommandBar, Deck, HudCanvas, HudViewport, PageIntro, Surface } from "@/app/components/Hud";

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
  rookieTeam?: boolean | string;
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

/** Column-group header tint — crimson/gold gradations only, never the old rainbow palette. */
const GROUP_TINTS = [
  "bg-red-900/10 text-red-950",
  "bg-amber-400/20 text-amber-950",
  "bg-red-800/15 text-red-950",
  "bg-amber-500/20 text-amber-950",
  "bg-slate-900/8 text-slate-900",
];

function GroupHeaderCell({ tone, colSpan, children }: { tone: number; colSpan: number; children: React.ReactNode }) {
  return (
    <th className={`text-center font-black uppercase tracking-[0.14em] ${GROUP_TINTS[tone % GROUP_TINTS.length]}`} colSpan={colSpan}>
      {children}
    </th>
  );
}

function SortTh({
  label,
  active,
  dir,
  onClick,
  sticky,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  sticky?: string;
}) {
  return (
    <th
      className={`cursor-pointer select-none text-center transition hover:bg-amber-100/60 ${sticky || ""}`}
      onClick={onClick}
    >
      {label} {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
    </th>
  );
}

function PitAnalyticsContent() {
  const { userData } = useAuth();
  const { autoExpandNotes, setAutoExpandNotes } = useAnalyticsNotesSettings();
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
  const canImportCsv = userData?.role === "coach" || Boolean(userData?.isTeamAdmin) || isLeadStrategist;
  const canExportCsv = canImportCsv;
  const csvDisabledReason = "Temporarily disabled due to bugs.";
  const canShowActions = canManageConfig || canDeleteEntries;
  void canViewAdminColumns;
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
  const [hideNames, setHideNames] = useState(false);
  const [sortKey, setSortKey] = useState<
    | "teamNumber"
    | "scoutName"
    | "robotWeight"
    | "rookieTeam"
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

  const eventOptions = useMemo(() => getEventOptionsForEntries(normalized, selectedGame), [normalized, selectedGame]);

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
        case "rookieTeam":
          return entry.rookieTeam ? 1 : 0;
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
      "Rookie",
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
        typeof entry.rookieTeam === "boolean" ? (entry.rookieTeam ? "Y" : "N") : "-",
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
        const idxRookie = headers.findIndex((h) => h === "rookie");
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
            rookieTeam: toBoolean(get(idxRookie)),
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

  const effectiveEventOptions = [{ id: "all", name: "All Events" }, ...eventOptions];

  return (
    <HudCanvas>
      <CommandBar className="flex-wrap">
        <Chip label="Game" value={selectedGame.replace("_", " ")} tone="crimson" icon={Boxes} />
        <select
          className="!min-h-0 !rounded-full !border-amber-300/60 !bg-white/60 !py-1.5 !pl-4 !pr-8 text-xs font-bold uppercase tracking-wider text-slate-800"
          value={selectedGame}
          onChange={(event) => setSelectedGame(event.target.value as AnalyticsGame)}
        >
          <option value="REEFSCAPE">REEFSCAPE</option>
          <option value="REBUILT">REBUILT</option>
        </select>
        <select
          className="!min-h-0 max-w-40 !rounded-full !border-amber-300/60 !bg-white/60 !py-1.5 !pl-4 !pr-8 text-xs font-bold uppercase tracking-wider text-slate-800"
          value={selectedEvent}
          onChange={(event) => setSelectedEvent(event.target.value)}
        >
          {effectiveEventOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <Action
          variant={practiceMatchesOnly ? "danger" : "ghost"}
          onClick={() => setPracticeMatchesOnly((prev) => !prev)}
        >
          Practice
        </Action>
        {canViewScoutNames && (
          <Action variant={hideNames ? "danger" : "ghost"} onClick={() => setHideNames((prev) => !prev)}>
            <Users className="h-4 w-4" /> {hideNames ? "Names Hidden" : "Hide Names"}
          </Action>
        )}
        <Action variant={autoExpandNotes ? "secondary" : "ghost"} onClick={() => setAutoExpandNotes(!autoExpandNotes)}>
          <StickyNote className="h-4 w-4" /> Notes
        </Action>
      </CommandBar>

      <HudViewport>
        <PageIntro
          eyebrow="Pit Intelligence"
          title={
            <>
              Pit <span className="gradient-text">Analytics</span>
            </>
          }
          subtitle="Chassis, drivetrain, and cycle-capability breakdowns for every scouted robot, with frozen team/scout columns for fast comparison."
          actions={<Chip label="Entries" value={filtered.length} tone="gold" icon={Database} />}
        />

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Deck offset="sm:-translate-y-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Export</p>
            <p className="mt-2 text-sm text-slate-600">Download the currently filtered pit dataset as CSV.</p>
            <Action variant="secondary" onClick={exportToCSV} disabled title={csvDisabledReason} className="mt-4">
              Export CSV
            </Action>
          </Deck>
          <Deck offset="sm:translate-y-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Import</p>
            <p className="mt-2 text-sm text-slate-600">Bulk-load pit entries from a spreadsheet export.</p>
            <label className="mt-4 inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-full border border-white/70 bg-white/35 px-5 py-2.5 text-sm font-bold text-slate-500 opacity-60" title={csvDisabledReason}>
              Import CSV
              <input type="file" accept=".csv" onChange={handleImportFilePick} className="hidden" disabled />
            </label>
          </Deck>
        </div>

        {loading ? (
          <div className="mt-10">
            <LoadingSpinner message="Loading pit analytics..." />
          </div>
        ) : (
          <Deck className="mt-6 !p-0 overflow-hidden" priority="high">
            <div className="table-scroll h-[calc(100vh-320px)] min-h-[420px]">
              {selectedGame === "REBUILT" ? (
                <table>
                  <thead className="sticky-header">
                    <tr>
                      <GroupHeaderCell tone={0} colSpan={4}>
                        Information
                      </GroupHeaderCell>
                      <GroupHeaderCell tone={1} colSpan={3}>
                        Friendliness
                      </GroupHeaderCell>
                      <GroupHeaderCell tone={2} colSpan={3}>
                        Fuel
                      </GroupHeaderCell>
                      <GroupHeaderCell tone={3} colSpan={3}>
                        Climb
                      </GroupHeaderCell>
                      <GroupHeaderCell tone={4} colSpan={3}>
                        Cycles
                      </GroupHeaderCell>
                      <GroupHeaderCell tone={1} colSpan={canShowActions ? 2 : 1}>
                        General
                      </GroupHeaderCell>
                    </tr>
                    <tr>
                      <SortTh label="Team" active={sortKey === "teamNumber"} dir={sortDir} onClick={() => handleSort("teamNumber")} sticky="sticky-left-0" />
                      <SortTh label="Scout" active={sortKey === "scoutName"} dir={sortDir} onClick={() => handleSort("scoutName")} sticky="sticky-left-1" />
                      <SortTh label="Robot Weight" active={sortKey === "robotWeight"} dir={sortDir} onClick={() => handleSort("robotWeight")} />
                      <SortTh label="Rookie" active={sortKey === "rookieTeam"} dir={sortDir} onClick={() => handleSort("rookieTeam")} />
                      <SortTh label="Pit Disposition" active={sortKey === "pitDisposition"} dir={sortDir} onClick={() => handleSort("pitDisposition")} />
                      <SortTh label="Drive Disposition" active={sortKey === "driveDisposition"} dir={sortDir} onClick={() => handleSort("driveDisposition")} />
                      <SortTh label="Robot Picture" active={sortKey === "robotPictureUrl"} dir={sortDir} onClick={() => handleSort("robotPictureUrl")} />
                      <SortTh label="Preload" active={sortKey === "fuelPreloadCapacity"} dir={sortDir} onClick={() => handleSort("fuelPreloadCapacity")} />
                      <SortTh label="Balls/Sec" active={sortKey === "fuelBallsPerSecond"} dir={sortDir} onClick={() => handleSort("fuelBallsPerSecond")} />
                      <SortTh label="Carrying" active={sortKey === "fuelCarryingCapacity"} dir={sortDir} onClick={() => handleSort("fuelCarryingCapacity")} />
                      <SortTh label="Climb L1" active={sortKey === "climbLevel1"} dir={sortDir} onClick={() => handleSort("climbLevel1")} />
                      <SortTh label="Climb L2" active={sortKey === "climbLevel2"} dir={sortDir} onClick={() => handleSort("climbLevel2")} />
                      <SortTh label="Climb L3" active={sortKey === "climbLevel3"} dir={sortDir} onClick={() => handleSort("climbLevel3")} />
                      <SortTh label="Fuel Cycle Time" active={sortKey === "typicalFuelCycleTime"} dir={sortDir} onClick={() => handleSort("typicalFuelCycleTime")} />
                      <SortTh label="Climb Time" active={sortKey === "typicalClimbTime"} dir={sortDir} onClick={() => handleSort("typicalClimbTime")} />
                      <SortTh label="Auto Cycle" active={sortKey === "autoCycleDescription"} dir={sortDir} onClick={() => handleSort("autoCycleDescription")} />
                      <SortTh label="Comments" active={sortKey === "notes"} dir={sortDir} onClick={() => handleSort("notes")} />
                      {canShowActions && (
                        <SortTh label="Actions" active={sortKey === "id"} dir={sortDir} onClick={() => handleSort("id")} />
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((entry) => (
                      <tr key={entry.id} className={entry.excludeFromStats ? "line-through opacity-50" : ""}>
                        <td className="sticky-left-0 font-bold">{entry.teamNumber || "-"}</td>
                        <td className="sticky-left-1">{canViewScoutNames && !hideNames ? entry.scoutName || "-" : "-"}</td>
                        <td>{formatAnalyticsText(entry.robotWeight)}</td>
                        <td>{typeof entry.rookieTeam === "boolean" ? (entry.rookieTeam ? "Y" : "N") : "-"}</td>
                        <td>{dispositionToCell(entry.pitDisposition)}</td>
                        <td>{dispositionToCell(entry.driveDisposition)}</td>
                        <td>{entry.robotPictureUrl ? "Yes" : "No"}</td>
                        <td>{fuelScaleDisplay(entry.fuelPreloadCapacity)}</td>
                        <td>{fuelScaleDisplay(entry.fuelBallsPerSecond)}</td>
                        <td>{fuelScaleDisplay(entry.fuelCarryingCapacity)}</td>
                        <td>{entry.climbLevel1 ? "Y" : "N"}</td>
                        <td>{entry.climbLevel2 ? "Y" : "N"}</td>
                        <td>{entry.climbLevel3 ? "Y" : "N"}</td>
                        <td>{formatAnalyticsText(entry.typicalFuelCycleTime)}</td>
                        <td>{formatAnalyticsText(entry.typicalClimbTime)}</td>
                        <td>{formatAnalyticsText(entry.autoCycleDescription)}</td>
                        <td>
                          <ExpandableNotesCell text={entry.notes} className="text-left align-top" />
                        </td>
                        {canShowActions && (
                          <td>
                            <div className="flex items-center justify-center gap-2">
                              {canManageConfig && (
                                <button
                                  type="button"
                                  onClick={() => setConfigEntry(entry)}
                                  className="rounded-full border border-amber-300/60 bg-white/60 px-2 py-1 text-[11px] font-bold text-amber-950"
                                >
                                  Config
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => void handleDeleteEntry(entry)}
                                disabled={!canDeleteEntries}
                                title={canDeleteEntries ? undefined : "Only coaches or team admins can delete entries."}
                                className="rounded-full border border-red-800/50 bg-red-800/90 px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50"
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
                      <GroupHeaderCell tone={0} colSpan={4}>
                        Information
                      </GroupHeaderCell>
                      <GroupHeaderCell tone={1} colSpan={3}>
                        Friendliness
                      </GroupHeaderCell>
                      <GroupHeaderCell tone={2} colSpan={2}>
                        Drive
                      </GroupHeaderCell>
                      <GroupHeaderCell tone={3} colSpan={2}>
                        Coral
                      </GroupHeaderCell>
                      <GroupHeaderCell tone={4} colSpan={2}>
                        Algae
                      </GroupHeaderCell>
                      <GroupHeaderCell tone={2} colSpan={4}>
                        Field Plan
                      </GroupHeaderCell>
                      <GroupHeaderCell tone={1} colSpan={canShowActions ? 3 : 2}>
                        General
                      </GroupHeaderCell>
                    </tr>
                    <tr>
                      <SortTh label="Team" active={sortKey === "teamNumber"} dir={sortDir} onClick={() => handleSort("teamNumber")} sticky="sticky-left-0" />
                      <SortTh label="Scout" active={sortKey === "scoutName"} dir={sortDir} onClick={() => handleSort("scoutName")} sticky="sticky-left-1" />
                      <SortTh label="Robot Weight" active={sortKey === "robotWeight"} dir={sortDir} onClick={() => handleSort("robotWeight")} />
                      <SortTh label="Rookie" active={sortKey === "rookieTeam"} dir={sortDir} onClick={() => handleSort("rookieTeam")} />
                      <SortTh label="Robot Picture" active={sortKey === "robotPictureUrl"} dir={sortDir} onClick={() => handleSort("robotPictureUrl")} />
                      <SortTh label="Pit Disposition" active={sortKey === "pitDisposition"} dir={sortDir} onClick={() => handleSort("pitDisposition")} />
                      <SortTh label="Drive Disposition" active={sortKey === "driveDisposition"} dir={sortDir} onClick={() => handleSort("driveDisposition")} />
                      <SortTh label="Drive Base" active={sortKey === "driveBaseType"} dir={sortDir} onClick={() => handleSort("driveBaseType")} />
                      <SortTh label="Center of Gravity" active={sortKey === "centerOfGravity"} dir={sortDir} onClick={() => handleSort("centerOfGravity")} />
                      <SortTh label="Coral Collecting" active={sortKey === "coralCollecting"} dir={sortDir} onClick={() => handleSort("coralCollecting")} />
                      <SortTh label="Coral Scoring" active={sortKey === "coralScoring"} dir={sortDir} onClick={() => handleSort("coralScoring")} />
                      <SortTh label="Algae Collecting" active={sortKey === "algaeCollecting"} dir={sortDir} onClick={() => handleSort("algaeCollecting")} />
                      <SortTh label="Algae Scoring" active={sortKey === "algaeScoring"} dir={sortDir} onClick={() => handleSort("algaeScoring")} />
                      <SortTh label="Barge" active={sortKey === "bargeCapability"} dir={sortDir} onClick={() => handleSort("bargeCapability")} />
                      <SortTh label="Auto" active={sortKey === "autoCapabilities"} dir={sortDir} onClick={() => handleSort("autoCapabilities")} />
                      <SortTh label="Starting Positions" active={sortKey === "startingPositions"} dir={sortDir} onClick={() => handleSort("startingPositions")} />
                      <SortTh label="Better At" active={sortKey === "betterAt"} dir={sortDir} onClick={() => handleSort("betterAt")} />
                      <SortTh label="Rating" active={sortKey === "rating"} dir={sortDir} onClick={() => handleSort("rating")} />
                      <SortTh label="Comments" active={sortKey === "notes"} dir={sortDir} onClick={() => handleSort("notes")} />
                      {canShowActions && (
                        <SortTh label="Actions" active={sortKey === "id"} dir={sortDir} onClick={() => handleSort("id")} />
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((entry) => (
                      <tr key={entry.id} className={entry.excludeFromStats ? "line-through opacity-50" : ""}>
                        <td className="sticky-left-0 font-bold">{entry.teamNumber || "-"}</td>
                        <td className="sticky-left-1">{canViewScoutNames && !hideNames ? entry.scoutName || "-" : "-"}</td>
                        <td>{formatAnalyticsText(entry.robotWeight)}</td>
                        <td>{typeof entry.rookieTeam === "boolean" ? (entry.rookieTeam ? "Y" : "N") : "-"}</td>
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
                        <td>
                          <ExpandableNotesCell text={entry.notes} className="text-left align-top" />
                        </td>
                        {canShowActions && (
                          <td>
                            <div className="flex items-center justify-center gap-2">
                              {canManageConfig && (
                                <button
                                  type="button"
                                  onClick={() => setConfigEntry(entry)}
                                  className="rounded-full border border-amber-300/60 bg-white/60 px-2 py-1 text-[11px] font-bold text-amber-950"
                                >
                                  Config
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => void handleDeleteEntry(entry)}
                                disabled={!canDeleteEntries}
                                title={canDeleteEntries ? undefined : "Only coaches or team admins can delete entries."}
                                className="rounded-full border border-red-800/50 bg-red-800/90 px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50"
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
          </Deck>
        )}
      </HudViewport>

      {showImportDialog && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/25 backdrop-blur-md" onClick={() => (!importing ? setShowImportDialog(false) : null)} />
          <Surface raised className="relative w-full max-w-md p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-2xl text-slate-950">Import CSV</h2>
              <button
                type="button"
                onClick={() => setShowImportDialog(false)}
                disabled={importing}
                className="rounded-full border border-white/70 bg-white/50 p-2 text-slate-700 disabled:opacity-50"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <p className="mb-4 text-sm text-slate-600">Choose the game and event for this import.</p>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Game</label>
                <select
                  value={importGame}
                  onChange={(event) => {
                    const next = event.target.value as AnalyticsGame;
                    setImportGame(next);
                    setImportEvent(getEventsForGame(next)[0]?.id || "app-testing");
                  }}
                  className="w-full"
                >
                  <option value="REEFSCAPE">REEFSCAPE</option>
                  <option value="REBUILT">REBUILT</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Event</label>
                <select value={importEvent} onChange={(event) => setImportEvent(event.target.value)} className="w-full">
                  {importEventOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <Action onClick={runCSVImport} disabled={importing} className="flex-1 justify-center">
                {importing ? "Importing..." : "Import"}
              </Action>
              <Action
                variant="ghost"
                onClick={() => {
                  setShowImportDialog(false);
                  setPendingImportFile(null);
                }}
                disabled={importing}
                className="flex-1 justify-center"
              >
                Cancel
              </Action>
            </div>
          </Surface>
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
    </HudCanvas>
  );
}

export default function PitAnalyticsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <AnalyticsNotesProvider>
        <PitAnalyticsContent />
      </AnalyticsNotesProvider>
    </ProtectedRoute>
  );
}
