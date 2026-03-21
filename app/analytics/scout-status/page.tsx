"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import DataSourceCredits from "@/app/components/DataSourceCredits";
import { useAuth } from "@/app/AuthContext";
import {
  entryMatchesAnalyticsFilters,
  getEventOptionsForEntries,
  getEventsForGame,
  isPracticeScoutedEntry,
  normalizeMatchLabel,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";
import { fetchFirstSchedule, splitFirstAllianceTeams } from "@/app/utils/firstSchedule";
import { getEventMatches, type TBAMatch } from "@/app/utils/tba-api";

type ScoutingEntry = {
  id?: string;
  eventKey?: string;
  eventName?: string;
  matchId?: string;
  matchKey?: string;
  matchLabel?: string;
  matchNumber?: string;
  matchType?: string;
  submittedAt?: number;
  timestamp?: number;
  game?: string;
  teamNumber?: string;
  scoutName?: string;
  scoutId?: string;
  isPracticeScouting?: boolean;
  practiceMode?: string;
  practiceSessionId?: string;
};

type MatchRow = {
  key: string;
  label: string;
  time: number;
  red: number[];
  blue: number[];
  level: "practice" | "qualification" | "playoff" | "finals";
  setNumber: number;
  matchNumber: number;
};

function entryTime(entry: ScoutingEntry): number {
  const raw = Number(entry.submittedAt ?? entry.timestamp ?? 0);
  return Number.isFinite(raw) ? raw : 0;
}

function entryMatchKey(entry: ScoutingEntry): string {
  const rawMatchId = String(entry.matchId || entry.matchKey || "").trim().toLowerCase();
  if (rawMatchId) return rawMatchId;
  const label = String(entry.matchLabel || "").trim();
  if (label) {
    const parsed = normalizeMatchLabel(label);
    return parsed.matchId || `${parsed.matchType}-${parsed.matchNumber}`;
  }
  const matchType = String(entry.matchType || "").trim().toLowerCase();
  const matchNumber = String(entry.matchNumber || "").replace(/[^\d]/g, "");
  if (matchType && matchNumber) {
    const prefix = matchType.startsWith("p") ? "p" : matchType.startsWith("f") ? "f" : "q";
    return `${prefix}${matchNumber}`;
  }
  if (matchNumber) return `q${matchNumber}`;
  return "";
}

function matchLabel(match: TBAMatch) {
  if (match.comp_level === "qm") return `Qualification ${match.match_number}`;
  if (match.comp_level === "f") return `Finals ${match.match_number}`;
  if (match.comp_level === "sf") return `Semifinal ${match.set_number}-${match.match_number}`;
  if (match.comp_level === "qf") return `Quarterfinal ${match.set_number}-${match.match_number}`;
  if (match.comp_level === "ef") return `Octofinal ${match.set_number}-${match.match_number}`;
  return match.key;
}

function compLevelPriority(compLevel: string) {
  if (compLevel === "pr") return -1;
  if (compLevel === "qm") return 0;
  if (compLevel === "ef") return 1;
  if (compLevel === "qf") return 2;
  if (compLevel === "sf") return 3;
  if (compLevel === "f") return 4;
  return 99;
}

async function fetchMatchesForEvent(eventKey: string, encryptedKey: string, plainKey: string): Promise<TBAMatch[]> {
  try {
    const response = await fetch("/api/tba/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventKey, encryptedKey, plainKey }),
    });
    if (response.ok) {
      const payload = (await response.json()) as { matches?: TBAMatch[] };
      if (Array.isArray(payload.matches)) return payload.matches;
    }
  } catch (error) {
    console.warn("Scout status TBA proxy failed:", error);
  }

  try {
    return await getEventMatches(eventKey, plainKey || undefined);
  } catch (error) {
    console.warn("Scout status direct TBA fetch failed:", error);
    return [];
  }
}

