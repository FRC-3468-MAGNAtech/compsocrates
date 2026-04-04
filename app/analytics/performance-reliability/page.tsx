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
  type TooltipProps,
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

function ScatterTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as ScatterPoint | undefined;
  if (!point) return null;
  return (
    <div className="bg-white border border-gray-200 rounded px-3 py-2 text-xs shadow">
      <div className="font-semibold text-gray-900">Team {point.teamNumber}</div>
      <div className="text-gray-700">Power: {formatNumber(point.power, 1)}</div>
      <div className="text-gray-700">Consistency: {formatNumber(point.consistency, 1)}</div>
      <div className="text-gray-500">{point.entriesCount} matches</div>
    </div>
  );
}

function LineTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const value = payload[0]?.value as number | undefined;
  return (
    <div className="bg-white border border-gray-200 rounded px-3 py-2 text-xs shadow">
      <div className="font-semibold text-gray-900">{`Match ${label}`}</div>
      <div className="text-gray-700">Score: {formatNumber(Number(value), 1)}</div>
    </div>
  );
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
  const [viewMode, setViewMode] = useState<"scatter" | "team">("scatter");
  const [searchTerm, setSearchTerm] = useState("");
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
    const savedSearch = localStorage.getItem("analytics-search-term");
    const savedAccuracy = localStorage.getItem("analytics-performance-accuracy");
    if (savedGame === "REEFSCAPE" || savedGame === "REBUILT") setSelectedGame(savedGame);
    if (savedEvent) setSelectedEvent(savedEvent);
    if (savedPractice !== null) setPracticeMatchesOnly(savedPractice === "true");
    if (savedSearch !== null) setSearchTerm(savedSearch);
    if (savedAccuracy) {
      const parsed = Number(savedAccuracy);
      if (ACCURACY_OPTIONS.includes(parsed as (typeof ACCURACY_OPTIONS)[number])) {
        setAccuracyThreshold(parsed as (typeof ACCURACY_OPTIONS)[number]);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    function handleStorage(event: StorageEvent) {
      if (event.key === "analytics-search-term") {
        setSearchTerm(event.newValue || "");
      }
    }
    function handleSearchEvent(event: Event) {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === "string") setSearchTerm(detail);
    }
    window.addEventListener("storage", handleStorage);
    window.addEventListener("analytics-search-term", handleSearchEvent as EventListener);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("analytics-search-term", handleSearchEvent as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const interval = window.setInterval(() => {
      const next = localStorage.getItem("analytics-search-term") || "";
      setSearchTerm((prev) => (prev === next ? prev : next));
    }, 500);
    return () => window.clearInterval(interval);
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

  useEffect(() => {
    if (!activeTeam) return;
    if (viewMode !== "team") return;
    const exists = processed.teamStats.some((team) => team.teamNumber === activeTeam);
    if (!exists) {
      setViewMode("scatter");
    }
  }, [activeTeam, processed.teamStats, viewMode]);

  const highlightedTeamFromSearch = useMemo(() => {
    const normalized = searchTerm.trim();
    if (!normalized) return null;
    const numeric = normalized.replace(/[^0-9]/g, "");
    if (!numeric) return null;
    return processed.teamStats.some((team) => team.teamNumber === numeric) ? numeric : null;
  }, [processed.teamStats, searchTerm]);

  useEffect(() => {
    if (!highlightedTeamFromSearch) return;
    if (activeTeam !== highlightedTeamFromSearch) {
      setActiveTeam(highlightedTeamFromSearch);
    }
  }, [highlightedTeamFromSearch, activeTeam]);

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

        <p className="text-xs text-gray-500">
          Power shows the average score per team. Consistency is the standard deviation of those scores (lower is steadier).
          Click a dot to see every match for that robot.
        </p>

        <div className="grid grid-cols-1 gap-6">
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
            {viewMode !== "scatter" ? (
              <div className="mt-4 text-sm text-gray-600">
                Viewing team details.{" "}
                <button
                  type="button"
                  className="text-rose-700 font-semibold hover:underline"
                  onClick={() => setViewMode("scatter")}
                >
                  Back to scatter plot
                </button>
              </div>
            ) : scatterData.length === 0 ? (
              <div className="mt-6 text-sm text-gray-500">No teams match this filter yet.</div>
            ) : (
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ bottom: 32 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      dataKey="power"
                      name="Power"
                      tick={{ fontSize: 12 }}
                      label={{ value: "Average Match Score (Power)", position: "bottom", offset: 12, fontSize: 12 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="consistency"
                      name="Consistency"
                      tick={{ fontSize: 12 }}
                      label={{ value: "Std Dev of Match Scores (Consistency)", angle: -90, position: "insideLeft", fontSize: 12 }}
                    />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<ScatterTooltip />} />
                    <Scatter
                      data={scatterData}
                      fill="#f87171"
                      onClick={(payload) => {
                        const point = payload as ScatterPoint | undefined;
                        if (point?.teamNumber) {
                          setActiveTeam(point.teamNumber);
                          setViewMode("team");
                        }
                      }}
                    >
                      {scatterData.map((point) => (
                        <Cell
                          key={point.teamNumber}
                          fill={
                            point.teamNumber === activeTeam
                              ? "#be123c"
                              : highlightedTeamFromSearch && point.teamNumber === highlightedTeamFromSearch
                                ? "#f97316"
                                : "#fb7185"
                          }
                          stroke={
                            highlightedTeamFromSearch && point.teamNumber === highlightedTeamFromSearch
                              ? "#b45309"
                              : undefined
                          }
                          strokeWidth={
                            highlightedTeamFromSearch && point.teamNumber === highlightedTeamFromSearch ? 2 : 0
                          }
                        />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {viewMode === "team" && (
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
                      <Tooltip content={<LineTooltip />} />
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
          )}
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
