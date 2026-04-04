"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { useAuth } from "@/app/AuthContext";
import {
  getEventOptionsForEntries,
  type AnalyticsEventOption,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";
import { getTeamEventOptions } from "@/app/utils/eventDetection";
import {
  getProcessedTeamStats,
  type PerformanceReliabilityEntry,
  type TeamReliabilityStats,
} from "@/app/utils/performanceReliability";

const ACCURACY_OPTIONS = [75, 85, 90] as const;
const SAMPLE_WARNING_THRESHOLD = 3;

type ScatterPoint = {
  teamNumber: string;
  power: number;
  consistency: number;
  entriesCount: number;
};

function formatNumber(value: number, digits = 1) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function PerformanceReliabilityContent() {
  const { userData } = useAuth();
  const [entries, setEntries] = useState<PerformanceReliabilityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REBUILT");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [accuracyThreshold, setAccuracyThreshold] = useState<(typeof ACCURACY_OPTIONS)[number]>(85);
  const [activeTeam, setActiveTeam] = useState<string | null>(null);
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
        console.warn("Failed to load team event options for performance reliability:", error);
        if (!cancelled) setDetectedEventOptions([]);
      }
    }
    void loadDetectedEvents();
    return () => {
      cancelled = true;
    };
  }, [userData?.teamId]);

  const eventOptions = useMemo(
    () => getEventOptionsForEntries(entries, selectedGame, selectedGame === "REBUILT" ? detectedEventOptions : []),
    [entries, selectedGame, detectedEventOptions]
  );

  useEffect(() => {
    const savedGame = localStorage.getItem("analytics-selected-game");
    const savedEvent = localStorage.getItem("analytics-selected-event");
    const savedPractice = localStorage.getItem("analytics-practice-matches-only");
    const savedAccuracy = localStorage.getItem("analytics-performance-accuracy");
    if (savedGame === "REEFSCAPE" || savedGame === "REBUILT") setSelectedGame(savedGame);
    if (savedEvent) setSelectedEvent(savedEvent);
    if (savedPractice !== null) setPracticeMatchesOnly(savedPractice === "true");
    if (savedAccuracy) {
      const parsed = Number(savedAccuracy);
      if (ACCURACY_OPTIONS.includes(parsed as (typeof ACCURACY_OPTIONS)[number])) {
        setAccuracyThreshold(parsed as (typeof ACCURACY_OPTIONS)[number]);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("analytics-selected-game", selectedGame);
    localStorage.setItem("analytics-selected-event", selectedEvent);
    localStorage.setItem("analytics-practice-matches-only", String(practiceMatchesOnly));
  }, [selectedGame, selectedEvent, practiceMatchesOnly]);

  useEffect(() => {
    localStorage.setItem("analytics-performance-accuracy", String(accuracyThreshold));
  }, [accuracyThreshold]);

  useEffect(() => {
    async function loadEntries() {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "scouting"));
        setEntries(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      } finally {
        setLoading(false);
      }
    }
    void loadEntries();
  }, []);

  const processed = useMemo(
    () =>
      getProcessedTeamStats(entries, {
        accuracyThreshold,
        game: selectedGame,
        selectedEvent,
        practiceMatchesOnly,
        rebuiltEventOptions: selectedGame === "REBUILT" ? detectedEventOptions : [],
        sampleWarningThreshold: SAMPLE_WARNING_THRESHOLD,
      }),
    [entries, accuracyThreshold, selectedGame, selectedEvent, practiceMatchesOnly, detectedEventOptions]
  );

  const scatterData: ScatterPoint[] = useMemo(
    () =>
      processed.teamStats.map((team) => ({
        teamNumber: team.teamNumber,
        power: team.avgScore,
        consistency: team.stdDev,
        entriesCount: team.entriesCount,
      })),
    [processed.teamStats]
  );

  useEffect(() => {
    if (processed.teamStats.length === 0) {
      if (activeTeam !== null) setActiveTeam(null);
      return;
    }
    const existing = processed.teamStats.find((team) => team.teamNumber === activeTeam);
    if (!existing) {
      setActiveTeam(processed.teamStats[0].teamNumber);
    }
  }, [processed.teamStats, activeTeam]);

  const activeStats: TeamReliabilityStats | undefined = useMemo(
    () => processed.teamStats.find((team) => team.teamNumber === activeTeam),
    [processed.teamStats, activeTeam]
  );

  const accuracyToggle = (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-600 whitespace-nowrap">Scout Accuracy Threshold</span>
      <div className="inline-flex rounded border border-gray-200 overflow-hidden">
        {ACCURACY_OPTIONS.map((option) => {
          const isActive = option === accuracyThreshold;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setAccuracyThreshold(option)}
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

  if (loading) {
    return <LoadingSpinner message="Loading performance reliability..." />;
  }

  return (
    <AnalyticsShell
      entriesCount={processed.filteredEntries.length}
      selectedGame={selectedGame}
      onSelectedGameChange={(game) => setSelectedGame(game as AnalyticsGame)}
      practiceMatchesOnly={practiceMatchesOnly}
      onPracticeMatchesOnlyChange={setPracticeMatchesOnly}
      selectedEvent={selectedEvent}
      eventOptions={eventOptions}
      onSelectedEventChange={setSelectedEvent}
      extraControls={accuracyToggle}
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--primary-color)" }}>
            Performance Reliability
          </h1>
          <p className="text-sm text-gray-600">
            Compare team power versus consistency, then drill into the peaks and valleys for any robot.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Power vs Consistency</h2>
                <p className="text-sm text-gray-600">Each dot is a team. Click to load match-by-match trends.</p>
              </div>
              <div className="text-xs text-gray-500 text-right">
                {scatterData.length} teams
              </div>
            </div>
            {scatterData.length === 0 ? (
              <div className="mt-6 text-sm text-gray-500">No teams match this filter yet.</div>
            ) : (
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" dataKey="power" name="Power" tick={{ fontSize: 12 }} />
                    <YAxis type="number" dataKey="consistency" name="Consistency" tick={{ fontSize: 12 }} />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      formatter={(value: number, name: string, entry) => {
                        if (name === "power") return [formatNumber(value, 1), "Avg Score"];
                        if (name === "consistency") return [formatNumber(value, 1), "Std Dev"];
                        return [value, name];
                      }}
                      labelFormatter={(_, payload) => {
                        const point = payload?.[0]?.payload as ScatterPoint | undefined;
                        return point ? `Team ${point.teamNumber}` : "";
                      }}
                    />
                    <Scatter
                      data={scatterData}
                      fill="#f87171"
                      onClick={(payload) => {
                        const point = payload as ScatterPoint | undefined;
                        if (point?.teamNumber) setActiveTeam(point.teamNumber);
                      }}
                    >
                      {scatterData.map((point) => (
                        <Cell
                          key={point.teamNumber}
                          fill={point.teamNumber === activeTeam ? "#be123c" : "#fb7185"}
                        />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Match Trend</h2>
                <p className="text-sm text-gray-600">Raw scores across all matches for the selected team.</p>
              </div>
              <div className="text-xs text-gray-500 text-right">
                {activeStats ? `Team ${activeStats.teamNumber}` : "No team selected"}
              </div>
            </div>

            {!activeStats ? (
              <div className="mt-6 text-sm text-gray-500">Select a team on the scatter plot.</div>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-gray-600">
                  <div>
                    Avg Score: <span className="font-semibold text-gray-900">{formatNumber(activeStats.avgScore, 1)}</span>
                  </div>
                  <div>
                    Std Dev: <span className="font-semibold text-gray-900">{formatNumber(activeStats.stdDev, 1)}</span>
                  </div>
                  <div>
                    Matches: <span className="font-semibold text-gray-900">{activeStats.entriesCount}</span>
                  </div>
                  <div>
                    Accuracy Filter: <span className="font-semibold text-gray-900">{accuracyThreshold}%</span>
                  </div>
                </div>
                {activeStats.entriesCount < SAMPLE_WARNING_THRESHOLD && (
                  <div className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    Low sample size at this accuracy level.
                  </div>
                )}
                <div className="mt-4 h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={activeStats.scores}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="matchLabel" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip
                        formatter={(value: number) => [formatNumber(value, 1), "Score"]}
                        labelFormatter={(label) => `Match ${label}`}
                      />
                      <Line
                        type="monotone"
                        dataKey="score"
                        stroke="#be123c"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AnalyticsShell>
  );
}

export default function PerformanceReliabilityPage() {
  return (
    <ProtectedRoute>
      <PerformanceReliabilityContent />
    </ProtectedRoute>
  );
}
