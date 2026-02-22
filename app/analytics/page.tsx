"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import { useAuth } from "@/app/AuthContext";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import {
  entryMatchesAnalyticsFilters,
  getExplicitMatchTypeFromLabel,
  getEventOptionsForEntries,
  getEventsForGame,
  isPracticeScoutedEntry,
  normalizeMatchLabel,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";
import { getEventMatches } from "@/app/utils/tba-api";

type Entry = {
  id: string;
  matchNumber?: string;
  matchType?: "qualification" | "practice" | "finals";
  matchId?: string;
  scoutId?: string;
  practiceMode?: "trial" | "competitive";
  isPracticeScouting?: boolean;
  practiceSessionId?: string;
  eventKey?: string;
  eventName?: string;
  game?: string;
  penaltyPoints?: number;
  alliance?: string;
  allianceColor?: string;
  assignedAlliance?: string;
  officialScore?: number;
  actualScore?: number;
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
  s += Number(e.penaltyPoints || 0);
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

function isPracticeScoutingEntry(entry: Entry) {
  return isPracticeScoutedEntry(entry);
}

function isEntryBlank(entry: Entry) {
  const numbers = [
    entry.autoCoralMissed,
    entry.autoCoralL1,
    entry.autoCoralL2,
    entry.autoCoralL3,
    entry.autoCoralL4,
    entry.autoAlgaeProcessorMissed,
    entry.autoAlgaeProcessorScored,
    entry.autoAlgaeNetMissed,
    entry.autoAlgaeNetScored,
    entry.teleopCoralMissed,
    entry.teleopCoralL1,
    entry.teleopCoralL2,
    entry.teleopCoralL3,
    entry.teleopCoralL4,
    entry.teleopProcessorMissed,
    entry.teleopProcessorScored,
    entry.teleopNetRobotMissed,
    entry.teleopNetRobotScored,
    entry.teleopNetHumanMissed,
    entry.teleopNetHumanScored,
    entry.failedClimb,
  ];
  const hasAnyNumbers = numbers.some((value) => Number(value || 0) > 0);
  return (
    !String(entry.teamNumber || "").trim() &&
    !String(entry.scoutName || "").trim() &&
    !String(entry.startingPosition || "").trim() &&
    !String(entry.stageStatus || "").trim() &&
    !String(entry.notes || "").trim() &&
    (!entry.incidents || entry.incidents.length === 0) &&
    !entry.leftStartingZone &&
    !entry.teleopAlgaeRemoved &&
    !hasAnyNumbers
  );
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function splitCsvRecords(text: string): string[] {
  const records: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i += 1;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (current.trim()) records.push(current);
      current = "";
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      continue;
    }
    current += ch;
  }

  if (current.trim()) records.push(current);
  return records;
}

function normalizeHeader(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseAccuracyPercent(value: string): number | undefined {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  const direct = Number(raw);
  if (Number.isFinite(direct)) return Math.round(direct);
  const percentMatch = raw.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percentMatch) return Math.round(Number(percentMatch[1]));
  const fallback = raw.match(/(\d+(?:\.\d+)?)/);
  if (fallback) return Math.round(Number(fallback[1]));
  return undefined;
}

type SortKey = keyof Entry | "score";
type SortDir = "asc" | "desc";

