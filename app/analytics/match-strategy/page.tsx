"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { addDoc, collection, deleteDoc, doc, getDocs } from "firebase/firestore";
import { ChevronLeft, ClipboardList, Download, EyeOff, Filter, Upload, Users } from "lucide-react";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import { Action, Chip, CommandBar, Deck, HudCanvas, HudViewport, PageIntro, Surface } from "@/app/components/Hud";
import GlassNotesCell from "@/app/components/GlassNotesCell";
import AnalyticsConfigModal from "@/app/components/AnalyticsConfigModal";
import { entryMatchesAnalyticsFilters, getEventOptionsForEntries, isPracticeScoutedEntry, type AnalyticsGame } from "@/app/utils/analyticsEvents";
import { formatAnalyticsText, formatMatchLabelShort, getMatchLabelMeta } from "@/app/utils/displayFormat";
import { useAuth } from "@/app/AuthContext";
import { csvEscape, normalizeHeader, parseCsvLine, splitCsvRecords, toBoolean } from "@/app/utils/csvHelpers";
import { compareMatchLabels, compareSortValues, sortLabel, type SortDir } from "@/app/utils/sortHelpers";
import { getUserRoles } from "@/app/utils/roles";

type MatchStrategyEntry = {
  id: string;
  game?: string;
  eventKey?: string;
  createdAt?: number;
  submittedAt?: number;
  timestamp?: number;
  matchLabel?: string;
  scoutName?: string;
  robots?: Array<{ teamNumber?: string; startingPosition?: string; role?: string; autoClimb?: boolean; endgameClimb?: string }>;
  notes?: string;
  matchType?: string;
  practiceMode?: string;
  isPracticeScouting?: boolean;
  excludeFromStats?: boolean;
};

type SortKey =
  | "matchLabel"
  | "scoutName"
  | "r1Team"
  | "r1Starting"
  | "r1Role"
  | "r1Auto"
  | "r1End"
  | "r2Team"
  | "r2Starting"
  | "r2Role"
  | "r2Auto"
  | "r2End"
  | "r3Team"
  | "r3Starting"
  | "r3Role"
  | "r3Auto"
  | "r3End"
  | "notes"
  | "id";

