"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { useAuth } from "@/app/AuthContext";
import { getUserRoles } from "@/app/utils/roles";
import {
  entryMatchesAnalyticsFilters,
  getEventOptionsForEntries,
  isPracticeScoutedEntry,
  type AnalyticsEventOption,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";
import { dedupeEntriesByMatchTeam } from "@/app/utils/entryDeduping";
import { getFirstEventCodeFromTbaKey } from "@/app/utils/firstSchedule";
import { getTeamEventOptions } from "@/app/utils/eventDetection";

type TeamPick = {
  teamNumber: string;
  avgScore: number;
  highScore: number;
  picked: boolean;
  pickOrder?: number;
};

type FirstRankingRow = {
  rank?: number;
  Rank?: number;
  teamNumber?: number;
  team?: number;
  TeamNumber?: number;
};

type ScoutingEntry = {
  eventKey?: string;
  submittedAt?: number;
  timestamp?: number;
  game?: string;
  teamNumber?: string;
  excludeFromStats?: boolean;
  matchType?: string;
  leftStartingZone?: boolean;
  autoCoralL1?: number;
  autoCoralL2?: number;
  autoCoralL3?: number;
  autoCoralL4?: number;
  teleopCoralL1?: number;
  teleopCoralL2?: number;
  teleopCoralL3?: number;
  teleopCoralL4?: number;
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
  practiceMode?: string;
  isPracticeScouting?: boolean;
};

function isPracticeEntry(entry: ScoutingEntry) {
  return isPracticeScoutedEntry(entry);
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
    (entry.teleopCoralL1 || 0) * 2 +
    (entry.teleopCoralL2 || 0) * 3 +
    (entry.teleopCoralL3 || 0) * 4 +
    (entry.teleopCoralL4 || 0) * 5 +
    Number(entry.penaltyPoints || 0)
  );
}

