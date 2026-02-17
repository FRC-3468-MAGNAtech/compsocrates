"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, deleteDoc, doc, addDoc } from "firebase/firestore";
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
  { id: "rocket-city", name: "Rocket City", startDate: "2026-03-18", endDate: "2026-03-21" },
  { id: "bayou", name: "Bayou", startDate: "2026-04-01", endDate: "2026-04-04" },
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

const positionLabels: Record<string, string> = {
  "Not There": "Not There",
  "Processor Side": "Processor Side",
  "Middle": "Middle",
  "Opposite Side": "Opposite Side"
};

const stageLabels: Record<string, string> = {
  "None": "None",
  "Park": "Park",
  "Shallow Cage": "Shallow",
  "Deep Cage": "Deep"
};

// -------------------------
// MAIN PAGE
// -------------------------
function AnalyticsPageContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const [rawData, setRawData] = useState<Entry[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("matchNumber");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [activeView, setActiveView] = useState("raw-data");
  const [selectedEvent, setSelectedEvent] = useState("all");
  const [selectedGame, setSelectedGame] = useState("reefscape");
  const [showPractice, setShowPractice] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  async function loadData() {
    const snapshot = await getDocs(collection(db, "scouting"));
    const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Entry[];
    setRawData(entries);
  }

  // Auto-collapse sidebar on mobile
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setSidebarCollapsed(true);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isCoach = userData?.role === "coach";

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, []);

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

  // Filter by practice/non-practice first
  const filteredByPractice = showPractice 
    ? rawData.filter(entry => entry.matchType === "practice")
    : rawData.filter(entry => entry.matchType !== "practice");

  // Then filter by event
  const filteredByEvent = selectedEvent === "all" 
    ? filteredByPractice 
    : filteredByPractice.filter(entry => {
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

  // Export data to CSV
  function exportToCSV() {
    if (filteredByEvent.length === 0) {
      alert("No data to export");
      return;
    }

    const headers = [
      "Match", "Type", "Team", "Scout", "Position", "Left Zone",
      "Auto Coral L1-4", "Auto Coral Missed",
      "Auto Processor", "Auto Net",
      "Teleop Coral L1-4", "Teleop Coral Missed",
      "Teleop Processor", "Teleop Net Robot", "Teleop Net Human",
      "Stage", "Notes", "Timestamp"
    ];

    const rows = filteredByEvent.map((e: Entry) => [
      e.matchNumber || "",
      e.matchType || "",
      e.teamNumber || "",
      e.scoutName || "",
      e.startingPosition || "",
      e.leftStartingZone ? "Y" : "N",
      `${e.autoCoralL1}/${e.autoCoralL2}/${e.autoCoralL3}/${e.autoCoralL4}`,
      e.autoCoralMissed || 0,
      `${e.autoAlgaeProcessorScored}/${e.autoAlgaeProcessorMissed}`,
      `${e.autoAlgaeNetScored}/${e.autoAlgaeNetMissed}`,
      `${e.teleopCoralL1}/${e.teleopCoralL2}/${e.teleopCoralL3}/${e.teleopCoralL4}`,
      e.teleopCoralMissed || 0,
      `${e.teleopProcessorScored}/${e.teleopProcessorMissed}`,
      `${e.teleopNetRobotScored}/${e.teleopNetRobotMissed}`,
      `${e.teleopNetHumanScored}/${e.teleopNetHumanMissed}`,
      e.stageStatus || "",
      (e.notes || "").replace(/,/g, ";"),
      e.timestamp || ""
    ]);

    const csv = [
      headers.join(","),
      ...rows.map((r: (string | number)[]) => r.map((c: string | number) => String(c).includes(",") ? `"${c}"` : c).join(","))
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Import data from CSV
  async function importFromCSV(event: React.ChangeEvent<HTMLInputElement>) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const text = e.target?.result as string;
      const lines = text.split('\n');
      let imported = 0;
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        
        const values = lines[i].split(',');
        const entry: Partial<Entry> = {
          matchNumber: values[0],
          matchType: values[1] as "qualification" | "practice" | "finals",
          teamNumber: values[2],
          scoutName: values[3],
          startingPosition: values[4],
          leftStartingZone: values[5] === 'Y',
          timestamp: Date.now(),
          submittedAt: Date.now()
        };

        // Parse Auto Coral L1-4
        const autoCoralStr = values[6].replace(/"/g, '');
        const autoCoral = autoCoralStr.split('/');
        entry.autoCoralL1 = parseInt(autoCoral[0]) || 0;
        entry.autoCoralL2 = parseInt(autoCoral[1]) || 0;
        entry.autoCoralL3 = parseInt(autoCoral[2]) || 0;
        entry.autoCoralL4 = parseInt(autoCoral[3]) || 0;
        entry.autoCoralMissed = parseInt(values[7]) || 0;

        // Parse Auto Processor
        const autoProc = values[8].replace(/"/g, '').split('/');
        entry.autoAlgaeProcessorScored = parseInt(autoProc[0]) || 0;
        entry.autoAlgaeProcessorMissed = parseInt(autoProc[1]) || 0;

        // Parse Auto Net
        const autoNet = values[9].replace(/"/g, '').split('/');
        entry.autoAlgaeNetScored = parseInt(autoNet[0]) || 0;
        entry.autoAlgaeNetMissed = parseInt(autoNet[1]) || 0;

        // Parse Teleop Coral L1-4
        const teleopCoralStr = values[10].replace(/"/g, '');
        const teleopCoral = teleopCoralStr.split('/');
        entry.teleopCoralL1 = parseInt(teleopCoral[0]) || 0;
        entry.teleopCoralL2 = parseInt(teleopCoral[1]) || 0;
        entry.teleopCoralL3 = parseInt(teleopCoral[2]) || 0;
        entry.teleopCoralL4 = parseInt(teleopCoral[3]) || 0;
        entry.teleopCoralMissed = parseInt(values[11]) || 0;

        // Parse Teleop Processor
        const teleopProc = values[12].replace(/"/g, '').split('/');
        entry.teleopProcessorScored = parseInt(teleopProc[0]) || 0;
        entry.teleopProcessorMissed = parseInt(teleopProc[1]) || 0;

        // Parse Teleop Net Robot
        const teleopNetR = values[13].replace(/"/g, '').split('/');
        entry.teleopNetRobotScored = parseInt(teleopNetR[0]) || 0;
        entry.teleopNetRobotMissed = parseInt(teleopNetR[1]) || 0;

        // Parse Teleop Net Human
        const teleopNetH = values[14].replace(/"/g, '').split('/');
        entry.teleopNetHumanScored = parseInt(teleopNetH[0]) || 0;
        entry.teleopNetHumanMissed = parseInt(teleopNetH[1]) || 0;

        entry.teleopAlgaeRemoved = false;
        entry.stageStatus = values[15] || "";
        entry.failedClimb = 0;
        entry.incidents = [];
        entry.notes = values[16]?.replace(/"/g, '').replace(/;/g, ',') || "";

        // Save to Firestore
        await addDoc(collection(db, "scouting"), entry);
        imported++;
      }

      alert(`Successfully imported ${imported} entries!`);
      await loadData();
    } catch (error) {
      console.error("Error importing CSV:", error);
      alert("Error importing CSV. Please check the file format.");
    }
  };

  reader.readAsText(file);
  event.target.value = ''; // Reset input
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
          <div className="mt-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input 
                type="checkbox" 
                checked={showPractice} 
                onChange={(e) => setShowPractice(e.target.checked)}
                className="rounded"
              />
              <span className="text-xs font-medium text-gray-600">Show Practice Matches</span>
            </label>
          </div>
        </div>
        <nav className="flex-1 p-4 flex flex-col">
          <button onClick={() => setActiveView("raw-data")} title="Raw Data" className={`w-full ${sidebarCollapsed ? "text-center" : "text-left"} px-3 py-2 rounded mb-2 ${activeView === "raw-data" ? "bg-red-100 text-red-800 font-semibold" : "hover:bg-gray-100 text-gray-700"}`}>Raw Data</button>
          <button onClick={() => router.push("/analytics/team-averages")} className="w-full text-left px-3 py-2 rounded mb-2 hover:bg-gray-100 text-gray-700">Team Averages</button>
          <button onClick={() => router.push("/analytics/match-breakdown")} className="w-full text-left px-3 py-2 rounded mb-2 hover:bg-gray-100 text-gray-700">Match Breakdown</button>
          <button onClick={() => router.push("/analytics/rankings")} className="w-full text-left px-3 py-2 rounded mb-2 hover:bg-gray-100 text-gray-700">Rankings</button>
          <button onClick={() => router.push("/analytics/pick-list")} className="w-full text-left px-3 py-2 rounded mb-2 hover:bg-gray-100 text-gray-700">Pick List</button>
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
                <button 
                  onClick={exportToCSV}
                  className="px-4 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium"
                >
                  Export CSV
                </button>
                <label className="px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium cursor-pointer">
                  Import CSV
                  <input 
                    type="file" 
                    accept=".csv" 
                    onChange={importFromCSV}
                    className="hidden"
                  />
                </label>
                <div className="h-6 w-px bg-gray-300" />
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
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("autoCoralMissed")}>{sortLabel("autoCoralMissed", "Auto Coral Missed")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("autoCoralL1")}>{sortLabel("autoCoralL1", "L1")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("autoCoralL2")}>{sortLabel("autoCoralL2", "L2")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("autoCoralL3")}>{sortLabel("autoCoralL3", "L3")}</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("autoCoralL4")}>{sortLabel("autoCoralL4", "L4")}</th>
                        <th className="text-center">Processor Missed</th>
                        <th className="text-center">Processor Scored</th>
                        <th className="text-center">Net Missed</th>
                        <th className="text-center">Net Scored</th>
                        <th className="text-center">Coral Missed</th>
                        <th className="text-center">L1</th>
                        <th className="text-center">L2</th>
                        <th className="text-center">L3</th>
                        <th className="text-center">L4</th>
                        <th className="text-center">Algae Removed</th>
                        <th className="text-center">Processor Missed</th>
                        <th className="text-center">Processor Scored</th>
                        <th className="text-center">Net (Robot) Missed</th>
                        <th className="text-center">Net (Robot) Scored</th>
                        <th className="text-center">Net (Human) Missed</th>
                        <th className="text-center">Net (Human) Scored</th>
                        <th className="text-center">Failed Climb</th>
                        <th className="text-center">Stage Status</th>
                        <th className="text-center">Incidents</th>
                        <th className="text-center">Notes</th>
                        <th className="cursor-pointer hover:bg-gray-100 text-center" onClick={() => handleSort("score")}>{sortLabel("score", "Score")}</th>
                        <th className="text-center">Scouted Pts</th>
                        {isCoach && <th className="text-center">Accuracy</th>}
                        {isCoach && <th className="text-center">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((e) => {
                        const score = scoreEntry(e);
                        const incidentText = e.incidents.map(i => INCIDENT_LABELS[i] || i).join(", ") || "-";
                        return (
                          <tr key={e.id}>
                            <td className="sticky-left-0 font-semibold bg-white z-20 text-center">
                              {e.matchNumber ? (
                                e.matchType === "finals" ? `F${e.matchNumber}` :
                                e.matchType === "practice" ? `P${e.matchNumber}` :
                                `Q${e.matchNumber}`
                              ) : "-"}
                            </td>
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
