"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { sortMatches } from "@/app/utils/matchSorting";
import {
  entryMatchesAnalyticsFilters,
  getEventOptionsForEntries,
  isPracticeScoutedEntry,
  normalizeMatchLabel,
  type AnalyticsEventOption,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";
import { dedupeEntriesByMatchTeam } from "@/app/utils/entryDeduping";
import { useAuth } from "@/app/AuthContext";
import { getTeamEventOptions } from "@/app/utils/eventDetection";
import { fetchEventMatchesWithTeamAuth, mapTbaMatchToModalId } from "@/app/utils/reefscapeMatchSync";
import { type TBAMatch } from "@/app/utils/tba-api";
import { formatMatchLabelLong } from "@/app/utils/displayFormat";

type ScoutingEntry = {
  id?: string;
  eventKey?: string;
  submittedAt?: number;
  timestamp?: number;
  accuracy?: number;
  game?: string;
  matchId?: string;
  matchKey?: string;
  matchNumber?: string;
  matchLabel?: string;
  matchType?: string;
  practiceMode?: string;
  isPracticeScouting?: boolean;
  excludeFromStats?: boolean;
  teamNumber?: string;
  scoutName?: string;
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
  alliance?: string;
  allianceColor?: string;
  assignedAlliance?: string;
  startingPosition?: string;
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
};

type AllianceRow = {
  teamNumber: string;
  totalScore: number;
};

function isPracticeEntry(entry: ScoutingEntry) {
  return isPracticeScoutedEntry(entry);
}

function formatMatchLabel(matchId: string): string {
  return formatMatchLabelLong(matchId);
}

function normalizeMatchId(entry: ScoutingEntry): string {
  const direct = String(entry.matchId || entry.matchKey || "").toLowerCase();
  if (direct) {
    const qm = direct.match(/_qm(\d+)/);
    if (qm) return `q${qm[1]}`;
    const finals = direct.match(/_f(\d+)/);
    if (finals) return `f${finals[1]}`;
    const short = direct.match(/^([pqf])\D*(\d+)/);
    if (short) return `${short[1]}${short[2]}`;
  }
  const labelSource = String(entry.matchNumber || entry.matchLabel || "");
  const byLabel = normalizeMatchLabel(labelSource);
  if (labelSource.trim()) return byLabel.matchId;

  const num = String(entry.matchNumber || "").replace(/\D/g, "");
  const prefix = entry.matchType === "practice" ? "p" : entry.matchType === "finals" ? "f" : "q";
  return num ? `${prefix}${num}` : "";
}

function scoreEntry(entry: ScoutingEntry, game: AnalyticsGame) {
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

function inferAlliance(entry: ScoutingEntry): "red" | "blue" | null {
  const direct = String(entry.alliance || entry.allianceColor || entry.assignedAlliance || "").toLowerCase();
  if (direct === "red" || direct === "blue") return direct;
  const pos = String(entry.startingPosition || "").toLowerCase();
  if (pos.includes("red")) return "red";
  if (pos.includes("blue")) return "blue";
  return null;
}

function MatchBreakdownContent() {
  const { userData } = useAuth();
  const [entries, setEntries] = useState<ScoutingEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REEFSCAPE");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState("");
  const [loading, setLoading] = useState(true);
  const [detectedEventOptions, setDetectedEventOptions] = useState<AnalyticsEventOption[]>([]);
  const [tbaAuth, setTbaAuth] = useState<{ encryptedKey: string; plainKey: string }>({
    encryptedKey: "",
    plainKey: "",
  });
  const [scheduleByMatchId, setScheduleByMatchId] = useState<
    Record<string, { red: number[]; blue: number[] }>
  >({});

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
    void loadEntries();
  }, []);

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
        console.warn("Failed to load team event options for match breakdown:", error);
        if (!cancelled) setDetectedEventOptions([]);
      }
    }
    void loadDetectedEvents();
    return () => {
      cancelled = true;
    };
  }, [userData?.teamId]);

  useEffect(() => {
    let cancelled = false;
    async function loadTeamTbaAuth() {
      if (!userData?.teamId) {
        if (!cancelled) setTbaAuth({ encryptedKey: "", plainKey: "" });
        return;
      }
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        if (cancelled) return;
        setTbaAuth({
          encryptedKey: String(teamDoc.data()?.tbaApiKeyEncrypted || "").trim(),
          plainKey: String(teamDoc.data()?.tbaApiKey || "").trim(),
        });
      } catch (error) {
        console.warn("Failed loading team TBA auth for match breakdown:", error);
        if (!cancelled) setTbaAuth({ encryptedKey: "", plainKey: "" });
      }
    }
    void loadTeamTbaAuth();
    return () => {
      cancelled = true;
    };
  }, [userData?.teamId]);

  useEffect(() => {
    let cancelled = false;
    async function loadSchedule() {
      if (!selectedEvent || selectedEvent === "all" || selectedEvent === "app-testing") {
        if (!cancelled) setScheduleByMatchId({});
        return;
      }
      try {
        const matches = await fetchEventMatchesWithTeamAuth(selectedEvent, {
          encryptedKey: tbaAuth.encryptedKey,
          plainKey: tbaAuth.plainKey,
        });
        if (cancelled) return;
        const map: Record<string, { red: number[]; blue: number[] }> = {};
        const parseTeamKey = (teamKey: string) => Number(String(teamKey || "").replace(/^frc/i, ""));
        matches.forEach((match: TBAMatch) => {
          const matchId = mapTbaMatchToModalId(match);
          if (!matchId) return;
          const red = (match.alliances?.red?.team_keys || [])
            .map(parseTeamKey)
            .filter((value) => Number.isFinite(value) && value > 0);
          const blue = (match.alliances?.blue?.team_keys || [])
            .map(parseTeamKey)
            .filter((value) => Number.isFinite(value) && value > 0);
          if (red.length || blue.length) {
            map[matchId] = { red, blue };
          }
        });
        setScheduleByMatchId(map);
      } catch (error) {
        console.warn("Failed loading TBA schedule for match breakdown:", error);
        if (!cancelled) setScheduleByMatchId({});
      }
    }
    void loadSchedule();
    return () => {
      cancelled = true;
    };
  }, [selectedEvent, tbaAuth.encryptedKey, tbaAuth.plainKey]);

  const eventOptions = useMemo(
    () => getEventOptionsForEntries(entries, selectedGame, selectedGame === "REBUILT" ? detectedEventOptions : []),
    [entries, selectedGame, detectedEventOptions]
  );

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

  const matches = useMemo(() => {
    const ids = dedupedEntries.map((entry) => normalizeMatchId(entry)).filter(Boolean);
    return sortMatches([...new Set(ids)].map((matchId) => ({ matchId }))).map((row) => row.matchId);
  }, [dedupedEntries]);

  useEffect(() => {
    if (matches.length === 0) {
      if (selectedMatch) setSelectedMatch("");
      return;
    }
    if (!selectedMatch || !matches.includes(selectedMatch)) {
      setSelectedMatch(matches[0]);
    }
  }, [matches, selectedMatch]);

  const allianceBreakdown = useMemo(() => {
    const selectedRows = dedupedEntries.filter((entry) => normalizeMatchId(entry) === selectedMatch);
    const teamScores = new Map<string, { score: number; alliance: "red" | "blue" | null }>();
    const scheduled = scheduleByMatchId[selectedMatch];
    const scheduledAllianceByTeam = new Map<number, "red" | "blue">();
    if (scheduled) {
      scheduled.red.forEach((team) => scheduledAllianceByTeam.set(team, "red"));
      scheduled.blue.forEach((team) => scheduledAllianceByTeam.set(team, "blue"));
    }

    selectedRows.forEach((entry) => {
      const team = String(entry.teamNumber || "").trim();
      if (!team) return;
      const teamNumber = Number(team);
      const scheduledAlliance = Number.isFinite(teamNumber)
        ? scheduledAllianceByTeam.get(teamNumber) || null
        : null;
      const score = scoreEntry(entry, selectedGame);
      const alliance = scheduledAlliance || inferAlliance(entry);
      if (!teamScores.has(team)) {
        teamScores.set(team, { score, alliance });
      }
    });

    const red: AllianceRow[] = [];
    const blue: AllianceRow[] = [];
    const unknown: AllianceRow[] = [];

    Array.from(teamScores.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .forEach(([teamNumber, value]) => {
        const row = { teamNumber, totalScore: value.score };
        if (value.alliance === "red") red.push(row);
        else if (value.alliance === "blue") blue.push(row);
        else unknown.push(row);
      });

    if (!scheduled) {
      // Fill missing alliances when source does not include explicit alliance tags.
      unknown.forEach((row) => {
        if (red.length < 3) red.push(row);
        else blue.push(row);
      });
    }

    const redTotal = red.reduce((sum, row) => sum + row.totalScore, 0);
    const blueTotal = blue.reduce((sum, row) => sum + row.totalScore, 0);

    return { red, blue, redTotal, blueTotal };
  }, [dedupedEntries, selectedMatch, selectedGame, scheduleByMatchId]);

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
      <h1 className="text-3xl font-bold mb-2 theme-text">Match Breakdown</h1>
      <p className="text-gray-600 mb-6">Teams and scores grouped by alliance.</p>

      <div className="bg-white rounded-xl shadow-md p-4 mb-4">
        <label className="text-sm text-gray-600 mr-2">Select Match:</label>
        <select
          value={selectedMatch}
          onChange={(event) => setSelectedMatch(event.target.value)}
          className="border rounded px-3 py-2"
        >
          {matches.map((matchId) => (
            <option key={matchId} value={matchId}>
              {formatMatchLabel(matchId)}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <LoadingSpinner message="Loading match data..." />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            <div className="px-4 py-3 bg-red-50 border-b border-red-100">
              <p className="font-semibold text-red-700">Red Alliance Total: {allianceBreakdown.redTotal}</p>
            </div>
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {allianceBreakdown.red.map((row) => (
                  <tr key={`red-${row.teamNumber}`}>
                    <td className="px-4 py-3 font-semibold">{row.teamNumber}</td>
                    <td className="px-4 py-3 text-xl font-bold theme-text">{row.totalScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
              <p className="font-semibold text-blue-700">Blue Alliance Total: {allianceBreakdown.blueTotal}</p>
            </div>
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {allianceBreakdown.blue.map((row) => (
                  <tr key={`blue-${row.teamNumber}`}>
                    <td className="px-4 py-3 font-semibold">{row.teamNumber}</td>
                    <td className="px-4 py-3 text-xl font-bold theme-text">{row.totalScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AnalyticsShell>
  );
}

export default function MatchBreakdownPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <MatchBreakdownContent />
    </ProtectedRoute>
  );
}
