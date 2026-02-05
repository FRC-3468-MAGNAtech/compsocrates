"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { collection, getDocs, deleteDoc, doc } from "firebase/firestore";
import { db } from "@/app/firebase";

// -------------------------
// TYPES
// -------------------------
type Entry = {
  id: string;
  matchNumber?: string;
  teamNumber: string;
  scoutName: string;
  startingPosition: string;
  leftStartingZone: boolean;

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

// -------------------------
// SCORING CONSTANTS
// -------------------------
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
  CLIMB_DEEP: 12
};

// -------------------------
// SCORING FUNCTION
// -------------------------
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
  else if (end.includes("park")) s += PTS.CLIMB_PARK;

  return s;
}

// -------------------------
// SORTING
// -------------------------
type SortKey = keyof Entry | "score";
type SortDir = "asc" | "desc";

function sortEntries(entries: Entry[], key: SortKey, dir: SortDir): Entry[] {
  const withScore = entries.map(e => ({ ...e, score: scoreEntry(e) }));
  return [...withScore].sort((a, b) => {
    const av = a[key];
    const bv = b[key];

    if (typeof av === "number" && typeof bv === "number") {
      return dir === "asc" ? av - bv : bv - av;
    }

    const as = (av ?? "").toString().toLowerCase();
    const bs = (bv ?? "").toString().toLowerCase();
    if (as < bs) return dir === "asc" ? -1 : 1;
    if (as > bs) return dir === "asc" ? 1 : -1;
    return 0;
  }) as Entry[];
}

