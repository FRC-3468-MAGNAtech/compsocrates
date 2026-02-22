"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, where } from "firebase/firestore";
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
  estimatedScore?: number;
  auto?: {
    preloadScale?: number;
    bpsScale?: number;
    carryingScale?: number;
    failedClimb?: number;
    cycleTimes?: number[];
    estimatedFuel?: number;
    successfulClimb?: boolean;
    wonAuto?: boolean;
  };
  teleop?: {
    bpsScale?: number;
    carryingScale?: number;
    transitionCycles?: number[];
    shift1Cycles?: number[];
    shift2Cycles?: number[];
    shift3Cycles?: number[];
    shift4Cycles?: number[];
    shiftParityFromWonAuto?: boolean;
    estimatedFuel?: number;
  };
  endgame?: {
    failedClimb?: number;
    status?: string;
  };
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

function scoreRebuiltEntry(e: Entry) {
  const autoFuel = Number(e.auto?.estimatedFuel || 0);
  const teleFuel = Number(e.teleop?.estimatedFuel || 0);
  const autoClimb = e.auto?.successfulClimb ? 15 : 0;
  const end = String(e.endgame?.status || "").toLowerCase();
  const endgameClimb = end === "level-1" ? 10 : end === "level-2" ? 20 : end === "level-3" ? 30 : 0;
  return autoFuel + teleFuel + autoClimb + endgameClimb;
}