function MatchStrategyAnalyticsContent() {
  const { userData } = useAuth();
  const userRoles = getUserRoles(userData);
  const isCoach = userData?.role === "coach";
  const isTeamCoach = String(userData?.role || "").toLowerCase() === "team-coach" || (userData?.roles || []).includes("team-coach");
  const isTeamAdmin = Boolean(userData?.isTeamAdmin);
  const isLeadStrategist = userRoles.includes("lead-strategist");
  const canViewAdminColumns = isCoach || isTeamCoach || isTeamAdmin || isLeadStrategist;
  const canDeleteEntries = isCoach || isTeamCoach || isTeamAdmin || isLeadStrategist;
  const canManageConfig = canDeleteEntries || userRoles.includes("lead-scout");
  const canViewScoutNames = isCoach || isTeamCoach || isTeamAdmin || isLeadStrategist || userRoles.includes("lead-scout");
  const canImportCsv = canDeleteEntries;
  const canExportCsv = canDeleteEntries;
  const csvDisabledReason = "Temporarily disabled due to bugs.";
  const canShowActions = canManageConfig || canDeleteEntries;
  void canViewAdminColumns;

  const [entries, setEntries] = useState<MatchStrategyEntry[]>([]);
  const [selectedGame] = useState<AnalyticsGame>("REBUILT");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [practiceMatchesOnly, setPracticeMatchesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("matchLabel");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [configEntry, setConfigEntry] = useState<MatchStrategyEntry | null>(null);
  const [hideNames, setHideNames] = useState(false);

  useEffect(() => {
    const savedEvent = localStorage.getItem("analytics-selected-event");
    const savedPractice = localStorage.getItem("analytics-practice-matches-only");
    if (savedEvent) setSelectedEvent(savedEvent);
    if (savedPractice !== null) setPracticeMatchesOnly(savedPractice === "true");
  }, []);

  useEffect(() => {
    localStorage.setItem("analytics-selected-game", selectedGame);
    localStorage.setItem("analytics-selected-event", selectedEvent);
    localStorage.setItem("analytics-practice-matches-only", String(practiceMatchesOnly));
  }, [selectedGame, selectedEvent, practiceMatchesOnly]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "matchStrategyPlans"));
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as MatchStrategyEntry[]);
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
        timestamp: entry.createdAt || entry.timestamp || entry.submittedAt || 0,
      })),
    [entries]
  );

  const eventOptions = useMemo(
    () => [{ id: "all", name: "All Events" }, ...getEventOptionsForEntries(normalized, selectedGame)],
    [normalized, selectedGame]
  );

  const filtered = useMemo(() => {
    const gameFiltered = normalized.filter((entry) => entryMatchesAnalyticsFilters(entry, selectedGame, selectedEvent));
    return gameFiltered.filter((entry) => (practiceMatchesOnly ? isPracticeScoutedEntry(entry) : !isPracticeScoutedEntry(entry)));
  }, [normalized, selectedEvent, selectedGame, practiceMatchesOnly]);

  const sorted = useMemo(() => {
    const getValue = (entry: MatchStrategyEntry) => {
      const r1 = entry.robots?.[0];
      const r2 = entry.robots?.[1];
      const r3 = entry.robots?.[2];
      switch (sortKey) {
        case "matchLabel":
          return entry.matchLabel || "";
        case "scoutName":
          return entry.scoutName || "";
        case "r1Team":
          return r1?.teamNumber || "";
        case "r1Starting":
          return r1?.startingPosition || "";
        case "r1Role":
          return r1?.role || "";
        case "r1Auto":
          return r1?.autoClimb ? 1 : 0;
        case "r1End":
          return r1?.endgameClimb || "";
        case "r2Team":
          return r2?.teamNumber || "";
        case "r2Starting":
          return r2?.startingPosition || "";
        case "r2Role":
          return r2?.role || "";
        case "r2Auto":
          return r2?.autoClimb ? 1 : 0;
        case "r2End":
          return r2?.endgameClimb || "";
        case "r3Team":
          return r3?.teamNumber || "";
        case "r3Starting":
          return r3?.startingPosition || "";
        case "r3Role":
          return r3?.role || "";
        case "r3Auto":
          return r3?.autoClimb ? 1 : 0;
        case "r3End":
          return r3?.endgameClimb || "";
        case "notes":
          return entry.notes || "";
        case "id":
        default:
          return entry.id;
      }
    };

    return [...filtered].sort((a, b) => {
      if (sortKey === "matchLabel") {
        const aMeta = getMatchLabelMeta(a.matchLabel || "");
        const bMeta = getMatchLabelMeta(b.matchLabel || "");
        if (aMeta.order !== bMeta.order) return sortDir === "asc" ? aMeta.order - bMeta.order : bMeta.order - aMeta.order;
        if (aMeta.matchNumber !== bMeta.matchNumber) {
          return sortDir === "asc" ? aMeta.matchNumber - bMeta.matchNumber : bMeta.matchNumber - aMeta.matchNumber;
        }
        return compareMatchLabels(a.matchLabel || "", b.matchLabel || "", sortDir);
      }
      return compareSortValues(getValue(a), getValue(b), sortDir);
    });
  }, [filtered, sortDir, sortKey]);

  function handleSort(key: SortKey) {
    setSortDir((prev) => (key === sortKey ? (prev === "asc" ? "desc" : "asc") : "asc"));
    setSortKey(key);
  }

  async function handleDeleteEntry(entry: MatchStrategyEntry) {
    if (!canDeleteEntries) {
      alert("Only coaches or team admins can delete entries.");
      return;
    }
    const ok = window.confirm("Delete this match strategy entry?");
    if (!ok) return;
    await deleteDoc(doc(db, "matchStrategyPlans", entry.id));
    setEntries((prev) => prev.filter((row) => row.id !== entry.id));
  }

  function exportToCSV() {
    if (!canExportCsv) {
      alert("Only coaches or team admins can export CSV files.");
      return;
    }
    const header = [
      "Match", "Scout",
      "R1 Team", "R1 Starting Position", "R1 Role", "R1 Auto Climb", "R1 Endgame Climb",
      "R2 Team", "R2 Starting Position", "R2 Role", "R2 Auto Climb", "R2 Endgame Climb",
      "R3 Team", "R3 Starting Position", "R3 Role", "R3 Auto Climb", "R3 Endgame Climb",
      "Notes", "Game", "Event Key",
    ];
    const lines = filtered.map((entry) => {
      const r1 = entry.robots?.[0];
      const r2 = entry.robots?.[1];
      const r3 = entry.robots?.[2];
      return [
        entry.matchLabel || "", entry.scoutName || "",
        r1?.teamNumber || "", r1?.startingPosition || "", r1?.role || "", r1?.autoClimb ? "Y" : "N", r1?.endgameClimb || "",
        r2?.teamNumber || "", r2?.startingPosition || "", r2?.role || "", r2?.autoClimb ? "Y" : "N", r2?.endgameClimb || "",
        r3?.teamNumber || "", r3?.startingPosition || "", r3?.role || "", r3?.autoClimb ? "Y" : "N", r3?.endgameClimb || "",
        entry.notes || "", entry.game || selectedGame, entry.eventKey || selectedEvent,
      ].map(csvEscape).join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `match-strategy-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFilePick(event: React.ChangeEvent<HTMLInputElement>) {
    if (!canImportCsv) {
      alert("Only coaches or team admins can import CSV files.");
      event.target.value = "";
      return;
    }
    const file = event.target.files?.[0];
    if (!file || importing) return;
    setImporting(true);
    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      try {
        const text = String(loadEvent.target?.result || "");
        const lines = splitCsvRecords(text);
        if (lines.length < 2) throw new Error("CSV has no data rows.");
        const headers = parseCsvLine(lines[0]).map(normalizeHeader);
        const idx = (name: string) => headers.findIndex((header) => header === name);
        const get = (cells: string[], index: number) => (index >= 0 ? String(cells[index] || "").trim() : "");

        const idxMatch = idx("match");
        const idxScout = idx("scout");
        const idxR1Team = idx("r1team");
        const idxR1Starting = idx("r1startingposition");
        const idxR1Role = idx("r1role");
        const idxR1Auto = idx("r1autoclimb");
        const idxR1End = idx("r1endgameclimb");
        const idxR2Team = idx("r2team");
        const idxR2Starting = idx("r2startingposition");
        const idxR2Role = idx("r2role");
        const idxR2Auto = idx("r2autoclimb");
        const idxR2End = idx("r2endgameclimb");
        const idxR3Team = idx("r3team");
        const idxR3Starting = idx("r3startingposition");
        const idxR3Role = idx("r3role");
        const idxR3Auto = idx("r3autoclimb");
        const idxR3End = idx("r3endgameclimb");
        const idxNotes = idx("notes");
        const idxGame = idx("game");
        const idxEvent = idx("eventkey");

        let imported = 0;
        for (let i = 1; i < lines.length; i += 1) {
          const cells = parseCsvLine(lines[i]);
          const matchLabel = get(cells, idxMatch);
          const scoutName = get(cells, idxScout);
          if (!matchLabel && !scoutName) continue;
          const now = Date.now();
          await addDoc(collection(db, "matchStrategyPlans"), {
            matchLabel,
            scoutName,
            robots: [
              {
                teamNumber: get(cells, idxR1Team),
                startingPosition: get(cells, idxR1Starting),
                role: get(cells, idxR1Role),
                autoClimb: toBoolean(get(cells, idxR1Auto)),
                endgameClimb: get(cells, idxR1End),
              },
              {
                teamNumber: get(cells, idxR2Team),
                startingPosition: get(cells, idxR2Starting),
                role: get(cells, idxR2Role),
                autoClimb: toBoolean(get(cells, idxR2Auto)),
                endgameClimb: get(cells, idxR2End),
              },
              {
                teamNumber: get(cells, idxR3Team),
                startingPosition: get(cells, idxR3Starting),
                role: get(cells, idxR3Role),
                autoClimb: toBoolean(get(cells, idxR3Auto)),
                endgameClimb: get(cells, idxR3End),
              },
            ],
            notes: get(cells, idxNotes),
            game: get(cells, idxGame) || selectedGame,
            eventKey: get(cells, idxEvent) || selectedEvent,
            submittedAt: now,
            timestamp: now,
          });
          imported += 1;
        }
        const snap = await getDocs(collection(db, "matchStrategyPlans"));
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as MatchStrategyEntry[]);
        alert(`Imported ${imported} match strategy rows.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        alert(`Error importing CSV: ${message}`);
      } finally {
        setImporting(false);
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  const robotCols = (prefix: "r1" | "r2" | "r3", label: string) => (
    <>
      <th className="cursor-pointer" onClick={() => handleSort(`${prefix}Team` as SortKey)}>
        {sortLabel(sortKey, sortDir, `${prefix}Team` as SortKey, `${label} Team`)}
      </th>
      <th className="cursor-pointer" onClick={() => handleSort(`${prefix}Starting` as SortKey)}>
        {sortLabel(sortKey, sortDir, `${prefix}Starting` as SortKey, "Start Pos")}
      </th>
      <th className="cursor-pointer" onClick={() => handleSort(`${prefix}Role` as SortKey)}>
        {sortLabel(sortKey, sortDir, `${prefix}Role` as SortKey, "Role")}
      </th>
      <th className="cursor-pointer" onClick={() => handleSort(`${prefix}Auto` as SortKey)}>
        {sortLabel(sortKey, sortDir, `${prefix}Auto` as SortKey, "Auto Climb")}
      </th>
      <th className="cursor-pointer" onClick={() => handleSort(`${prefix}End` as SortKey)}>
        {sortLabel(sortKey, sortDir, `${prefix}End` as SortKey, "Endgame")}
      </th>
    </>
  );

  return (
    <HudCanvas>
      <CommandBar>
        <Link href="/analytics" className="flex items-center gap-2 rounded-full py-1.5 pl-2 pr-3 text-sm font-bold text-slate-800">
          <ChevronLeft className="h-4 w-4" />
          Analytics
        </Link>
        {canViewScoutNames && (
          <Action variant={hideNames ? "primary" : "ghost"} onClick={() => setHideNames((v) => !v)}>
            <EyeOff className="h-4 w-4" />
            Hide Names
          </Action>
        )}
      </CommandBar>

      <HudViewport>
        <PageIntro
          eyebrow="Per-Match Playbooks"
          title="Match Strategy"
          subtitle="Robot roles, starting positions, and climb assignments plotted per match for every scouted alliance."
          actions={<Chip icon={ClipboardList} label="Entries" value={filtered.length} tone="crimson" />}
        />

        <div className="mt-8 grid gap-4 lg:grid-cols-[1.4fr_0.6fr]">
          <Surface className="flex flex-wrap items-center gap-4 p-4">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
              <Filter className="h-3.5 w-3.5" />
              Event
              <select
                value={selectedEvent}
                onChange={(e) => setSelectedEvent(e.target.value)}
                className="!min-h-0 !py-1.5 text-sm font-semibold text-slate-900"
              >
                {eventOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
              <input
                type="checkbox"
                checked={practiceMatchesOnly}
                onChange={(e) => setPracticeMatchesOnly(e.target.checked)}
                className="h-4 w-4"
              />
              Practice Only
            </label>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Action variant="ghost" onClick={exportToCSV} disabled title={csvDisabledReason}>
                <Download className="h-4 w-4" />
                Export CSV
              </Action>
              <label
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-white/70 bg-white/35 px-5 py-2.5 text-sm font-bold text-slate-400"
                title={csvDisabledReason}
              >
                <Upload className="h-4 w-4" />
                {importing ? "Importing..." : "Import CSV"}
                <input type="file" accept=".csv" onChange={handleImportFilePick} className="hidden" disabled />
              </label>
            </div>
          </Surface>
          <Chip icon={Users} label="Roster Rows" value={sorted.length} tone="gold" />
        </div>

        {loading ? (
          <Surface className="mt-8 p-10 text-center text-sm text-slate-600">Loading match strategy analytics…</Surface>
        ) : (
          <Surface raised className="mt-8 overflow-hidden p-2">
            <div className="table-scroll max-h-[70vh]">
              <table className="sticky-header">
                <thead>
                  <tr>
                    <th className="sticky-left-0 cursor-pointer" onClick={() => handleSort("matchLabel")}>
                      {sortLabel(sortKey, sortDir, "matchLabel", "Match")}
                    </th>
                    <th className="sticky-left-1 cursor-pointer" onClick={() => handleSort("scoutName")}>
                      {sortLabel(sortKey, sortDir, "scoutName", "Scout")}
                    </th>
                    {robotCols("r1", "R1")}
                    {robotCols("r2", "R2")}
                    {robotCols("r3", "R3")}
                    <th className="cursor-pointer" onClick={() => handleSort("notes")}>
                      {sortLabel(sortKey, sortDir, "notes", "Notes")}
                    </th>
                    {canShowActions && (
                      <th className="cursor-pointer" onClick={() => handleSort("id")}>
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
                    return (
                      <tr key={entry.id} className={entry.excludeFromStats ? "opacity-50 line-through" : ""}>
                        <td className="sticky-left-0 font-bold text-red-800">{formatMatchLabelShort(entry.matchLabel || "")}</td>
                        <td className="sticky-left-1">{canViewScoutNames && !hideNames ? entry.scoutName || "-" : "-"}</td>
                        <td>{r1?.teamNumber || "-"}</td>
                        <td>{formatAnalyticsText(r1?.startingPosition)}</td>
                        <td>{formatAnalyticsText(r1?.role)}</td>
                        <td>{r1?.autoClimb ? "Y" : "N"}</td>
                        <td>{formatAnalyticsText(r1?.endgameClimb)}</td>
                        <td>{r2?.teamNumber || "-"}</td>
                        <td>{formatAnalyticsText(r2?.startingPosition)}</td>
                        <td>{formatAnalyticsText(r2?.role)}</td>
                        <td>{r2?.autoClimb ? "Y" : "N"}</td>
                        <td>{formatAnalyticsText(r2?.endgameClimb)}</td>
                        <td>{r3?.teamNumber || "-"}</td>
                        <td>{formatAnalyticsText(r3?.startingPosition)}</td>
                        <td>{formatAnalyticsText(r3?.role)}</td>
                        <td>{r3?.autoClimb ? "Y" : "N"}</td>
                        <td>{formatAnalyticsText(r3?.endgameClimb)}</td>
                        <td className="text-left" style={{ minWidth: "220px", maxWidth: "360px" }}>
                          <GlassNotesCell text={entry.notes} />
                        </td>
                        {canShowActions && (
                          <td>
                            <div className="flex items-center justify-center gap-2">
                              {canManageConfig && (
                                <button
                                  type="button"
                                  onClick={() => setConfigEntry(entry)}
                                  className="rounded-full border border-amber-300/60 bg-white/50 px-3 py-1 text-[11px] font-bold text-amber-950"
                                >
                                  Config
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => void handleDeleteEntry(entry)}
                                disabled={!canDeleteEntries}
                                title={canDeleteEntries ? undefined : "Only coaches or team admins can delete entries."}
                                className="rounded-full border border-red-800/50 bg-gradient-to-br from-red-700 to-red-900 px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Surface>
        )}
      </HudViewport>

      {configEntry && canManageConfig && (
        <AnalyticsConfigModal
          open={Boolean(configEntry)}
          onClose={() => setConfigEntry(null)}
          entryId={configEntry.id}
          entryLabel={formatMatchLabelShort(configEntry.matchLabel || configEntry.id)}
          entrySubtitle={configEntry.scoutName ? `Scout: ${configEntry.scoutName}` : undefined}
          collectionName="matchStrategyPlans"
          entityType="matchStrategyPlan"
          excludeFromStats={Boolean(configEntry.excludeFromStats)}
          onExcludeChange={(excluded) => {
            setEntries((prev) => prev.map((row) => (row.id === configEntry.id ? { ...row, excludeFromStats: excluded } : row)));
            setConfigEntry((prev) => (prev ? { ...prev, excludeFromStats: excluded } : prev));
          }}
        />
      )}
    </HudCanvas>
  );
}

export default function MatchStrategyAnalyticsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <MatchStrategyAnalyticsContent />
    </ProtectedRoute>
  );
}
