"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, deleteDoc, doc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { useAnalyticsNotesSettings } from "@/app/components/AnalyticsNotesContext";
import {
  entryMatchesAnalyticsFilters,
  getEventOptionsForEntries,
  isLeadScoutingEntry,
  isPracticeScoutedEntry,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";
import { formatAnalyticsText } from "@/app/utils/displayFormat";
import { compareMatchLabels, compareSortValues, sortLabel, type SortDir } from "@/app/utils/sortHelpers";
import { useAuth } from "@/app/AuthContext";

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
  entryType?: string;
  isLeadScouting?: boolean;
  sourceCollection?: "leadScouting" | "scouting";
};

type SortKey =
  | "matchLabel"
  | "alliance"
  | "scoutName"
  | "overallTeams"
  | "overallNotes"
  | "overallSkill"
  | "r1Team"
  | "r1Notes"
  | "r1Skill"
  | "r2Team"
  | "r2Notes"
  | "r2Skill"
  | "r3Team"
  | "r3Notes"
  | "r3Skill"
  | "id";

function LeadNotesCell({ text }: { text?: string | null }) {
  const { autoExpandNotes, setAutoExpandNotes } = useAnalyticsNotesSettings();
  const [isOverflowing, setIsOverflowing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const content = useMemo(() => (text ?? "").trim(), [text]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const checkOverflow = () => {
      const heightOverflow = el.scrollHeight > el.clientHeight + 1;
      const widthOverflow = el.scrollWidth > el.clientWidth + 1;
      setIsOverflowing(heightOverflow || widthOverflow);
    };
    checkOverflow();
    const id = window.setTimeout(checkOverflow, 0);
    return () => window.clearTimeout(id);
  }, [content, autoExpandNotes]);

  if (!content) {
    return <span className="text-gray-500">-</span>;
  }

  const clampStyles: React.CSSProperties = autoExpandNotes
    ? { whiteSpace: "pre-wrap" }
    : {
        display: "-webkit-box",
        WebkitLineClamp: 1,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
        whiteSpace: "pre-wrap",
      };

  return (
    <button
      type="button"
      onClick={() => {
        if (!isOverflowing && !autoExpandNotes) return;
        setAutoExpandNotes(!autoExpandNotes);
      }}
      className={`w-full text-left ${isOverflowing || autoExpandNotes ? "cursor-pointer" : "cursor-default"}`}
      title={autoExpandNotes ? "Collapse all notes" : "Expand all notes"}
      aria-expanded={autoExpandNotes}
    >
      <div ref={containerRef} style={clampStyles}>
        {content}
      </div>
    </button>
  );
}

