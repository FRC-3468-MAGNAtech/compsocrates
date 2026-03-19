"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, deleteDoc, doc, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { useAnalyticsNotesSettings } from "@/app/components/AnalyticsNotesContext";
import {
  entryMatchesAnalyticsFilters,
  getEventOptionsForEntries,
  isPracticeScoutedEntry,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";
import { formatAnalyticsText } from "@/app/utils/displayFormat";
import { compareMatchLabels } from "@/app/utils/sortHelpers";
import { useAuth } from "@/app/AuthContext";
import { Trash2 } from "lucide-react";

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

  async function handleDelete(entry: LeadScoutEntry) {
    if (!canDeleteEntries) return;
    const ok = confirm("Delete this lead scout entry?");
    if (!ok) return;
    await deleteDoc(doc(db, "leadScouting", entry.id));
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
                <th className="bg-pink-300 text-center" colSpan={1}>Actions</th>
              </tr>
              <tr>
                <th className="bg-red-200 text-center" colSpan={3}>Pre-Match</th>
                <th className="bg-pink-200 text-center" colSpan={3}>Overall Alliance</th>
                <th className="bg-blue-200 text-center" colSpan={3}>Robot 1</th>
                <th className="bg-blue-200 text-center" colSpan={3}>Robot 2</th>
                <th className="bg-blue-200 text-center" colSpan={3}>Robot 3</th>
                <th className="bg-pink-200 text-center" colSpan={1}>Actions</th>
              </tr>
              <tr>
                <th className="text-center">Match</th>
                <th className="text-center">Alliance</th>
                <th className="text-center">Scout</th>
                <th className="text-center">Alliance / Team Numbers</th>
                <th className="text-center">Notes</th>
                <th className="text-center">Skill Level</th>
                <th className="text-center">Team Number</th>
                <th className="text-center">Notes</th>
                <th className="text-center">Skill Level</th>
                <th className="text-center">Team Number</th>
                <th className="text-center">Notes</th>
                <th className="text-center">Skill Level</th>
                <th className="text-center">Team Number</th>
                <th className="text-center">Notes</th>
                <th className="text-center">Skill Level</th>
                <th className="text-center">Actions</th>
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
                    <td className="text-center">
                      {canDeleteEntries ? (
                        <button
                          type="button"
                          onClick={() => void handleDelete(entry)}
                          className="text-red-600 hover:text-red-800"
                          title="Delete entry"
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-gray-500" colSpan={16}>
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