function scoreEntry(e: Entry, game: AnalyticsGame) {
  if (game === "REBUILT") return scoreRebuiltEntry(e);

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

type MatchIdentity = {
  compLevel: "qm" | "qf" | "sf" | "f";
  setNumber: number | null;
  matchNumber: number;
};

type TbaMatchRow = {
  key?: string;
  comp_level?: string;
  set_number?: number;
  match_number?: number;
  alliances?: {
    red?: { team_keys?: string[]; score?: number };
    blue?: { team_keys?: string[]; score?: number };
  };
};

const REBUILT_PRELOAD_RANGES = ["0", "1-2", "3-4", "5-6", "7-8"];
const REBUILT_BPS_RANGES = ["0", "1-3", "4-6", "7-9", "10+"];
const REBUILT_CARRY_RANGES = ["0", "1-12", "13-23", "23-32", "33-42", "43-53", "54+"];

function rebuiltPreloadRange(scale?: number) {
  const idx = Math.max(0, Math.min(4, Number(scale ?? 0)));
  return REBUILT_PRELOAD_RANGES[idx];
}

function rebuiltBpsRange(scale?: number) {
  const idx = Math.max(0, Math.min(4, Number(scale ?? 0)));
  return REBUILT_BPS_RANGES[idx];
}

function rebuiltCarryRange(scale?: number) {
  const idx = Math.max(0, Math.min(6, Number(scale ?? 0)));
  return REBUILT_CARRY_RANGES[idx];
}

function inferAllianceColor(entry: Entry): "red" | "blue" | null {
  const raw = String(entry.allianceColor || entry.assignedAlliance || entry.alliance || "")
    .trim()
    .toLowerCase();
  if (raw.includes("red")) return "red";
  if (raw.includes("blue")) return "blue";
  return null;
}

function parseMatchIdentity(entry: Pick<Entry, "matchId" | "matchType" | "matchNumber">): MatchIdentity | null {
  const matchId = String(entry.matchId || "").trim().toLowerCase();
  const rawType = String(entry.matchType || "").trim().toLowerCase();
  const matchNumberFallback = Number(String(entry.matchNumber || "").replace(/\D/g, ""));

  const qmLike = matchId.match(/^(?:q|qm|p)(\d+)$/);
  if (qmLike) {
    return { compLevel: "qm", setNumber: null, matchNumber: Number(qmLike[1]) };
  }

  const playoff = matchId.match(/^(qf|sf|f)(\d+)(?:m(\d+))?$/);
  if (playoff) {
    const compLevel = playoff[1] as "qf" | "sf" | "f";
    const first = Number(playoff[2]);
    const second = playoff[3] ? Number(playoff[3]) : null;
    return {
      compLevel,
      setNumber: second === null ? null : first,
      matchNumber: second === null ? first : second,
    };
  }

  if (matchNumberFallback > 0) {
    if (rawType === "qualification" || rawType === "practice") {
      return { compLevel: "qm", setNumber: null, matchNumber: matchNumberFallback };
    }
    if (rawType === "finals") {
      return { compLevel: "f", setNumber: null, matchNumber: matchNumberFallback };
    }
  }

  return null;
}

function matchIdentityEquals(a: MatchIdentity, b: MatchIdentity): boolean {
  if (a.compLevel !== b.compLevel) return false;
  if (a.matchNumber !== b.matchNumber) return false;
  if (a.setNumber === null || b.setNumber === null) return true;
  return a.setNumber === b.setNumber;
}

function parseMatchIdentityFromLabel(label: string): MatchIdentity | null {
  const normalized = normalizeMatchLabel(label);
  return parseMatchIdentity({
    matchId: normalized.matchId,
    matchType: normalized.matchType,
    matchNumber: normalized.matchNumber,
  });
}

function tbaMatchLabel(row: TbaMatchRow): string {
  const level = String(row.comp_level || "").toLowerCase();
  const matchNumber = Number(row.match_number || 0);
  if (level === "f") return `F${matchNumber || "-"}`;
  if (level === "qm") return `Q${matchNumber || "-"}`;
  if (level === "sf") return `SF${Number(row.set_number || 0)}M${matchNumber || "-"}`;
  if (level === "qf") return `QF${Number(row.set_number || 0)}M${matchNumber || "-"}`;
  return `M${matchNumber || "-"}`;
}

function formatApprox(value: string | number) {
  return `~${value}`;
}

function chooseLatestEntryPerTeam(entries: Entry[]): Entry[] {
  const byTeam = new Map<string, Entry>();
  entries.forEach((entry) => {
    const team = String(entry.teamNumber || "").trim();
    if (!team) return;
    const prev = byTeam.get(team);
    const prevTime = Number(prev?.submittedAt || prev?.timestamp || 0);
    const currentTime = Number(entry.submittedAt || entry.timestamp || 0);
    if (!prev || currentTime >= prevTime) {
      byTeam.set(team, entry);
    }
  });
  return Array.from(byTeam.values());
}

type AccuracyDetails = {
  scoutedPoints: number;
  actualPoints: number | null;
  penaltyPoints: number;
  allRobotsScouted: "yes" | "no" | "unknown";
  eventKeyUsed: string;
  matchLabelUsed: string;
};

type AccuracyRobotBreakdown = {
  teamNumber: string;
  total: number;
  source: "computed" | "reefscape";
  autoFuel: number;
  teleFuel: number;
  autoClimb: number;
  endgameClimb: number;
};

function getRebuiltBreakdown(entry: Entry): AccuracyRobotBreakdown {
  const teamNumber = String(entry.teamNumber || "-").trim() || "-";
  const autoFuel = Number(entry.auto?.estimatedFuel || 0);
  const teleFuel = Number(entry.teleop?.estimatedFuel || 0);
  const autoClimb = entry.auto?.successfulClimb ? 15 : 0;
  const end = String(entry.endgame?.status || "").toLowerCase();
  const endgameClimb = end === "level-1" ? 10 : end === "level-2" ? 20 : end === "level-3" ? 30 : 0;
  return {
    teamNumber,
    total: autoFuel + teleFuel + autoClimb + endgameClimb,
    source: "computed",
    autoFuel,
    teleFuel,
    autoClimb,
    endgameClimb,
  };
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
  const [accuracyDetails, setAccuracyDetails] = useState<AccuracyDetails>({
    scoutedPoints: 0,
    actualPoints: null,
    penaltyPoints: 0,
    allRobotsScouted: "unknown",
    eventKeyUsed: "",
    matchLabelUsed: "",
  });
  const [accuracyRobotBreakdown, setAccuracyRobotBreakdown] = useState<AccuracyRobotBreakdown[]>([]);

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
    const withScore = filtered.map((entry) => ({ ...entry, score: scoreEntry(entry, selectedGame) }));
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
    const clickedLabel = matchLabel(entry);
    setAccuracyRobotBreakdown([]);
    setAccuracyDetails({
      scoutedPoints: 0,
      actualPoints: null,
      penaltyPoints: Number(entry.penaltyPoints || 0),
      allRobotsScouted: "unknown",
      eventKeyUsed: "",
      matchLabelUsed: clickedLabel,
    });
    try {
      const selectedTeam = String(entry.teamNumber || "").trim();
      const entryGame = String(entry.game || "REEFSCAPE").toUpperCase() as AnalyticsGame;
      const sameGameRows = rawData.filter((row) => String(row.game || "REEFSCAPE").toUpperCase() === entryGame);
      const sameLabelRows = sameGameRows.filter((row) => matchLabel(row) === clickedLabel);
      const sameScoutRows = sameLabelRows.filter(
        (row) => String(row.scoutName || "").trim() === String(entry.scoutName || "").trim()
      );

      const eventKeyFromEntry = String(entry.eventKey || "").trim();
      const eventKeyFromSelector = selectedEvent !== "all" ? selectedEvent : "";
      const eventKeyPool = sameLabelRows
        .filter((row) => !selectedTeam || String(row.teamNumber || "").trim() === selectedTeam)
        .map((row) => String(row.eventKey || "").trim())
        .filter(Boolean);
      const eventKeyFrequency = eventKeyPool.reduce<Record<string, number>>((acc, key) => {
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const mostCommonEventKey =
        Object.entries(eventKeyFrequency).sort((a, b) => b[1] - a[1])[0]?.[0] ||
        sameLabelRows.map((row) => String(row.eventKey || "").trim()).filter(Boolean)[0] ||
        "";
      const eventKey = eventKeyFromEntry || eventKeyFromSelector || mostCommonEventKey;

      const poolByEvent = eventKey
        ? sameGameRows.filter((row) => String(row.eventKey || "").trim() === eventKey)
        : sameLabelRows;
      const identity =
        parseMatchIdentity(entry) ||
        parseMatchIdentityFromLabel(clickedLabel) ||
        sameLabelRows.map((row) => parseMatchIdentity(row)).find((value): value is MatchIdentity => Boolean(value)) ||
        null;
      const matchRows = poolByEvent.filter((row) => {
        if (matchLabel(row) === clickedLabel) return true;
        if (!identity) return false;
        const rowIdentity = parseMatchIdentity(row) || parseMatchIdentityFromLabel(matchLabel(row));
        return Boolean(rowIdentity && matchIdentityEquals(identity, rowIdentity));
      });
      const latestReferenceRows = chooseLatestEntryPerTeam(sameScoutRows.length > 0 ? sameScoutRows : matchRows);
      const scoutedTeamsReference = new Set(
        latestReferenceRows.map((row) => String(row.teamNumber || "").trim()).filter(Boolean)
      );

      let allianceColor = inferAllianceColor(entry);
      let officialTeamsForAlliance: string[] = [];
      let matchLabelUsed = clickedLabel;
      let actualPoints: number | null =
        typeof entry.officialScore === "number"
          ? Number(entry.officialScore)
          : typeof entry.actualScore === "number"
          ? Number(entry.actualScore)
          : null;

      if (!userData?.teamId) {
        const allianceRows =
          allianceColor === null
            ? latestReferenceRows
            : matchRows.filter((row) => inferAllianceColor(row) === allianceColor);
        const latestAllianceRows = chooseLatestEntryPerTeam(allianceRows);
        const scoutedPoints = latestAllianceRows.reduce((sum, row) => sum + scoreEntry(row, entryGame), 0);
        setAccuracyRobotBreakdown(
          latestAllianceRows.map((row) =>
            entryGame === "REBUILT"
              ? getRebuiltBreakdown(row)
              : {
                  teamNumber: String(row.teamNumber || "-"),
                  total: scoreEntry(row, entryGame),
                  source: "reefscape",
                  autoFuel: 0,
                  teleFuel: 0,
                  autoClimb: 0,
                  endgameClimb: 0,
                }
          )
        );
        setAccuracyDetails({
          scoutedPoints,
          actualPoints,
          penaltyPoints: Number(entry.penaltyPoints || 0),
          allRobotsScouted: "unknown",
          eventKeyUsed: eventKey,
          matchLabelUsed: matchLabelUsed,
        });
        return;
      }

      const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
      const encryptedKey = String(teamDoc.data()?.tbaApiKeyEncrypted || "").trim();
      const plainKey = String(teamDoc.data()?.tbaApiKey || "").trim();
      if (eventKey && identity && (encryptedKey || plainKey)) {
        const response = await fetch("/api/tba/matches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventKey, encryptedKey, plainKey }),
        });
        if (response.ok) {
          const payload = await response.json();
          const matches = (Array.isArray(payload.matches) ? payload.matches : []) as TbaMatchRow[];
          const candidates = matches.filter((row) => {
            const rowLevel = String(row.comp_level || "").toLowerCase();
            return ["qm", "qf", "sf", "f"].includes(rowLevel);
          });
          const scoredCandidates = candidates
            .map((row) => {
              const redTeams = (row.alliances?.red?.team_keys || [])
                .map((key) => String(key).replace("frc", "").trim())
                .filter(Boolean);
              const blueTeams = (row.alliances?.blue?.team_keys || [])
                .map((key) => String(key).replace("frc", "").trim())
                .filter(Boolean);
              const redOverlap = redTeams.filter((team) => scoutedTeamsReference.has(team)).length;
              const blueOverlap = blueTeams.filter((team) => scoutedTeamsReference.has(team)).length;
              const bestOverlap = Math.max(redOverlap, blueOverlap);
              const overlapAlliance: "red" | "blue" = redOverlap >= blueOverlap ? "red" : "blue";
              const rowIdentity: MatchIdentity = {
                compLevel: String(row.comp_level || "").toLowerCase() as MatchIdentity["compLevel"],
                setNumber: Number(row.set_number || 0) > 0 ? Number(row.set_number || 0) : null,
                matchNumber: Number(row.match_number || 0),
              };
              const identityBoost = identity && matchIdentityEquals(identity, rowIdentity) ? 1 : 0;
              return { row, redTeams, blueTeams, redOverlap, blueOverlap, bestOverlap, overlapAlliance, identityBoost };
            })
            .sort((a, b) => {
              if (b.bestOverlap !== a.bestOverlap) return b.bestOverlap - a.bestOverlap;
              if (b.identityBoost !== a.identityBoost) return b.identityBoost - a.identityBoost;
              return 0;
            });
          const best = scoredCandidates[0];
          if (best && best.bestOverlap > 0) {
            const alliances = best.row.alliances || {};
            if (!allianceColor) {
              if (selectedTeam && best.redTeams.includes(selectedTeam)) allianceColor = "red";
              else if (selectedTeam && best.blueTeams.includes(selectedTeam)) allianceColor = "blue";
              else allianceColor = best.overlapAlliance;
            }
            if (allianceColor === "red") {
              officialTeamsForAlliance = best.redTeams;
              actualPoints = typeof alliances.red?.score === "number" ? alliances.red.score : actualPoints;
            } else if (allianceColor === "blue") {
              officialTeamsForAlliance = best.blueTeams;
              actualPoints = typeof alliances.blue?.score === "number" ? alliances.blue.score : actualPoints;
            }
            matchLabelUsed = tbaMatchLabel(best.row);
          }
        }
      }

      const allianceRows =
        allianceColor === null
          ? latestReferenceRows
          : officialTeamsForAlliance.length > 0
          ? matchRows.filter((row) => officialTeamsForAlliance.includes(String(row.teamNumber || "").trim()))
          : matchRows.filter((row) => inferAllianceColor(row) === allianceColor);
      let latestAllianceRows = chooseLatestEntryPerTeam(allianceRows);
      if (officialTeamsForAlliance.length > 0 && latestAllianceRows.length < 2 && latestReferenceRows.length >= 2) {
        // If official-team matching collapses rows (bad/missing team keys), keep scouted alliance rows visible.
        latestAllianceRows = latestReferenceRows;
      }
      const scoutedPoints = latestAllianceRows.reduce((sum, row) => sum + scoreEntry(row, entryGame), 0);
      setAccuracyRobotBreakdown(
        latestAllianceRows.map((row) =>
          entryGame === "REBUILT"
            ? getRebuiltBreakdown(row)
            : {
                teamNumber: String(row.teamNumber || "-"),
                total: scoreEntry(row, entryGame),
                source: "reefscape",
                autoFuel: 0,
                teleFuel: 0,
                autoClimb: 0,
                endgameClimb: 0,
              }
        )
      );
      const scoutedTeams = new Set(latestAllianceRows.map((row) => String(row.teamNumber || "").trim()).filter(Boolean));
      const allRobotsScouted =
        officialTeamsForAlliance.length > 0
          ? officialTeamsForAlliance.every((team) => scoutedTeams.has(team))
            ? "yes"
            : "no"
          : "unknown";
      setAccuracyDetails({
        scoutedPoints,
        actualPoints,
        penaltyPoints:
          Number(
            latestAllianceRows.find((row) => typeof row.penaltyPoints === "number")?.penaltyPoints ??
              entry.penaltyPoints ??
              0
          ) || 0,
        allRobotsScouted,
        eventKeyUsed: eventKey,
        matchLabelUsed: matchLabelUsed,
      });
    } catch (error) {
      console.error("Failed to load alliance robot details:", error);
      setAccuracyDetails((prev) => ({ ...prev, allRobotsScouted: "unknown", matchLabelUsed: clickedLabel }));
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
        {selectedGame === "REBUILT" ? (
          <table>
            <thead className="sticky-header">
              <tr>
                <th className="sticky-left-group sticky-row-1 bg-red-300 text-center" colSpan={2}>Information</th>
                <th className="bg-yellow-300 text-center" colSpan={2}>Pre-Match</th>
                <th className="bg-green-300 text-center" colSpan={5}>Autonomous</th>
                <th className="bg-blue-300 text-center" colSpan={13}>Teleoperated</th>
                <th className="bg-purple-300 text-center" colSpan={3}>Endgame</th>
                <th className="bg-pink-300 text-center" colSpan={5}>General</th>
              </tr>
              <tr>
                <th className="sticky-left-group sticky-row-2 bg-red-200 text-center" colSpan={2}>Information</th>
                <th className="bg-yellow-200 text-center" colSpan={2}>Pre-Match</th>
                <th className="bg-green-200 text-center" colSpan={3}>Stats</th>
                <th className="bg-green-200 text-center" colSpan={1}>Fuel</th>
                <th className="bg-green-200 text-center" colSpan={1}>Climb</th>
                <th className="bg-blue-200 text-center" colSpan={8}>Fuel</th>
                <th className="bg-blue-200 text-center" colSpan={5}>Cycles (s)</th>
                <th className="bg-purple-200 text-center" colSpan={1}>End Place</th>
                <th className="bg-purple-200 text-center" colSpan={1}>Climb</th>
                <th className="bg-purple-200 text-center" colSpan={1}>Incidents</th>
                <th className="bg-pink-200 text-center" colSpan={1}>Score</th>
                <th className="bg-pink-200 text-center" colSpan={1}>Comments</th>
                <th className="bg-pink-200 text-center" colSpan={2}>Accuracy Script</th>
                <th className="bg-gray-200 text-center" colSpan={1}>Actions</th>
              </tr>
              <tr>
                <th className="sticky-left-0 sticky-row-3 cursor-pointer text-center" onClick={() => handleSort("matchNumber")}>{sortLabel("matchNumber", "Match")}</th>
                <th className="sticky-left-1 sticky-row-3 cursor-pointer text-center" onClick={() => handleSort("teamNumber")}>{sortLabel("teamNumber", "Team")}</th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("scoutName")}>{sortLabel("scoutName", "Scout")}</th>
                <th className="text-center">Starting Position</th>
                <th className="text-center">Preload</th>
                <th className="text-center">BPS</th>
                <th className="text-center">Carry</th>
                <th className="text-center">Fuel</th>
                <th className="text-center">Climb Pts</th>
                <th className="text-center">BPS</th>
                <th className="text-center">Carry</th>
                <th className="text-center">Transition</th>
                <th className="text-center">Shift 1</th>
                <th className="text-center">Shift 2</th>
                <th className="text-center">Shift 3</th>
                <th className="text-center">Shift 4</th>
                <th className="text-center">Fuel Used</th>
                <th className="text-center">Transition Cycles</th>
                <th className="text-center">Shift 1 Cycles</th>
                <th className="text-center">Shift 2 Cycles</th>
                <th className="text-center">Shift 3 Cycles</th>
                <th className="text-center">Shift 4 Cycles</th>
                <th className="text-center">End Place</th>
                <th className="text-center">Climb Pts</th>
                <th className="text-center">Incidents</th>
                <th className="text-center">Total Used</th>
                <th className="text-center" style={{ minWidth: "260px" }}>Comments</th>
                <th className="text-center">Alliance Accuracy</th>
                <th className="text-center">Script Status</th>
                <th className="text-center">Delete</th>
              </tr>
            </thead>
            <tbody>
              {data.map((entry) => {
                const autoFuel = Number(entry.auto?.estimatedFuel || 0);
                const teleFuel = Number(entry.teleop?.estimatedFuel || 0);
                const autoClimb = entry.auto?.successfulClimb ? 15 : 0;
                const end = String(entry.endgame?.status || "").toLowerCase();
                const endgameClimb = end === "level-1" ? 10 : end === "level-2" ? 20 : end === "level-3" ? 30 : 0;
                const totalUsed = autoFuel + teleFuel + autoClimb + endgameClimb;
                const formatCycles = (cycles?: number[]) =>
                  Array.isArray(cycles) && cycles.length > 0 ? cycles.map((v) => v.toFixed(2)).join(", ") : "-";
                return (
                <tr key={entry.id}>
                  <td className="sticky-left-0 bg-white font-semibold text-center">{matchLabel(entry)}</td>
                  <td className="sticky-left-1 bg-white font-semibold text-center">{entry.teamNumber || "-"}</td>
                  <td className="text-center">{entry.scoutName || "-"}</td>
                  <td className="text-center">{entry.startingPosition || "-"}</td>
                  <td className="text-center">{formatApprox(rebuiltPreloadRange(entry.auto?.preloadScale))}</td>
                  <td className="text-center">{formatApprox(rebuiltBpsRange(entry.auto?.bpsScale))}</td>
                  <td className="text-center">{formatApprox(rebuiltCarryRange(entry.auto?.carryingScale))}</td>
                  <td className="text-center">{autoFuel}</td>
                  <td className="text-center">{autoClimb}</td>
                  <td className="text-center">{formatApprox(rebuiltBpsRange(entry.teleop?.bpsScale))}</td>
                  <td className="text-center">{formatApprox(rebuiltCarryRange(entry.teleop?.carryingScale))}</td>
                  <td className="text-center">{formatApprox(Array.isArray(entry.teleop?.transitionCycles) ? entry.teleop.transitionCycles.length : 0)}</td>
                  <td className="text-center">{formatApprox(Array.isArray(entry.teleop?.shift1Cycles) ? entry.teleop.shift1Cycles.length : 0)}</td>
                  <td className="text-center">{formatApprox(Array.isArray(entry.teleop?.shift2Cycles) ? entry.teleop.shift2Cycles.length : 0)}</td>
                  <td className="text-center">{formatApprox(Array.isArray(entry.teleop?.shift3Cycles) ? entry.teleop.shift3Cycles.length : 0)}</td>
                  <td className="text-center">{formatApprox(Array.isArray(entry.teleop?.shift4Cycles) ? entry.teleop.shift4Cycles.length : 0)}</td>
                  <td className="text-center">{teleFuel}</td>
                  <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCycles(entry.teleop?.transitionCycles)}</td>
                  <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCycles(entry.teleop?.shift1Cycles)}</td>
                  <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCycles(entry.teleop?.shift2Cycles)}</td>
                  <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCycles(entry.teleop?.shift3Cycles)}</td>
                  <td className="text-center" style={{ minWidth: "140px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{formatCycles(entry.teleop?.shift4Cycles)}</td>
                  <td className="text-center">{entry.endgame?.status || entry.stageStatus || "-"}</td>
                  <td className="text-center">{endgameClimb}</td>
                  <td className="text-center">
                    {entry.incidents?.map((incident) => INCIDENT_LABELS[incident] || incident).join(", ") || "-"}
                  </td>
                  <td className="text-center font-semibold">{totalUsed}</td>
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
                );
              })}
            </tbody>
          </table>
        ) : (
        <table>
          <thead className="sticky-header">
            <tr>
              <th className="sticky-left-group sticky-row-1 bg-red-300 text-center" colSpan={2}>Information</th>
              <th className="bg-yellow-300 text-center" colSpan={2}>Pre-Match</th>
              <th className="bg-green-300 text-center" colSpan={10}>Autonomous</th>
              <th className="bg-blue-300 text-center" colSpan={13}>Teleoperated</th>
              <th className="bg-purple-300 text-center" colSpan={2}>Endgame</th>
              <th className="bg-pink-300 text-center" colSpan={4}>General</th>
            </tr>
            <tr>
              <th className="sticky-left-group sticky-row-2 bg-red-200 text-center" colSpan={2}>Information</th>
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
              <th className="sticky-left-0 sticky-row-3 cursor-pointer text-center" onClick={() => handleSort("matchNumber")}>{sortLabel("matchNumber", "Match")}</th>
              <th className="sticky-left-1 sticky-row-3 cursor-pointer text-center" onClick={() => handleSort("teamNumber")}>{sortLabel("teamNumber", "Team")}</th>
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
        )}
      </div>

      {selectedAccuracyEntry && (
        <div className="fixed inset-0 bg-black/45 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-semibold mb-3">Alliance Accuracy Details</h2>
            {(() => {
              return (
                <div className="space-y-2 text-sm">
                  <p><span className="font-semibold">Match:</span> {accuracyDetails.matchLabelUsed || "-"}</p>
                  <p><span className="font-semibold">Event:</span> {accuracyDetails.eventKeyUsed || "Unknown"}</p>
                  <p><span className="font-semibold">Scouted Points:</span> {accuracyDetails.scoutedPoints}</p>
                  <p><span className="font-semibold">Actual Points:</span> {accuracyDetails.actualPoints ?? "Unavailable"}</p>
                  <p>
                    <span className="font-semibold">All Robots Scouted:</span>{" "}
                    {accuracyModalLoading ? "Checking..." : accuracyDetails.allRobotsScouted === "yes" ? "Yes" : accuracyDetails.allRobotsScouted === "no" ? "No" : "Unknown"}
                  </p>
                  <p><span className="font-semibold">Penalty Points:</span> {accuracyDetails.penaltyPoints}</p>
                  {accuracyRobotBreakdown.length > 0 && (
                    <div className="pt-2">
                      <p className="font-semibold mb-1">Score Breakdown</p>
                      <div className="space-y-1 text-xs">
                        {accuracyRobotBreakdown.map((row) => (
                          <p key={`${row.teamNumber}-${row.source}`}>
                            Team {row.teamNumber}: {row.total}{" "}
                            {row.source === "computed"
                              ? `(autoFuel=${row.autoFuel} + teleFuel=${row.teleFuel} + autoClimb=${row.autoClimb} + endgameClimb=${row.endgameClimb})`
                              : "(REEFSCAPE scorer)"}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
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
