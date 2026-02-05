"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
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

  useEffect(() => {
    async function load() {
      const snapshot = await getDocs(collection(db, "scouting"));
      const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Entry[];
      setRawData(entries);
    }
    load();
  }, []);

  const data = sortEntries(rawData, sortKey, sortDir);

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
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-bold" style={{ color: "#c42221" }}>
            Analytics
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {rawData.length} entries
          </p>
        </div>

        <nav className="flex-1 p-4">
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
            className={`w-full text-left px-3 py-2 rounded ${
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
      <div className="flex-1 overflow-hidden">
        {activeView === "raw-data" && (
          <div className="h-full overflow-auto">
            <style jsx>{`
              .table-container {
                position: relative;
                overflow: auto;
                height: 100%;
              }

              table {
                border-collapse: collapse;
                font-size: 0.75rem;
              }

              th, td {
                border: 1px solid #e5e7eb;
                padding: 0.5rem;
                white-space: nowrap;
              }

              thead th {
                position: sticky;
                top: 0;
                z-index: 20;
                background: white;
              }

              /* First row headers (group headers) */
              thead tr:first-child th {
                top: 0;
                z-index: 21;
              }

              /* Second row headers (column labels) */
              thead tr:nth-child(2) th {
                top: 33px; /* Height of first header row */
                z-index: 21;
              }

              /* Sticky left columns */
              .sticky-col-1 {
                position: sticky;
                left: 0;
                z-index: 10;
                background: white;
              }

              .sticky-col-2 {
                position: sticky;
                left: 80px; /* Width of first column */
                z-index: 10;
                background: white;
              }

              /* When in header */
              thead .sticky-col-1,
              thead .sticky-col-2 {
                z-index: 22;
              }

              tbody tr:nth-child(even) .sticky-col-1,
              tbody tr:nth-child(even) .sticky-col-2 {
                background: #f9fafb;
              }
            `}</style>

            <div className="table-container">
              <table>
                <thead>
                  {/* GROUP HEADERS ROW */}
                  <tr>
                    <th className="sticky-col-1 bg-red-200 font-bold" colSpan={2}>
                      Information
                    </th>
                    <th className="bg-yellow-200 font-bold" colSpan={2}>
                      Pre-Match
                    </th>
                    <th className="bg-green-200 font-bold" colSpan={9}>
                      Autonomous
                    </th>
                    <th className="bg-blue-200 font-bold" colSpan={13}>
                      Teleoperated
                    </th>
                    <th className="bg-yellow-200 font-bold" colSpan={2}>
                      Endgame
                    </th>
                    <th className="bg-purple-200 font-bold" colSpan={2}>
                      Misc
                    </th>
                    <th className="bg-pink-200 font-bold">
                      Accuracy
                    </th>
                  </tr>

                  {/* SUB-HEADERS ROW */}
                  <tr>
                    {/* Information */}
                    <th className="sticky-col-1 bg-red-50 cursor-pointer hover:bg-red-100"
                        onClick={() => handleSort("matchNumber")}>
                      {sortLabel("matchNumber", "Match")}
                    </th>
                    <th className="sticky-col-2 bg-red-50 cursor-pointer hover:bg-red-100"
                        onClick={() => handleSort("teamNumber")}>
                      {sortLabel("teamNumber", "Team")}
                    </th>

                    {/* Pre-Match */}
                    <th className="bg-yellow-50 cursor-pointer hover:bg-yellow-100"
                        onClick={() => handleSort("scoutName")}>
                      {sortLabel("scoutName", "Scout")}
                    </th>
                    <th className="bg-yellow-50 cursor-pointer hover:bg-yellow-100"
                        onClick={() => handleSort("startingPosition")}>
                      {sortLabel("startingPosition", "Starting Position")}
                    </th>

                    {/* Autonomous - Leave */}
                    <th className="bg-green-50 cursor-pointer hover:bg-green-100"
                        onClick={() => handleSort("leftStartingZone")}>
                      {sortLabel("leftStartingZone", "Leave")}
                    </th>

                    {/* Autonomous - Coral */}
                    <th className="bg-green-50 cursor-pointer hover:bg-green-100"
                        onClick={() => handleSort("autoCoralL1")}>
                      {sortLabel("autoCoralL1", "L1")}
                    </th>
                    <th className="bg-green-50 cursor-pointer hover:bg-green-100"
                        onClick={() => handleSort("autoCoralL2")}>
                      {sortLabel("autoCoralL2", "L2")}
                    </th>
                    <th className="bg-green-50 cursor-pointer hover:bg-green-100"
                        onClick={() => handleSort("autoCoralL3")}>
                      {sortLabel("autoCoralL3", "L3")}
                    </th>
                    <th className="bg-green-50 cursor-pointer hover:bg-green-100"
                        onClick={() => handleSort("autoCoralL4")}>
                      {sortLabel("autoCoralL4", "L4")}
                    </th>

                    {/* Autonomous - Algae Processor */}
                    <th className="bg-green-50 cursor-pointer hover:bg-green-100"
                        onClick={() => handleSort("autoAlgaeProcessorMissed")}>
                      {sortLabel("autoAlgaeProcessorMissed", "Missed")}
                    </th>
                    <th className="bg-green-50 cursor-pointer hover:bg-green-100"
                        onClick={() => handleSort("autoAlgaeProcessorScored")}>
                      {sortLabel("autoAlgaeProcessorScored", "Scored")}
                    </th>

                    {/* Autonomous - Algae Net */}
                    <th className="bg-green-50 cursor-pointer hover:bg-green-100"
                        onClick={() => handleSort("autoAlgaeNetMissed")}>
                      {sortLabel("autoAlgaeNetMissed", "Missed")}
                    </th>
                    <th className="bg-green-50 cursor-pointer hover:bg-green-100"
                        onClick={() => handleSort("autoAlgaeNetScored")}>
                      {sortLabel("autoAlgaeNetScored", "Scored")}
                    </th>

                    {/* Teleoperated - Coral */}
                    <th className="bg-blue-50 cursor-pointer hover:bg-blue-100"
                        onClick={() => handleSort("teleopCoralMissed")}>
                      {sortLabel("teleopCoralMissed", "Missed")}
                    </th>
                    <th className="bg-blue-50 cursor-pointer hover:bg-blue-100"
                        onClick={() => handleSort("teleopCoralL1")}>
                      {sortLabel("teleopCoralL1", "L1")}
                    </th>
                    <th className="bg-blue-50 cursor-pointer hover:bg-blue-100"
                        onClick={() => handleSort("teleopCoralL2")}>
                      {sortLabel("teleopCoralL2", "L2")}
                    </th>
                    <th className="bg-blue-50 cursor-pointer hover:bg-blue-100"
                        onClick={() => handleSort("teleopCoralL3")}>
                      {sortLabel("teleopCoralL3", "L3")}
                    </th>
                    <th className="bg-blue-50 cursor-pointer hover:bg-blue-100"
                        onClick={() => handleSort("teleopCoralL4")}>
                      {sortLabel("teleopCoralL4", "L4")}
                    </th>

                    {/* Teleoperated - Algae Collection */}
                    <th className="bg-blue-50 cursor-pointer hover:bg-blue-100"
                        onClick={() => handleSort("teleopAlgaeRemoved")}>
                      {sortLabel("teleopAlgaeRemoved", "Remove")}
                    </th>

                    {/* Teleoperated - Processor */}
                    <th className="bg-blue-50 cursor-pointer hover:bg-blue-100"
                        onClick={() => handleSort("teleopProcessorMissed")}>
                      {sortLabel("teleopProcessorMissed", "Missed")}
                    </th>
                    <th className="bg-blue-50 cursor-pointer hover:bg-blue-100"
                        onClick={() => handleSort("teleopProcessorScored")}>
                      {sortLabel("teleopProcessorScored", "Scored")}
                    </th>

                    {/* Teleoperated - Net (Robot) */}
                    <th className="bg-blue-50 cursor-pointer hover:bg-blue-100"
                        onClick={() => handleSort("teleopNetRobotMissed")}>
                      {sortLabel("teleopNetRobotMissed", "Missed")}
                    </th>
                    <th className="bg-blue-50 cursor-pointer hover:bg-blue-100"
                        onClick={() => handleSort("teleopNetRobotScored")}>
                      {sortLabel("teleopNetRobotScored", "Scored")}
                    </th>

                    {/* Teleoperated - Net (Human) */}
                    <th className="bg-blue-50 cursor-pointer hover:bg-blue-100"
                        onClick={() => handleSort("teleopNetHumanMissed")}>
                      {sortLabel("teleopNetHumanMissed", "Missed")}
                    </th>
                    <th className="bg-blue-50 cursor-pointer hover:bg-blue-100"
                        onClick={() => handleSort("teleopNetHumanScored")}>
                      {sortLabel("teleopNetHumanScored", "Scored")}
                    </th>

                    {/* Endgame */}
                    <th className="bg-yellow-50 cursor-pointer hover:bg-yellow-100"
                        onClick={() => handleSort("failedClimb")}>
                      {sortLabel("failedClimb", "Failed")}
                    </th>
                    <th className="bg-yellow-50 cursor-pointer hover:bg-yellow-100"
                        onClick={() => handleSort("stageStatus")}>
                      {sortLabel("stageStatus", "End Place")}
                    </th>

                    {/* Misc */}
                    <th className="bg-purple-50">Incidents</th>
                    <th className="bg-purple-50">Notes</th>

                    {/* Accuracy */}
                    <th className="bg-pink-50 cursor-pointer hover:bg-pink-100"
                        onClick={() => handleSort("score")}>
                      {sortLabel("score", "Score")}
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {data.map((e, idx) => {
                    const score = scoreEntry(e);

                    return (
                      <tr key={e.id}>
                        {/* Information */}
                        <td className="sticky-col-1 text-center font-semibold">
                          {e.matchNumber || "-"}
                        </td>
                        <td className="sticky-col-2 text-center font-semibold">
                          {e.teamNumber}
                        </td>

                        {/* Pre-Match */}
                        <td className="text-center">{e.scoutName}</td>
                        <td className="text-center">{e.startingPosition}</td>

                        {/* Autonomous */}
                        <td className="text-center">{e.leftStartingZone ? "✓" : ""}</td>
                        <td className="text-center">{e.autoCoralL1 || ""}</td>
                        <td className="text-center">{e.autoCoralL2 || ""}</td>
                        <td className="text-center">{e.autoCoralL3 || ""}</td>
                        <td className="text-center">{e.autoCoralL4 || ""}</td>
                        <td className="text-center">{e.autoAlgaeProcessorMissed || ""}</td>
                        <td className="text-center">{e.autoAlgaeProcessorScored || ""}</td>
                        <td className="text-center">{e.autoAlgaeNetMissed || ""}</td>
                        <td className="text-center">{e.autoAlgaeNetScored || ""}</td>

                        {/* Teleoperated */}
                        <td className="text-center">{e.teleopCoralMissed || ""}</td>
                        <td className="text-center">{e.teleopCoralL1 || ""}</td>
                        <td className="text-center">{e.teleopCoralL2 || ""}</td>
                        <td className="text-center">{e.teleopCoralL3 || ""}</td>
                        <td className="text-center">{e.teleopCoralL4 || ""}</td>
                        <td className="text-center">{e.teleopAlgaeRemoved ? "✓" : ""}</td>
                        <td className="text-center">{e.teleopProcessorMissed || ""}</td>
                        <td className="text-center">{e.teleopProcessorScored || ""}</td>
                        <td className="text-center">{e.teleopNetRobotMissed || ""}</td>
                        <td className="text-center">{e.teleopNetRobotScored || ""}</td>
                        <td className="text-center">{e.teleopNetHumanMissed || ""}</td>
                        <td className="text-center">{e.teleopNetHumanScored || ""}</td>

                        {/* Endgame */}
                        <td className="text-center">{e.failedClimb || ""}</td>
                        <td className="text-center">{e.stageStatus}</td>

                        {/* Misc */}
                        <td className="text-xs max-w-[200px] truncate">
                          {e.incidents?.join(", ")}
                        </td>
                        <td className="text-xs max-w-[200px] truncate">
                          {e.notes}
                        </td>

                        {/* Accuracy */}
                        <td className="text-center font-bold text-base">
                          {score}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
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