"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { sortMatches } from "@/app/utils/matchSorting";
import { entryMatchesAnalyticsFilters, getEventOptionsForEntries, type AnalyticsGame } from "@/app/utils/analyticsEvents";

type MatchEntry = {
  matchId: string;
  teamNumber: string;
  scoutName: string;
  totalScore: number;
};

type ScoutingEntry = {
  eventKey?: string;
  submittedAt?: number;
  timestamp?: number;
  game?: string;
  matchId?: string;
  matchNumber?: string;
  matchType?: string;
  practiceMode?: string;
  isPracticeScouting?: boolean;
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
};

function isPracticeEntry(entry: ScoutingEntry) {
  return entry.matchType === "practice" || Boolean(entry.practiceMode) || Boolean(entry.isPracticeScouting);
}

function formatMatchLabel(matchId: string): string {
  const id = matchId.toLowerCase();
  const num = id.replace(/\D/g, "");
  if (id.startsWith("p")) return `Practice ${num}`;
  if (id.startsWith("q")) return `Qualification ${num}`;
  if (id.startsWith("f")) return `Finals ${num}`;
  return `Match ${matchId}`;
}

function normalizeMatchId(entry: ScoutingEntry): string {
  const direct = String(entry.matchId || "").toLowerCase();
  if (direct) {
    const qm = direct.match(/_qm(\d+)/);
    if (qm) return `q${qm[1]}`;
    const finals = direct.match(/_f(\d+)/);
    if (finals) return `f${finals[1]}`;
    const short = direct.match(/^([pqf])\D*(\d+)/);
    if (short) return `${short[1]}${short[2]}`;
  }
  const num = String(entry.matchNumber || "").replace(/\D/g, "");
  const prefix = entry.matchType === "practice" ? "p" : entry.matchType === "finals" ? "f" : "q";
  return num ? `${prefix}${num}` : "";
}

function MatchBreakdownContent() {
  const [entries, setEntries] = useState<ScoutingEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REEFSCAPE");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState("");
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
    async function loadEntries() {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "scouting"));
        const rows = snap.docs.map((d) => d.data());
        setEntries(rows);
      } finally {
        setLoading(false);
      }
    }
    loadEntries();
  }, []);

  const filteredEntries = useMemo(() => {
    const gameFiltered = entries.filter((entry) => entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent));
    return gameFiltered.filter((entry) => (practiceMatchesOnly ? isPracticeEntry(entry) : !isPracticeEntry(entry)));
  }, [entries, selectedEvent, selectedGame, practiceMatchesOnly]);

  const matches = useMemo(() => {
    const ids = filteredEntries.map((e) => normalizeMatchId(e)).filter(Boolean);
    return sortMatches([...new Set(ids)].map((matchId) => ({ matchId }))).map((m) => m.matchId);
  }, [filteredEntries]);

  useEffect(() => {
    if (matches.length === 0) {
      if (selectedMatch) setSelectedMatch("");
      return;
    }
    if (!selectedMatch || !matches.includes(selectedMatch)) {
      setSelectedMatch(matches[0]);
    }
  }, [matches, selectedMatch]);

  const matchRows = useMemo<MatchEntry[]>(() => {
    if (!selectedMatch) return [];
    return filteredEntries
      .filter((e) => normalizeMatchId(e) === selectedMatch)
      .map((e) => ({
        matchId: selectedMatch,
        teamNumber: e.teamNumber || "-",
        scoutName: e.scoutName || "-",
        totalScore:
          (e.leftStartingZone ? 3 : 0) +
          (e.autoCoralL1 || 0) * 3 +
          (e.autoCoralL2 || 0) * 4 +
          (e.autoCoralL3 || 0) * 6 +
          (e.autoCoralL4 || 0) * 7 +
          (e.teleopCoralL1 || 0) * 2 +
          (e.teleopCoralL2 || 0) * 3 +
          (e.teleopCoralL3 || 0) * 4 +
          (e.teleopCoralL4 || 0) * 5 +
          Number(e.penaltyPoints || 0),
      }));
  }, [filteredEntries, selectedMatch]);

  return (
    <AnalyticsShell
      entriesCount={filteredEntries.length}
      selectedGame={selectedGame}
      onSelectedGameChange={(game) => setSelectedGame(game as AnalyticsGame)}
      practiceMatchesOnly={practiceMatchesOnly}
      onPracticeMatchesOnlyChange={setPracticeMatchesOnly}
      selectedEvent={selectedEvent}
      eventOptions={[{ id: "all", name: "All Events" }, ...getEventOptionsForEntries(entries, selectedGame)]}
      onSelectedEventChange={setSelectedEvent}
    >
      <h1 className="text-3xl font-bold mb-2 theme-text">Match Breakdown</h1>
      <p className="text-gray-600 mb-6">Detailed view by selected match.</p>

      <div className="bg-white rounded-xl shadow-md p-4 mb-4">
        <label className="text-sm text-gray-600 mr-2">Select Match:</label>
        <select
          value={selectedMatch}
          onChange={(e) => setSelectedMatch(e.target.value)}
          className="border rounded px-3 py-2"
        >
          {matches.map((m) => (
            <option key={m} value={m}>
              {formatMatchLabel(m)}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <LoadingSpinner message="Loading match data..." />
      ) : (
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scout</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {matchRows.map((row, idx) => (
                <tr key={`${row.teamNumber}-${idx}`}>
                  <td className="px-6 py-4 font-semibold">{row.teamNumber}</td>
                  <td className="px-6 py-4">{row.scoutName}</td>
                  <td className="px-6 py-4 text-xl font-bold theme-text">{row.totalScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