function ScoutStatusContent() {
  const { userData } = useAuth();
  const [entries, setEntries] = useState<ScoutingEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REBUILT");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [tbaKeys, setTbaKeys] = useState({ encrypted: "", plain: "" });

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
      setLoadingEntries(true);
      try {
        const snap = await getDocs(collection(db, "scouting"));
        setEntries(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      } finally {
        setLoadingEntries(false);
      }
    }
    loadEntries();
  }, []);

  useEffect(() => {
    async function loadKeys() {
      if (!userData?.teamId) return;
      try {
        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        setTbaKeys({
          encrypted: String(teamDoc.data()?.tbaApiKeyEncrypted || "").trim(),
          plain: String(teamDoc.data()?.tbaApiKey || "").trim(),
        });
      } catch (error) {
        console.warn("Scout status failed to load TBA keys:", error);
      }
    }
    void loadKeys();
  }, [userData?.teamId]);

  const eventOptions = useMemo(() => {
    return [{ id: "all", name: "All Events" }, ...getEventOptionsForEntries(entries, selectedGame)];
  }, [entries, selectedGame]);

  const filteredEntries = useMemo(() => {
    const eventFilterOptions = getEventsForGame(selectedGame);
    return entries
      .filter((entry) => entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent, eventFilterOptions))
      .filter((entry) => (practiceMatchesOnly ? isPracticeScoutedEntry(entry) : !isPracticeScoutedEntry(entry)));
  }, [entries, selectedEvent, selectedGame, practiceMatchesOnly]);

  const scoutStats = useMemo(() => {
    const byScout = new Map<string, { id: string; name: string; entries: number; matches: Set<string>; last: number }>();
    filteredEntries.forEach((entry) => {
      const scoutId = String(entry.scoutId || entry.scoutName || "unknown").trim();
      const scoutName = String(entry.scoutName || "Unknown Scout").trim();
      const matchKey = entryMatchKey(entry);
      if (!scoutId) return;
      const current = byScout.get(scoutId) || { id: scoutId, name: scoutName, entries: 0, matches: new Set<string>(), last: 0 };
      current.entries += 1;
      if (matchKey) current.matches.add(matchKey);
      const time = entryTime(entry);
      if (time > current.last) current.last = time;
      byScout.set(scoutId, current);
    });
    return Array.from(byScout.values()).sort((a, b) => b.entries - a.entries);
  }, [filteredEntries]);

  const coverage = useMemo(() => {
    const set = new Set<string>();
    filteredEntries.forEach((entry) => {
      const team = String(entry.teamNumber || "").trim();
      const matchKey = entryMatchKey(entry);
      if (!team || !matchKey) return;
      set.add(`${matchKey}::${team}`);
    });
    return set;
  }, [filteredEntries]);

  useEffect(() => {
    async function loadMatches() {
      if (!selectedEvent || selectedEvent === "all") {
        setMatches([]);
        return;
      }
      setScheduleLoading(true);
      try {
        const rows = await fetchMatchesForEvent(selectedEvent, tbaKeys.encrypted, tbaKeys.plain);
        const normalized = rows
          .sort((a, b) => {
            const levelDiff = compLevelPriority(a.comp_level) - compLevelPriority(b.comp_level);
            if (levelDiff !== 0) return levelDiff;
            if (a.set_number !== b.set_number) return a.set_number - b.set_number;
            return a.match_number - b.match_number;
          })
          .map((match) => {
            const level =
              match.comp_level === "pr"
                ? "practice"
                : match.comp_level === "qm"
                ? "qualification"
                : match.comp_level === "f"
                ? "finals"
                : "playoff";
            return {
              key: match.key,
              label: matchLabel(match),
              time: match.actual_time || match.predicted_time || match.time || 0,
              red: match.alliances.red.team_keys.map((k) => parseInt(k.replace("frc", ""), 10)).filter(Number.isFinite),
              blue: match.alliances.blue.team_keys.map((k) => parseInt(k.replace("frc", ""), 10)).filter(Number.isFinite),
              level,
              setNumber: match.set_number,
              matchNumber: match.match_number,
            } as MatchRow;
          });
        const firstSchedule = await fetchFirstSchedule(selectedEvent, "Practice");
        const existingPracticeNumbers = new Set(normalized.filter((row) => row.level === "practice").map((row) => row.matchNumber));
        const firstPracticeRows = firstSchedule
          .map((match) => {
            const { red, blue } = splitFirstAllianceTeams(match);
            return {
              key: `first_${selectedEvent}_practice_${match.matchNumber}`,
              label: `Practice ${match.matchNumber}`,
              time: match.startTime || 0,
              red,
              blue,
              level: "practice" as const,
              setNumber: 1,
              matchNumber: match.matchNumber,
            };
          })
          .filter((row) => row.red.length >= 3 && row.blue.length >= 3)
          .filter((row) => !existingPracticeNumbers.has(row.matchNumber));
        const merged = [...firstPracticeRows, ...normalized].sort((a, b) => {
          const levelOrder = a.level === "practice" ? -1 : a.level === "qualification" ? 0 : a.level === "playoff" ? 1 : 2;
          const otherLevelOrder = b.level === "practice" ? -1 : b.level === "qualification" ? 0 : b.level === "playoff" ? 1 : 2;
          if (levelOrder !== otherLevelOrder) return levelOrder - otherLevelOrder;
          if (a.setNumber !== b.setNumber) return a.setNumber - b.setNumber;
          if (a.matchNumber !== b.matchNumber) return a.matchNumber - b.matchNumber;
          return a.time - b.time;
        });
        setMatches(merged);
      } catch (error) {
        console.warn("Scout status failed to load match schedule:", error);
        setMatches([]);
      } finally {
        setScheduleLoading(false);
      }
    }
    void loadMatches();
  }, [selectedEvent, tbaKeys.encrypted, tbaKeys.plain]);

  const visibleMatches = useMemo(() => {
    if (practiceMatchesOnly) return matches.filter((match) => match.level === "practice");
    return matches.filter((match) => match.level !== "practice");
  }, [matches, practiceMatchesOnly]);

  return (
    <AnalyticsShell
      entriesCount={filteredEntries.length}
      selectedGame={selectedGame}
      onSelectedGameChange={(game) => setSelectedGame(game as AnalyticsGame)}
      practiceMatchesOnly={practiceMatchesOnly}
      onPracticeMatchesOnlyChange={setPracticeMatchesOnly}
      selectedEvent={selectedEvent}
      eventOptions={eventOptions}
      onSelectedEventChange={setSelectedEvent}
    >
      <h1 className="text-3xl font-bold mb-2 theme-text">Scout Status</h1>
      <p className="text-gray-600 mb-6">Who has scouted and which match robots are covered.</p>
      <DataSourceCredits className="mb-6 max-w-3xl" />

      {loadingEntries ? (
        <LoadingSpinner message="Loading scouting entries..." />
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-md overflow-x-auto mb-6">
            <table className="w-full min-w-[520px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scout</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Matches Scouted</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entries</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Submit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {scoutStats.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-sm text-gray-600" colSpan={4}>
                      No match scouting entries found for this selection.
                    </td>
                  </tr>
                ) : (
                  scoutStats.map((row) => (
                    <tr key={row.id} data-analytics-search-item="true">
                      <td className="px-4 py-3 font-medium">{row.name}</td>
                      <td className="px-4 py-3">{row.matches.size}</td>
                      <td className="px-4 py-3">{row.entries}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {row.last ? new Date(row.last).toLocaleString() : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl shadow-md overflow-x-auto">
            <div className="p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold mb-1">Match Coverage</h2>
              <p className="text-sm text-gray-600">
                Check whether each scheduled robot has a scouting entry. “OK” means at least one submission exists.
              </p>
            </div>
            {selectedEvent === "all" ? (
              <div className="p-4 text-sm text-gray-600">Select a specific event to view match coverage.</div>
            ) : scheduleLoading ? (
              <div className="p-4">
                <LoadingSpinner message="Loading match schedule..." />
              </div>
            ) : visibleMatches.length === 0 ? (
              <div className="p-4 text-sm text-gray-600">No matches found for the selected event.</div>
            ) : (
              <table className="w-full min-w-[900px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Match</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Red 1</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Red 2</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Red 3</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Blue 1</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Blue 2</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Blue 3</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {visibleMatches.map((match) => {
                    const matchKey = normalizeMatchLabel(match.label).matchId || `${match.level}-${match.matchNumber}`;
                    const timeLabel = match.time
                      ? new Date(match.time * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                      : "TBD";
                    const allTeams = [...match.red, ...match.blue];
                    const cells = allTeams.map((team) => {
                      const scouted = coverage.has(`${matchKey}::${team}`);
                      return (
                        <td key={`${match.key}-${team}`} className="px-4 py-3 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{team}</span>
                            <span className={scouted ? "text-green-700" : "text-red-600"}>{scouted ? "OK" : "X"}</span>
                          </div>
                        </td>
                      );
                    });
                    return (
                      <tr key={match.key} data-analytics-search-item="true">
                        <td className="px-4 py-3 font-medium">{match.label}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{timeLabel}</td>
                        {cells}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </AnalyticsShell>
  );
}

export default function ScoutStatusPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <ScoutStatusContent />
    </ProtectedRoute>
  );
}
