"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { collection, getDocs, deleteDoc, doc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";

// -------------------------
// TYPES
// -------------------------
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

// Helper function to format match display
function formatMatchDisplay(entry: Entry): string {
  const matchNum = entry.matchNumber || "";
  const matchType = entry.matchType || "qualification";
  
  if (matchType === "practice") {
    return `P${matchNum}`;
  } else if (matchType === "finals") {
    return `F${matchNum}`;
  } else {
    return `Q${matchNum}`;
  }
}

// -------------------------
// SORTING
// -------------------------
type SortKey = keyof Entry | "score" | "matchDisplay";
type SortDir = "asc" | "desc";

function sortEntries(entries: Entry[], key: SortKey, dir: SortDir): Entry[] {
  const withScore = entries.map(e => ({ 
    ...e, 
    score: scoreEntry(e),
    matchDisplay: formatMatchDisplay(e)
  }));
  
  return [...withScore].sort((a, b) => {
    if (key === "matchDisplay" || key === "matchNumber") {
      // Custom sorting for matches: sort by type first, then by number
      const typeOrder = { practice: 0, qualification: 1, finals: 2 };
      const aType = a.matchType || "qualification";
      const bType = b.matchType || "qualification";
      
      if (aType !== bType) {
        return dir === "asc" 
          ? typeOrder[aType] - typeOrder[bType]
          : typeOrder[bType] - typeOrder[aType];
      }
      
      // Same type, sort by number
      const aNum = parseInt(a.matchNumber || "0");
      const bNum = parseInt(b.matchNumber || "0");
      return dir === "asc" ? aNum - bNum : bNum - aNum;
    }
    
    const av = a[key as keyof typeof a];
    const bv = b[key as keyof typeof b];

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
function AnalyticsPageContent() {
  const [rawData, setRawData] = useState<Entry[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("matchDisplay");
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
        await loadData();
        setDeleteConfirm(null);
        alert("Entry deleted successfully");
      } catch (error) {
        console.error("Error deleting entry:", error);
        alert("Error deleting entry");
      }
    } else {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm(null), 3000);
    }
  }

  const filteredData = selectedEvent === "all" 
    ? rawData 
    : rawData;

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
      <Sidebar />
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeView === "raw-data" && (
          <>
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
                <option value="arkansas">Arkansas Regional</option>
                <option value="bayou">Bayou Regional</option>
              </select>
            </div>

            <div className="flex-1 p-4 overflow-hidden">
              <div className="bg-white rounded-xl shadow h-full table-scroll">
                <table>
                  <thead className="sticky-header">
                    <tr>
                      <th className="sticky-left-action bg-red-300" rowSpan={3}>Actions</th>
                      <th className="sticky-left bg-red-300" colSpan={2}>Information</th>
                      <th className="bg-yellow-300" colSpan={2}>Pre-Match</th>
                      <th className="bg-green-300" colSpan={9}>Autonomous</th>
                      <th className="bg-blue-300" colSpan={13}>Teleoperated</th>
                      <th className="bg-yellow-300" colSpan={2}>Endgame</th>
                      <th className="bg-purple-300" colSpan={1}>Incidents</th>
                      <th className="bg-pink-300" colSpan={2}>General</th>
                    </tr>

                    <tr>
                      <th className="sticky-left bg-red-200" colSpan={2}>Information</th>
                      <th className="bg-yellow-200" colSpan={2}>Pre-Match</th>
                      <th className="bg-green-200" colSpan={1}>Leave</th>
                      <th className="bg-green-200" colSpan={4}>Coral</th>
                      <th className="bg-green-200" colSpan={2}>Algae Processor</th>
                      <th className="bg-green-200" colSpan={2}>Algae Net</th>
                      <th className="bg-blue-200" colSpan={5}>Coral</th>
                      <th className="bg-blue-200" colSpan={1}>Algae Collection</th>
                      <th className="bg-blue-200" colSpan={2}>Algae Processor</th>
                      <th className="bg-blue-200" colSpan={2}>Algae Net (Robot)</th>
                      <th className="bg-blue-200" colSpan={2}>Algae Net (Human)</th>
                      <th className="bg-blue-200" colSpan={1}>Climb</th>
                      <th className="bg-yellow-200" colSpan={2}>Climb</th>
                      <th className="bg-purple-200" colSpan={1}>Incidents</th>
                      <th className="bg-pink-200" colSpan={2}>Comments</th>
                    </tr>

                    <tr>
                      <th className="sticky-left cursor-pointer hover:bg-red-100"
                          onClick={() => handleSort("matchDisplay")}>
                        {sortLabel("matchDisplay", "Match")}
                      </th>
                      <th className="sticky-left-2 cursor-pointer hover:bg-red-100"
                          onClick={() => handleSort("teamNumber")}>
                        {sortLabel("teamNumber", "Team")}
                      </th>
                      <th className="cursor-pointer hover:bg-yellow-100"
                          onClick={() => handleSort("scoutName")}>
                        {sortLabel("scoutName", "Scout")}
                      </th>
                      <th className="cursor-pointer hover:bg-yellow-100"
                          onClick={() => handleSort("startingPosition")}>
                        {sortLabel("startingPosition", "Starting Position")}
                      </th>
                      <th className="cursor-pointer hover:bg-green-100"
                          onClick={() => handleSort("leftStartingZone")}>
                        {sortLabel("leftStartingZone", "Leave")}
                      </th>
                      <th className="cursor-pointer hover:bg-green-100"
                          onClick={() => handleSort("autoCoralL1")}>
                        {sortLabel("autoCoralL1", "L1")}
                      </th>
                      <th className="cursor-pointer hover:bg-green-100"
                          onClick={() => handleSort("autoCoralL2")}>
                        {sortLabel("autoCoralL2", "L2")}
                      </th>
                      <th className="cursor-pointer hover:bg-green-100"
                          onClick={() => handleSort("autoCoralL3")}>
                        {sortLabel("autoCoralL3", "L3")}
                      </th>
                      <th className="cursor-pointer hover:bg-green-100"
                          onClick={() => handleSort("autoCoralL4")}>
                        {sortLabel("autoCoralL4", "L4")}
                      </th>
                      <th className="cursor-pointer hover:bg-green-100"
                          onClick={() => handleSort("autoAlgaeProcessorMissed")}>
                        {sortLabel("autoAlgaeProcessorMissed", "Missed")}
                      </th>
                      <th className="cursor-pointer hover:bg-green-100"
                          onClick={() => handleSort("autoAlgaeProcessorScored")}>
                        {sortLabel("autoAlgaeProcessorScored", "Scored")}
                      </th>
                      <th className="cursor-pointer hover:bg-green-100"
                          onClick={() => handleSort("autoAlgaeNetMissed")}>
                        {sortLabel("autoAlgaeNetMissed", "Missed")}
                      </th>
                      <th className="cursor-pointer hover:bg-green-100"
                          onClick={() => handleSort("autoAlgaeNetScored")}>
                        {sortLabel("autoAlgaeNetScored", "Scored")}
                      </th>
                      <th className="cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort("teleopCoralMissed")}>
                        {sortLabel("teleopCoralMissed", "Missed")}
                      </th>
                      <th className="cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort("teleopCoralL1")}>
                        {sortLabel("teleopCoralL1", "L1")}
                      </th>
                      <th className="cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort("teleopCoralL2")}>
                        {sortLabel("teleopCoralL2", "L2")}
                      </th>
                      <th className="cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort("teleopCoralL3")}>
                        {sortLabel("teleopCoralL3", "L3")}
                      </th>
                      <th className="cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort("teleopCoralL4")}>
                        {sortLabel("teleopCoralL4", "L4")}
                      </th>
                      <th className="cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort("teleopAlgaeRemoved")}>
                        {sortLabel("teleopAlgaeRemoved", "Remove Algae from Reef")}
                      </th>
                      <th className="cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort("teleopProcessorMissed")}>
                        {sortLabel("teleopProcessorMissed", "Missed")}
                      </th>
                      <th className="cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort("teleopProcessorScored")}>
                        {sortLabel("teleopProcessorScored", "Scored")}
                      </th>
                      <th className="cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort("teleopNetRobotMissed")}>
                        {sortLabel("teleopNetRobotMissed", "Missed")}
                      </th>
                      <th className="cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort("teleopNetRobotScored")}>
                        {sortLabel("teleopNetRobotScored", "Scored")}
                      </th>
                      <th className="cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort("teleopNetHumanMissed")}>
                        {sortLabel("teleopNetHumanMissed", "Missed")}
                      </th>
                      <th className="cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort("teleopNetHumanScored")}>
                        {sortLabel("teleopNetHumanScored", "Scored")}
                      </th>
                      <th className="cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort("failedClimb")}>
                        {sortLabel("failedClimb", "Failed")}
                      </th>
                      <th className="cursor-pointer hover:bg-yellow-100"
                          onClick={() => handleSort("stageStatus")}>
                        {sortLabel("stageStatus", "End Place")}
                      </th>
                      <th className="bg-yellow-200">Score</th>
                      <th className="bg-purple-200">Incidents</th>
                      <th className="bg-pink-200">Comments</th>
                      <th className="bg-pink-200">Delete</th>
                    </tr>
                  </thead>

                  <tbody>
                    {data.map((e) => {
                      const score = scoreEntry(e);
                      const isDeleting = deleteConfirm === e.id;

                      return (
                        <tr key={e.id}>
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
                          <td className="sticky-left font-semibold">
                            {formatMatchDisplay(e)}
                          </td>
                          <td className="sticky-left-2 font-semibold">
                            {e.teamNumber || "x"}
                          </td>
                          <td>{e.scoutName || "x"}</td>
                          <td>{e.startingPosition || "x"}</td>
                          <td>{e.leftStartingZone ? "x" : ""}</td>
                          <td>{e.autoCoralL1 || ""}</td>
                          <td>{e.autoCoralL2 || ""}</td>
                          <td>{e.autoCoralL3 || ""}</td>
                          <td>{e.autoCoralL4 || ""}</td>
                          <td>{e.autoAlgaeProcessorMissed || ""}</td>
                          <td>{e.autoAlgaeProcessorScored || ""}</td>
                          <td>{e.autoAlgaeNetMissed || ""}</td>
                          <td>{e.autoAlgaeNetScored || ""}</td>
                          <td>{e.teleopCoralMissed || ""}</td>
                          <td>{e.teleopCoralL1 || ""}</td>
                          <td>{e.teleopCoralL2 || ""}</td>
                          <td>{e.teleopCoralL3 || ""}</td>
                          <td>{e.teleopCoralL4 || ""}</td>
                          <td>{e.teleopAlgaeRemoved ? "x" : ""}</td>
                          <td>{e.teleopProcessorMissed || ""}</td>
                          <td>{e.teleopProcessorScored || ""}</td>
                          <td>{e.teleopNetRobotMissed || ""}</td>
                          <td>{e.teleopNetRobotScored || ""}</td>
                          <td>{e.teleopNetHumanMissed || ""}</td>
                          <td>{e.teleopNetHumanScored || ""}</td>
                          <td>{e.failedClimb || ""}</td>
                          <td>{e.stageStatus || "x"}</td>
                          <td className="font-bold">{score}</td>
                          <td className="text-xs max-w-[200px] truncate">
                            {e.incidents?.join(", ") || "x"}
                          </td>
                          <td className="text-xs max-w-[200px] truncate">
                            {e.notes || "x"}
                          </td>
                          <td>
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

export default function AnalyticsPage() {
  return (
    <ProtectedRoute>
      <AnalyticsPageContent />
    </ProtectedRoute>
  );
}