function AnalyticsPageContent() {
  const { userData } = useAuth();
  const isCoach = userData?.role === "coach";
  const isTeamAdmin = Boolean(userData?.isTeamAdmin);
  const isTeamMember = Boolean(userData?.teamId);
  const canImportCsv = isCoach || isTeamAdmin;
  const canExportCsv = isTeamMember;
  const canCleanBlankRows = isCoach || isTeamAdmin;
  const canDeleteEntries = isCoach || isTeamAdmin;
  const [rawData, setRawData] = useState<Entry[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("matchNumber");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>(() => {
    if (typeof window === "undefined") return "REEFSCAPE";
    const saved = localStorage.getItem("analytics-selected-game");
    return saved === "REEFSCAPE" || saved === "REBUILT" ? saved : "REEFSCAPE";
  });
  const [selectedEvent, setSelectedEvent] = useState(() => {
    if (typeof window === "undefined") return "all";
    return localStorage.getItem("analytics-selected-event") || "all";
  });
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importMatchMode, setImportMatchMode] = useState<"official" | "practice-scouted">("official");
  const [importing, setImporting] = useState(false);
  const [cleaningBlankRows, setCleaningBlankRows] = useState(false);
  const [importGame, setImportGame] = useState<AnalyticsGame>(() => {
    if (typeof window === "undefined") return "REEFSCAPE";
    const saved = localStorage.getItem("analytics-selected-game");
    return saved === "REEFSCAPE" || saved === "REBUILT" ? saved : "REEFSCAPE";
  });
  const [importEvent, setImportEvent] = useState("app-testing");
  const [selectedAccuracyEntry, setSelectedAccuracyEntry] = useState<Entry | null>(null);
  const [accuracyModalLoading, setAccuracyModalLoading] = useState(false);
  const [allRobotsScoutedByApi, setAllRobotsScoutedByApi] = useState<"yes" | "no" | "unknown">("unknown");

  const eventOptions = useMemo(
    () => [{ id: "all", name: "All Events" }, ...getEventOptionsForEntries(rawData, selectedGame)],
    [rawData, selectedGame]
  );
  const importEventOptions = useMemo(() => getEventsForGame(importGame), [importGame]);

  useEffect(() => {
    const savedPractice = localStorage.getItem("analytics-practice-matches-only");
    if (savedPractice !== null) {
      setPracticeMatchesOnly(savedPractice === "true");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("analytics-selected-game", selectedGame);
    localStorage.setItem("analytics-selected-event", selectedEvent);
    localStorage.setItem("analytics-practice-matches-only", String(practiceMatchesOnly));
  }, [selectedGame, selectedEvent, practiceMatchesOnly]);

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
    return rawData.filter((entry) => {
      if (!entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent)) return false;
      if (practiceMatchesOnly) return isPracticeScoutingEntry(entry);
      return !isPracticeScoutingEntry(entry);
    });
  }, [rawData, selectedEvent, selectedGame, practiceMatchesOnly]);

  const data = useMemo(() => {
    const withScore = filtered.map((entry) => ({ ...entry, score: scoreEntry(entry) }));
    return withScore.sort((a, b) => {
      if (sortKey === "matchNumber") {
        const eventDiff = String(a.eventName || a.eventKey || "").localeCompare(String(b.eventName || b.eventKey || ""));
        if (eventDiff !== 0) return sortDir === "asc" ? eventDiff : -eventDiff;
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

  async function handleDeleteEntry(entry: Entry) {
    if (!canDeleteEntries) {
      alert("Only coaches or team admins can delete entries.");
      return;
    }
    const sessionId = String(entry.practiceSessionId || "").trim();
    const isPracticeEntry = isPracticeScoutingEntry(entry);

    if (isPracticeEntry && sessionId) {
      const ok = window.confirm(
        "Delete this entire practice session? This will remove all scouting rows tied to this session."
      );
      if (!ok) return;

      const relatedEntriesSnap = await getDocs(
        query(collection(db, "scouting"), where("practiceSessionId", "==", sessionId))
      );
      const deleteOps = relatedEntriesSnap.docs.map((docSnap) => deleteDoc(doc(db, "scouting", docSnap.id)));
      deleteOps.push(deleteDoc(doc(db, "practiceSessions", sessionId)));
      await Promise.all(deleteOps);
      await loadData();
      return;
    }

    const ok = window.confirm("Delete this scouting entry?");
    if (!ok) return;
    await deleteDoc(doc(db, "scouting", entry.id));
    await loadData();
  }

  async function loadAccuracyDetails(entry: Entry) {
    setAccuracyModalLoading(true);
    setAllRobotsScoutedByApi("unknown");
    try {
      const eventKey = String(entry.eventKey || "").trim();
      const matchType = String(entry.matchType || "").toLowerCase();
      const matchNumber = Number(String(entry.matchNumber || "").replace(/\D/g, ""));
      if (!eventKey || !matchNumber || !["practice", "qualification", "finals"].includes(matchType)) {
        setAllRobotsScoutedByApi("unknown");
        return;
      }
      const compLevel = matchType === "qualification" || matchType === "practice" ? "qm" : "f";
      const matches = await getEventMatches(eventKey);
      const match = matches.find((row) => row.comp_level === compLevel && row.match_number === matchNumber);
      if (!match) {
        setAllRobotsScoutedByApi("unknown");
        return;
      }
      const officialTeams = [...match.alliances.red.team_keys, ...match.alliances.blue.team_keys]
        .map((key) => key.replace("frc", "").trim())
        .filter(Boolean);
      const scoutedTeams = new Set(
        rawData
          .filter((row) => String(row.eventKey || "") === eventKey)
          .filter((row) => String(row.matchType || "").toLowerCase() === matchType)
          .filter((row) => Number(String(row.matchNumber || "").replace(/\D/g, "")) === matchNumber)
          .map((row) => String(row.teamNumber || "").trim())
          .filter(Boolean)
      );
      setAllRobotsScoutedByApi(officialTeams.every((team) => scoutedTeams.has(team)) ? "yes" : "no");
    } catch (error) {
      console.error("Failed to load alliance robot details:", error);
      setAllRobotsScoutedByApi("unknown");
    } finally {
      setAccuracyModalLoading(false);
    }
  }

  async function handleCleanBlankEntries() {
    if (!canCleanBlankRows) {
      alert("Only coaches or team admins can clean blank rows.");
      return;
    }
    const blankRows = rawData.filter((entry) => isEntryBlank(entry));
    if (blankRows.length === 0) {
      alert("No blank rows found.");
      return;
    }
    const ok = window.confirm(`Delete ${blankRows.length} blank rows?`);
    if (!ok) return;
    setCleaningBlankRows(true);
    try {
      await Promise.all(blankRows.map((entry) => deleteDoc(doc(db, "scouting", entry.id))));
      await loadData();
      alert(`Deleted ${blankRows.length} blank rows.`);
    } finally {
      setCleaningBlankRows(false);
    }
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
    const headers = [
      "Match",
      "Team",
      "Scout",
      "Starting Position",
      "Leave",
      "Auto Coral Missed",
      "Auto Coral L1",
      "Auto Coral L2",
      "Auto Coral L3",
      "Auto Coral L4",
      "Auto Algae Processor Missed",
      "Auto Algae Processor Scored",
      "Auto Algae Net Missed",
      "Auto Algae Net Scored",
      "Tele Coral Missed",
      "Tele Coral L1",
      "Tele Coral L2",
      "Tele Coral L3",
      "Tele Coral L4",
      "Remove Algae from Reef",
      "Tele Processor Missed",
      "Tele Processor Scored",
      "Tele Net Robot Missed",
      "Tele Net Robot Scored",
      "Tele Net Human Missed",
      "Tele Net Human Scored",
      "Climb Failed",
      "End Place",
      "Miscellaneous",
      "Comments",
      "Alliance Accuracy",
      "Script Status",
    ];
    const rows = filtered.map((entry) => [
      matchLabel(entry),
      entry.teamNumber || "",
      entry.scoutName || "",
      entry.startingPosition || "",
      entry.leftStartingZone ? "1" : "0",
      entry.autoCoralMissed || 0,
      entry.autoCoralL1 || 0,
      entry.autoCoralL2 || 0,
      entry.autoCoralL3 || 0,
      entry.autoCoralL4 || 0,
      entry.autoAlgaeProcessorMissed || 0,
      entry.autoAlgaeProcessorScored || 0,
      entry.autoAlgaeNetMissed || 0,
      entry.autoAlgaeNetScored || 0,
      entry.teleopCoralMissed || 0,
      entry.teleopCoralL1 || 0,
      entry.teleopCoralL2 || 0,
      entry.teleopCoralL3 || 0,
      entry.teleopCoralL4 || 0,
      entry.teleopAlgaeRemoved ? "1" : "0",
      entry.teleopProcessorMissed || 0,
      entry.teleopProcessorScored || 0,
      entry.teleopNetRobotMissed || 0,
      entry.teleopNetRobotScored || 0,
      entry.teleopNetHumanMissed || 0,
      entry.teleopNetHumanScored || 0,
      entry.failedClimb || 0,
      entry.stageStatus || "",
      (entry.incidents || []).join(";"),
      (entry.notes || "").replace(/,/g, ";"),
      typeof (entry as Entry & { accuracy?: number }).accuracy === "number"
        ? (entry as Entry & { accuracy?: number }).accuracy
        : "",
      typeof (entry as Entry & { accuracy?: number }).accuracy === "number" ? "Complete" : "",
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
    if (!canImportCsv) {
      alert("Only coaches or team admins can import CSV files.");
      event.target.value = "";
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;
    setPendingImportFile(file);
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
        const text = loadEvent.target?.result as string;
        const lines = splitCsvRecords(text);
        if (lines.length < 2) {
          throw new Error("CSV has no data rows.");
        }
        const findHeaderRowIndex = () => {
          for (let row = 0; row < Math.min(lines.length, 8); row += 1) {
            const cells = parseCsvLine(lines[row]).map(normalizeHeader);
            if (
              cells.includes("match") &&
              (cells.includes("team") || cells.includes("teamnumber")) &&
              cells.includes("scout")
            ) {
              return row;
            }
          }
          return 0;
        };
        const headerRowIndex = findHeaderRowIndex();
        const headers = parseCsvLine(lines[headerRowIndex]).map(normalizeHeader);
        const column = (aliases: string[], fallbackIndex: number) => {
          for (const alias of aliases) {
            const idx = headers.indexOf(normalizeHeader(alias));
            if (idx >= 0) return idx;
          }
          return fallbackIndex;
        };
        const idxMatch = column(["match"], 0);
        const idxTeam = column(["team"], 1);
        const idxScout = column(["scout"], 2);
        const idxStartingPos = column(["startingposition"], 3);
        const idxLeave = column(["leave"], 4);
        const idxAutoCoralMissed = column(["autocoralmissed"], 5);
        const idxAutoCoralL1 = column(["autocorall1"], 6);
        const idxAutoCoralL2 = column(["autocorall2"], 7);
        const idxAutoCoralL3 = column(["autocorall3"], 8);
        const idxAutoCoralL4 = column(["autocorall4"], 9);
        const idxAutoAlgaeProcMissed = column(["autoalgaeprocessormissed"], 10);
        const idxAutoAlgaeProcScored = column(["autoalgaeprocessorscored"], 11);
        const idxAutoAlgaeNetMissed = column(["autoalgaenetmissed"], 12);
        const idxAutoAlgaeNetScored = column(["autoalgaenetscored"], 13);
        const idxTeleCoralMissed = column(["telecoralmissed"], 14);
        const idxTeleCoralL1 = column(["telecorall1"], 15);
        const idxTeleCoralL2 = column(["telecorall2"], 16);
        const idxTeleCoralL3 = column(["telecorall3"], 17);
        const idxTeleCoralL4 = column(["telecorall4"], 18);
        const idxRemovedReef = column(["removealgaefromreef", "removedreef"], 19);
        const idxTeleProcMissed = column(["teleprocessormissed"], 20);
        const idxTeleProcScored = column(["teleprocessorscored"], 21);
        const idxTeleNetRobotMissed = column(["telenetrobotmissed"], 22);
        const idxTeleNetRobotScored = column(["telenetrobotscored"], 23);
        const idxTeleNetHumanMissed = column(["telenethumanmissed"], 24);
        const idxTeleNetHumanScored = column(["telenethumanscored"], 25);
        const idxFailedClimb = column(["climbfailed", "failed"], 26);
        const idxEndPlace = column(["endplace", "stagestatus"], 27);
        const idxIncidents = column(["miscellaneous", "incidents"], 28);
        const idxComments = column(["comments", "notes"], 29);
        const idxAccuracy = column(["allianceaccuracy", "accuracy"], 30);

        const startDataRow = Math.max(headerRowIndex + 1, 3);
        let imported = 0;
        let skipped = 0;
        type CandidateRow = {
          values: string[];
          matchRaw: string;
          parsedMatch: ReturnType<typeof normalizeMatchLabel>;
          explicitType: ReturnType<typeof getExplicitMatchTypeFromLabel>;
          numericOnly: boolean;
        };
        const candidates: CandidateRow[] = [];
        for (let i = startDataRow; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const values = parseCsvLine(lines[i]);
          const matchRaw = (values[idxMatch] || "").trim();
          const teamRaw = (values[idxTeam] || "").trim();
          const scoutRaw = (values[idxScout] || "").trim();
          const startRaw = (values[idxStartingPos] || "").trim();
          const rowSignals = [matchRaw, teamRaw, scoutRaw, startRaw].map(normalizeHeader);
          const looksLikeHeaderRow =
            rowSignals.includes("match") ||
            rowSignals.includes("team") ||
            rowSignals.includes("scout") ||
            rowSignals.includes("startingposition") ||
            rowSignals.includes("information") ||
            rowSignals.includes("prematch") ||
            rowSignals.includes("autonomous") ||
            rowSignals.includes("teleop") ||
            rowSignals.includes("endgame") ||
            rowSignals.includes("general") ||
            rowSignals.includes("actions");
          const numericCells = [
            idxAutoCoralMissed,
            idxAutoCoralL1,
            idxAutoCoralL2,
            idxAutoCoralL3,
            idxAutoCoralL4,
            idxAutoAlgaeProcMissed,
            idxAutoAlgaeProcScored,
            idxAutoAlgaeNetMissed,
            idxAutoAlgaeNetScored,
            idxTeleCoralMissed,
            idxTeleCoralL1,
            idxTeleCoralL2,
            idxTeleCoralL3,
            idxTeleCoralL4,
            idxTeleProcMissed,
            idxTeleProcScored,
            idxTeleNetRobotMissed,
            idxTeleNetRobotScored,
            idxTeleNetHumanMissed,
            idxTeleNetHumanScored,
            idxFailedClimb,
          ];
          const hasNumericData = numericCells.some((idx) => Number(values[idx] || 0) > 0);
          const hasTextData =
            Boolean(scoutRaw) ||
            Boolean(startRaw) ||
            Boolean((values[idxComments] || "").trim()) ||
            Boolean((values[idxIncidents] || "").trim()) ||
            Boolean((values[idxEndPlace] || "").trim());
          const hasMatchSignal = /\d/.test(matchRaw) || /(practice|final|upper|lower|ub|lb|qual|qm|round)/i.test(matchRaw);
          const hasCoreIds = hasMatchSignal && /\d/.test(teamRaw);
          if (looksLikeHeaderRow || !hasCoreIds || (!hasNumericData && !hasTextData)) {
            skipped += 1;
            continue;
          }

          const parsedMatch = normalizeMatchLabel(matchRaw);
          candidates.push({
            values,
            matchRaw,
            parsedMatch,
            explicitType: getExplicitMatchTypeFromLabel(matchRaw),
            numericOnly: /^\d+$/.test(matchRaw.replace(/\s+/g, "")),
          });
        }

        const explicitByMatchNumber = new Map<string, Record<"practice" | "qualification" | "finals", number>>();
        for (const candidate of candidates) {
          if (!candidate.explicitType) continue;
          const key = candidate.parsedMatch.matchNumber || "1";
          const counts = explicitByMatchNumber.get(key) || { practice: 0, qualification: 0, finals: 0 };
          counts[candidate.explicitType] += 1;
          explicitByMatchNumber.set(key, counts);
        }

        const inferContextType = (index: number): "practice" | "qualification" | "finals" => {
          const row = candidates[index];
          if (row.explicitType) return row.explicitType;

          const sameNumberCounts = explicitByMatchNumber.get(row.parsedMatch.matchNumber || "1");
          if (sameNumberCounts) {
            const ranked = (Object.entries(sameNumberCounts) as Array<["practice" | "qualification" | "finals", number]>)
              .sort((a, b) => b[1] - a[1]);
            if (ranked[0]?.[1] > 0 && ranked[0]?.[1] > (ranked[1]?.[1] || 0)) {
              return ranked[0][0];
            }
          }

          let prev: { type: "practice" | "qualification" | "finals"; dist: number } | null = null;
          for (let p = index - 1; p >= 0; p -= 1) {
            const type = candidates[p].explicitType;
            if (type) {
              prev = { type, dist: index - p };
              break;
            }
          }

          let next: { type: "practice" | "qualification" | "finals"; dist: number } | null = null;
          for (let n = index + 1; n < candidates.length; n += 1) {
            const type = candidates[n].explicitType;
            if (type) {
              next = { type, dist: n - index };
              break;
            }
          }

          if (prev && next) {
            if (prev.type === next.type) return prev.type;
            if (prev.dist < next.dist) return prev.type;
            if (next.dist < prev.dist) return next.type;
            return row.parsedMatch.matchType;
          }
          if (prev) return prev.type;
          if (next) return next.type;
          return row.parsedMatch.matchType;
        };

        for (let i = 0; i < candidates.length; i += 1) {
          const candidate = candidates[i];
          const values = candidate.values;
          const parsedMatch = candidate.parsedMatch;
          const importedMatchType = inferContextType(i);
          const matchId = `${importedMatchType === "practice" ? "p" : importedMatchType === "finals" ? "f" : "q"}${parsedMatch.matchNumber}`;
          const now = Date.now();
          const parseNum = (value: string, fallback = 0) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : fallback;
          };
          const parseBool = (value: string) => value === "1" || /^y(es)?$/i.test(value) || /^true$/i.test(value);
          const parsedAccuracy = parseAccuracyPercent(values[idxAccuracy] || "");
          await addDoc(collection(db, "scouting"), {
            matchId,
            matchNumber: parsedMatch.matchNumber,
            matchType: importedMatchType,
            teamNumber: values[idxTeam] || "",
            scoutName: values[idxScout] || "",
            startingPosition: values[idxStartingPos] || "",
            leftStartingZone: parseBool(values[idxLeave] || ""),
            autoCoralMissed: parseNum(values[idxAutoCoralMissed]),
            autoCoralL1: parseNum(values[idxAutoCoralL1]),
            autoCoralL2: parseNum(values[idxAutoCoralL2]),
            autoCoralL3: parseNum(values[idxAutoCoralL3]),
            autoCoralL4: parseNum(values[idxAutoCoralL4]),
            autoAlgaeProcessorMissed: parseNum(values[idxAutoAlgaeProcMissed]),
            autoAlgaeProcessorScored: parseNum(values[idxAutoAlgaeProcScored]),
            autoAlgaeNetMissed: parseNum(values[idxAutoAlgaeNetMissed]),
            autoAlgaeNetScored: parseNum(values[idxAutoAlgaeNetScored]),
            teleopCoralMissed: parseNum(values[idxTeleCoralMissed]),
            teleopCoralL1: parseNum(values[idxTeleCoralL1]),
            teleopCoralL2: parseNum(values[idxTeleCoralL2]),
            teleopCoralL3: parseNum(values[idxTeleCoralL3]),
            teleopCoralL4: parseNum(values[idxTeleCoralL4]),
            teleopAlgaeRemoved: parseBool(values[idxRemovedReef] || ""),
            teleopProcessorMissed: parseNum(values[idxTeleProcMissed]),
            teleopProcessorScored: parseNum(values[idxTeleProcScored]),
            teleopNetRobotMissed: parseNum(values[idxTeleNetRobotMissed]),
            teleopNetRobotScored: parseNum(values[idxTeleNetRobotScored]),
            teleopNetHumanMissed: parseNum(values[idxTeleNetHumanMissed]),
            teleopNetHumanScored: parseNum(values[idxTeleNetHumanScored]),
            failedClimb: parseNum(values[idxFailedClimb]),
            stageStatus: values[idxEndPlace] || "",
            incidents: (values[idxIncidents] || "").split(";").map((item) => item.trim()).filter(Boolean),
            notes: values[idxComments] || "",
            ...(typeof parsedAccuracy === "number" ? { accuracy: parsedAccuracy } : {}),
            ...(importMatchMode === "practice-scouted" ? { isPracticeScouting: true, practiceMode: "trial" } : {}),
            eventKey: importEvent,
            eventName: importEventOptions.find((option) => option.id === importEvent)?.name || "App Testing",
            game: importGame,
            timestamp: now,
            submittedAt: now,
          });
          imported += 1;
        }
        alert(`Successfully imported ${imported} entries${skipped ? ` (${skipped} rows skipped)` : ""}`);
        await loadData();
        setShowImportDialog(false);
        setPendingImportFile(null);
      } catch (error) {
        console.error("Import failed:", error);
        const message = error instanceof Error ? error.message : "Unknown error";
        alert(`Error importing CSV: ${message}`);
      } finally {
        setImporting(false);
      }
    };
    reader.readAsText(pendingImportFile);
  }

  return (
    <AnalyticsShell
      entriesCount={data.length}
      selectedGame={selectedGame}
      onSelectedGameChange={(game) => handleGameChange(game as AnalyticsGame)}
      practiceMatchesOnly={practiceMatchesOnly}
      onPracticeMatchesOnlyChange={setPracticeMatchesOnly}
      selectedEvent={selectedEvent}
      eventOptions={eventOptions}
      onSelectedEventChange={setSelectedEvent}
    >
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
          Import CSV
          <input type="file" accept=".csv" onChange={handleImportFilePick} className="hidden" disabled={!canImportCsv} />
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Import As</label>
                <select
                  value={importMatchMode}
                  onChange={(event) => setImportMatchMode(event.target.value as "official" | "practice-scouted")}
                  className="w-full border rounded p-2"
                >
                  <option value="official">Official (Practice/Qualification/Finals)</option>
                  <option value="practice-scouted">Practice Scouted Matches</option>
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

      <div className="bg-white rounded-xl shadow h-[calc(100vh-270px)] table-scroll overflow-x-auto">
        <table>
          <thead className="sticky-header">
            <tr>
              <th className="sticky-left-group bg-red-300 text-center" colSpan={2}>Information</th>
              <th className="bg-yellow-300 text-center" colSpan={2}>Pre-Match</th>
              <th className="bg-green-300 text-center" colSpan={10}>Autonomous</th>
              <th className="bg-blue-300 text-center" colSpan={13}>Teleoperated</th>
              <th className="bg-purple-300 text-center" colSpan={2}>Endgame</th>
              <th className="bg-pink-300 text-center" colSpan={4}>General</th>
            </tr>
            <tr>
              <th className="sticky-left-group bg-red-200 text-center" colSpan={2}>Information</th>
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
              <th className="bg-pink-200 text-center" colSpan={2}>Comments</th>
              <th className="bg-pink-200 text-center" colSpan={1}>Accuracy Script</th>
              <th className="bg-pink-200 text-center" colSpan={1}>Script Status</th>
              <th className="bg-gray-200 text-center" colSpan={1}>Actions</th>
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
              <th className="text-center">Miscellaneous</th>
              <th className="text-center" style={{ minWidth: "260px" }}>Comments</th>
              <th className="text-center">Alliance Accuracy</th>
              <th className="text-center">Script Status</th>
              <th className="text-center">Delete</th>
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
                <td className="text-left align-top" style={{ minWidth: "260px", whiteSpace: "normal", overflowWrap: "anywhere" }}>
                  {entry.notes || "-"}
                </td>
                <td className="text-center">
                  {typeof (entry as Entry & { accuracy?: number }).accuracy === "number" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAccuracyEntry(entry);
                        void loadAccuracyDetails(entry);
                      }}
                      className="underline decoration-dotted underline-offset-2"
                      style={{ color: "var(--primary-color)" }}
                    >
                      {`${Math.round((entry as Entry & { accuracy?: number }).accuracy || 0)}%`}
                    </button>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="text-center">{typeof (entry as Entry & { accuracy?: number }).accuracy === "number" ? "Complete" : "-"}</td>
                <td className="text-center">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedAccuracyEntry && (
        <div className="fixed inset-0 bg-black/45 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-semibold mb-3">Alliance Accuracy Details</h2>
            {(() => {
              const scoutedPoints = scoreEntry(selectedAccuracyEntry);
              const accuracy = Number((selectedAccuracyEntry as Entry & { accuracy?: number }).accuracy || 0);
              const explicitActual =
                typeof selectedAccuracyEntry.officialScore === "number"
                  ? selectedAccuracyEntry.officialScore
                  : typeof selectedAccuracyEntry.actualScore === "number"
                  ? selectedAccuracyEntry.actualScore
                  : null;
              const inferredActual =
                explicitActual !== null
                  ? explicitActual
                  : accuracy > 0
                  ? Math.round(scoutedPoints / (accuracy / 100))
                  : null;
              return (
                <div className="space-y-2 text-sm">
                  <p><span className="font-semibold">Scouted Points:</span> {scoutedPoints}</p>
                  <p><span className="font-semibold">Actual Points:</span> {inferredActual ?? "Unavailable"}</p>
                  <p>
                    <span className="font-semibold">All Robots Scouted:</span>{" "}
                    {accuracyModalLoading ? "Checking..." : allRobotsScoutedByApi === "yes" ? "Yes" : allRobotsScoutedByApi === "no" ? "No" : "Unknown"}
                  </p>
                  <p><span className="font-semibold">Penalty Points:</span> {Number(selectedAccuracyEntry.penaltyPoints || 0)}</p>
                </div>
              );
            })()}
            <div className="mt-5">
              <button
                onClick={() => setSelectedAccuracyEntry(null)}
                className="w-full py-2 rounded text-white font-semibold"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
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
