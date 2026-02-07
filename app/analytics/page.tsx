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

// -------------------------
// MATCH SORTING
// -------------------------
function parseMatchType(matchStr: string): { type: string; number: number; priority: number } {
  if (!matchStr) return { type: "unknown", number: 0, priority: 999 };
  
  const str = matchStr.toString().toLowerCase();
  
  if (str.includes("practice") || str.startsWith("p")) {
    const num = parseInt(str.replace(/\D/g, "")) || 0;
    return { type: "practice", number: num, priority: 1 };
  }
  
  if (str.includes("qual") || str.startsWith("q")) {
    const num = parseInt(str.replace(/\D/g, "")) || 0;
    return { type: "qualification", number: num, priority: 2 };
  }
  
  if (str.includes("final") || str.includes("upper") || str.includes("lower") || str.startsWith("f")) {
    const num = parseInt(str.replace(/\D/g, "")) || 0;
    return { type: "finals", number: num, priority: 3 };
  }
  
  const num = parseInt(str.replace(/\D/g, "")) || 0;
  return { type: "unknown", number: num, priority: 999 };
}

// -------------------------
// SORTING
// -------------------------
type SortKey = keyof Entry | "score";
type SortDir = "asc" | "desc";

function sortEntries(entries: Entry[], key: SortKey, dir: SortDir): Entry[] {
  const withScore = entries.map(e => ({ ...e, score: scoreEntry(e) }));
  return [...withScore].sort((a, b) => {
    // Special handling for match number sorting
    if (key === "matchNumber") {
      const aMatch = parseMatchType(a.matchNumber || "");
      const bMatch = parseMatchType(b.matchNumber || "");
      
      // First sort by type (Practice, Qualification, Finals)
      if (aMatch.priority !== bMatch.priority) {
        return dir === "asc" 
          ? aMatch.priority - bMatch.priority 
          : bMatch.priority - aMatch.priority;
      }
      
      // Then by number within type
      return dir === "asc"
        ? aMatch.number - bMatch.number
        : bMatch.number - aMatch.number;
    }
    
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
// EVENT DEFINITIONS
// -------------------------
type EventDefinition = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
};

const EVENTS: EventDefinition[] = [
  { id: "arkansas-regional", name: "Arkansas Regional", startDate: "2026-03-15", endDate: "2026-03-18" },
  { id: "app-testing", name: "App Testing", startDate: "1970-01-01", endDate: "2099-12-31" }
];

const INCIDENT_LABELS: Record<string, string> = {
  "died": "Died During Match",
  "never-started": "Never Started Match",
  "disabled": "Disabled by FRC",
  "recovered": "Recovered from Freeze",
  "tipped": "Tipped Over",
  "yellow-card": "Yellow Card",
  "red-card": "Red Card"
};

// -------------------------
// MAIN PAGE
// -------------------------
function AnalyticsPageContent() {
  const { userData } = useAuth();
  const [rawData, setRawData] = useState<Entry[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("matchNumber");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [activeView, setActiveView] = useState("raw-data");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [selectedGame, setSelectedGame] = useState("reefscape");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const isCoach = userData?.role === "coach";

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

  const filteredByEvent = selectedEvent === "all" 
    ? rawData 
    : rawData.filter(entry => {
        const event = EVENTS.find(e => e.id === selectedEvent);
        if (!event) return true;
        const entryTime = entry.submittedAt || entry.timestamp || 0;
        const entryDate = new Date(entryTime);
        const startDate = new Date(event.startDate + "T00:00:00");
        const endDate = new Date(event.endDate + "T23:59:59");
        return entryDate >= startDate && entryDate <= endDate;
      });

  const data = sortEntries(filteredByEvent, sortKey, sortDir);

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
      <div className="flex-1 flex h-screen bg-gray-100 overflow-hidden">
      <div 
        className={`bg-white border-r border-gray-200 flex flex-col shrink-0 transition-all duration-300 ${
          sidebarCollapsed ? "w-0 overflow-hidden" : "w-64"
        }`}
      >
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-bold" style={{ color: "#c42221" }}>Analytics</h1>
          <p className="text-sm text-gray-600 mt-1">{data.length} entries</p>
          <div className="mt-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">Event</label>
            <select value={selectedEvent} onChange={(e) => setSelectedEvent(e.target.value)} className="w-full text-sm border rounded p-1.5">
              <option value="all">All Events</option>
              {EVENTS.map(event => (
                <option key={event.id} value={event.id}>{event.name}</option>
              ))}
            </select>
          </div>
        </div>
        <nav className="flex-1 p-4 flex flex-col">
          <button onClick={() => setActiveView("raw-data")} className={`w-full text-left px-3 py-2 rounded mb-2 ${activeView === "raw-data" ? "bg-red-100 text-red-800 font-semibold" : "hover:bg-gray-100 text-gray-700"}`}>Raw Data</button>
          <button onClick={() => setActiveView("team-averages")} className={`w-full text-left px-3 py-2 rounded mb-2 ${activeView === "team-averages" ? "bg-red-100 text-red-800 font-semibold" : "hover:bg-gray-100 text-gray-700"}`}>Team Averages</button>
          <button onClick={() => setActiveView("match-breakdown")} className={`w-full text-left px-3 py-2 rounded mb-2 ${activeView === "match-breakdown" ? "bg-red-100 text-red-800 font-semibold" : "hover:bg-gray-100 text-gray-700"}`}>Match Breakdown</button>
          <button onClick={() => setActiveView("rankings")} className={`w-full text-left px-3 py-2 rounded mb-2 ${activeView === "rankings" ? "bg-red-100 text-red-800 font-semibold" : "hover:bg-gray-100 text-gray-700"}`}>Rankings</button>
        </nav>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {activeView === "raw-data" && (
          <>
            <div className="bg-white border-b border-gray-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="p-2 hover:bg-gray-100 rounded" title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
                  {sidebarCollapsed ? "→" : "←"}
                </button>
                <div className="h-6 w-px bg-gray-300" />
                <span className="text-sm text-gray-600">{data.length} entries</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700">Game:</label>
                <select value={selectedGame} onChange={(e) => setSelectedGame(e.target.value)} className="border rounded px-3 py-1.5 text-sm">
                  <option value="reefscape">REEFSCAPE</option>
                  <option value="rebuilt">REBUILT</option>
                </select>
              </div>
            </div>

            {selectedGame === "reefscape" ? (
              <div className="flex-1 p-4 overflow-hidden">
                <div className="bg-white rounded-xl shadow h-full table-scroll">
                  <table>
                    <thead className="sticky-header">
                      <tr>
                        <th className="sticky-left-0 bg-red-300 z-30 text-center" colSpan={2}>Information</th>
                        <th className="bg-yellow-300 text-center" colSpan={2}>Pre-Match</th>
                        <th className="bg-green-300 text-center" colSpan={10}>Autonomous</th>
                        <th className="bg-blue-300 text-center" colSpan={13}>Teleoperated</th>
                        <th className="bg-purple-300 text-center" colSpan={2}>Endgame</th>
                        <th className="bg-gray-300 text-center" colSpan={5}>General</th>
                        {isCoach && <th className="bg-orange-300 text-center" colSpan={1}>Actions</th>}
                      </tr>
                      <tr>
                        <th className="sticky-left-0 bg-red-200 z-30 text-center" colSpan={2}>Information</th>
                        <th className="bg-yellow-200 text-center" colSpan={2}>Pre-Match</th>
                        <th className="bg-green-200 text-center" colSpan={1}>Leave</th>
                        <th className="bg-green-200 text-center" colSpan={5}>Coral</th>
                        <th className="bg-green-200 text-center" colSpan={2}>Algae Processor</th>
                        <th className="bg-green-200 text-center" colSpan={2}>Algae Net</th>
                        <th className="bg-blue-200 text-center" colSpan={5}>Coral</th>
                        <th className="bg-blue-200 text-center" colSpan={1}>Algae Collection</th>
                        <th className="bg-blue-200 text-center" colSpan={2}>Algae Processor</th>
                        <th className="bg-blue-200 text-center" colSpan={2}>Algae Net (Robot)</th>
                        <th className="bg-blue-200 text-center" colSpan={2}>Algae Net (Human)</th>
                        <th className="bg-purple-200 text-center" colSpan={1}>Climb</th>
                        <th className="bg-purple-200 text-center" colSpan={1}>End Place</th>
                        <th className="bg-gray-200 text-center" colSpan={1}>Incidents</th>
                        <th className="bg-gray-200 text-center" colSpan={1}>Notes</th>
                        <th className="bg-gray-200 text-center" colSpan={3}>Accuracy</th>
                        {isCoach && <th className="bg-orange-200 text-center" colSpan={1}>Actions</th>}
                      </tr>
                      <tr>
                        <th className="sticky-left-0 z-30 cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("matchNumber")}>{sortLabel("matchNumber", "Match")}</th>
                        <th className="sticky-left-1 z-30 cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("teamNumber")}>{sortLabel("teamNumber", "Team")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("scoutName")}>{sortLabel("scoutName", "Scout")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("startingPosition")}>{sortLabel("startingPosition", "Starting Position")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("leftStartingZone")}>{sortLabel("leftStartingZone", "Leave")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("autoCoralMissed")}>{sortLabel("autoCoralMissed", "Missed")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("autoCoralL1")}>{sortLabel("autoCoralL1", "L1")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("autoCoralL2")}>{sortLabel("autoCoralL2", "L2")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("autoCoralL3")}>{sortLabel("autoCoralL3", "L3")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("autoCoralL4")}>{sortLabel("autoCoralL4", "L4")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("autoAlgaeProcessorMissed")}>{sortLabel("autoAlgaeProcessorMissed", "Missed")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("autoAlgaeProcessorScored")}>{sortLabel("autoAlgaeProcessorScored", "Scored")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("autoAlgaeNetMissed")}>{sortLabel("autoAlgaeNetMissed", "Missed")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("autoAlgaeNetScored")}>{sortLabel("autoAlgaeNetScored", "Scored")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("teleopCoralMissed")}>{sortLabel("teleopCoralMissed", "Missed")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("teleopCoralL1")}>{sortLabel("teleopCoralL1", "L1")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("teleopCoralL2")}>{sortLabel("teleopCoralL2", "L2")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("teleopCoralL3")}>{sortLabel("teleopCoralL3", "L3")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("teleopCoralL4")}>{sortLabel("teleopCoralL4", "L4")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("teleopAlgaeRemoved")}>{sortLabel("teleopAlgaeRemoved", "Remove Algae from Reef")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("teleopProcessorMissed")}>{sortLabel("teleopProcessorMissed", "Missed")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("teleopProcessorScored")}>{sortLabel("teleopProcessorScored", "Scored")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("teleopNetRobotMissed")}>{sortLabel("teleopNetRobotMissed", "Missed")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("teleopNetRobotScored")}>{sortLabel("teleopNetRobotScored", "Scored")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("teleopNetHumanMissed")}>{sortLabel("teleopNetHumanMissed", "Missed")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("teleopNetHumanScored")}>{sortLabel("teleopNetHumanScored", "Scored")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("failedClimb")}>{sortLabel("failedClimb", "Failed")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("stageStatus")}>{sortLabel("stageStatus", "End Place")}</th>
                        <th className="text-center">Incidents</th>
                        <th className="text-center">Notes</th>
                        <th className="text-center">Score</th>
                        <th className="text-center">Alliance Accuracy</th>
                        {isCoach && <th className="text-center">Comparison</th>}
                        {isCoach && <th className="text-center">Delete</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((e) => {
                        const score = scoreEntry(e);
                        const positionLabels: Record<string, string> = {
                          "not-there": "Not There",
                          "processor": "Processor Side",
                          "middle": "Middle",
                          "opposite": "Opposite Side"
                        };
                        const stageLabels: Record<string, string> = {
                          "not-parked": "Not Parked",
                          "barge": "Parked in Barge Zone",
                          "shallow": "Shallow Cage",
                          "deep": "Deep Cage"
                        };
                        const incidentText = e.incidents?.map(inc => INCIDENT_LABELS[inc] || inc).join(", ") || "-";

                        return (
                          <tr key={e.id}>
                            <td className="sticky-left-0 font-semibold bg-white z-20 text-center">{e.matchNumber || "-"}</td>
                            <td className="sticky-left-1 font-semibold bg-white z-20 text-center">{e.teamNumber || "-"}</td>
                            <td className="text-center">{e.scoutName || "-"}</td>
                            <td className="text-center">{positionLabels[e.startingPosition] || e.startingPosition || "-"}</td>
                            <td className="text-center">{e.leftStartingZone ? "Yes" : "-"}</td>
                            <td className="text-center">{e.autoCoralMissed || "-"}</td>
                            <td className="text-center">{e.autoCoralL1 || "-"}</td>
                            <td className="text-center">{e.autoCoralL2 || "-"}</td>
                            <td className="text-center">{e.autoCoralL3 || "-"}</td>
                            <td className="text-center">{e.autoCoralL4 || "-"}</td>
                            <td className="text-center">{e.autoAlgaeProcessorMissed || "-"}</td>
                            <td className="text-center">{e.autoAlgaeProcessorScored || "-"}</td>
                            <td className="text-center">{e.autoAlgaeNetMissed || "-"}</td>
                            <td className="text-center">{e.autoAlgaeNetScored || "-"}</td>
                            <td className="text-center">{e.teleopCoralMissed || "-"}</td>
                            <td className="text-center">{e.teleopCoralL1 || "-"}</td>
                            <td className="text-center">{e.teleopCoralL2 || "-"}</td>
                            <td className="text-center">{e.teleopCoralL3 || "-"}</td>
                            <td className="text-center">{e.teleopCoralL4 || "-"}</td>
                            <td className="text-center">{e.teleopAlgaeRemoved ? "Yes" : "-"}</td>
                            <td className="text-center">{e.teleopProcessorMissed || "-"}</td>
                            <td className="text-center">{e.teleopProcessorScored || "-"}</td>
                            <td className="text-center">{e.teleopNetRobotMissed || "-"}</td>
                            <td className="text-center">{e.teleopNetRobotScored || "-"}</td>
                            <td className="text-center">{e.teleopNetHumanMissed || "-"}</td>
                            <td className="text-center">{e.teleopNetHumanScored || "-"}</td>
                            <td className="text-center">{e.failedClimb || "-"}</td>
                            <td className="text-center">{stageLabels[e.stageStatus] || e.stageStatus || "-"}</td>
                            <td className="text-center" style={{ minWidth: "200px", maxWidth: "200px", whiteSpace: "normal", wordWrap: "break-word" }}>{incidentText}</td>
                            <td className="text-center" style={{ minWidth: "200px", maxWidth: "200px", whiteSpace: "normal", wordWrap: "break-word" }}>{e.notes || "-"}</td>
                            <td className="font-bold text-center">{score}</td>
                            <td className="text-center">-</td>
                            {isCoach && <td className="text-center">-</td>}
                            {isCoach && (
                              <td className="text-center">
                                <button onClick={() => handleDelete(e.id)} className={`px-2 py-1 text-xs rounded transition-colors ${deleteConfirm === e.id ? "bg-red-600 text-white" : "bg-red-500 text-white hover:bg-red-600"}`}>
                                  {deleteConfirm === e.id ? "Confirm?" : "Delete"}
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center p-8 bg-white rounded-xl shadow max-w-md">
                  <h2 className="text-xl font-semibold mb-2" style={{ color: "#c42221" }}>REBUILT Form Not Available</h2>
                  <p className="text-gray-600">The scouting form for REBUILT has not been created yet. Please select REEFSCAPE to view data.</p>
                </div>
              </div>
            )}
          </>
        )}
        {activeView === "team-averages" && <div className="h-full flex items-center justify-center text-gray-500">Team Averages - Coming Soon</div>}
        {activeView === "match-breakdown" && <div className="h-full flex items-center justify-center text-gray-500">Match Breakdown - Coming Soon</div>}
        {activeView === "rankings" && <div className="h-full flex items-center justify-center text-gray-500">Rankings - Coming Soon</div>}
      </div>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <AnalyticsPageContent />
    </ProtectedRoute>
  );
}