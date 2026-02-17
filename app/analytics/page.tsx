"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsShell from "@/app/components/AnalyticsShell";
import { useAuth } from "@/app/AuthContext";

type Entry = {
  id: string;
  matchNumber?: string;
  matchType?: "qualification" | "practice" | "finals";
  teamNumber: string;
  scoutName: string;
  startingPosition: string;
  leftStartingZone: boolean;
  submittedAt?: number;
  autoCoralMissed: number;
  autoCoralL1: number;
  autoCoralL2: number;
  autoCoralL3: number;
  autoCoralL4: number;
  autoAlgaeProcessorMissed: number;
  autoAlgaeProcessorScored: number;
  autoAlgaeNetMissed: number;
  autoAlgaeNetScored: number;
  teleopCoralMissed: number;
  teleopCoralL1: number;
  teleopCoralL2: number;
  teleopCoralL3: number;
  teleopCoralL4: number;
  teleopAlgaeRemoved: boolean;
  teleopProcessorMissed: number;
  teleopProcessorScored: number;
  teleopNetRobotMissed: number;
  teleopNetRobotScored: number;
  teleopNetHumanMissed: number;
  teleopNetHumanScored: number;
  failedClimb: number;
  stageStatus: string;
  incidents: string[];
  notes: string;
  timestamp: number;
};

const EVENTS = [
  { id: "rocket-city", name: "Rocket City", startDate: "2026-03-18", endDate: "2026-03-21" },
  { id: "bayou", name: "Bayou", startDate: "2026-04-01", endDate: "2026-04-04" },
  { id: "app-testing", name: "App Testing", startDate: "1970-01-01", endDate: "2099-12-31" },
];

const INCIDENT_LABELS: Record<string, string> = {
  died: "Died During Match",
  "never-started": "Never Started Match",
  disabled: "Disabled by FRC",
  recovered: "Recovered from Freeze",
  tipped: "Tipped Over",
  "yellow-card": "Yellow Card",
  "red-card": "Red Card",
};

const PTS = {
  LEAVE: 3,
  AUTO_CORAL_L1: 3,
  AUTO_CORAL_L2: 4,
  AUTO_CORAL_L3: 6,
  AUTO_CORAL_L4: 7,
  AUTO_ALGAE_PROC: 6,
  AUTO_ALGAE_NET: 4,
  TELE_CORAL_L1: 2,
  TELE_CORAL_L2: 3,
  TELE_CORAL_L3: 4,
  TELE_CORAL_L4: 5,
  TELE_ALGAE_PROC: 6,
  TELE_ALGAE_NET_R: 4,
  TELE_ALGAE_NET_H: 4,
  CLIMB_PARK: 2,
  CLIMB_SHALLOW: 6,
  CLIMB_DEEP: 12,
};

function scoreEntry(e: Entry) {
  let s = 0;
  if (e.leftStartingZone) s += PTS.LEAVE;
  s += e.autoCoralL1 * PTS.AUTO_CORAL_L1;
  s += e.autoCoralL2 * PTS.AUTO_CORAL_L2;
  s += e.autoCoralL3 * PTS.AUTO_CORAL_L3;
  s += e.autoCoralL4 * PTS.AUTO_CORAL_L4;
  s += e.autoAlgaeProcessorScored * PTS.AUTO_ALGAE_PROC;
  s += e.autoAlgaeNetScored * PTS.AUTO_ALGAE_NET;
  s += e.teleopCoralL1 * PTS.TELE_CORAL_L1;
  s += e.teleopCoralL2 * PTS.TELE_CORAL_L2;
  s += e.teleopCoralL3 * PTS.TELE_CORAL_L3;
  s += e.teleopCoralL4 * PTS.TELE_CORAL_L4;
  s += e.teleopProcessorScored * PTS.TELE_ALGAE_PROC;
  s += e.teleopNetRobotScored * PTS.TELE_ALGAE_NET_R;
  s += e.teleopNetHumanScored * PTS.TELE_ALGAE_NET_H;
  if (e.teleopAlgaeRemoved) s += 2;
  const end = e.stageStatus.toLowerCase();
  if (end.includes("deep")) s += PTS.CLIMB_DEEP;
  else if (end.includes("shallow")) s += PTS.CLIMB_SHALLOW;
  else if (end.includes("park") || end.includes("barge")) s += PTS.CLIMB_PARK;
  return s;
}