function LeadAnalyticsContent() {
  const { userData } = useAuth();
  const isCoach = userData?.role === "coach";
  const isTeamCoach = String(userData?.role || "").toLowerCase() === "team-coach" || (userData?.roles || []).includes("team-coach");
  const isTeamAdmin = Boolean(userData?.isTeamAdmin);
  const canDeleteEntries = isCoach || isTeamCoach || isTeamAdmin;
  const columnCount = canDeleteEntries ? 16 : 15;
  const [entries, setEntries] = useState<LeadScoutEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REBUILT");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("matchLabel");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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
        const results = await Promise.allSettled([
          getDocs(collection(db, "leadScouting")),
          getDocs(query(collection(db, "scouting"), where("entryType", "==", "lead"))),
        ]);
        const leadEntries =
          results[0].status === "fulfilled"
            ? results[0].value.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
                entryType: "lead",
                isLeadScouting: true,
                sourceCollection: "leadScouting",
              }))
            : [];
        const scoutingEntries =
          results[1].status === "fulfilled"
            ? results[1].value.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
                entryType: "lead",
                isLeadScouting: true,
                sourceCollection: "scouting",
              }))
            : [];
        setEntries([...leadEntries, ...scoutingEntries] as LeadScoutEntry[]);
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
    const gameFiltered = normalized.filter((entry) =>
      entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent, undefined, { includeLead: true })
    );
    const leadOnly = gameFiltered.filter((entry) => isLeadScoutingEntry(entry));
    return leadOnly.filter((entry) => (practiceMatchesOnly ? isPracticeScoutedEntry(entry) : !isPracticeScoutedEntry(entry)));
  }, [normalized, practiceMatchesOnly, selectedEvent, selectedGame]);

  const sorted = useMemo(() => {
    const getValue = (entry: LeadScoutEntry) => {
      const r1 = entry.robots?.[0];
      const r2 = entry.robots?.[1];
      const r3 = entry.robots?.[2];
      const overall = entry.overallAlliance;
      switch (sortKey) {
        case "matchLabel":
          return entry.matchLabel || entry.matchId || "";
        case "alliance":
          return entry.alliance || "";
        case "scoutName":
          return entry.scoutName || "";
        case "overallTeams":
          return formatAnalyticsText(overall?.teams);
        case "overallNotes":
          return formatAnalyticsText(overall?.notes);
        case "overallSkill":
          return overall?.skillLevel ?? 0;
        case "r1Team":
          return r1?.teamNumber || "";
        case "r1Notes":
          return formatAnalyticsText(r1?.notes);
        case "r1Skill":
          return r1?.skillLevel ?? 0;
        case "r2Team":
          return r2?.teamNumber || "";
        case "r2Notes":
          return formatAnalyticsText(r2?.notes);
        case "r2Skill":
          return r2?.skillLevel ?? 0;
        case "r3Team":
          return r3?.teamNumber || "";
        case "r3Notes":
          return formatAnalyticsText(r3?.notes);
        case "r3Skill":
          return r3?.skillLevel ?? 0;
        case "id":
          return entry.id || "";
        default:
          return "";
      }
    };
    return filtered.slice().sort((a, b) => {
      if (sortKey === "matchLabel") {
        return compareMatchLabels(String(a.matchLabel || a.matchId || ""), String(b.matchLabel || b.matchId || ""), sortDir);
      }
      return compareSortValues(getValue(a), getValue(b), sortDir);
    });
  }, [filtered, sortDir, sortKey]);

  const eventOptions = useMemo(() => getEventOptionsForEntries(normalized, selectedGame), [normalized, selectedGame]);

  function handleSort(key: SortKey) {
    setSortDir((prev) => (key === sortKey ? (prev === "asc" ? "desc" : "asc") : "asc"));
    setSortKey(key);
  }

  async function handleDelete(entry: LeadScoutEntry) {
    if (!canDeleteEntries) return;
    const ok = confirm("Delete this lead scout entry?");
    if (!ok) return;
    const collectionName = entry.sourceCollection === "scouting" ? "scouting" : "leadScouting";
    await deleteDoc(doc(db, collectionName, entry.id));
    setEntries((prev) => prev.filter((row) => row.id !== entry.id));
  }

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
        <div className="bg-white rounded-xl shadow h-[calc(100vh-270px)] table-scroll">
          <table>
            <thead className="sticky-header">
              <tr>
                <th className="bg-red-300 text-center" colSpan={3}>Pre-Match</th>
                <th className="bg-pink-300 text-center" colSpan={3}>Overall Alliance</th>
                <th className="bg-blue-300 text-center" colSpan={9}>Robots</th>
                {canDeleteEntries && <th className="bg-pink-300 text-center" colSpan={1}>Actions</th>}
              </tr>
              <tr>
                <th className="bg-red-200 text-center" colSpan={3}>Pre-Match</th>
                <th className="bg-pink-200 text-center" colSpan={3}>Overall Alliance</th>
                <th className="bg-blue-200 text-center" colSpan={3}>Robot 1</th>
                <th className="bg-blue-200 text-center" colSpan={3}>Robot 2</th>
                <th className="bg-blue-200 text-center" colSpan={3}>Robot 3</th>
                {canDeleteEntries && <th className="bg-pink-200 text-center" colSpan={1}>Actions</th>}
              </tr>
              <tr>
                <th className="cursor-pointer text-center" onClick={() => handleSort("matchLabel")}>
                  {sortLabel(sortKey, sortDir, "matchLabel", "Match")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("alliance")}>
                  {sortLabel(sortKey, sortDir, "alliance", "Alliance")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("scoutName")}>
                  {sortLabel(sortKey, sortDir, "scoutName", "Scout")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("overallTeams")}>
                  {sortLabel(sortKey, sortDir, "overallTeams", "Alliance / Team Numbers")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("overallNotes")}>
                  {sortLabel(sortKey, sortDir, "overallNotes", "Notes")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("overallSkill")}>
                  {sortLabel(sortKey, sortDir, "overallSkill", "Skill Level")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r1Team")}>
                  {sortLabel(sortKey, sortDir, "r1Team", "Team Number")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r1Notes")}>
                  {sortLabel(sortKey, sortDir, "r1Notes", "Notes")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r1Skill")}>
                  {sortLabel(sortKey, sortDir, "r1Skill", "Skill Level")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r2Team")}>
                  {sortLabel(sortKey, sortDir, "r2Team", "Team Number")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r2Notes")}>
                  {sortLabel(sortKey, sortDir, "r2Notes", "Notes")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r2Skill")}>
                  {sortLabel(sortKey, sortDir, "r2Skill", "Skill Level")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r3Team")}>
                  {sortLabel(sortKey, sortDir, "r3Team", "Team Number")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r3Notes")}>
                  {sortLabel(sortKey, sortDir, "r3Notes", "Notes")}
                </th>
                <th className="cursor-pointer text-center" onClick={() => handleSort("r3Skill")}>
                  {sortLabel(sortKey, sortDir, "r3Skill", "Skill Level")}
                </th>
                {canDeleteEntries && (
                  <th className="cursor-pointer text-center" onClick={() => handleSort("id")}>
                    {sortLabel(sortKey, sortDir, "id", "Actions")}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => {
                const r1 = entry.robots?.[0];
                const r2 = entry.robots?.[1];
                const r3 = entry.robots?.[2];
                const overall = entry.overallAlliance;
                return (
                  <tr key={entry.id}>
                    <td className="font-semibold">{entry.matchLabel || entry.matchId || "-"}</td>
                    <td>{entry.alliance ? entry.alliance.toUpperCase() : "-"}</td>
                    <td>{entry.scoutName || "-"}</td>
                    <td>{formatAnalyticsText(overall?.teams) || "-"}</td>
                    <td className="min-w-[180px]">
                      <LeadNotesCell text={formatAnalyticsText(overall?.notes)} />
                    </td>
                    <td>{overall?.skillLevel || "-"}</td>
                    <td>{r1?.teamNumber || "-"}</td>
                    <td className="min-w-[180px]">
                      <LeadNotesCell text={formatAnalyticsText(r1?.notes)} />
                    </td>
                    <td>{r1?.skillLevel || "-"}</td>
                    <td>{r2?.teamNumber || "-"}</td>
                    <td className="min-w-[180px]">
                      <LeadNotesCell text={formatAnalyticsText(r2?.notes)} />
                    </td>
                    <td>{r2?.skillLevel || "-"}</td>
                    <td>{r3?.teamNumber || "-"}</td>
                    <td className="min-w-[180px]">
                      <LeadNotesCell text={formatAnalyticsText(r3?.notes)} />
                    </td>
                    <td>{r3?.skillLevel || "-"}</td>
                    {canDeleteEntries && (
                      <td className="text-center">
                        <button
                          type="button"
                          onClick={() => void handleDelete(entry)}
                          className="px-3 py-1 rounded text-white text-sm disabled:opacity-60"
                          style={{ backgroundColor: "#dc2626" }}
                          title="Delete entry"
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-gray-500" colSpan={columnCount}>
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
