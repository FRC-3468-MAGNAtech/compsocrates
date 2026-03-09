"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import { useAuth } from "@/app/AuthContext";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import {
  entryMatchesAnalyticsFilters,
  getEventOptionsForEntries,
  getEventsForGame,
  isPracticeScoutedEntry,
  type AnalyticsEventOption,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";
import { getTeamEvents } from "@/app/utils/tba-api";
import { dedupeEventKeys } from "@/app/utils/events";
import { flagStateDocId, shouldExcludeEntryFromStats, type StoredFlagState } from "@/app/utils/scoutingFlags";

type ScoutingEntry = {
  id?: string;
  eventKey?: string;
  submittedAt?: number;
  timestamp?: number;
  game?: string;
  accuracy?: number;
  teamNumber?: string;
  leftStartingZone?: boolean;
  autoCoralL1?: number;
  autoCoralL2?: number;
  autoCoralL3?: number;
  autoCoralL4?: number;
  autoAlgaeProcessorScored?: number;
  autoAlgaeNetScored?: number;
  teleopCoralL1?: number;
  teleopCoralL2?: number;
  teleopCoralL3?: number;
  teleopCoralL4?: number;
  teleopProcessorScored?: number;
  teleopNetRobotScored?: number;
  teleopNetHumanScored?: number;
  penaltyPoints?: number;
  auto?: {
    estimatedFuel?: number;
    preloadScale?: number;
    bpsScale?: number;
    carryingScale?: number;
    successfulClimb?: boolean;
  };
  teleop?: {
    estimatedFuel?: number;
    bpsScale?: number;
    carryingScale?: number;
  };
  endgame?: {
    status?: string;
  };
  matchId?: string;
  matchNumber?: string | number;
  startingPosition?: string;
  stageStatus?: string;
  isPracticeScouting?: boolean;
  practiceMode?: string;
  practiceSessionId?: string;
};

type PitEntry = {
  eventKey?: string;
  game?: string;
  teamNumber?: string;
  createdAt?: number;
  pitDisposition?: boolean;
  driveDisposition?: boolean;
  collectCoralStation?: boolean;
  collectCoralGround?: boolean;
  coralL1?: boolean;
  coralL2?: boolean;
  coralL3?: boolean;
  coralL4?: boolean;
  collectAlgaeReef?: boolean;
  collectAlgaeGround?: boolean;
  scoreProcessor?: boolean;
  scoreNetRobot?: boolean;
  bargeCapability?: string;
  startingOpposite?: boolean;
  startingMiddle?: boolean;
  startingProcessor?: boolean;
  fuelPreloadCapacity?: string | number;
  fuelBallsPerSecond?: string | number;
  fuelCarryingCapacity?: string | number;
  robotName?: string;
  robotNickname?: string;
  robot?: string;
  botName?: string;
};

type StrategyPlanEntry = {
  eventKey?: string;
  game?: string;
  createdAt?: number;
  robots?: Array<{
    teamNumber?: string;
    startingPosition?: string;
    role?: string;
    autoClimb?: boolean;
    endgameClimb?: string;
  }>;
};

type DriveEntry = {
  eventKey?: string;
  game?: string;
  createdAt?: number;
  robots?: Array<{
    teamNumber?: string;
    startingPosition?: string;
    role?: string;
    autoClimb?: boolean;
    endgameClimb?: string;
  }>;
};

type StatboticsEpa = {
  total_points?: { mean?: number };
  breakdown?: Record<string, number>;
  ranks?: {
    total?: {
      rank?: number;
      percentile?: number;
      team_count?: number;
    };
  };
};

type StatboticsRecord = {
  wins?: number;
  losses?: number;
  ties?: number;
  count?: number;
  winrate?: number;
};

type StatboticsTeamYear = {
  name?: string;
  epa?: StatboticsEpa;
  record?: StatboticsRecord;
};

type StatboticsTeamEvent = {
  event_name?: string;
  epa?: StatboticsEpa;
  record?: {
    qual?: {
      rank?: number;
      num_teams?: number;
    };
    total?: StatboticsRecord;
  };
};

