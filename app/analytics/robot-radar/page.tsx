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
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [detectedEventOptions, setDetectedEventOptions] = useState<AnalyticsEventOption[]>([]);

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
    const savedTeamA = localStorage.getItem("robot-radar-team-a");
    const savedTeamB = localStorage.getItem("robot-radar-team-b");
    if (savedGame === "REEFSCAPE" || savedGame === "REBUILT") setSelectedGame(savedGame);
    if (savedEvent) setSelectedEvent(savedEvent);
    if (savedPractice !== null) setPracticeMatchesOnly(savedPractice === "true");
    if (savedTeamA) setTeamA(savedTeamA);
    if (savedTeamB) setTeamB(savedTeamB);
  }, []);

  useEffect(() => {
    localStorage.setItem("analytics-selected-game", selectedGame);
    localStorage.setItem("analytics-selected-event", selectedEvent);
    localStorage.setItem("analytics-practice-matches-only", String(practiceMatchesOnly));
  }, [selectedGame, selectedEvent, practiceMatchesOnly]);

  useEffect(() => {
    localStorage.setItem("robot-radar-team-a", teamA);
  }, [teamA]);

  useEffect(() => {
    localStorage.setItem("robot-radar-team-b", teamB);
  }, [teamB]);

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
        return !isPracticeScoutedEntry(entry);
      }),
    [entries, selectedGame, selectedEvent, practiceMatchesOnly, detectedEventOptions]
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

  const normalizedTeamA = teamA.replace(/[^0-9]/g, "");
  const normalizedTeamB = teamB.replace(/[^0-9]/g, "");
  const radarTeams = normalizedTeamB ? ([normalizedTeamA, normalizedTeamB] as [string, string]) : ([normalizedTeamA] as [string]);

  if (loading) {
    return <LoadingSpinner message="Loading robot radar..." />;
  }

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
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-gray-600 flex items-center gap-2">
            Team A
            <input
              value={teamA}
              onChange={(event) => setTeamA(event.target.value)}
              className="border rounded px-2 py-1 text-sm w-24"
              placeholder="1234"
            />
          </label>
          <label className="text-sm text-gray-600 flex items-center gap-2">
            Team B
            <input
              value={teamB}
              onChange={(event) => setTeamB(event.target.value)}
              className="border rounded px-2 py-1 text-sm w-24"
              placeholder="Optional"
            />
          </label>
        </div>
      }
    >
      <div className="mb-4">
        <h1 className="text-3xl font-bold mb-1 theme-text">Robot Radar</h1>
        <p className="text-sm text-gray-600">
          Normalized 0–10 build profile for REBUILT robots. Add a second team to compare overlap and synergy.
        </p>
      </div>

      {normalizedTeamA ? (
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
