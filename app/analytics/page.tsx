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
    <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row justify-center">
      {/* LEFT PANEL */}
      <div className="flex-1 p-4 space-y-6 max-w-3xl">
        <div
          className="bg-white rounded-xl shadow p-4 border-l-4"
          style={{ borderColor: "#c42221" }}
        >
          <h1 className="text-2xl font-bold">REEFSCAPE Data</h1>
          <p className="text-sm text-gray-600 mt-1">
            Total entries: {rawData.length}
          </p>
        </div>
      </div>

      {/* RIGHT PANEL – TABLE */}
      <div className="flex-1 p-4">
        <div className="bg-white rounded-xl shadow table-scroll border">
          <table className="min-w-full border-collapse text-xs">
            {/* GROUP HEADERS */}
            <thead className="sticky-header">
              <tr>
                {/* Information */}
                <th
                  className="sticky-left bg-red-300 border px-2 py-1 text-center font-semibold"
                  colSpan={2}
                >
                  Information
                </th>

                {/* Pre-Match */}
                <th className="bg-yellow-300 border px-2 py-1 text-center font-semibold" colSpan={2}>
                  Pre‑Match
                </th>

                {/* Autonomous */}
                <th className="bg-green-300 border px-2 py-1 text-center font-semibold" colSpan={9}>
                  Autonomous
                </th>

                {/* Teleop */}
                <th className="bg-blue-300 border px-2 py-1 text-center font-semibold" colSpan={13}>
                  Teleoperated
                </th>

                {/* Endgame */}
                <th className="bg-yellow-300 border px-2 py-1 text-center font-semibold" colSpan={2}>
                  Endgame
                </th>

                {/* Misc */}
                <th className="bg-purple-300 border px-2 py-1 text-center font-semibold" colSpan={2}>
                  Misc
                </th>

                {/* Accuracy */}
                <th className="bg-pink-300 border px-2 py-1 text-center font-semibold" colSpan={1}>
                  Accuracy
                </th>
              </tr>

              {/* COLUMN HEADERS */}
              <tr className="bg-white shadow-sm">
                {/* Sticky left columns */}
                <th
                  className="sticky-left border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("matchNumber")}
                >
                  {sortLabel("matchNumber", "Match")}
                </th>
                <th
                  className="sticky-left-2 border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("teamNumber")}
                >
                  {sortLabel("teamNumber", "Team")}
                </th>

                {/* Pre-Match */}
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("scoutName")}
                >
                  {sortLabel("scoutName", "Scout")}
                </th>
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("startingPosition")}
                >
                  {sortLabel("startingPosition", "Start Pos")}
                </th>

                {/* Autonomous */}
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("leftStartingZone")}
                >
                  {sortLabel("leftStartingZone", "Leave")}
                </th>
                <th className="border px-2 py-1 text-center font-semibold cursor-pointer" onClick={() => handleSort("autoCoralL1")}>
                  {sortLabel("autoCoralL1", "A L1")}
                </th>
                <th className="border px-2 py-1 text-center font-semibold cursor-pointer" onClick={() => handleSort("autoCoralL2")}>
                  {sortLabel("autoCoralL2", "A L2")}
                </th>
                <th className="border px-2 py-1 text-center font-semibold cursor-pointer" onClick={() => handleSort("autoCoralL3")}>
                  {sortLabel("autoCoralL3", "A L3")}
                </th>
                <th className="border px-2 py-1 text-center font-semibold cursor-pointer" onClick={() => handleSort("autoCoralL4")}>
                  {sortLabel("autoCoralL4", "A L4")}
                </th>
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("autoAlgaeProcessorMissed")}
                >
                  {sortLabel("autoAlgaeProcessorMissed", "Proc Miss")}
                </th>
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("autoAlgaeProcessorScored")}
                >
                  {sortLabel("autoAlgaeProcessorScored", "Proc Score")}
                </th>
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("autoAlgaeNetMissed")}
                >
                  {sortLabel("autoAlgaeNetMissed", "Net Miss")}
                </th>
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("autoAlgaeNetScored")}
                >
                  {sortLabel("autoAlgaeNetScored", "Net Score")}
                </th>

                {/* Teleop */}
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("teleopCoralMissed")}
                >
                  {sortLabel("teleopCoralMissed", "T Miss")}
                </th>
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("teleopCoralL1")}
                >
                  {sortLabel("teleopCoralL1", "T L1")}
                </th>
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("teleopCoralL2")}
                >
                  {sortLabel("teleopCoralL2", "T L2")}
                </th>
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("teleopCoralL3")}
                >
                  {sortLabel("teleopCoralL3", "T L3")}
                </th>
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("teleopCoralL4")}
                >
                  {sortLabel("teleopCoralL4", "T L4")}
                </th>
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("teleopAlgaeRemoved")}
                >
                  {sortLabel("teleopAlgaeRemoved", "Remove")}
                </th>
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("teleopProcessorMissed")}
                >
                  {sortLabel("teleopProcessorMissed", "Proc Miss")}
                </th>
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("teleopProcessorScored")}
                >
                  {sortLabel("teleopProcessorScored", "Proc Score")}
                </th>
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("teleopNetRobotMissed")}
                >
                  {sortLabel("teleopNetRobotMissed", "Net R Miss")}
                </th>
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("teleopNetRobotScored")}
                >
                  {sortLabel("teleopNetRobotScored", "Net R Score")}
                </th>
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("teleopNetHumanMissed")}
                >
                  {sortLabel("teleopNetHumanMissed", "Net H Miss")}
                </th>
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("teleopNetHumanScored")}
                >
                  {sortLabel("teleopNetHumanScored", "Net H Score")}
                </th>

                {/* Endgame */}
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("failedClimb")}
                >
                  {sortLabel("failedClimb", "Failed")}
                </th>
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("stageStatus")}
                >
                  {sortLabel("stageStatus", "End Place")}
                </th>

                {/* Misc */}
                <th className="border px-2 py-1 text-center font-semibold">
                  Incidents
                </th>
                <th className="border px-2 py-1 text-center font-semibold">
                  Notes
                </th>

                {/* Accuracy */}
                <th
                  className="border px-2 py-1 text-center font-semibold cursor-pointer"
                  onClick={() => handleSort("score")}
                >
                  {sortLabel("score", "Score")}
                </th>
              </tr>
            </thead>

            {/* BODY */}
            <tbody>
              {data.map((e, idx) => {
                const score = scoreEntry(e);

                return (
                  <tr
                    key={e.id}
                    className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                  >
                    {/* Sticky left */}
                    <td className="sticky-left border px-2 py-1 text-center">
                      {e.matchNumber || ""}
                    </td>
                    <td className="sticky-left-2 border px-2 py-1 text-center">
                      {e.teamNumber}
                    </td>

                    {/* Pre-Match */}
                    <td className="border px-2 py-1 text-center">
                      {e.scoutName}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.startingPosition}
                    </td>

                    {/* Auto */}
                    <td className="border px-2 py-1 text-center">
                      {e.leftStartingZone ? "Y" : ""}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.autoCoralL1}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.autoCoralL2}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.autoCoralL3}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.autoCoralL4}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.autoAlgaeProcessorMissed}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.autoAlgaeProcessorScored}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.autoAlgaeNetMissed}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.autoAlgaeNetScored}
                    </td>

                    {/* Teleop */}
                    <td className="border px-2 py-1 text-center">
                      {e.teleopCoralMissed}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.teleopCoralL1}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.teleopCoralL2}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.teleopCoralL3}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.teleopCoralL4}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.teleopAlgaeRemoved ? "Y" : ""}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.teleopProcessorMissed}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.teleopProcessorScored}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.teleopNetRobotMissed}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.teleopNetRobotScored}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.teleopNetHumanMissed}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.teleopNetHumanScored}
                    </td>

                    {/* Endgame */}
                    <td className="border px-2 py-1 text-center">
                      {e.failedClimb}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {e.stageStatus}
                    </td>

                    {/* Misc */}
                    <td className="border px-2 py-1 text-center text-xs">
                      {e.incidents?.join(", ")}
                    </td>
                    <td className="border px-2 py-1 text-center text-xs">
                      {e.notes}
                    </td>

                    {/* Accuracy */}
                    <td className="border px-2 py-1 text-center font-semibold">
                      {score}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}