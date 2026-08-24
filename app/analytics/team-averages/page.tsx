"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, getDocs } from "firebase/firestore";
import { Award, ChevronLeft, Medal, Trophy, Users } from "lucide-react";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import {
  Action,
  Chip,
  CommandBar,
  Deck,
  HudCanvas,
  HudViewport,
  PageIntro,
  Surface,
} from "@/app/components/Hud";
import {
  entryMatchesAnalyticsFilters,
  getEventOptionsForEntries,
  isPracticeScoutedEntry,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";
import { dedupeEntriesByMatchTeam } from "@/app/utils/entryDeduping";

type TeamAverage = {
  teamNumber: string;
  matchCount: number;
  avgAuto: number;
  avgTeleop: number;
  avgEndgame: number;
  avgTotal: number;
};

type ScoutingEntry = {
  id?: string;
  eventKey?: string;
  eventName?: string;
  matchId?: string;
  matchKey?: string;
  matchLabel?: string;
  matchNumber?: string;
  submittedAt?: number;
  timestamp?: number;
  accuracy?: number;
  game?: string;
  teamNumber?: string;
  leftStartingZone?: boolean;
  stageStatus?: string;
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
  teleopAlgaeRemoved?: boolean;
  penaltyPoints?: number;
  estimatedScore?: number;
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
  matchType?: string;
  practiceMode?: string;
  isPracticeScouting?: boolean;
  excludeFromStats?: boolean;
};

function isPracticeEntry(entry: ScoutingEntry) {
  return isPracticeScoutedEntry(entry);
}

// Scoring parity with app/analytics/team-averages (source of truth).
function scoreEntry(entry: ScoutingEntry, game: AnalyticsGame): number {
  if (game === "REBUILT") {
    const autoFuel = Number(entry.auto?.estimatedFuel || 0);
    const teleFuel = Number(entry.teleop?.estimatedFuel || 0);
    const autoClimb = entry.auto?.successfulClimb ? 15 : 0;
    const endStatus = String(entry.endgame?.status || "").toLowerCase();
    const endgameClimb = endStatus === "level-1" ? 10 : endStatus === "level-2" ? 20 : endStatus === "level-3" ? 30 : 0;
    return autoFuel + teleFuel + autoClimb + endgameClimb;
  }

  const auto =
    (entry.autoCoralL1 || 0) * 3 +
    (entry.autoCoralL2 || 0) * 4 +
    (entry.autoCoralL3 || 0) * 6 +
    (entry.autoCoralL4 || 0) * 7 +
    (entry.autoAlgaeProcessorScored || 0) * 6 +
    (entry.autoAlgaeNetScored || 0) * 4 +
    (entry.leftStartingZone ? 3 : 0);
  const tele =
    (entry.teleopCoralL1 || 0) * 2 +
    (entry.teleopCoralL2 || 0) * 3 +
    (entry.teleopCoralL3 || 0) * 4 +
    (entry.teleopCoralL4 || 0) * 5 +
    (entry.teleopProcessorScored || 0) * 6 +
    (entry.teleopNetRobotScored || 0) * 4 +
    (entry.teleopNetHumanScored || 0) * 4 +
    (entry.teleopAlgaeRemoved ? 2 : 0);
  const stage = String(entry.stageStatus || "").toLowerCase();
  const end = stage.includes("deep") ? 12 : stage.includes("shallow") ? 6 : stage.includes("park") ? 2 : 0;
  return auto + tele + end + Number(entry.penaltyPoints || 0);
}

const podiumStyle = [
  {
    icon: Trophy,
    label: "1ST",
    priority: "critical" as const,
    ring: "from-amber-300 via-amber-200 to-white",
    accent: "text-red-800",
  },
  {
    icon: Medal,
    label: "2ND",
    priority: "high" as const,
    ring: "from-slate-200 via-white to-slate-100",
    accent: "text-slate-700",
  },
  {
    icon: Award,
    label: "3RD",
    priority: "normal" as const,
    ring: "from-amber-100 via-white to-amber-50",
    accent: "text-amber-800",
  },
];

function TeamAveragesContent() {
  const [entries, setEntries] = useState<ScoutingEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REEFSCAPE");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const eventOptions = useMemo(() => getEventOptionsForEntries(entries, selectedGame), [entries, selectedGame]);

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
        const snap = await getDocs(collection(db, "scouting"));
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } finally {
        setLoading(false);
      }
    }
    loadEntries();
  }, []);

  const filteredEntries = useMemo(() => {
    const gameFiltered = entries.filter((entry) =>
      entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent, eventOptions)
    );
    return gameFiltered
      .filter((entry) => (practiceMatchesOnly ? isPracticeEntry(entry) : !isPracticeEntry(entry)))
      .filter((entry) => !entry.excludeFromStats);
  }, [entries, selectedEvent, selectedGame, practiceMatchesOnly, eventOptions]);

  const dedupedEntries = useMemo(() => {
    return dedupeEntriesByMatchTeam(filteredEntries, {
      game: selectedGame,
      eventOptions,
      selectedEvent,
      preferLatest: true,
    });
  }, [filteredEntries, selectedGame, eventOptions, selectedEvent]);

  const averages = useMemo(() => {
    const teamData: Record<string, number[]> = {};
    dedupedEntries.forEach((e) => {
      const team = e.teamNumber;
      if (!team) return;
      const total = scoreEntry(e, selectedGame);
      if (!teamData[team]) teamData[team] = [];
      teamData[team].push(total);
    });

    const rows: TeamAverage[] = Object.entries(teamData).map(([teamNumber, totals]) => {
      const avgTotal = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
      return {
        teamNumber,
        matchCount: totals.length,
        avgAuto: 0,
        avgTeleop: 0,
        avgEndgame: 0,
        avgTotal,
      };
    });
    return rows.sort((a, b) => b.avgTotal - a.avgTotal);
  }, [dedupedEntries, selectedGame]);

  const podium = averages.slice(0, 3);
  const rest = averages.slice(3);
  const allEventOptions = [{ id: "all", name: "All Events" }, ...eventOptions];

  return (
    <HudCanvas>
      <CommandBar>
        <Link href="/analytics" className="flex items-center gap-2 rounded-full py-1.5 pl-2 pr-3 text-sm font-bold text-slate-800">
          <ChevronLeft className="h-4 w-4" />
          Analytics
        </Link>
        <Action
          variant={selectedGame === "REEFSCAPE" ? "primary" : "ghost"}
          onClick={() => setSelectedGame("REEFSCAPE")}
        >
          Reefscape
        </Action>
        <Action
          variant={selectedGame === "REBUILT" ? "primary" : "ghost"}
          onClick={() => setSelectedGame("REBUILT")}
        >
          Rebuilt
        </Action>
      </CommandBar>

      <HudViewport>
        <PageIntro
          eyebrow="Cross-Event Aggregate"
          title="Team Averages"
          subtitle="Average scored performance per team, deduplicated across match-scouted entries for the active game and event filter."
          actions={<Chip icon={Users} label="Teams" value={averages.length} tone="crimson" />}
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
          <Chip label="Scouted Entries" value={dedupedEntries.length} tone="gold" />
        </div>

        {loading ? (
          <Surface className="mt-8 p-10 text-center text-sm text-slate-600">Loading team averages…</Surface>
        ) : averages.length === 0 ? (
          <Surface className="mt-8 p-10 text-center text-sm text-slate-600">No teams match the current filters.</Surface>
        ) : (
          <>
            {podium.length > 0 && (
              <div className="mt-10 grid gap-5 sm:grid-cols-3">
                {podium.map((team, index) => {
                  const style = podiumStyle[index];
                  const Icon = style.icon;
                  return (
                    <Deck
                      key={team.teamNumber}
                      priority={style.priority}
                      offset={index === 0 ? "sm:-translate-y-4" : index === 2 ? "sm:translate-y-3" : ""}
                      className="text-center"
                    >
                      <div className={`mx-auto grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br ${style.ring} shadow-inner`}>
                        <Icon className={`h-6 w-6 ${style.accent}`} />
                      </div>
                      <p className="mt-3 text-[11px] font-black uppercase tracking-[0.28em] text-slate-500">{style.label} PLACE</p>
                      <h2 className="mt-1 font-display text-3xl text-slate-950">Team {team.teamNumber}</h2>
                      <p className="mt-3 font-data text-4xl font-black text-red-800">{team.avgTotal}</p>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">avg total pts</p>
                      <p className="mt-2 text-xs text-slate-500">{team.matchCount} matches scouted</p>
                    </Deck>
                  );
                })}
              </div>
            )}

            {rest.length > 0 && (
              <Surface raised className="mt-8 overflow-hidden p-2">
                <div className="table-scroll max-h-[65vh]">
                  <table className="sticky-header">
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Team</th>
                        <th>Matches</th>
                        <th>Avg Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rest.map((team, index) => (
                        <tr key={team.teamNumber}>
                          <td className="font-data">#{index + 4}</td>
                          <td className="font-data font-bold text-red-800">{team.teamNumber}</td>
                          <td className="font-data">{team.matchCount}</td>
                          <td className="font-data text-base font-black text-slate-900">{team.avgTotal}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Surface>
            )}
          </>
        )}
      </HudViewport>
    </HudCanvas>
  );
}

export default function TeamAveragesPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <TeamAveragesContent />
    </ProtectedRoute>
  );
}
