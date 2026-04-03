"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, deleteDoc, doc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { useAnalyticsNotesSettings } from "@/app/components/AnalyticsNotesContext";
import AnalyticsConfigModal from "@/app/components/AnalyticsConfigModal";
import {
  entryMatchesAnalyticsFilters,
  getEventOptionsForEntries,
  isLeadScoutingEntry,
  isPracticeScoutedEntry,
  type AnalyticsGame,
} from "@/app/utils/analyticsEvents";
import { formatAnalyticsText, formatMatchLabelShort, getMatchLabelMeta } from "@/app/utils/displayFormat";
import { compareMatchLabels, compareSortValues, sortLabel, type SortDir } from "@/app/utils/sortHelpers";
import { useAuth } from "@/app/AuthContext";
import { getUserRoles } from "@/app/utils/roles";

type LeadScoutEntry = {
  id: string;
  game?: string;
  eventKey?: string;
  matchId?: string;
  matchKey?: string;
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
  excludeFromStats?: boolean;
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

function resolveLeadMatchLabel(entry: LeadScoutEntry): string {
  const primary = String(entry.matchLabel || "").trim();
  const primaryMeta = getMatchLabelMeta(primary);
  const isGeneric = !primary || (primaryMeta.category === "unknown" && /^match\b/i.test(primary));
  if (!isGeneric && primaryMeta.shortLabel) return primaryMeta.shortLabel;
  const fallback = String(entry.matchId || entry.matchKey || "").trim();
  if (fallback) return formatMatchLabelShort(fallback);
  return primaryMeta.shortLabel || primary || "-";
}

function resolveLeadMatchSortLabel(entry: LeadScoutEntry): string {
  const label = resolveLeadMatchLabel(entry);
  if (label && !/^match\b/i.test(label)) return label;
  const fallback = String(entry.matchId || entry.matchKey || "").trim();
  return fallback ? formatMatchLabelShort(fallback) : label;
}

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
  const userRoles = getUserRoles(userData);
  const isCoach = userData?.role === "coach";
  const isTeamCoach = String(userData?.role || "").toLowerCase() === "team-coach" || (userData?.roles || []).includes("team-coach");
  const isTeamAdmin = Boolean(userData?.isTeamAdmin);
  const canManageAnalytics = isCoach || isTeamCoach || isTeamAdmin || userRoles.includes("lead-scout") || userRoles.includes("lead-strategist");
  const canDeleteEntries = isCoach || isTeamCoach || isTeamAdmin || userRoles.includes("lead-strategist");
  const canViewScoutNames = isCoach || isTeamCoach || isTeamAdmin || userRoles.includes("lead-scout") || userRoles.includes("lead-strategist");
  const columnCount = canManageAnalytics ? 16 : 15;
  const canOpenConfig = canManageAnalytics;
  const [entries, setEntries] = useState<LeadScoutEntry[]>([]);
  const [configEntry, setConfigEntry] = useState<LeadScoutEntry | null>(null);
  const [selectedGame, setSelectedGame] = useState<AnalyticsGame>("REBUILT");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("matchLabel");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [hideNames, setHideNames] = useState(false);

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
        const teamId = String(userData?.teamId || "").trim();
        const leadQuery = teamId
          ? query(collection(db, "leadScouting"), where("teamId", "==", teamId))
          : collection(db, "leadScouting");
        const scoutingQuery = teamId
          ? query(collection(db, "scouting"), where("entryType", "==", "lead"), where("teamId", "==", teamId))
          : query(collection(db, "scouting"), where("entryType", "==", "lead"));
        const results = await Promise.allSettled([getDocs(leadQuery), getDocs(scoutingQuery)]);
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
  }, [userData?.teamId]);

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
          return resolveLeadMatchSortLabel(entry);
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
        const aMeta = getMatchLabelMeta(resolveLeadMatchSortLabel(a));
        const bMeta = getMatchLabelMeta(resolveLeadMatchSortLabel(b));
        if (aMeta.order !== bMeta.order) return sortDir === "asc" ? aMeta.order - bMeta.order : bMeta.order - aMeta.order;
        if (aMeta.matchNumber !== bMeta.matchNumber) {
          return sortDir === "asc" ? aMeta.matchNumber - bMeta.matchNumber : bMeta.matchNumber - aMeta.matchNumber;
        }
        return compareMatchLabels(String(a.matchLabel || a.matchId || ""), String(b.matchLabel || b.matchId || ""), sortDir);
      }
      return compareSortValues(getValue(a), getValue(b), sortDir);
    });
  }, [filtered, sortDir, sortKey]);

  const eventOptions = useMemo(
    () => [{ id: "all", name: "All Events" }, ...getEventOptionsForEntries(normalized, selectedGame)],
    [normalized, selectedGame]
  );

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
      extraControls={
        canViewScoutNames ? (
          <label className="text-sm text-gray-600 flex items-center gap-2 mr-3">
            <input
              type="checkbox"
              checked={hideNames}
              onChange={(event) => setHideNames(event.target.checked)}
            />
            Hide Names
          </label>
        ) : null
      }
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
                <th className="sticky-left-group-3 sticky-row-1 bg-red-300 text-center" colSpan={3}>Pre-Match</th>
                <th className="bg-pink-300 text-center" colSpan={3}>Overall Alliance</th>
                <th className="bg-blue-300 text-center" colSpan={9}>Robots</th>
                {canManageAnalytics && <th className="bg-pink-300 text-center" colSpan={1}>Actions</th>}
              </tr>
              <tr>
                <th className="sticky-left-group-3 sticky-row-2 bg-red-200 text-center" colSpan={3}>Pre-Match</th>
                <th className="bg-pink-200 text-center" colSpan={3}>Overall Alliance</th>
                <th className="bg-blue-200 text-center" colSpan={3}>Robot 1</th>
                <th className="bg-blue-200 text-center" colSpan={3}>Robot 2</th>
                <th className="bg-blue-200 text-center" colSpan={3}>Robot 3</th>
                {canManageAnalytics && <th className="bg-pink-200 text-center" colSpan={1}>Actions</th>}
              </tr>
              <tr>
                <th className="sticky-left-0 sticky-row-3 cursor-pointer text-center" onClick={() => handleSort("matchLabel")}>
                  {sortLabel(sortKey, sortDir, "matchLabel", "Match")}
                </th>
                <th className="sticky-left-1 sticky-row-3 cursor-pointer text-center" onClick={() => handleSort("alliance")}>
                  {sortLabel(sortKey, sortDir, "alliance", "Alliance")}
                </th>
                <th className="sticky-left-2 sticky-row-3 cursor-pointer text-center" onClick={() => handleSort("scoutName")}>
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
                {canManageAnalytics && (
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
                  <tr key={entry.id} className={entry.excludeFromStats ? "line-through text-gray-500" : ""}>
                    <td className="sticky-left-0 bg-white font-semibold">{resolveLeadMatchLabel(entry)}</td>
                    <td className="sticky-left-1 bg-white">{entry.alliance ? entry.alliance.toUpperCase() : "-"}</td>
                    <td className="sticky-left-2 bg-white">
                      {canViewScoutNames && !hideNames ? entry.scoutName || "-" : "-"}
                    </td>
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
                    {canManageAnalytics && (
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          {canOpenConfig && (
                            <button
                              type="button"
                              onClick={() => setConfigEntry(entry)}
                              className="px-2 py-1 rounded border border-gray-300 bg-gray-50 text-gray-800 text-xs disabled:opacity-50"
                            >
                              Config
                            </button>
                          )}
                          {canDeleteEntries && (
                            <button
                              type="button"
                              onClick={() => void handleDelete(entry)}
                              className="px-3 py-1 rounded text-white text-sm disabled:opacity-60"
                              style={{ backgroundColor: "#dc2626" }}
                              title="Delete entry"
                            >
                              Delete
                            </button>
                          )}
                        </div>
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
      {configEntry && canOpenConfig && (
        <AnalyticsConfigModal
          open={Boolean(configEntry)}
          onClose={() => setConfigEntry(null)}
          entryId={configEntry.id}
          entryLabel={`Match ${resolveLeadMatchLabel(configEntry)}`}
          entrySubtitle={configEntry.alliance ? `Alliance ${String(configEntry.alliance).toUpperCase()}` : undefined}
          collectionName={configEntry.sourceCollection === "scouting" ? "scouting" : "leadScouting"}
          entityType={configEntry.sourceCollection === "scouting" ? "scoutingEntry" : "leadScouting"}
          excludeFromStats={Boolean(configEntry.excludeFromStats)}
          onExcludeChange={(excluded) => {
            setEntries((prev) => prev.map((row) => (row.id === configEntry.id ? { ...row, excludeFromStats: excluded } : row)));
            setConfigEntry((prev) => (prev ? { ...prev, excludeFromStats: excluded } : prev));
          }}
        />
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
