"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import ExpandableNotesCell from "@/app/components/ExpandableNotesCell";
import {
  entryMatchesAnalyticsFilters,
  getEventOptionsForEntries,
  isPracticeScoutedEntry,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";
import { formatAnalyticsText } from "@/app/utils/displayFormat";
import { compareMatchLabels } from "@/app/utils/sortHelpers";

type LeadScoutEntry = {
  id: string;
  game?: string;
  eventKey?: string;
  matchId?: string;
  matchType?: string;
  matchNumber?: string;
  matchLabel?: string;
  alliance?: string;
  scoutName?: string;
  robots?: Array<{
    teamNumber?: string;
    pickNumber?: string;
    notes?: string;
    skillLevel?: number;
  }>;
  overallAlliance?: {
    teams?: string;
    notes?: string;
    skillLevel?: number;
  };
  submittedAt?: number;
  timestamp?: number;
  isPracticeScouting?: boolean;
};

function LeadAnalyticsContent() {
  const [entries, setEntries] = useState<LeadScoutEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REBUILT");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedGame = localStorage.getItem("analytics-selected-game");
    const savedEvent = localStorage.getItem("analytics-selected-event");
    const savedPractice = localStorage.getItem("analytics-practice-matches-only");
    if (savedGame === "REBUILT") setSelectedGame("REBUILT");
    if (savedEvent) setSelectedEvent(savedEvent);
    if (savedPractice !== null) setPracticeMatchesOnly(savedPractice === "true");
  }, []);

  useEffect(() => {
    localStorage.setItem("analytics-selected-game", selectedGame);
    localStorage.setItem("analytics-selected-event", selectedEvent);
    localStorage.setItem("analytics-practice-matches-only", String(practiceMatchesOnly));
  }, [practiceMatchesOnly, selectedEvent, selectedGame]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "leadScouting"));
        setEntries(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as LeadScoutEntry[]);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const normalized = useMemo(
    () =>
      entries.map((entry) => ({
        ...entry,
        game: entry.game || "REBUILT",
        timestamp: entry.timestamp || entry.submittedAt || 0,
      })),
    [entries]
  );

  const filtered = useMemo(() => {
    const gameFiltered = normalized.filter((entry) => entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent));
    return gameFiltered.filter((entry) => (practiceMatchesOnly ? isPracticeScoutedEntry(entry) : !isPracticeScoutedEntry(entry)));
  }, [normalized, practiceMatchesOnly, selectedEvent, selectedGame]);

  const sorted = useMemo(
    () =>
      filtered.slice().sort((a, b) => {
        const matchA = a.matchLabel || a.matchId || "";
        const matchB = b.matchLabel || b.matchId || "";
        const matchSort = compareMatchLabels(matchA, matchB, "asc");
        if (matchSort !== 0) return matchSort;
        const allianceSort = String(a.alliance || "").localeCompare(String(b.alliance || ""));
        if (allianceSort !== 0) return allianceSort;
        return String(a.scoutName || "").localeCompare(String(b.scoutName || ""));
      }),
    [filtered]
  );

  const eventOptions = useMemo(() => getEventOptionsForEntries(normalized, selectedGame), [normalized, selectedGame]);

  return (
    <AnalyticsShell
      entriesCount={filtered.length}
      selectedGame={selectedGame}
      onSelectedGameChange={(game) => setSelectedGame(game as AnalyticsGame)}
      practiceMatchesOnly={practiceMatchesOnly}
      onPracticeMatchesOnlyChange={setPracticeMatchesOnly}
      selectedEvent={selectedEvent}
      eventOptions={eventOptions}
      onSelectedEventChange={setSelectedEvent}
      allowedGames={["REBUILT"]}
    >
      <div className="mb-4">
        <h1 className="text-3xl font-bold mb-1 theme-text">Lead Analytics</h1>
        <p className="text-sm text-gray-600">Alliance-level lead scout notes and skill ratings.</p>
      </div>

      {loading ? (
        <LoadingSpinner message="Loading lead analytics..." />
      ) : (
        <div className="bg-white rounded-xl shadow h-[calc(100vh-270px)] table-scroll overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Match</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Alliance</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Scout</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">R1 Team</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">R1 Pick</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">R1 Skill</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">R1 Notes</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">R2 Team</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">R2 Pick</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">R2 Skill</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">R2 Notes</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">R3 Team</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">R3 Pick</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">R3 Skill</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">R3 Notes</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Alliance Teams</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Alliance Skill</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Alliance Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sorted.map((entry) => {
                const r1 = entry.robots?.[0];
                const r2 = entry.robots?.[1];
                const r3 = entry.robots?.[2];
                const overall = entry.overallAlliance;
                return (
                  <tr key={entry.id}>
                    <td className="px-4 py-2 whitespace-nowrap font-medium">{entry.matchLabel || entry.matchId || "-"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{entry.alliance ? entry.alliance.toUpperCase() : "-"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{entry.scoutName || "-"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{r1?.teamNumber || "-"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{r1?.pickNumber || "-"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{r1?.skillLevel || "-"}</td>
                    <td className="px-4 py-2 min-w-[200px]">
                      <ExpandableNotesCell text={formatAnalyticsText(r1?.notes)} />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{r2?.teamNumber || "-"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{r2?.pickNumber || "-"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{r2?.skillLevel || "-"}</td>
                    <td className="px-4 py-2 min-w-[200px]">
                      <ExpandableNotesCell text={formatAnalyticsText(r2?.notes)} />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{r3?.teamNumber || "-"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{r3?.pickNumber || "-"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{r3?.skillLevel || "-"}</td>
                    <td className="px-4 py-2 min-w-[200px]">
                      <ExpandableNotesCell text={formatAnalyticsText(r3?.notes)} />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatAnalyticsText(overall?.teams) || "-"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{overall?.skillLevel || "-"}</td>
                    <td className="px-4 py-2 min-w-[200px]">
                      <ExpandableNotesCell text={formatAnalyticsText(overall?.notes)} />
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-gray-500" colSpan={18}>
                    No lead scout entries found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </AnalyticsShell>
  );
}

export default function LeadAnalyticsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <LeadAnalyticsContent />
    </ProtectedRoute>
  );
}
