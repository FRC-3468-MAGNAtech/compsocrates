"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { ChevronLeft, ExternalLink, Radar, Users } from "lucide-react";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import {
  Action,
  Chip,
  CommandBar,
  HudCanvas,
  HudViewport,
  PageIntro,
  Surface,
} from "@/app/components/Hud";
import { entryMatchesAnalyticsFilters, getEventOptionsForEntries, isPracticeScoutedEntry, type AnalyticsGame } from "@/app/utils/analyticsEvents";
import { dedupeEntriesByMatchTeam } from "@/app/utils/entryDeduping";

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
    successfulClimb?: boolean;
  };
  teleop?: {
    estimatedFuel?: number;
  };
  endgame?: {
    status?: string;
  };
  excludeFromStats?: boolean;
  isPracticeScouting?: boolean;
  practiceMode?: string;
  practiceSessionId?: string;
};

type PitEntry = {
  eventKey?: string;
  game?: string;
  teamNumber?: string;
  createdAt?: number;
};

type StrategyOrDriveEntry = {
  eventKey?: string;
  game?: string;
  createdAt?: number;
  robots?: Array<{ teamNumber?: string }>;
};

type TeamSummary = {
  teamNumber: string;
  avgScore: number | null;
  matches: number;
  lastSeen: number;
  preferredEventKey: string;
};

function getFirstEventCodeFromTbaKey(key: string): string {
  const normalized = String(key || "").toLowerCase();
  const specialMap: Record<string, string> = {
    "2026lake": "LAKE",
    "2025lake": "LAKE",
  };
  if (specialMap[normalized]) return specialMap[normalized];
  const suffix = normalized.slice(4).toUpperCase();
  return suffix || normalized.toUpperCase();
}

function normalizeTeamNumber(value: unknown) {
  return String(value || "").replace(/[^\d]/g, "");
}

// Scoring parity with app/analytics/team-breakdown (source of truth).
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

function isPracticeEntry(entry: ScoutingEntry) {
  return isPracticeScoutedEntry(entry);
}

function gameForAuxEntry(rawGame: unknown): AnalyticsGame {
  return String(rawGame || "").toUpperCase() === "REEFSCAPE" ? "REEFSCAPE" : "REBUILT";
}