function PickListContent() {
  const { userData } = useAuth();
  const roles = getUserRoles(userData);
  const canEditPickList =
    userData?.role === "coach" ||
    Boolean(userData?.isTeamAdmin) ||
    roles.includes("lead-scout") ||
    roles.includes("lead-strategist") ||
    roles.includes("team-coach");
  const [entries, setEntries] = useState<ScoutingEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REEFSCAPE");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [pickedTeams, setPickedTeams] = useState<TeamPick[]>([]);
  const [pickListLoading, setPickListLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [officialRanks, setOfficialRanks] = useState<Map<string, number>>(new Map());
  const [officialEpa, setOfficialEpa] = useState<Map<string, number | null>>(new Map());
  const [officialLoading, setOfficialLoading] = useState(false);
  const [epaLoading, setEpaLoading] = useState(false);
  const [detectedEventOptions, setDetectedEventOptions] = useState<AnalyticsEventOption[]>([]);
  const statboticsCache = useRef(new Map<string, number | null>());

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
        console.warn("Failed to load team event options for pick list:", error);
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
        setEntries(snap.docs.map((d) => d.data()));
      } finally {
        setLoading(false);
      }
    }
    loadEntries();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadPickList() {
      if (!userData?.teamId) {
        if (!cancelled) {
          setPickedTeams([]);
          setPickListLoading(false);
        }
        return;
      }
      setPickListLoading(true);
      try {
        const snap = await getDoc(doc(db, "teamPickLists", userData.teamId));
        if (!snap.exists()) {
          if (!cancelled) setPickedTeams([]);
          return;
        }
        const data = snap.data() as { picks?: Array<{ teamNumber?: string; pickOrder?: number }> } | undefined;
        const picks = Array.isArray(data?.picks) ? data?.picks : [];
        const normalized = picks
          .map((pick, index) => ({
            teamNumber: String(pick.teamNumber || "").trim(),
            avgScore: 0,
            highScore: 0,
            picked: true,
            pickOrder: Number(pick.pickOrder || index + 1),
          }))
          .filter((pick) => Boolean(pick.teamNumber))
          .sort((a, b) => (a.pickOrder || 0) - (b.pickOrder || 0))
          .map((pick, index) => ({ ...pick, pickOrder: index + 1 }));
        if (!cancelled) setPickedTeams(normalized);
      } catch (error) {
        console.warn("Failed to load team pick list:", error);
        if (!cancelled) setPickedTeams([]);
      } finally {
        if (!cancelled) setPickListLoading(false);
      }
    }
    void loadPickList();
    return () => {
      cancelled = true;
    };
  }, [userData?.teamId]);

  useEffect(() => {
    if (!canEditPickList || !userData?.teamId) return;
    if (pickListLoading) return;
    const payload = {
      picks: pickedTeams.map((team, index) => ({
        teamNumber: team.teamNumber,
        pickOrder: team.pickOrder || index + 1,
      })),
      updatedAt: Date.now(),
      updatedBy: userData?.uid || "",
    };
    setDoc(doc(db, "teamPickLists", userData.teamId), payload, { merge: true }).catch((error) => {
      console.warn("Failed to persist team pick list:", error);
    });
  }, [pickedTeams, canEditPickList, userData?.teamId, userData?.uid, pickListLoading]);

  const filteredEntries = useMemo(() => {
    const gameFiltered = entries.filter((entry) =>
      entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent, eventOptions)
    );
    return gameFiltered
      .filter((entry) => (practiceMatchesOnly ? isPracticeEntry(entry) : !isPracticeEntry(entry)))
      .filter((entry) => !entry.excludeFromStats);
  }, [entries, selectedEvent, selectedGame, practiceMatchesOnly, eventOptions]);

  const dedupedEntries = useMemo(
    () =>
      dedupeEntriesByMatchTeam(filteredEntries, {
        game: selectedGame,
        eventOptions,
        selectedEvent,
        preferLatest: true,
      }),
    [filteredEntries, selectedGame, eventOptions, selectedEvent]
  );

  useEffect(() => {
    let isActive = true;

    async function loadRankings() {
      if (selectedEvent === "all") {
        if (isActive) setOfficialRanks(new Map());
        return;
      }
      const year = Number(String(selectedEvent || "").slice(0, 4));
      const eventCode = getFirstEventCodeFromTbaKey(selectedEvent);
      if (!Number.isFinite(year) || !eventCode) {
        if (isActive) setOfficialRanks(new Map());
        return;
      }

      setOfficialLoading(true);
      try {
        const response = await fetch("/api/first/rankings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year, eventCode }),
        });
        if (!response.ok) {
          if (isActive) setOfficialRanks(new Map());
          return;
        }
        const payload = await response.json();
        const rows = Array.isArray(payload.rankings) ? (payload.rankings as FirstRankingRow[]) : [];
        const map = new Map<string, number>();
        rows.forEach((row) => {
          const teamNumber = String(row.teamNumber ?? row.TeamNumber ?? row.team ?? "").trim();
          const rankValue = Number(row.rank ?? row.Rank ?? 0);
          if (teamNumber && Number.isFinite(rankValue) && rankValue > 0) {
            map.set(teamNumber, rankValue);
          }
        });
        if (isActive) setOfficialRanks(map);
      } catch (error) {
        console.warn("Failed to load FIRST rankings:", error);
        if (isActive) setOfficialRanks(new Map());
      } finally {
        if (isActive) setOfficialLoading(false);
      }
    }

    void loadRankings();
    return () => {
      isActive = false;
    };
  }, [selectedEvent]);

  useEffect(() => {
    let isActive = true;

    async function loadEpa() {
      if (dedupedEntries.length === 0) {
        if (isActive) setOfficialEpa(new Map());
        return;
      }
      const fallbackEvent = dedupedEntries.find((entry) => entry.eventKey)?.eventKey || "";
      const yearSource = selectedEvent !== "all" ? selectedEvent : fallbackEvent;
      const year = Number(String(yearSource || "").slice(0, 4));
      if (!Number.isFinite(year)) {
        if (isActive) setOfficialEpa(new Map());
        return;
      }

      const teamNumbers = Array.from(
        new Set(dedupedEntries.map((entry) => String(entry.teamNumber || "").trim()).filter(Boolean))
      );
      if (teamNumbers.length === 0) {
        if (isActive) setOfficialEpa(new Map());
        return;
      }

      setEpaLoading(true);
      const map = new Map<string, number | null>();
      const batchSize = 6;
      for (let i = 0; i < teamNumbers.length; i += batchSize) {
        const batch = teamNumbers.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (teamNumber) => {
            const cacheKey = `${selectedEvent}:${teamNumber}`;
            if (statboticsCache.current.has(cacheKey)) {
              return [teamNumber, statboticsCache.current.get(cacheKey) ?? null] as const;
            }
            const params = new URLSearchParams({
              teamNumber,
              year: String(year),
            });
            if (selectedEvent !== "all") params.set("eventKey", selectedEvent);
            try {
              const response = await fetch(`/api/statbotics/team?${params.toString()}`);
              if (!response.ok) {
                statboticsCache.current.set(cacheKey, null);
                return [teamNumber, null] as const;
              }
              const payload = await response.json();
              const eventEpa = Number(payload?.teamEvent?.epa?.total_points?.mean);
              const yearEpa = Number(payload?.teamYear?.epa?.total_points?.mean);
              const epaValue = Number.isFinite(eventEpa) ? eventEpa : Number.isFinite(yearEpa) ? yearEpa : null;
              statboticsCache.current.set(cacheKey, epaValue);
              return [teamNumber, epaValue] as const;
            } catch (error) {
              console.warn("Failed to load Statbotics EPA:", error);
              statboticsCache.current.set(cacheKey, null);
              return [teamNumber, null] as const;
            }
          })
        );
        results.forEach(([teamNumber, epa]) => {
          map.set(teamNumber, epa);
        });
      }
      if (isActive) setOfficialEpa(map);
      if (isActive) setEpaLoading(false);
    }

    void loadEpa();
    return () => {
      isActive = false;
    };
  }, [dedupedEntries, selectedEvent]);

  const teamStats = useMemo(() => {
    const grouped: Record<string, number[]> = {};
    dedupedEntries.forEach((e) => {
      if (!e.teamNumber) return;
      const score = scoreEntry(e, selectedGame);
      if (!grouped[e.teamNumber]) grouped[e.teamNumber] = [];
      grouped[e.teamNumber].push(score);
    });

    return Object.entries(grouped)
      .map(([teamNumber, scores]) => ({
        teamNumber,
        avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        highScore: Math.max(...scores),
      }))
      .sort((a, b) => b.avgScore - a.avgScore);
  }, [dedupedEntries, selectedGame]);

  const scoutedRankMap = useMemo(() => {
    const map = new Map<string, number>();
    const sorted = [...teamStats].sort((a, b) => b.avgScore - a.avgScore);
    sorted.forEach((team, index) => {
      map.set(team.teamNumber, index + 1);
    });
    return map;
  }, [teamStats]);

  const teamStatsMap = useMemo(() => {
    const map = new Map<string, { avgScore: number; highScore: number }>();
    teamStats.forEach((team) => {
      map.set(team.teamNumber, { avgScore: team.avgScore, highScore: team.highScore });
    });
    return map;
  }, [teamStats]);

  const teams = useMemo(() => {
    const pickMap = new Map<string, TeamPick>();
    pickedTeams.forEach((team) => pickMap.set(team.teamNumber, team));
    return teamStats
      .map((team) => ({
        ...team,
        picked: pickMap.has(team.teamNumber),
        pickOrder: pickMap.get(team.teamNumber)?.pickOrder,
      }))
      .sort((a, b) => {
        const rankA = officialRanks.get(a.teamNumber);
        const rankB = officialRanks.get(b.teamNumber);
        const rankAValue = Number.isFinite(rankA as number) ? (rankA as number) : Number.POSITIVE_INFINITY;
        const rankBValue = Number.isFinite(rankB as number) ? (rankB as number) : Number.POSITIVE_INFINITY;
        if (rankAValue !== rankBValue) return rankAValue - rankBValue;
        if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
        return a.teamNumber.localeCompare(b.teamNumber, undefined, { numeric: true });
      });
  }, [teamStats, pickedTeams, officialRanks]);

  const orderedPickedTeams = useMemo(() => {
    return [...pickedTeams].sort((a, b) => (a.pickOrder || 0) - (b.pickOrder || 0));
  }, [pickedTeams]);

  function formatStatLine(teamNumber: string, avgScore: number, highScore: number) {
    const scoutedRank = scoutedRankMap.get(teamNumber);
    const officialRank = officialRanks.get(teamNumber);
    const epaValue = officialEpa.get(teamNumber);
    const epaText = typeof epaValue === "number" && Number.isFinite(epaValue) ? epaValue.toFixed(2) : "-";
    return `O. Rank ${officialRank ?? "-"} | S. Rank ${scoutedRank ?? "-"} | S. Avg ${avgScore} | S. High ${highScore} | O. EPA ${epaText}`;
  }

  function pickTeam(team: TeamPick) {
    if (!canEditPickList) return;
    if (pickedTeams.some((p) => p.teamNumber === team.teamNumber)) return;
    setPickedTeams((prev) => [...prev, { ...team, picked: true, pickOrder: prev.length + 1 }]);
  }

  function removeTeam(teamNumber: string) {
    if (!canEditPickList) return;
    const next = pickedTeams.filter((p) => p.teamNumber !== teamNumber).map((p, i) => ({ ...p, pickOrder: i + 1 }));
    setPickedTeams(next);
  }

  function movePick(teamNumber: string, direction: "up" | "down") {
    if (!canEditPickList) return;
    setPickedTeams((prev) => {
      const ordered = [...prev].sort((a, b) => (a.pickOrder || 0) - (b.pickOrder || 0));
      const index = ordered.findIndex((team) => team.teamNumber === teamNumber);
      if (index === -1) return prev;
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= ordered.length) return prev;
      const next = [...ordered];
      const temp = next[index];
      next[index] = next[target];
      next[target] = temp;
      return next.map((team, i) => ({ ...team, pickOrder: i + 1 }));
    });
  }

  return (
    <AnalyticsShell
      entriesCount={dedupedEntries.length}
      selectedGame={selectedGame}
      onSelectedGameChange={(game) => setSelectedGame(game as AnalyticsGame)}
      practiceMatchesOnly={practiceMatchesOnly}
      onPracticeMatchesOnlyChange={setPracticeMatchesOnly}
      selectedEvent={selectedEvent}
      eventOptions={[{ id: "all", name: "All Events" }, ...eventOptions]}
      onSelectedEventChange={setSelectedEvent}
    >
      <h1 className="text-3xl font-bold mb-2 theme-text">Pick List</h1>
      <p className="text-gray-600 mb-6">Build and reorder your preferred alliance picks.</p>
      {!canEditPickList && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-6">
          View only: only coaches or team admins can add or remove teams from the pick list.
        </p>
      )}

      {loading || pickListLoading ? (
        <LoadingSpinner message="Loading pick list..." />
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            <div className="p-4 border-b border-gray-200">
              <h2 className="font-semibold">Available Teams</h2>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {teams.filter((t) => !t.picked).map((team) => (
                <div key={team.teamNumber} data-analytics-search-item="true" className="p-4 border-b flex items-center justify-between">
                  <div>
                    <p className="font-semibold">Team {team.teamNumber}</p>
                    <p className="text-sm text-gray-600">
                      {formatStatLine(team.teamNumber, team.avgScore, team.highScore)}
                    </p>
                  </div>
                  {canEditPickList ? (
                    <button onClick={() => pickTeam(team)} className="px-3 py-1.5 rounded theme-primary text-sm">
                      Pick
                    </button>
                  ) : (
                    <span className="text-xs text-gray-500">Coach/Admin only</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            <div className="p-4 border-b border-gray-200">
              <h2 className="font-semibold">Selected Picks ({pickedTeams.length})</h2>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {orderedPickedTeams.map((team, index) => {
                const stats = teamStatsMap.get(team.teamNumber);
                const avgScore = stats?.avgScore ?? team.avgScore ?? 0;
                const highScore = stats?.highScore ?? team.highScore ?? 0;
                const order = team.pickOrder ?? index + 1;
                return (
                  <div key={team.teamNumber} data-analytics-search-item="true" className="p-4 border-b flex items-center justify-between">
                    <div>
                      <p className="font-semibold">
                        #{order} Team {team.teamNumber}
                      </p>
                      <p className="text-sm text-gray-600">{formatStatLine(team.teamNumber, avgScore, highScore)}</p>
                    </div>
                    {canEditPickList ? (
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => movePick(team.teamNumber, "up")}
                            disabled={index === 0}
                            className="px-2 py-1 rounded border border-gray-300 text-xs disabled:opacity-40"
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            onClick={() => movePick(team.teamNumber, "down")}
                            disabled={index === orderedPickedTeams.length - 1}
                            className="px-2 py-1 rounded border border-gray-300 text-xs disabled:opacity-40"
                          >
                            Down
                          </button>
                        </div>
                        <button
                          onClick={() => removeTeam(team.teamNumber)}
                          className="px-3 py-1.5 rounded bg-red-100 text-red-700 text-sm"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-500">Coach/Admin only</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </AnalyticsShell>
  );
}

export default function PickListAnalyticsPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <PickListContent />
    </ProtectedRoute>
  );
}