function matchPriority(type?: string) {
  if (type === "practice") return 0;
  if (type === "qualification") return 1;
  if (type === "finals") return 2;
  return 999;
}

function matchNumberValue(value?: string) {
  if (!value) return 0;
  return parseInt(String(value).replace(/\D/g, ""), 10) || 0;
}

function matchLabel(entry: Entry) {
  const num = entry.matchNumber || "-";
  if (entry.matchType === "practice") return `P${num}`;
  if (entry.matchType === "qualification") return `Q${num}`;
  if (entry.matchType === "finals") return `F${num}`;
  return num;
}

type SortKey = keyof Entry | "score";
type SortDir = "asc" | "desc";

function AnalyticsPageContent() {
  const { userData } = useAuth();
  const [rawData, setRawData] = useState<Entry[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("matchNumber");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [selectedGame, setSelectedGame] = useState("REEFSCAPE");
  const [showPractice, setShowPractice] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const isCoach = userData?.role === "coach";

  async function loadData() {
    const snapshot = await getDocs(collection(db, "scouting"));
    const entries = snapshot.docs.map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() })) as Entry[];
    setRawData(entries);
  }

  useEffect(() => {
    getDocs(collection(db, "scouting")).then((snapshot) => {
      const entries = snapshot.docs.map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() })) as Entry[];
      setRawData(entries);
    });
  }, []);

  const filtered = useMemo(() => {
    const byPractice = showPractice
      ? rawData.filter((entry) => entry.matchType === "practice")
      : rawData.filter((entry) => entry.matchType !== "practice");
    return selectedEvent === "all"
      ? byPractice
      : byPractice.filter((entry) => {
          const event = EVENTS.find((candidate) => candidate.id === selectedEvent);
          if (!event) return true;
          const time = entry.submittedAt || entry.timestamp || 0;
          const date = new Date(time);
          const start = new Date(`${event.startDate}T00:00:00`);
          const end = new Date(`${event.endDate}T23:59:59`);
          return date >= start && date <= end;
        });
  }, [rawData, selectedEvent, showPractice]);

  const data = useMemo(() => {
    const withScore = filtered.map((entry) => ({ ...entry, score: scoreEntry(entry) }));
    return withScore.sort((a, b) => {
      if (sortKey === "matchNumber") {
        const typeDiff = matchPriority(a.matchType) - matchPriority(b.matchType);
        if (typeDiff !== 0) return sortDir === "asc" ? typeDiff : -typeDiff;
        const numDiff = matchNumberValue(a.matchNumber) - matchNumberValue(b.matchNumber);
        return sortDir === "asc" ? numDiff : -numDiff;
      }
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const as = String(av ?? "").toLowerCase();
      const bs = String(bv ?? "").toLowerCase();
      if (as < bs) return sortDir === "asc" ? -1 : 1;
      if (as > bs) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filtered, sortDir, sortKey]);

  async function handleDelete(id: string) {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm(null), 3000);
      return;
    }
    await deleteDoc(doc(db, "scouting", id));
    setDeleteConfirm(null);
    await loadData();
  }

  function handleSort(key: SortKey) {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevKey;
      }
      setSortDir("asc");
      return key;
    });
  }

  function sortLabel(key: SortKey, label: string) {
    if (sortKey !== key) return label;
    return sortDir === "asc" ? `${label} ▲` : `${label} ▼`;
  }

  function exportToCSV() {
    if (filtered.length === 0) {
      alert("No data to export");
      return;
    }
    const headers = ["Match", "Type", "Team", "Scout", "Position", "Left Zone", "Notes", "Timestamp"];
    const rows = filtered.map((entry) => [
      entry.matchNumber || "",
      entry.matchType || "",
      entry.teamNumber || "",
      entry.scoutName || "",
      entry.startingPosition || "",
      entry.leftStartingZone ? "Y" : "N",
      (entry.notes || "").replace(/,/g, ";"),
      entry.timestamp || "",
    ]);
    const csv = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => (String(cell).includes(",") ? `"${cell}"` : cell)).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importFromCSV(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      try {
        const text = loadEvent.target?.result as string;
        const lines = text.split("\n");
        let imported = 0;
        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const values = lines[i].split(",");
          await addDoc(collection(db, "scouting"), {
            matchNumber: values[0],
            matchType: values[1] || "qualification",
            teamNumber: values[2],
            scoutName: values[3],
            startingPosition: values[4],
            leftStartingZone: values[5] === "Y",
            notes: values[6]?.replace(/"/g, "").replace(/;/g, ",") || "",
            timestamp: Date.now(),
            submittedAt: Date.now(),
          });
          imported += 1;
        }
        alert(`Successfully imported ${imported} entries`);
        await loadData();
      } catch (error) {
        console.error("Import failed:", error);
        alert("Error importing CSV");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  return (
    <AnalyticsShell entriesCount={data.length} selectedGame={selectedGame} onSelectedGameChange={setSelectedGame}>
      <div className="bg-white rounded-xl shadow p-4 mb-4 flex flex-wrap items-center gap-4">
        <label className="text-sm text-gray-600">
          Event:
          <select
            value={selectedEvent}
            onChange={(e) => setSelectedEvent(e.target.value)}
            className="ml-2 border rounded p-1.5"
          >
            <option value="all">All Events</option>
            {EVENTS.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-600 flex items-center gap-2">
          <input type="checkbox" checked={showPractice} onChange={(e) => setShowPractice(e.target.checked)} />
          Show Practice Matches
        </label>
        <button className="px-3 py-1.5 text-sm rounded bg-green-600 text-white" onClick={exportToCSV}>
          Export CSV
        </button>
        <label className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white cursor-pointer">
          Import CSV
          <input type="file" accept=".csv" onChange={importFromCSV} className="hidden" />
        </label>
      </div>

      <div className="bg-white rounded-xl shadow h-[calc(100vh-270px)] table-scroll">
        <table>
          <thead className="sticky-header">
            <tr>
              <th className="sticky-left-0 cursor-pointer" onClick={() => handleSort("matchNumber")}>
                {sortLabel("matchNumber", "Match")}
              </th>
              <th className="sticky-left-1 cursor-pointer" onClick={() => handleSort("teamNumber")}>
                {sortLabel("teamNumber", "Team")}
              </th>
              <th className="cursor-pointer" onClick={() => handleSort("scoutName")}>
                {sortLabel("scoutName", "Scout")}
              </th>
              <th>Position</th>
              <th>Incidents</th>
              <th>Notes</th>
              <th className="cursor-pointer" onClick={() => handleSort("score")}>
                {sortLabel("score", "Score")}
              </th>
              {isCoach && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((entry) => (
              <tr key={entry.id}>
                <td className="sticky-left-0 bg-white font-semibold text-center">{matchLabel(entry)}</td>
                <td className="sticky-left-1 bg-white font-semibold text-center">{entry.teamNumber || "-"}</td>
                <td className="text-center">{entry.scoutName || "-"}</td>
                <td className="text-center">{entry.startingPosition || "-"}</td>
                <td className="text-center">
                  {entry.incidents?.map((incident) => INCIDENT_LABELS[incident] || incident).join(", ") || "-"}
                </td>
                <td className="text-center">{entry.notes || "-"}</td>
                <td className="text-center font-bold">{scoreEntry(entry)}</td>
                {isCoach && (
                  <td className="text-center">
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className={`px-2 py-1 text-xs rounded ${
                        deleteConfirm === entry.id ? "bg-red-700 text-white" : "bg-red-500 text-white"
                      }`}
                    >
                      {deleteConfirm === entry.id ? "Confirm?" : "Delete"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AnalyticsShell>
  );
}

export default function AnalyticsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <AnalyticsPageContent />
    </ProtectedRoute>
  );
}