function normalizeTeam(input: unknown) {
  return String(input || "").replace(/[^\d]/g, "");
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = parseFloat(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function avg(values: Array<number | null | undefined>) {
  const usable = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (usable.length === 0) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function mode(values: Array<string | undefined | null>) {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    const normalized = String(value || "").trim();
    if (!normalized) return;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  });
  let winner = "";
  let best = 0;
  counts.forEach((count, value) => {
    if (count > best) {
      best = count;
      winner = value;
    }
  });
  return winner || "-";
}

function percentTrue(values: Array<boolean | undefined | null>) {
  const usable = values.filter((value): value is boolean => typeof value === "boolean");
  if (usable.length === 0) return "-";
  const trueCount = usable.filter(Boolean).length;
  return `${Math.round((trueCount / usable.length) * 100)}%`;
}

function displayNumber(value: number | null, digits = 1) {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function asFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asPercent(value: unknown, digits = 1) {
  const numeric = asFiniteNumber(value);
  if (numeric === null) return "-";
  return `${(numeric * 100).toFixed(digits)}%`;
}

function formatRecord(record?: StatboticsRecord | null) {
  if (!record) return "-";
  const wins = Number(record.wins || 0);
  const losses = Number(record.losses || 0);
  const ties = Number(record.ties || 0);
  if (wins + losses + ties <= 0) return "-";
  return `${wins}-${losses}-${ties}`;
}

function yesNo(value: boolean | null) {
  if (value === null) return "-";
  return value ? "Yes" : "No";
}

function scoreEntry(entry: ScoutingEntry, game: AnalyticsGame): number {
  if (game === "REBUILT") {
    const autoFuel = Number(entry.auto?.estimatedFuel || 0);
    const teleFuel = Number(entry.teleop?.estimatedFuel || 0);
    const autoClimb = entry.auto?.successfulClimb ? 15 : 0;
    const endStatus = String(entry.endgame?.status || "").toLowerCase();
    const endgameClimb = endStatus === "level-1" ? 10 : endStatus === "level-2" ? 20 : endStatus === "level-3" ? 30 : 0;
    return autoFuel + teleFuel + autoClimb + endgameClimb;
  }
  return (
    (entry.leftStartingZone ? 3 : 0) +
    (entry.autoCoralL1 || 0) * 3 +
    (entry.autoCoralL2 || 0) * 4 +
    (entry.autoCoralL3 || 0) * 6 +
    (entry.autoCoralL4 || 0) * 7 +
    (entry.autoAlgaeProcessorScored || 0) * 6 +
    (entry.autoAlgaeNetScored || 0) * 4 +
    (entry.teleopCoralL1 || 0) * 2 +
    (entry.teleopCoralL2 || 0) * 3 +
    (entry.teleopCoralL3 || 0) * 4 +
    (entry.teleopCoralL4 || 0) * 5 +
    (entry.teleopProcessorScored || 0) * 6 +
    (entry.teleopNetRobotScored || 0) * 4 +
    (entry.teleopNetHumanScored || 0) * 4 +
    Number(entry.penaltyPoints || 0)
  );
}

function isPastEventKey(eventKey: string, options: AnalyticsEventOption[]) {
  const option = options.find((row) => row.id === eventKey);
  if (!option?.endDate) return false;
  const end = new Date(`${option.endDate}T23:59:59`).getTime();
  return Number.isFinite(end) && Date.now() > end;
}

function getFirstEventCodeFromTbaKey(key: string): string {
  const normalized = String(key || "").toLowerCase();
  const specialMap: Record<string, string> = {
    "2026labr": "LAKE",
    "2025lake": "LAKE",
  };
  if (specialMap[normalized]) return specialMap[normalized];
  const suffix = normalized.slice(4).toUpperCase();
  return suffix || normalized.toUpperCase();
}

function TeamBreakdownDetailContent() {
  const params = useParams<{ teamNumber: string }>();
  const { userData } = useAuth();
  const teamNumber = normalizeTeam(params?.teamNumber);
  const [scoutingEntries, setScoutingEntries] = useState<ScoutingEntry[]>([]);
  const [pitEntries, setPitEntries] = useState<PitEntry[]>([]);
  const [strategyEntries, setStrategyEntries] = useState<StrategyPlanEntry[]>([]);
  const [driveEntries, setDriveEntries] = useState<DriveEntry[]>([]);
  const [flagStates, setFlagStates] = useState<Record<string, StoredFlagState>>({});
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REEFSCAPE");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [knownTeamEvents, setKnownTeamEvents] = useState<Array<{ key: string; name: string; start_date?: string }>>([]);
  const [selectedTeamEvents, setSelectedTeamEvents] = useState<string[]>([]);
  const [teamDisplayName, setTeamDisplayName] = useState("");
  const [summaryTab, setSummaryTab] = useState<"matchScouted" | "statbotics">("matchScouted");
  const [statboticsTeamYear, setStatboticsTeamYear] = useState<StatboticsTeamYear | null>(null);
  const [statboticsTeamEvent, setStatboticsTeamEvent] = useState<StatboticsTeamEvent | null>(null);
  const [statboticsUnavailable, setStatboticsUnavailable] = useState(false);
  const [statboticsLoading, setStatboticsLoading] = useState(false);
  const [statboticsError, setStatboticsError] = useState("");
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
    async function load() {
      setLoading(true);
      try {
        const [scoutingSnap, pitSnap, strategySnap, driveSnap] = await Promise.all([
          getDocs(collection(db, "scouting")),
          getDocs(collection(db, "pitScouting")),
          getDocs(collection(db, "matchStrategyPlans")),
          getDocs(collection(db, "driveScouting")),
        ]);
        setScoutingEntries(scoutingSnap.docs.map((d) => ({ id: d.id, ...(d.data() as ScoutingEntry) })));
        setPitEntries(pitSnap.docs.map((d) => d.data() as PitEntry));
        setStrategyEntries(strategySnap.docs.map((d) => d.data() as StrategyPlanEntry));
        setDriveEntries(driveSnap.docs.map((d) => d.data() as DriveEntry));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  useEffect(() => {
    async function loadFlagStates() {
      if (!userData?.teamId) {
        setFlagStates({});
        return;
      }
      try {
        const snap = await getDocs(query(collection(db, "scoutingFlagStates"), where("teamId", "==", userData.teamId)));
        const next: Record<string, StoredFlagState> = {};
        snap.docs.forEach((d) => {
          const row = d.data() as StoredFlagState;
          const entityType = row.entityType === "practiceSession" ? "practiceSession" : "scoutingEntry";
          const entityId = String(row.entityId || "").trim();
          if (!entityId) return;
          next[flagStateDocId(entityType, entityId)] = row;
        });
        setFlagStates(next);
      } catch (error) {
        console.warn("Unable to load scouting flag states for team detail breakdown. Continuing without flag states.", error);
        setFlagStates({});
      }
    }
    void loadFlagStates();
  }, [userData?.teamId]);

  useEffect(() => {
    async function loadTeamEvents() {
      if (!teamNumber) return;
      try {
        const year = new Date().getFullYear();
        const [currentYear, nextYear] = await Promise.all([
          getTeamEvents(Number(teamNumber), year),
          getTeamEvents(Number(teamNumber), year + 1),
        ]);
        const merged = [...currentYear, ...nextYear].map((event) => ({
          key: String(event.key || ""),
          name: String(event.name || event.key || ""),
          start_date: String(event.start_date || ""),
        }));
        const byKey = new Map<string, { key: string; name: string; start_date?: string }>();
        merged.forEach((event) => {
          if (!event.key) return;
          if (!byKey.has(event.key)) byKey.set(event.key, event);
        });
        setKnownTeamEvents(Array.from(byKey.values()));
      } catch {
        setKnownTeamEvents([]);
      }
    }
    void loadTeamEvents();
  }, [teamNumber]);

  useEffect(() => {
    async function loadSelectedTeamEvents() {
      if (!userData?.teamId) {
        setSelectedTeamEvents([]);
        return;
      }
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        if (!teamDoc.exists()) {
          setSelectedTeamEvents([]);
          return;
        }
        const raw = teamDoc.data().selectedEvents;
        const selected = Array.isArray(raw)
          ? dedupeEventKeys(raw.map((value: unknown) => String(value || "").trim()).filter(Boolean))
          : [];
        setSelectedTeamEvents(selected);
      } catch {
        setSelectedTeamEvents([]);
      }
    }
    void loadSelectedTeamEvents();
  }, [userData?.teamId]);

  useEffect(() => {
    async function loadTeamName() {
      if (!teamNumber) {
        setTeamDisplayName("");
        return;
      }
      const candidateEventKeys: string[] = [];
      if (selectedEvent !== "all") candidateEventKeys.push(selectedEvent);
      knownTeamEvents.forEach((event) => {
        if (!candidateEventKeys.includes(event.key)) candidateEventKeys.push(event.key);
      });
      if (candidateEventKeys.length === 0) {
        setTeamDisplayName("");
        return;
      }

      for (const eventKey of candidateEventKeys) {
        const year = Number(eventKey.slice(0, 4));
        const eventCode = getFirstEventCodeFromTbaKey(eventKey);
        if (!Number.isFinite(year) || !eventCode) continue;
        try {
          const response = await fetch("/api/first/teams", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year, eventCode }),
          });
          if (!response.ok) continue;
          const payload = await response.json();
          const teams = Array.isArray(payload.teams)
            ? (payload.teams as Array<{ teamNumber?: number; nameShort?: string }>)
            : [];
          const found = teams.find((team) => Number(team.teamNumber || 0) === Number(teamNumber));
          if (found?.nameShort) {
            setTeamDisplayName(String(found.nameShort));
            return;
          }
        } catch {
          // Best-effort only.
        }
      }
      setTeamDisplayName("");
    }
    void loadTeamName();
  }, [teamNumber, selectedEvent, knownTeamEvents]);

  const teamScoutingAll = useMemo(
    () => scoutingEntries.filter((entry) => normalizeTeam(entry.teamNumber) === teamNumber),
    [scoutingEntries, teamNumber]
  );

  const teamScoutingAllForStats = useMemo(
    () =>
      teamScoutingAll.filter((entry) => {
        const entryId = String(entry.id || "").trim();
        const state = entryId ? flagStates[flagStateDocId("scoutingEntry", entryId)] : undefined;
        return !shouldExcludeEntryFromStats(entry as Record<string, unknown>, state);
      }),
    [teamScoutingAll, flagStates]
  );

  const eventSeedEntries = useMemo(
    () => [
      ...teamScoutingAll,
      ...pitEntries
        .filter((entry) => normalizeTeam(entry.teamNumber) === teamNumber)
        .map((entry) => ({ eventKey: entry.eventKey, game: String(entry.game || "REEFSCAPE") })),
      ...strategyEntries
        .filter((entry) => Array.isArray(entry.robots) && entry.robots.some((robot) => normalizeTeam(robot.teamNumber) === teamNumber))
        .map((entry) => ({ eventKey: entry.eventKey, game: String(entry.game || "REBUILT") })),
      ...driveEntries
        .filter((entry) => Array.isArray(entry.robots) && entry.robots.some((robot) => normalizeTeam(robot.teamNumber) === teamNumber))
        .map((entry) => ({ eventKey: entry.eventKey, game: String(entry.game || "REBUILT") })),
    ],
    [teamScoutingAll, pitEntries, strategyEntries, driveEntries, teamNumber]
  );

  const eventOptions = useMemo(() => getEventOptionsForEntries(eventSeedEntries, selectedGame), [eventSeedEntries, selectedGame]);

  const isReefscape = selectedGame === "REEFSCAPE";

  const teamScoutingFiltered = useMemo(() => {
    const gameFiltered = teamScoutingAllForStats.filter((entry) =>
      entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent, eventOptions)
    );
    return gameFiltered.filter((entry) => (practiceMatchesOnly ? isPracticeScoutedEntry(entry) : !isPracticeScoutedEntry(entry)));
  }, [teamScoutingAllForStats, selectedGame, selectedEvent, practiceMatchesOnly, eventOptions]);

  const teamPitFiltered = useMemo(() => {
    if (practiceMatchesOnly) return [] as PitEntry[];
    return pitEntries.filter((entry) => {
      if (normalizeTeam(entry.teamNumber) !== teamNumber) return false;
      if (String(entry.game || "REEFSCAPE") !== selectedGame) return false;
      if (selectedEvent !== "all" && String(entry.eventKey || "") !== selectedEvent) return false;
      return true;
    });
  }, [pitEntries, teamNumber, selectedGame, selectedEvent, practiceMatchesOnly]);

  const teamStrategyFiltered = useMemo(() => {
    if (practiceMatchesOnly) return [] as StrategyPlanEntry[];
    if (isReefscape) return [] as StrategyPlanEntry[];
    return strategyEntries
      .filter((entry) => String(entry.game || "REBUILT") === selectedGame)
      .filter((entry) => selectedEvent === "all" || String(entry.eventKey || "") === selectedEvent)
      .filter((entry) => Array.isArray(entry.robots) && entry.robots.some((robot) => normalizeTeam(robot.teamNumber) === teamNumber));
  }, [strategyEntries, selectedGame, selectedEvent, teamNumber, isReefscape, practiceMatchesOnly]);

  const teamDriveFiltered = useMemo(() => {
    if (practiceMatchesOnly) return [] as DriveEntry[];
    if (isReefscape) return [] as DriveEntry[];
    return driveEntries
      .filter((entry) => String(entry.game || "REBUILT") === selectedGame)
      .filter((entry) => selectedEvent === "all" || String(entry.eventKey || "") === selectedEvent)
      .filter((entry) => Array.isArray(entry.robots) && entry.robots.some((robot) => normalizeTeam(robot.teamNumber) === teamNumber));
  }, [driveEntries, selectedGame, selectedEvent, teamNumber, isReefscape, practiceMatchesOnly]);

  const pitLatest = useMemo(() => {
    if (teamPitFiltered.length === 0) return null;
    return [...teamPitFiltered].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];
  }, [teamPitFiltered]);

  const robotName = useMemo(() => {
    if (!pitLatest) return "-";
    return String(pitLatest.robotName || pitLatest.robotNickname || pitLatest.robot || pitLatest.botName || "").trim() || "-";
  }, [pitLatest]);

  const reefscapePitSummary = useMemo(() => {
    if (!isReefscape || teamPitFiltered.length === 0) {
      return {
        coralL1: null as boolean | null,
        coralL2: null as boolean | null,
        coralL3: null as boolean | null,
        coralL4: null as boolean | null,
        scoreProcessor: null as boolean | null,
        scoreNetRobot: null as boolean | null,
        startingOpposite: null as boolean | null,
        startingMiddle: null as boolean | null,
        startingProcessor: null as boolean | null,
        pitDisposition: "-",
        driveDisposition: "-",
        bargeCapability: "-",
      };
    }
    const anyTrue = (selector: (row: PitEntry) => boolean | undefined) => {
      const values = teamPitFiltered.map(selector).filter((value): value is boolean => typeof value === "boolean");
      if (values.length === 0) return null;
      return values.some(Boolean);
    };
    return {
      coralL1: anyTrue((row) => row.coralL1),
      coralL2: anyTrue((row) => row.coralL2),
      coralL3: anyTrue((row) => row.coralL3),
      coralL4: anyTrue((row) => row.coralL4),
      scoreProcessor: anyTrue((row) => row.scoreProcessor),
      scoreNetRobot: anyTrue((row) => row.scoreNetRobot),
      startingOpposite: anyTrue((row) => row.startingOpposite),
      startingMiddle: anyTrue((row) => row.startingMiddle),
      startingProcessor: anyTrue((row) => row.startingProcessor),
      pitDisposition: percentTrue(teamPitFiltered.map((row) => row.pitDisposition)),
      driveDisposition: percentTrue(teamPitFiltered.map((row) => row.driveDisposition)),
      bargeCapability: mode(teamPitFiltered.map((row) => row.bargeCapability)),
    };
  }, [isReefscape, teamPitFiltered]);

  const matchAverages = useMemo(() => {
    return {
      preloadScale: avg(teamScoutingFiltered.map((entry) => toNumber(entry.auto?.preloadScale))),
      autoBpsScale: avg(teamScoutingFiltered.map((entry) => toNumber(entry.auto?.bpsScale))),
      autoCarryScale: avg(teamScoutingFiltered.map((entry) => toNumber(entry.auto?.carryingScale))),
      teleBpsScale: avg(teamScoutingFiltered.map((entry) => toNumber(entry.teleop?.bpsScale))),
      teleCarryScale: avg(teamScoutingFiltered.map((entry) => toNumber(entry.teleop?.carryingScale))),
      autoFuel: avg(teamScoutingFiltered.map((entry) => toNumber(entry.auto?.estimatedFuel))),
      teleFuel: avg(teamScoutingFiltered.map((entry) => toNumber(entry.teleop?.estimatedFuel))),
    };
  }, [teamScoutingFiltered]);

  const strategyRobots = useMemo(
    () =>
      teamStrategyFiltered.flatMap((entry) =>
        (entry.robots || []).filter((robot) => normalizeTeam(robot.teamNumber) === teamNumber)
      ),
    [teamStrategyFiltered, teamNumber]
  );

  const driveRobots = useMemo(
    () =>
      teamDriveFiltered.flatMap((entry) =>
        (entry.robots || []).filter((robot) => normalizeTeam(robot.teamNumber) === teamNumber)
      ),
    [teamDriveFiltered, teamNumber]
  );

  const knownEvents = useMemo(() => {
    const fromData = new Map<string, string>();
    teamScoutingAll.forEach((entry) => {
      const key = String(entry.eventKey || "").trim();
      if (!key) return;
      const option = getEventsForGame(selectedGame).find((row) => row.id === key);
      fromData.set(key, option?.name || key);
    });
    pitEntries.forEach((entry) => {
      if (normalizeTeam(entry.teamNumber) !== teamNumber) return;
      const key = String(entry.eventKey || "").trim();
      if (!key) return;
      const option = getEventsForGame(selectedGame).find((row) => row.id === key);
      fromData.set(key, option?.name || key);
    });
    const collectRobotEvents = (entries: Array<StrategyPlanEntry | DriveEntry>) => {
      entries.forEach((entry) => {
        if (!Array.isArray(entry.robots) || !entry.robots.some((robot) => normalizeTeam(robot.teamNumber) === teamNumber)) return;
        const key = String(entry.eventKey || "").trim();
        if (!key) return;
        const option = getEventsForGame(selectedGame).find((row) => row.id === key);
        fromData.set(key, option?.name || key);
      });
    };
    if (!isReefscape) {
      collectRobotEvents(strategyEntries);
      collectRobotEvents(driveEntries);
    }
    const merged = new Map<string, string>();
    Array.from(fromData.entries()).forEach(([key, name]) => merged.set(key, name));
    knownTeamEvents.forEach((event) => {
      if (!event.key) return;
      if (!merged.has(event.key)) merged.set(event.key, event.name || event.key);
    });
    const selectedEventSet = new Set(selectedTeamEvents.map((value) => String(value || "").trim()).filter(Boolean));
    return Array.from(merged.entries())
      .map(([key, name]) => ({ key, name, isCommon: selectedEventSet.has(key) }))
      .sort((a, b) => {
        if (a.isCommon !== b.isCommon) return a.isCommon ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [teamScoutingAll, pitEntries, strategyEntries, driveEntries, teamNumber, knownTeamEvents, selectedGame, isReefscape, selectedTeamEvents]);

  const statboticsYear = useMemo(() => {
    const preferred = selectedEvent !== "all" ? Number(selectedEvent.slice(0, 4)) : NaN;
    if (Number.isFinite(preferred) && preferred > 2000) return preferred;
    const fromKnown = knownEvents
      .map((event) => Number(String(event.key || "").slice(0, 4)))
      .find((year) => Number.isFinite(year) && year > 2000);
    if (Number.isFinite(fromKnown)) return fromKnown as number;
    return new Date().getFullYear();
  }, [selectedEvent, knownEvents]);

  useEffect(() => {
    async function loadStatbotics() {
      if (!teamNumber) {
        setStatboticsTeamYear(null);
        setStatboticsTeamEvent(null);
        setStatboticsUnavailable(false);
        setStatboticsError("");
        return;
      }
      setStatboticsLoading(true);
      setStatboticsUnavailable(false);
      setStatboticsError("");
      try {
        const params = new URLSearchParams({
          teamNumber,
          year: String(statboticsYear),
        });
        if (selectedEvent !== "all") params.set("eventKey", selectedEvent);
        const response = await fetch(`/api/statbotics/team?${params.toString()}`);
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          teamYear?: StatboticsTeamYear;
          teamEvent?: StatboticsTeamEvent;
          unavailable?: boolean;
          upstreamStatus?: number;
        };
        if (!response.ok) {
          setStatboticsTeamYear(null);
          setStatboticsTeamEvent(null);
          setStatboticsUnavailable(false);
          setStatboticsError(payload.error || `Unable to load Statbotics (${response.status})`);
          return;
        }
        setStatboticsUnavailable(Boolean(payload.unavailable));
        setStatboticsTeamYear(payload.teamYear || null);
        setStatboticsTeamEvent(payload.teamEvent || null);
      } catch {
        setStatboticsTeamYear(null);
        setStatboticsTeamEvent(null);
        setStatboticsUnavailable(false);
        setStatboticsError("Unable to load Statbotics right now.");
      } finally {
        setStatboticsLoading(false);
      }
    }
    void loadStatbotics();
  }, [teamNumber, statboticsYear, selectedEvent]);

  useEffect(() => {
    if (teamDisplayName) return;
    const fallback = String(statboticsTeamYear?.name || "").trim();
    if (fallback) setTeamDisplayName(fallback);
  }, [teamDisplayName, statboticsTeamYear]);

  const pastEvents = useMemo(() => {
    const byEvent = new Map<string, { count: number; totalScore: number }>();
    teamScoutingAllForStats.forEach((entry) => {
      const key = String(entry.eventKey || "").trim();
      if (!key || !isPastEventKey(key, eventOptions)) return;
      const existing = byEvent.get(key) || { count: 0, totalScore: 0 };
      existing.count += 1;
      existing.totalScore += scoreEntry(entry, selectedGame);
      byEvent.set(key, existing);
    });
    return Array.from(byEvent.entries()).map(([key, value]) => ({
      key,
      name: eventOptions.find((option) => option.id === key)?.name || key,
      matches: value.count,
      avgScore: value.count > 0 ? value.totalScore / value.count : 0,
    }));
  }, [teamScoutingAllForStats, eventOptions, selectedGame]);

  const filteredEntryCount = teamScoutingFiltered.length + teamPitFiltered.length + teamStrategyFiltered.length + teamDriveFiltered.length;

  return (
    <AnalyticsShell
      entriesCount={filteredEntryCount}
      selectedGame={selectedGame}
      onSelectedGameChange={(game) => setSelectedGame(game as AnalyticsGame)}
      practiceMatchesOnly={practiceMatchesOnly}
      onPracticeMatchesOnlyChange={setPracticeMatchesOnly}
      selectedEvent={selectedEvent}
      eventOptions={[{ id: "all", name: "All Events" }, ...eventOptions]}
      onSelectedEventChange={setSelectedEvent}
    >
      <div className="mb-6">
        <Link href="/analytics/team-breakdown" className="text-sm text-blue-700 hover:underline">
          Back to Team Breakdown list
        </Link>
        <h1 className="text-3xl font-bold mt-2 mb-1 theme-text">
          Team {teamNumber || "Unknown"}{teamDisplayName ? ` - ${teamDisplayName}` : ""} Breakdown
        </h1>
        {selectedEvent !== "all" && (
          <p className="text-sm mb-1">
            <Link href={`/event-details/${selectedEvent}?tab=teams&team=${teamNumber}`} className="text-blue-700 hover:underline">
              Open this team in Event Details
            </Link>
          </p>
        )}
        <p className="text-gray-600">
          {isReefscape
            ? "Reefscape summary using match scout and pit scout data."
            : "Cross-form summary for this team across scouting, pit, strategy, and drive reflection data."}
        </p>
      </div>

      {loading ? (
        <LoadingSpinner message="Loading team breakdown..." />
      ) : (
        <div className="space-y-6">
          <div className={`grid gap-4 ${isReefscape ? "md:grid-cols-3" : "md:grid-cols-4"}`}>
            <div className="bg-white rounded-xl shadow p-4" data-analytics-search-item="true">
              <p className="text-sm text-gray-500">Robot Name</p>
              <p className="text-xl font-semibold">{robotName}</p>
            </div>
            <div className="bg-white rounded-xl shadow p-4" data-analytics-search-item="true">
              <p className="text-sm text-gray-500">Scouted Matches (Filtered)</p>
              <p className="text-xl font-semibold">{teamScoutingFiltered.length}</p>
            </div>
            <div className="bg-white rounded-xl shadow p-4" data-analytics-search-item="true">
              <p className="text-sm text-gray-500">Pit Entries (Filtered)</p>
              <p className="text-xl font-semibold">{teamPitFiltered.length}</p>
            </div>
            {!isReefscape && (
              <div className="bg-white rounded-xl shadow p-4" data-analytics-search-item="true">
                <p className="text-sm text-gray-500">Strategy Plans (Filtered)</p>
                <p className="text-xl font-semibold">{teamStrategyFiltered.length}</p>
              </div>
            )}
            {!isReefscape && (
              <div className="bg-white rounded-xl shadow p-4" data-analytics-search-item="true">
                <p className="text-sm text-gray-500">Drive Reflections (Filtered)</p>
                <p className="text-xl font-semibold">{teamDriveFiltered.length}</p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow p-5" data-analytics-search-item="true">
            <div className="bg-white rounded-xl shadow-md p-2 mb-4 flex gap-2">
              <button
                type="button"
                onClick={() => setSummaryTab("matchScouted")}
                className={`flex-1 px-4 py-2 rounded font-medium transition-colors ${
                  summaryTab === "matchScouted"
                    ? "bg-red-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Match-Scouted
              </button>
              <button
                type="button"
                onClick={() => setSummaryTab("statbotics")}
                className={`flex-1 px-4 py-2 rounded font-medium transition-colors ${
                  summaryTab === "statbotics"
                    ? "bg-red-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Statbotics
              </button>
            </div>
            <div className="flex justify-end mb-3">
              {summaryTab === "statbotics" && (
                <p className="text-xs text-gray-500">
                  Source: <a href="https://www.statbotics.io/" target="_blank" rel="noreferrer" className="underline">Statbotics</a> (api.statbotics.io)
                </p>
              )}
            </div>
            {summaryTab === "matchScouted" ? (
              isReefscape ? (
                <div className="grid md:grid-cols-3 gap-3 text-sm">
                  <p>
                    Avg Match Score:{" "}
                    <span className="font-semibold">
                      {displayNumber(avg(teamScoutingFiltered.map((entry) => scoreEntry(entry, selectedGame))), 2)}
                    </span>
                  </p>
                  <p>Avg Auto L4 Coral: <span className="font-semibold">{displayNumber(avg(teamScoutingFiltered.map((entry) => toNumber(entry.autoCoralL4))))}</span></p>
                  <p>Avg Teleop L4 Coral: <span className="font-semibold">{displayNumber(avg(teamScoutingFiltered.map((entry) => toNumber(entry.teleopCoralL4))))}</span></p>
                  <p>Avg Auto Processor Algae: <span className="font-semibold">{displayNumber(avg(teamScoutingFiltered.map((entry) => toNumber(entry.autoAlgaeProcessorScored))))}</span></p>
                  <p>Avg Teleop Processor Algae: <span className="font-semibold">{displayNumber(avg(teamScoutingFiltered.map((entry) => toNumber(entry.teleopProcessorScored))))}</span></p>
                  <p>Avg Penalty Points: <span className="font-semibold">{displayNumber(avg(teamScoutingFiltered.map((entry) => toNumber(entry.penaltyPoints))))}</span></p>
                </div>
              ) : (
                <div className="grid md:grid-cols-3 gap-3 text-sm">
                  <p>Auto Preload Scale: <span className="font-semibold">{displayNumber(matchAverages.preloadScale)}</span></p>
                  <p>Auto BPS Scale: <span className="font-semibold">{displayNumber(matchAverages.autoBpsScale)}</span></p>
                  <p>Auto Carry Scale: <span className="font-semibold">{displayNumber(matchAverages.autoCarryScale)}</span></p>
                  <p>Teleop BPS Scale: <span className="font-semibold">{displayNumber(matchAverages.teleBpsScale)}</span></p>
                  <p>Teleop Carry Scale: <span className="font-semibold">{displayNumber(matchAverages.teleCarryScale)}</span></p>
                  <p>Avg Auto Fuel: <span className="font-semibold">{displayNumber(matchAverages.autoFuel)}</span></p>
                  <p>Avg Teleop Fuel: <span className="font-semibold">{displayNumber(matchAverages.teleFuel)}</span></p>
                </div>
              )
            ) : statboticsLoading ? (
              <p className="text-sm text-gray-600">Loading Statbotics data...</p>
            ) : statboticsUnavailable ? (
              <p className="text-sm text-gray-600">Statbotics does not currently have data available for this team/year.</p>
            ) : statboticsError ? (
              <p className="text-sm text-red-600">{statboticsError}</p>
            ) : (
              <div className="space-y-4 text-sm">
                <div className="grid md:grid-cols-3 gap-3">
                  <p>Season EPA (Points): <span className="font-semibold">{displayNumber(asFiniteNumber(statboticsTeamYear?.epa?.total_points?.mean), 2)}</span></p>
                  <p>Season Record: <span className="font-semibold">{formatRecord(statboticsTeamYear?.record)}</span></p>
                  <p>Season Win Rate: <span className="font-semibold">{asPercent(statboticsTeamYear?.record?.winrate)}</span></p>
                  <p>
                    Global Rank:{" "}
                    <span className="font-semibold">
                      {statboticsTeamYear?.epa?.ranks?.total?.rank && statboticsTeamYear?.epa?.ranks?.total?.team_count
                        ? `${statboticsTeamYear.epa.ranks.total.rank}/${statboticsTeamYear.epa.ranks.total.team_count}`
                        : "-"}
                    </span>
                  </p>
                  <p>Global Percentile: <span className="font-semibold">{asPercent(statboticsTeamYear?.epa?.ranks?.total?.percentile)}</span></p>
                  <p>Auto / Teleop / Endgame EPA: <span className="font-semibold">{`${displayNumber(asFiniteNumber(statboticsTeamYear?.epa?.breakdown?.auto_points), 2)} / ${displayNumber(asFiniteNumber(statboticsTeamYear?.epa?.breakdown?.teleop_points), 2)} / ${displayNumber(asFiniteNumber(statboticsTeamYear?.epa?.breakdown?.endgame_points), 2)}`}</span></p>
                </div>
                {selectedEvent !== "all" && statboticsTeamEvent && (
                  <div className="pt-3 border-t border-gray-200 grid md:grid-cols-3 gap-3">
                    <p>Event: <span className="font-semibold">{statboticsTeamEvent.event_name || selectedEvent}</span></p>
                    <p>Event EPA (Points): <span className="font-semibold">{displayNumber(asFiniteNumber(statboticsTeamEvent.epa?.total_points?.mean), 2)}</span></p>
                    <p>Event Record: <span className="font-semibold">{formatRecord(statboticsTeamEvent.record?.total)}</span></p>
                    <p>
                      Event Qual Rank:{" "}
                      <span className="font-semibold">
                        {statboticsTeamEvent.record?.qual?.rank && statboticsTeamEvent.record?.qual?.num_teams
                          ? `${statboticsTeamEvent.record.qual.rank}/${statboticsTeamEvent.record.qual.num_teams}`
                          : "-"}
                      </span>
                    </p>
                    <p>Event Auto / Teleop / Endgame EPA: <span className="font-semibold">{`${displayNumber(asFiniteNumber(statboticsTeamEvent.epa?.breakdown?.auto_points), 2)} / ${displayNumber(asFiniteNumber(statboticsTeamEvent.epa?.breakdown?.teleop_points), 2)} / ${displayNumber(asFiniteNumber(statboticsTeamEvent.epa?.breakdown?.endgame_points), 2)}`}</span></p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow p-5">
            <h2 className="text-xl font-semibold mb-3">Capability Comparison</h2>
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs uppercase text-gray-500">Capability</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-gray-500">Match Scout</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-gray-500">Pit Scout</th>
                  {!isReefscape && <th className="px-3 py-2 text-left text-xs uppercase text-gray-500">Match Strategy</th>}
                  {!isReefscape && <th className="px-3 py-2 text-left text-xs uppercase text-gray-500">Drive Reflection</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                <tr>
                  <td className="px-3 py-2 font-medium">{isReefscape ? "Coral Scoring (L1/L2/L3/L4)" : "Preload / BPS / Carry"}</td>
                  <td className="px-3 py-2 text-sm">
                    {isReefscape
                      ? `${displayNumber(avg(teamScoutingFiltered.map((entry) => toNumber(entry.teleopCoralL1))))} / ${displayNumber(avg(teamScoutingFiltered.map((entry) => toNumber(entry.teleopCoralL2))))} / ${displayNumber(avg(teamScoutingFiltered.map((entry) => toNumber(entry.teleopCoralL3))))} / ${displayNumber(avg(teamScoutingFiltered.map((entry) => toNumber(entry.teleopCoralL4))))}`
                      : `${displayNumber(matchAverages.preloadScale)} / ${displayNumber(matchAverages.autoBpsScale)} / ${displayNumber(matchAverages.autoCarryScale)}`}
                  </td>
                  <td className="px-3 py-2 text-sm">
                    {isReefscape
                      ? `${yesNo(reefscapePitSummary.coralL1)} / ${yesNo(reefscapePitSummary.coralL2)} / ${yesNo(reefscapePitSummary.coralL3)} / ${yesNo(reefscapePitSummary.coralL4)}`
                      : pitLatest
                        ? `${pitLatest.fuelPreloadCapacity || "-"} / ${pitLatest.fuelBallsPerSecond || "-"} / ${pitLatest.fuelCarryingCapacity || "-"}`
                        : "-"}
                  </td>
                  {!isReefscape && <td className="px-3 py-2 text-sm">-</td>}
                  {!isReefscape && <td className="px-3 py-2 text-sm">-</td>}
                </tr>
                {isReefscape && (
                  <tr>
                    <td className="px-3 py-2 font-medium">Algae Scoring (Processor / Net)</td>
                    <td className="px-3 py-2 text-sm">
                      {`${displayNumber(
                        avg(
                          teamScoutingFiltered.map(
                            (entry) => Number(toNumber(entry.autoAlgaeProcessorScored) || 0) + Number(toNumber(entry.teleopProcessorScored) || 0)
                          )
                        )
                      )} / ${displayNumber(
                        avg(
                          teamScoutingFiltered.map(
                            (entry) => Number(toNumber(entry.teleopNetRobotScored) || 0) + Number(toNumber(entry.teleopNetHumanScored) || 0)
                          )
                        )
                      )}`}
                    </td>
                    <td className="px-3 py-2 text-sm">{`${yesNo(reefscapePitSummary.scoreProcessor)} / ${yesNo(reefscapePitSummary.scoreNetRobot)}`}</td>
                  </tr>
                )}
                {!isReefscape && (
                  <tr>
                    <td className="px-3 py-2 font-medium">Starting Position</td>
                    <td className="px-3 py-2 text-sm">-</td>
                    <td className="px-3 py-2 text-sm">-</td>
                    <td className="px-3 py-2 text-sm">{mode(strategyRobots.map((row) => row.startingPosition))}</td>
                    <td className="px-3 py-2 text-sm">{mode(driveRobots.map((row) => row.startingPosition))}</td>
                  </tr>
                )}
                {!isReefscape && (
                  <tr>
                    <td className="px-3 py-2 font-medium">Role</td>
                    <td className="px-3 py-2 text-sm">-</td>
                    <td className="px-3 py-2 text-sm">-</td>
                    <td className="px-3 py-2 text-sm">{mode(strategyRobots.map((row) => row.role))}</td>
                    <td className="px-3 py-2 text-sm">{mode(driveRobots.map((row) => row.role))}</td>
                  </tr>
                )}
                <tr>
                  <td className="px-3 py-2 font-medium">Auto Climb</td>
                  <td className="px-3 py-2 text-sm">{percentTrue(teamScoutingFiltered.map((entry) => entry.auto?.successfulClimb))}</td>
                  <td className="px-3 py-2 text-sm">-</td>
                  {!isReefscape && <td className="px-3 py-2 text-sm">{percentTrue(strategyRobots.map((row) => row.autoClimb))}</td>}
                  {!isReefscape && <td className="px-3 py-2 text-sm">{percentTrue(driveRobots.map((row) => row.autoClimb))}</td>}
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium">Endgame Climb</td>
                  <td className="px-3 py-2 text-sm">{mode(teamScoutingFiltered.map((entry) => entry.endgame?.status))}</td>
                  <td className="px-3 py-2 text-sm">-</td>
                  {!isReefscape && <td className="px-3 py-2 text-sm">{mode(strategyRobots.map((row) => row.endgameClimb))}</td>}
                  {!isReefscape && <td className="px-3 py-2 text-sm">{mode(driveRobots.map((row) => row.endgameClimb))}</td>}
                </tr>
                {isReefscape && (
                  <tr>
                    <td className="px-3 py-2 font-medium">Starting Position</td>
                    <td className="px-3 py-2 text-sm">{mode(teamScoutingFiltered.map((entry) => entry.startingPosition))}</td>
                    <td className="px-3 py-2 text-sm">
                      {`Opposite:${yesNo(reefscapePitSummary.startingOpposite)} | Middle:${yesNo(reefscapePitSummary.startingMiddle)} | Processor:${yesNo(reefscapePitSummary.startingProcessor)}`}
                    </td>
                  </tr>
                )}
                {isReefscape && (
                  <tr>
                    <td className="px-3 py-2 font-medium">Barge / Endgame</td>
                    <td className="px-3 py-2 text-sm">{mode(teamScoutingFiltered.map((entry) => entry.stageStatus || entry.endgame?.status))}</td>
                    <td className="px-3 py-2 text-sm">{reefscapePitSummary.bargeCapability}</td>
                  </tr>
                )}
                {isReefscape && (
                  <tr>
                    <td className="px-3 py-2 font-medium">Left Starting Zone</td>
                    <td className="px-3 py-2 text-sm">{percentTrue(teamScoutingFiltered.map((entry) => Boolean(entry.leftStartingZone)))}</td>
                    <td className="px-3 py-2 text-sm">-</td>
                  </tr>
                )}
                {isReefscape && (
                  <tr>
                    <td className="px-3 py-2 font-medium">Disposition (Pit / Drive)</td>
                    <td className="px-3 py-2 text-sm">-</td>
                    <td className="px-3 py-2 text-sm">{`${reefscapePitSummary.pitDisposition} / ${reefscapePitSummary.driveDisposition}`}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl shadow p-5" data-analytics-search-item="true">
            <h2 className="text-xl font-semibold mb-3">Past Event Match Data</h2>
            {pastEvents.length === 0 ? (
              <p className="text-sm text-gray-600">No past-event scouting data found for this team.</p>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs uppercase text-gray-500">Event</th>
                    <th className="px-3 py-2 text-left text-xs uppercase text-gray-500">Matches</th>
                    <th className="px-3 py-2 text-left text-xs uppercase text-gray-500">Avg Match Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pastEvents.map((event) => (
                    <tr key={event.key}>
                      <td className="px-3 py-2">{event.name}</td>
                      <td className="px-3 py-2">{event.matches}</td>
                      <td className="px-3 py-2">{displayNumber(event.avgScore, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-white rounded-xl shadow p-5" data-analytics-search-item="true">
            <h2 className="text-xl font-semibold mb-3">Known Events They&apos;re Going To</h2>
            {knownEvents.length === 0 ? (
              <p className="text-sm text-gray-600">No event list found from synced data for this team yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {knownEvents.map((event) => (
                  <span
                    key={event.key}
                    className={`px-3 py-1 rounded border text-sm ${
                      event.isCommon ? "bg-green-100 border-green-300 text-green-900" : "bg-gray-50"
                    }`}
                  >
                    {event.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </AnalyticsShell>
  );
}

export default function TeamBreakdownDetailPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <TeamBreakdownDetailContent />
    </ProtectedRoute>
  );
}
