"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import RobotRadarChart from "@/app/components/RobotRadarChart";
import {
  entryMatchesAnalyticsFilters,
  getEventOptionsForEntries,
  isPracticeScoutedEntry,
  type AnalyticsEventOption,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";
import { getTeamEventOptions } from "@/app/utils/eventDetection";
import { useAuth } from "@/app/AuthContext";

type ScoutingEntry = {
  id?: string;
  eventKey?: string;
  eventName?: string;
  matchId?: string;
  matchKey?: string;
  matchLabel?: string;
  matchType?: string;
  matchNumber?: string;
  submittedAt?: number;
  timestamp?: number;
  game?: string;
  teamNumber?: string;
  isPracticeScouting?: boolean;
  practiceMode?: string;
  practiceSessionId?: string;
  excludeFromStats?: boolean;
  auto?: {
    preloadScale?: number;
    bpsScale?: number;
    carryingScale?: number;
    cycleTimes?: number[];
    counterOverride?: number;
    counterOverrideMissedFuel?: number;
    humanPlayerFuel?: number;
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
    transitionOverride?: number;
    transitionMissedFuel?: number;
    shift1Override?: number;
    shift1MissedFuel?: number;
    shift2Override?: number;
    shift2MissedFuel?: number;
    shift3Override?: number;
    shift3MissedFuel?: number;
    shift4Override?: number;
    shift4MissedFuel?: number;
    humanPlayerFuel?: number;
    shiftParityFromWonAuto?: boolean;
  };
  endgame?: {
    cycleTimes?: number[];
    counterOverride?: number;
    counterOverrideMissedFuel?: number;
    humanPlayerFuel?: number;
    status?: string;
  };
};

type LeadEntry = {
  id?: string;
  game?: string;
  eventKey?: string;
  matchId?: string;
  matchKey?: string;
  matchLabel?: string;
  matchType?: string;
  matchNumber?: string;
  submittedAt?: number;
  timestamp?: number;
  isPracticeScouting?: boolean;
  entryType?: string;
  isLeadScouting?: boolean;
  excludeFromStats?: boolean;
  robots?: Array<{
    teamNumber?: string;
    skillLevel?: number;
  }>;
  overallAlliance?: {
    skillLevel?: number;
  };
};

function RobotRadarPageContent() {
  const { userData } = useAuth();
  const [entries, setEntries] = useState<ScoutingEntry[]>([]);
  const [leadEntries, setLeadEntries] = useState<LeadEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REBUILT");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);
  const [detectedEventOptions, setDetectedEventOptions] = useState<AnalyticsEventOption[]>([]);
  const [accuracyThreshold, setAccuracyThreshold] = useState<75 | 85 | 90>(75);

  useEffect(() => {
    let cancelled = false;
    async function loadDetectedEvents() {
      if (!userData?.teamId) {
        if (!cancelled) setDetectedEventOptions([]);
        return;
      }
      try {
        const teamEvents = await getTeamEventOptions(userData.teamId);
        if (cancelled) return;
        setDetectedEventOptions(
          teamEvents.map((event) => ({
            id: event.key,
            key: event.key,
            name: event.name,
            startDate: event.startDate,
            endDate: event.endDate,
          }))
        );
      } catch (error) {
        console.warn("Failed to load team event options for radar:", error);
        if (!cancelled) setDetectedEventOptions([]);
      }
    }
    void loadDetectedEvents();
    return () => {
      cancelled = true;
    };
  }, [userData?.teamId]);

  const eventOptions = useMemo(
    () => getEventOptionsForEntries(entries, selectedGame, detectedEventOptions),
    [entries, selectedGame, detectedEventOptions]
  );

  useEffect(() => {
    const savedGame = localStorage.getItem("analytics-selected-game");
    const savedEvent = localStorage.getItem("analytics-selected-event");
    const savedPractice = localStorage.getItem("analytics-practice-matches-only");
    const savedTeams = localStorage.getItem("robot-radar-teams");
    const savedAccuracy = localStorage.getItem("robot-radar-accuracy");
    if (savedGame === "REEFSCAPE" || savedGame === "REBUILT") setSelectedGame(savedGame);
    if (savedEvent) setSelectedEvent(savedEvent);
    if (savedPractice !== null) setPracticeMatchesOnly(savedPractice === "true");
    if (savedTeams) {
      const parsed = savedTeams
        .split(",")
        .map((team) => team.trim())
        .filter(Boolean)
        .slice(0, 2);
      setSelectedTeams(parsed);
    }
    if (savedAccuracy) {
      const parsed = Number(savedAccuracy);
      if (parsed === 75 || parsed === 85 || parsed === 90) setAccuracyThreshold(parsed);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("analytics-selected-game", selectedGame);
    localStorage.setItem("analytics-selected-event", selectedEvent);
    localStorage.setItem("analytics-practice-matches-only", String(practiceMatchesOnly));
  }, [selectedGame, selectedEvent, practiceMatchesOnly]);

  useEffect(() => {
    localStorage.setItem("robot-radar-teams", selectedTeams.join(","));
  }, [selectedTeams]);

  useEffect(() => {
    localStorage.setItem("robot-radar-accuracy", String(accuracyThreshold));
  }, [accuracyThreshold]);

  useEffect(() => {
    async function loadEntries() {
      setLoading(true);
      try {
        const [scoutSnap, leadSnap] = await Promise.all([
          getDocs(collection(db, "scouting")),
          getDocs(collection(db, "leadScouting")),
        ]);
        setEntries(scoutSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
        setLeadEntries(leadSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      } finally {
        setLoading(false);
      }
    }
    void loadEntries();
  }, []);

  const filteredEntries = useMemo(
    () =>
      entries.filter((entry) => {
        if (entry.excludeFromStats) return false;
        if (!entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent, detectedEventOptions)) return false;
        if (practiceMatchesOnly) return isPracticeScoutedEntry(entry);
        if (isPracticeScoutedEntry(entry)) return false;
        const accuracy = typeof (entry as { accuracy?: number }).accuracy === "number"
          ? Number((entry as { accuracy?: number }).accuracy)
          : NaN;
        if (!Number.isFinite(accuracy)) return false;
        return accuracy >= accuracyThreshold;
      }),
    [entries, selectedGame, selectedEvent, practiceMatchesOnly, detectedEventOptions, accuracyThreshold]
  );

  const filteredLeadEntries = useMemo(
    () =>
      leadEntries.filter((entry) => {
        if (entry.excludeFromStats) return false;
        if (!entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent, detectedEventOptions, { includeLead: true })) {
          return false;
        }
        if (practiceMatchesOnly) return isPracticeScoutedEntry(entry);
        return !isPracticeScoutedEntry(entry);
      }),
    [leadEntries, selectedGame, selectedEvent, practiceMatchesOnly, detectedEventOptions]
  );

  const teamOptions = useMemo(() => {
    const counts = new Map<string, number>();
    filteredEntries.forEach((entry) => {
      const team = String(entry.teamNumber || "").trim();
      if (!team) return;
      counts.set(team, (counts.get(team) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([teamNumber, count]) => ({ teamNumber, count }));
  }, [filteredEntries]);

  const normalizedSelectedTeams = selectedTeams.map((team) => team.replace(/[^0-9]/g, "")).filter(Boolean).slice(0, 2);
  const radarTeams = normalizedSelectedTeams.length === 2
    ? ([normalizedSelectedTeams[0], normalizedSelectedTeams[1]] as [string, string])
    : ([normalizedSelectedTeams[0]] as [string]);

  if (loading) {
    return <LoadingSpinner message="Loading robot radar..." />;
  }

  const accuracyToggle = (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-600 whitespace-nowrap">Scout Accuracy Threshold</span>
      <div className="inline-flex rounded border border-gray-200 overflow-hidden">
        {[75, 85, 90].map((option) => {
          const isActive = option === accuracyThreshold;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setAccuracyThreshold(option as 75 | 85 | 90)}
              className={`px-3 py-1 text-sm border-r last:border-r-0 ${
                isActive ? "bg-rose-600 text-white" : "bg-white text-gray-700 hover:bg-gray-100"
              }`}
            >
              {option}%
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <AnalyticsShell
      entriesCount={filteredEntries.length}
      selectedGame={selectedGame}
      onSelectedGameChange={(game) => setSelectedGame(game as AnalyticsGame)}
      allowedGames={["REBUILT"]}
      practiceMatchesOnly={practiceMatchesOnly}
      onPracticeMatchesOnlyChange={setPracticeMatchesOnly}
      selectedEvent={selectedEvent}
      eventOptions={eventOptions}
      onSelectedEventChange={setSelectedEvent}
      extraControls={
        <div className="flex flex-wrap items-center gap-3">
          {accuracyToggle}
          <div className="relative">
            <button
              type="button"
              onClick={() => setTeamMenuOpen((open) => !open)}
              className="px-3 py-1.5 text-sm rounded border border-gray-200 bg-white hover:bg-gray-100"
            >
              {normalizedSelectedTeams.length > 0
                ? `Teams (${normalizedSelectedTeams.length}/2)`
                : "Select Teams"}
            </button>
            {teamMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 max-h-64 overflow-y-auto rounded border border-gray-200 bg-white shadow-lg z-50">
                {teamOptions.length === 0 ? (
                  <div className="p-3 text-xs text-gray-500">No teams found for this filter.</div>
                ) : (
                  teamOptions.map((option) => {
                    const selected = normalizedSelectedTeams.includes(option.teamNumber);
                    const disable =
                      !selected && normalizedSelectedTeams.length >= 2;
                    return (
                      <button
                        key={option.teamNumber}
                        type="button"
                        disabled={disable}
                        onClick={() => {
                          setSelectedTeams((prev) => {
                            if (prev.includes(option.teamNumber)) {
                              return prev.filter((team) => team !== option.teamNumber);
                            }
                            if (prev.length >= 2) return prev;
                            return [...prev, option.teamNumber];
                          });
                        }}
                        className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between ${
                          selected ? "bg-rose-50 text-rose-700" : "text-gray-700"
                        } ${disable ? "opacity-40 cursor-not-allowed" : "hover:bg-gray-50"}`}
                      >
                        <span>Team {option.teamNumber}</span>
                        <span className="text-xs text-gray-400">{option.count}</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      }
    >
      <div className="mb-4">
        <h1 className="text-3xl font-bold mb-1 theme-text">Robot Radar</h1>
        <p className="text-sm text-gray-600">
          Normalized 0–10 build profile for REBUILT robots. Add a second team to compare overlap and synergy.
        </p>
        {normalizedSelectedTeams.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {normalizedSelectedTeams.map((team) => (
              <span
                key={team}
                className="inline-flex items-center gap-2 px-2 py-1 rounded-full bg-rose-50 text-rose-700"
              >
                Team {team}
                <button
                  type="button"
                  onClick={() => setSelectedTeams((prev) => prev.filter((value) => value !== team))}
                  className="text-rose-600 hover:text-rose-800"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {normalizedSelectedTeams.length > 0 ? (
        <div className="bg-white rounded-xl shadow p-4">
          <RobotRadarChart
            entries={filteredEntries}
            leadEntries={filteredLeadEntries}
            teamNumbers={radarTeams}
          />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow p-4 text-sm text-gray-600">
          Enter a Team A number to generate the radar chart.
        </div>
      )}
    </AnalyticsShell>
  );
}

export default function RobotRadarPage() {
  return (
    <ProtectedRoute>
      <RobotRadarPageContent />
    </ProtectedRoute>
  );
}