// -------------------------
// MAIN PAGE
// -------------------------
export default function AnalyticsPage() {
  const [rawData, setRawData] = useState<Entry[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("matchNumber");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [activeView, setActiveView] = useState("raw-data");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const snapshot = await getDocs(collection(db, "scouting"));
    const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Entry[];
    setRawData(entries);
  }

  async function handleDelete(id: string) {
    if (deleteConfirm === id) {
      try {
        await deleteDoc(doc(db, "scouting", id));
        await loadData(); // Reload data
        setDeleteConfirm(null);
        alert("Entry deleted successfully");
      } catch (error) {
        console.error("Error deleting entry:", error);
        alert("Error deleting entry");
      }
    } else {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm(null), 3000); // Reset after 3 seconds
    }
  }

  // Filter data by event
  const filteredData = selectedEvent === "all" 
    ? rawData 
    : rawData; // TODO: Add actual event filtering logic when event data is available

  const data = sortEntries(filteredData, sortKey, sortDir);

  function handleSort(key: SortKey) {
    setSortKey(prevKey => {
      if (prevKey === key) {
        setSortDir(prevDir => (prevDir === "asc" ? "desc" : "asc"));
        return prevKey;
      } else {
        setSortDir("asc");
        return key;
      }
    });
  }

  function sortLabel(key: SortKey, label: string) {
    if (sortKey !== key) return label;
    return sortDir === "asc" ? `${label} ▲` : `${label} ▼`;
  }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* SIDEBAR */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-bold" style={{ color: "#c42221" }}>
            Analytics
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {data.length} entries
          </p>
        </div>

        <nav className="flex-1 p-4 flex flex-col">
          <button
            onClick={() => setActiveView("raw-data")}
            className={`w-full text-left px-3 py-2 rounded mb-2 ${
              activeView === "raw-data"
                ? "bg-red-100 text-red-800 font-semibold"
                : "hover:bg-gray-100 text-gray-700"
            }`}
          >
            Raw Data
          </button>
          <button
            onClick={() => setActiveView("team-averages")}
            className={`w-full text-left px-3 py-2 rounded mb-2 ${
              activeView === "team-averages"
                ? "bg-red-100 text-red-800 font-semibold"
                : "hover:bg-gray-100 text-gray-700"
            }`}
          >
            Team Averages
          </button>
          <button
            onClick={() => setActiveView("match-breakdown")}
            className={`w-full text-left px-3 py-2 rounded mb-2 ${
              activeView === "match-breakdown"
                ? "bg-red-100 text-red-800 font-semibold"
                : "hover:bg-gray-100 text-gray-700"
            }`}
          >
            Match Breakdown
          </button>
          <button
            onClick={() => setActiveView("rankings")}
            className={`w-full text-left px-3 py-2 rounded mb-2 ${
              activeView === "rankings"
                ? "bg-red-100 text-red-800 font-semibold"
                : "hover:bg-gray-100 text-gray-700"
            }`}
          >
            Rankings
          </button>
        </nav>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeView === "raw-data" && (
          <>
            {/* EVENT FILTER */}
            <div className="p-4 bg-white border-b">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Event
              </label>
              <select
                value={selectedEvent}
                onChange={(e) => setSelectedEvent(e.target.value)}
                className="w-full max-w-md border rounded p-2"
              >
                <option value="all">All Events</option>
                <option value="app-testing">App Testing</option>
                <option value="regional-1">Regional 1 (Coming Soon)</option>
                <option value="regional-2">Regional 2 (Coming Soon)</option>
              </select>
            </div>

            {/* TABLE */}
            <div className="flex-1 p-4 overflow-hidden">
              <div className="bg-white rounded-xl shadow h-full table-scroll">
                <table>
                  <thead className="sticky-header">
                    {/* ROW 1: TOP LEVEL GROUPS */}
                    <tr>
                      <th className="sticky-left-action bg-white" rowSpan={3}>Actions</th>
                      <th className="sticky-left bg-red-300" colSpan={2}>Information</th>
                      <th className="bg-yellow-300" colSpan={2}>Pre-Match</th>
                      <th className="bg-green-300" colSpan={9}>Autonomous</th>
                      <th className="bg-blue-300" colSpan={13}>Teleoperated</th>
                      <th className="bg-yellow-300" colSpan={2}>Endgame</th>
                      <th className="bg-purple-300" colSpan={1}>Incidents</th>
                      <th className="bg-pink-300" colSpan={3}>General</th>
                    </tr>

                    {/* ROW 2: SUB-CATEGORIES */}
                    <tr>
                      {/* Information */}
                      <th className="sticky-left bg-red-200" colSpan={2}>Information</th>

                      {/* Pre-Match */}
                      <th className="bg-yellow-200" colSpan={2}>Pre-Match</th>

                      {/* Autonomous - subdivided */}
                      <th className="bg-green-200" colSpan={1}>Leave</th>
                      <th className="bg-green-200" colSpan={4}>Coral</th>
                      <th className="bg-green-200" colSpan={2}>Algae Processor</th>
                      <th className="bg-green-200" colSpan={2}>Algae Net</th>

                      {/* Teleoperated - subdivided */}
                      <th className="bg-blue-200" colSpan={5}>Coral</th>
                      <th className="bg-blue-200" colSpan={1}>Algae Collection</th>
                      <th className="bg-blue-200" colSpan={2}>Algae Processor</th>
                      <th className="bg-blue-200" colSpan={2}>Algae Net (Robot)</th>
                      <th className="bg-blue-200" colSpan={2}>Algae Net (Human)</th>
                      <th className="bg-blue-200" colSpan={1}>Climb</th>

                      {/* Endgame */}
                      <th className="bg-yellow-200" colSpan={2}>Climb</th>

                      {/* Incidents */}
                      <th className="bg-purple-200" colSpan={1}>Incidents</th>

                      {/* General */}
                      <th className="bg-pink-200" colSpan={1}>Comments</th>
                      <th className="bg-pink-200" colSpan={1}>Accuracy Script</th>
                      <th className="bg-pink-200" colSpan={1}>Script Status</th>
                    </tr>

                    {/* ROW 3: ACTUAL COLUMN LABELS */}
                    <tr>
                      {/* Information */}
                      <th className="sticky-left cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("matchNumber")}>
                        {sortLabel("matchNumber", "Match")}
                      </th>
                      <th className="sticky-left-2 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("teamNumber")}>
                        {sortLabel("teamNumber", "Team")}
                      </th>

                      {/* Pre-Match */}
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("scoutName")}>
                        {sortLabel("scoutName", "Scout")}
                      </th>
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("startingPosition")}>
                        {sortLabel("startingPosition", "Starting Position")}
                      </th>

                      {/* Autonomous - Leave */}
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("leftStartingZone")}>
                        {sortLabel("leftStartingZone", "Leave")}
                      </th>

                      {/* Autonomous - Coral */}
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("autoCoralL1")}>
                        {sortLabel("autoCoralL1", "L1")}
                      </th>
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("autoCoralL2")}>
                        {sortLabel("autoCoralL2", "L2")}
                      </th>
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("autoCoralL3")}>
                        {sortLabel("autoCoralL3", "L3")}
                      </th>
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("autoCoralL4")}>
                        {sortLabel("autoCoralL4", "L4")}
                      </th>

                      {/* Autonomous - Algae Processor */}
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("autoAlgaeProcessorMissed")}>
                        {sortLabel("autoAlgaeProcessorMissed", "Missed")}
                      </th>
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("autoAlgaeProcessorScored")}>
                        {sortLabel("autoAlgaeProcessorScored", "Scored")}
                      </th>

                      {/* Autonomous - Algae Net */}
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("autoAlgaeNetMissed")}>
                        {sortLabel("autoAlgaeNetMissed", "Missed")}
                      </th>
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("autoAlgaeNetScored")}>
                        {sortLabel("autoAlgaeNetScored", "Scored")}
                      </th>

                      {/* Teleoperated - Coral */}
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("teleopCoralMissed")}>
                        {sortLabel("teleopCoralMissed", "Missed")}
                      </th>
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("teleopCoralL1")}>
                        {sortLabel("teleopCoralL1", "L1")}
                      </th>
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("teleopCoralL2")}>
                        {sortLabel("teleopCoralL2", "L2")}
                      </th>
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("teleopCoralL3")}>
                        {sortLabel("teleopCoralL3", "L3")}
                      </th>
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("teleopCoralL4")}>
                        {sortLabel("teleopCoralL4", "L4")}
                      </th>

                      {/* Teleoperated - Algae Collection */}
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("teleopAlgaeRemoved")}>
                        {sortLabel("teleopAlgaeRemoved", "Remove Algae from Reef")}
                      </th>

                      {/* Teleoperated - Processor */}
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("teleopProcessorMissed")}>
                        {sortLabel("teleopProcessorMissed", "Missed")}
                      </th>
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("teleopProcessorScored")}>
                        {sortLabel("teleopProcessorScored", "Scored")}
                      </th>

                      {/* Teleoperated - Net (Robot) */}
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("teleopNetRobotMissed")}>
                        {sortLabel("teleopNetRobotMissed", "Missed")}
                      </th>
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("teleopNetRobotScored")}>
                        {sortLabel("teleopNetRobotScored", "Scored")}
                      </th>

                      {/* Teleoperated - Net (Human) */}
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("teleopNetHumanMissed")}>
                        {sortLabel("teleopNetHumanMissed", "Missed")}
                      </th>
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("teleopNetHumanScored")}>
                        {sortLabel("teleopNetHumanScored", "Scored")}
                      </th>

                      {/* Teleoperated - Climb (Failed moved here from Endgame) */}
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("failedClimb")}>
                        {sortLabel("failedClimb", "Failed")}
                      </th>

                      {/* Endgame - Climb */}
                      <th className="cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort("stageStatus")}>
                        {sortLabel("stageStatus", "End Place")}
                      </th>
                      <th>Score</th>

                      {/* Incidents */}
                      <th>Incidents</th>

                      {/* General */}
                      <th>Comments</th>
                      <th>Alliance Accuracy</th>
                      <th>Script Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {data.map((e) => {
                      const score = scoreEntry(e);
                      const isDeleting = deleteConfirm === e.id;

                      return (
                        <tr key={e.id}>
                          {/* Actions Column */}
                          <td className="sticky-left-action">
                            <button
                              onClick={() => handleDelete(e.id)}
                              className={`px-2 py-1 text-xs rounded ${
                                isDeleting 
                                  ? "bg-red-600 text-white font-semibold" 
                                  : "bg-red-100 text-red-700 hover:bg-red-200"
                              }`}
                            >
                              {isDeleting ? "Confirm?" : "Delete"}
                            </button>
                          </td>

                          {/* Information */}
                          <td className="sticky-left font-semibold">
                            {e.matchNumber || "-"}
                          </td>
                          <td className="sticky-left-2 font-semibold">
                            {e.teamNumber}
                          </td>

                          {/* Pre-Match */}
                          <td>{e.scoutName}</td>
                          <td>{e.startingPosition}</td>

                          {/* Autonomous */}
                          <td>{e.leftStartingZone ? "✓" : ""}</td>
                          <td>{e.autoCoralL1 || ""}</td>
                          <td>{e.autoCoralL2 || ""}</td>
                          <td>{e.autoCoralL3 || ""}</td>
                          <td>{e.autoCoralL4 || ""}</td>
                          <td>{e.autoAlgaeProcessorMissed || ""}</td>
                          <td>{e.autoAlgaeProcessorScored || ""}</td>
                          <td>{e.autoAlgaeNetMissed || ""}</td>
                          <td>{e.autoAlgaeNetScored || ""}</td>

                          {/* Teleoperated */}
                          <td>{e.teleopCoralMissed || ""}</td>
                          <td>{e.teleopCoralL1 || ""}</td>
                          <td>{e.teleopCoralL2 || ""}</td>
                          <td>{e.teleopCoralL3 || ""}</td>
                          <td>{e.teleopCoralL4 || ""}</td>
                          <td>{e.teleopAlgaeRemoved ? "✓" : ""}</td>
                          <td>{e.teleopProcessorMissed || ""}</td>
                          <td>{e.teleopProcessorScored || ""}</td>
                          <td>{e.teleopNetRobotMissed || ""}</td>
                          <td>{e.teleopNetRobotScored || ""}</td>
                          <td>{e.teleopNetHumanMissed || ""}</td>
                          <td>{e.teleopNetHumanScored || ""}</td>
                          <td>{e.failedClimb || ""}</td>

                          {/* Endgame */}
                          <td>{e.stageStatus}</td>
                          <td className="font-bold">{score}</td>

                          {/* Incidents */}
                          <td className="text-xs max-w-[200px] truncate">
                            {e.incidents?.join(", ") || ""}
                          </td>

                          {/* General */}
                          <td className="text-xs max-w-[200px] truncate">
                            {e.notes || ""}
                          </td>
                          <td>-</td>
                          <td>-</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {activeView === "team-averages" && (
          <div className="h-full flex items-center justify-center text-gray-500">
            Team Averages - Coming Soon
          </div>
        )}

        {activeView === "match-breakdown" && (
          <div className="h-full flex items-center justify-center text-gray-500">
            Match Breakdown - Coming Soon
          </div>
        )}

        {activeView === "rankings" && (
          <div className="h-full flex items-center justify-center text-gray-500">
            Rankings - Coming Soon
          </div>
        )}
      </div>
    </div>
  );
}