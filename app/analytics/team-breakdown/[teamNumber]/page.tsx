"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
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

type ScoutingEntry = {
  eventKey?: string;
  submittedAt?: number;
  timestamp?: number;
  game?: string;
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
  isPracticeScouting?: boolean;
  practiceMode?: string;
  practiceSessionId?: string;
};

type PitEntry = {
  eventKey?: string;
  game?: string;
  teamNumber?: string;
  createdAt?: number;
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

function TeamBreakdownDetailContent() {
  const params = useParams<{ teamNumber: string }>();
  const teamNumber = normalizeTeam(params?.teamNumber);
  const [scoutingEntries, setScoutingEntries] = useState<ScoutingEntry[]>([]);
  const [pitEntries, setPitEntries] = useState<PitEntry[]>([]);
  const [strategyEntries, setStrategyEntries] = useState<StrategyPlanEntry[]>([]);
  const [driveEntries, setDriveEntries] = useState<DriveEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REEFSCAPE");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [knownTeamEvents, setKnownTeamEvents] = useState<Array<{ key: string; name: string; start_date?: string }>>([]);
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
        setScoutingEntries(scoutingSnap.docs.map((d) => d.data() as ScoutingEntry));
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

  const teamScoutingAll = useMemo(
    () => scoutingEntries.filter((entry) => normalizeTeam(entry.teamNumber) === teamNumber),
    [scoutingEntries, teamNumber]
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
    const gameFiltered = teamScoutingAll.filter((entry) => entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent, eventOptions));
    return gameFiltered.filter((entry) => (practiceMatchesOnly ? isPracticeScoutedEntry(entry) : !isPracticeScoutedEntry(entry)));
  }, [teamScoutingAll, selectedGame, selectedEvent, practiceMatchesOnly, eventOptions]);

  const teamPitFiltered = useMemo(() => {
    return pitEntries.filter((entry) => {
      if (normalizeTeam(entry.teamNumber) !== teamNumber) return false;
      if (String(entry.game || "REEFSCAPE") !== selectedGame) return false;
      if (selectedEvent !== "all" && String(entry.eventKey || "") !== selectedEvent) return false;
      return true;
    });
  }, [pitEntries, teamNumber, selectedGame, selectedEvent]);

  const teamStrategyFiltered = useMemo(() => {
    if (isReefscape) return [] as StrategyPlanEntry[];
    return strategyEntries
      .filter((entry) => String(entry.game || "REBUILT") === selectedGame)
      .filter((entry) => selectedEvent === "all" || String(entry.eventKey || "") === selectedEvent)
      .filter((entry) => Array.isArray(entry.robots) && entry.robots.some((robot) => normalizeTeam(robot.teamNumber) === teamNumber));
  }, [strategyEntries, selectedGame, selectedEvent, teamNumber, isReefscape]);

  const teamDriveFiltered = useMemo(() => {
    if (isReefscape) return [] as DriveEntry[];
    return driveEntries
      .filter((entry) => String(entry.game || "REBUILT") === selectedGame)
      .filter((entry) => selectedEvent === "all" || String(entry.eventKey || "") === selectedEvent)
      .filter((entry) => Array.isArray(entry.robots) && entry.robots.some((robot) => normalizeTeam(robot.teamNumber) === teamNumber));
  }, [driveEntries, selectedGame, selectedEvent, teamNumber, isReefscape]);

  const pitLatest = useMemo(() => {
    if (teamPitFiltered.length === 0) return null;
    return [...teamPitFiltered].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];
  }, [teamPitFiltered]);

  const robotName = useMemo(() => {
    if (!pitLatest) return "-";
    return String(pitLatest.robotName || pitLatest.robotNickname || pitLatest.robot || pitLatest.botName || "").trim() || "-";
  }, [pitLatest]);

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
    return Array.from(merged.entries()).map(([key, name]) => ({ key, name }));
  }, [teamScoutingAll, pitEntries, strategyEntries, driveEntries, teamNumber, knownTeamEvents, selectedGame, isReefscape]);

  const pastEvents = useMemo(() => {
    const byEvent = new Map<string, { count: number; totalScore: number }>();
    teamScoutingAll.forEach((entry) => {
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
  }, [teamScoutingAll, eventOptions, selectedGame]);

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
        <h1 className="text-3xl font-bold mt-2 mb-1 theme-text">Team {teamNumber || "Unknown"} Breakdown</h1>
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
            <h2 className="text-xl font-semibold mb-3">Match-Scouted Averages In Event</h2>
            {isReefscape ? (
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
                  <td className="px-3 py-2 font-medium">Preload / BPS / Carry</td>
                  <td className="px-3 py-2 text-sm">
                    {`${displayNumber(matchAverages.preloadScale)} / ${displayNumber(matchAverages.autoBpsScale)} / ${displayNumber(matchAverages.autoCarryScale)}`}
                  </td>
                  <td className="px-3 py-2 text-sm">
                    {pitLatest
                      ? `${pitLatest.fuelPreloadCapacity || "-"} / ${pitLatest.fuelBallsPerSecond || "-"} / ${pitLatest.fuelCarryingCapacity || "-"}`
                      : "-"}
                  </td>
                  {!isReefscape && <td className="px-3 py-2 text-sm">-</td>}
                  {!isReefscape && <td className="px-3 py-2 text-sm">-</td>}
                </tr>
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
                    <td className="px-3 py-2 font-medium">Left Starting Zone</td>
                    <td className="px-3 py-2 text-sm">{percentTrue(teamScoutingFiltered.map((entry) => Boolean(entry.leftStartingZone)))}</td>
                    <td className="px-3 py-2 text-sm">-</td>
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
                  <span key={event.key} className="px-3 py-1 rounded border bg-gray-50 text-sm">
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