function TeamBreakdownContent() {
  const [scoutingEntries, setScoutingEntries] = useState<ScoutingEntry[]>([]);
  const [pitEntries, setPitEntries] = useState<PitEntry[]>([]);
  const [strategyEntries, setStrategyEntries] = useState<StrategyOrDriveEntry[]>([]);
  const [driveEntries, setDriveEntries] = useState<StrategyOrDriveEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REEFSCAPE");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [teamNameByNumber, setTeamNameByNumber] = useState<Record<string, string>>({});

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
    async function loadEntries() {
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
        setStrategyEntries(strategySnap.docs.map((d) => d.data() as StrategyOrDriveEntry));
        setDriveEntries(driveSnap.docs.map((d) => d.data() as StrategyOrDriveEntry));
      } finally {
        setLoading(false);
      }
    }
    void loadEntries();
  }, []);

  const eventSeedEntries = useMemo(
    () => [
      ...scoutingEntries,
      ...pitEntries.map((entry) => ({ eventKey: entry.eventKey, game: gameForAuxEntry(entry.game) })),
      ...strategyEntries.map((entry) => ({ eventKey: entry.eventKey, game: gameForAuxEntry(entry.game) })),
      ...driveEntries.map((entry) => ({ eventKey: entry.eventKey, game: gameForAuxEntry(entry.game) })),
    ],
    [scoutingEntries, pitEntries, strategyEntries, driveEntries]
  );

  const eventOptions = useMemo(() => getEventOptionsForEntries(eventSeedEntries, selectedGame), [eventSeedEntries, selectedGame]);

  const filteredScoutingEntries = useMemo(() => {
    const gameFiltered = scoutingEntries.filter((entry) =>
      entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent, eventOptions)
    );
    return gameFiltered
      .filter((entry) => (practiceMatchesOnly ? isPracticeEntry(entry) : !isPracticeEntry(entry)))
      .filter((entry) => !entry.excludeFromStats);
  }, [scoutingEntries, selectedEvent, selectedGame, practiceMatchesOnly, eventOptions]);

  const dedupedScoutingEntries = useMemo(
    () =>
      dedupeEntriesByMatchTeam(filteredScoutingEntries, {
        game: selectedGame,
        eventOptions,
        selectedEvent,
        preferLatest: true,
      }),
    [filteredScoutingEntries, selectedGame, eventOptions, selectedEvent]
  );

  const filteredPitEntries = useMemo(() => {
    if (practiceMatchesOnly) return [] as PitEntry[];
    return pitEntries.filter((entry) => {
      if (gameForAuxEntry(entry.game) !== selectedGame) return false;
      if (selectedEvent !== "all" && String(entry.eventKey || "").trim() !== selectedEvent) return false;
      return true;
    });
  }, [pitEntries, selectedEvent, selectedGame, practiceMatchesOnly]);

  const filteredStrategyEntries = useMemo(() => {
    if (practiceMatchesOnly) return [] as StrategyOrDriveEntry[];
    if (selectedGame === "REEFSCAPE") return [] as StrategyOrDriveEntry[];
    return strategyEntries.filter((entry) => {
      if (gameForAuxEntry(entry.game) !== selectedGame) return false;
      if (selectedEvent !== "all" && String(entry.eventKey || "").trim() !== selectedEvent) return false;
      return true;
    });
  }, [strategyEntries, selectedEvent, selectedGame, practiceMatchesOnly]);

  const filteredDriveEntries = useMemo(() => {
    if (practiceMatchesOnly) return [] as StrategyOrDriveEntry[];
    if (selectedGame === "REEFSCAPE") return [] as StrategyOrDriveEntry[];
    return driveEntries.filter((entry) => {
      if (gameForAuxEntry(entry.game) !== selectedGame) return false;
      if (selectedEvent !== "all" && String(entry.eventKey || "").trim() !== selectedEvent) return false;
      return true;
    });
  }, [driveEntries, selectedEvent, selectedGame, practiceMatchesOnly]);

  const teamRows = useMemo(() => {
    const grouped = new Map<string, { scores: number[]; matches: number; lastSeen: number; preferredEventKey: string }>();

    dedupedScoutingEntries.forEach((entry) => {
      const teamNumber = normalizeTeamNumber(entry.teamNumber);
      if (!teamNumber) return;
      const row = grouped.get(teamNumber) || { scores: [], matches: 0, lastSeen: 0, preferredEventKey: "" };
      row.scores.push(scoreEntry(entry, selectedGame));
      row.matches += 1;
      row.lastSeen = Math.max(row.lastSeen, Number(entry.submittedAt || entry.timestamp || 0));
      if (!row.preferredEventKey && entry.eventKey) row.preferredEventKey = String(entry.eventKey).trim();
      grouped.set(teamNumber, row);
    });

    filteredPitEntries.forEach((entry) => {
      const teamNumber = normalizeTeamNumber(entry.teamNumber);
      if (!teamNumber) return;
      const row = grouped.get(teamNumber) || { scores: [], matches: 0, lastSeen: 0, preferredEventKey: "" };
      row.lastSeen = Math.max(row.lastSeen, Number(entry.createdAt || 0));
      if (!row.preferredEventKey && entry.eventKey) row.preferredEventKey = String(entry.eventKey).trim();
      grouped.set(teamNumber, row);
    });

    const mergeRobotRows = (entries: StrategyOrDriveEntry[]) => {
      entries.forEach((entry) => {
        (entry.robots || []).forEach((robot) => {
          const teamNumber = normalizeTeamNumber(robot.teamNumber);
          if (!teamNumber) return;
          const row = grouped.get(teamNumber) || { scores: [], matches: 0, lastSeen: 0, preferredEventKey: "" };
          row.lastSeen = Math.max(row.lastSeen, Number(entry.createdAt || 0));
          if (!row.preferredEventKey && entry.eventKey) row.preferredEventKey = String(entry.eventKey).trim();
          grouped.set(teamNumber, row);
        });
      });
    };
    mergeRobotRows(filteredStrategyEntries);
    mergeRobotRows(filteredDriveEntries);

    const rows: TeamSummary[] = Array.from(grouped.entries()).map(([teamNumber, value]) => ({
      teamNumber,
      avgScore: value.scores.length > 0 ? Math.round(value.scores.reduce((a, b) => a + b, 0) / value.scores.length) : null,
      matches: value.matches,
      lastSeen: value.lastSeen,
      preferredEventKey: value.preferredEventKey,
    }));

    return rows.sort((a, b) => Number(a.teamNumber) - Number(b.teamNumber));
  }, [filteredScoutingEntries, filteredPitEntries, filteredStrategyEntries, filteredDriveEntries, selectedGame]);

  useEffect(() => {
    async function loadTeamNames() {
      const eventKeys = new Set<string>();
      if (selectedEvent !== "all") {
        eventKeys.add(selectedEvent);
      } else {
        teamRows.forEach((row) => {
          if (row.preferredEventKey) eventKeys.add(row.preferredEventKey);
        });
      }
      if (eventKeys.size === 0) {
        setTeamNameByNumber({});
        return;
      }

      const merged = new Map<string, string>();
      await Promise.all(
        Array.from(eventKeys).map(async (eventKey) => {
          const year = Number(eventKey.slice(0, 4));
          const eventCode = getFirstEventCodeFromTbaKey(eventKey);
          if (!Number.isFinite(year) || !eventCode) return;
          try {
            const response = await fetch("/api/first/teams", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ year, eventCode }),
            });
            if (!response.ok) return;
            const payload = await response.json();
            const teams = Array.isArray(payload.teams)
              ? (payload.teams as Array<{ teamNumber?: number; nameShort?: string }>)
              : [];
            teams.forEach((team) => {
              const num = Number(team.teamNumber || 0);
              const name = String(team.nameShort || "").trim();
              if (!num || !name) return;
              const key = String(num);
              if (!merged.has(key)) merged.set(key, name);
            });
          } catch {
            // Best-effort names only.
          }
        })
      );

      setTeamNameByNumber(Object.fromEntries(Array.from(merged.entries())));
    }
    void loadTeamNames();
  }, [teamRows, selectedEvent]);

  const allEventOptions = [{ id: "all", name: "All Events" }, ...eventOptions];
  const filteredEntryCount =
    dedupedScoutingEntries.length + filteredPitEntries.length + filteredStrategyEntries.length + filteredDriveEntries.length;

  return (
    <HudCanvas>
      <CommandBar>
        <Link href="/analytics" className="flex items-center gap-2 rounded-full py-1.5 pl-2 pr-3 text-sm font-bold text-slate-800">
          <ChevronLeft className="h-4 w-4" />
          Analytics
        </Link>
        <Action variant={selectedGame === "REEFSCAPE" ? "primary" : "ghost"} onClick={() => setSelectedGame("REEFSCAPE")}>
          Reefscape
        </Action>
        <Action variant={selectedGame === "REBUILT" ? "primary" : "ghost"} onClick={() => setSelectedGame("REBUILT")}>
          Rebuilt
        </Action>
      </CommandBar>

      <HudViewport>
        <PageIntro
          eyebrow="Cross-Form Roster"
          title="Team Breakdown"
          subtitle="Open any team for cross-form details, event history, and capability comparisons."
          actions={<Chip icon={Users} label="Teams" value={teamRows.length} tone="crimson" />}
        />

        <div className="mt-8 grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <Surface className="flex flex-wrap items-center gap-3 p-4">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
              Event
              <select
                value={selectedEvent}
                onChange={(e) => setSelectedEvent(e.target.value)}
                className="!min-h-0 !py-1.5 text-sm font-semibold text-slate-900"
              >
                {allEventOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
              <input
                type="checkbox"
                checked={practiceMatchesOnly}
                onChange={(e) => setPracticeMatchesOnly(e.target.checked)}
                className="h-4 w-4"
              />
              Practice Only
            </label>
          </Surface>
          <Chip label="Filtered Entries" value={filteredEntryCount} tone="gold" />
        </div>

        {loading ? (
          <Surface className="mt-8 p-10 text-center text-sm text-slate-600">Loading team breakdown…</Surface>
        ) : (
          <Surface raised className="mt-8 overflow-hidden p-2">
            <div className="table-scroll max-h-[70vh]">
              <table className="sticky-header">
                <thead>
                  <tr>
                    <th className="sticky-left-0">Team</th>
                    <th>Name</th>
                    <th>Avg Score</th>
                    <th>Scouted Matches</th>
                    <th>Last Seen</th>
                    <th>Event</th>
                  </tr>
                </thead>
                <tbody>
                  {teamRows.map((row) => (
                    <tr key={row.teamNumber}>
                      <td className="sticky-left-0 font-data font-bold text-red-800">
                        <Link
                          href={`/analytics/team-breakdown/${row.teamNumber}`}
                          className="underline decoration-red-300 decoration-2 underline-offset-2 hover:text-red-900"
                          onClick={() => localStorage.removeItem("analytics-search-term")}
                        >
                          {row.teamNumber}
                        </Link>
                      </td>
                      <td>{teamNameByNumber[row.teamNumber] || `Team ${row.teamNumber}`}</td>
                      <td className="font-data font-black">{row.avgScore === null ? "-" : row.avgScore}</td>
                      <td className="font-data">{row.matches}</td>
                      <td className="text-xs">{row.lastSeen > 0 ? new Date(row.lastSeen).toLocaleString() : "-"}</td>
                      <td>
                        {row.preferredEventKey && teamNameByNumber[row.teamNumber] ? (
                          <Link
                            href={`/event-details/${row.preferredEventKey}?tab=teams&team=${row.teamNumber}`}
                            className="inline-flex items-center gap-1 text-red-800 underline decoration-red-300 decoration-2 underline-offset-2 hover:text-red-900"
                          >
                            Open <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                  {teamRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        No teams match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Surface>
        )}

        <Surface className="mt-8 flex items-center gap-3 p-4 text-xs text-slate-500">
          <Radar className="h-4 w-4 text-red-800" />
          Rows merge match scout, pit scout, match strategy, and drive reflection data for the active game and event filter.
        </Surface>
      </HudViewport>
    </HudCanvas>
  );
}

export default function TeamBreakdownPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <TeamBreakdownContent />
    </ProtectedRoute>
  );
}
