"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { collection, getDocs, deleteDoc, doc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";

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
  submittedAt?: number; // timestamp when form was submitted

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

  if (e.stageStatus === "Parked") s += PTS.CLIMB_PARK;
  else if (e.stageStatus === "Shallow Climb") s += PTS.CLIMB_SHALLOW;
  else if (e.stageStatus === "Deep Climb") s += PTS.CLIMB_DEEP;

  return s;
}

// -------------------------
// MAIN COMPONENT
// -------------------------
function AnalyticsPageContent() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sortConfig, setSortConfig] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "timestamp", dir: "desc" });
  const [selectedGame, setSelectedGame] = useState<"reefscape" | null>("reefscape");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "scoutingEntries"));
        const data: Entry[] = [];
        snap.forEach((d) => {
          const raw = d.data();
          data.push({
            id: d.id,
            matchNumber: raw.matchNumber || "",
            teamNumber: raw.teamNumber || "",
            scoutName: raw.scoutName || "",
            startingPosition: raw.startingPosition || "",
            leftStartingZone: raw.leftStartingZone || false,
            submittedAt: raw.submittedAt,

            autoCoralMissed: raw.autoCoralMissed || 0,
            autoCoralL1: raw.autoCoralL1 || 0,
            autoCoralL2: raw.autoCoralL2 || 0,
            autoCoralL3: raw.autoCoralL3 || 0,
            autoCoralL4: raw.autoCoralL4 || 0,
            autoAlgaeProcessorMissed: raw.autoAlgaeProcessorMissed || 0,
            autoAlgaeProcessorScored: raw.autoAlgaeProcessorScored || 0,
            autoAlgaeNetMissed: raw.autoAlgaeNetMissed || 0,
            autoAlgaeNetScored: raw.autoAlgaeNetScored || 0,

            teleopCoralMissed: raw.teleopCoralMissed || 0,
            teleopCoralL1: raw.teleopCoralL1 || 0,
            teleopCoralL2: raw.teleopCoralL2 || 0,
            teleopCoralL3: raw.teleopCoralL3 || 0,
            teleopCoralL4: raw.teleopCoralL4 || 0,
            teleopAlgaeRemoved: raw.teleopAlgaeRemoved || false,
            teleopProcessorMissed: raw.teleopProcessorMissed || 0,
            teleopProcessorScored: raw.teleopProcessorScored || 0,
            teleopNetRobotMissed: raw.teleopNetRobotMissed || 0,
            teleopNetRobotScored: raw.teleopNetRobotScored || 0,
            teleopNetHumanMissed: raw.teleopNetHumanMissed || 0,
            teleopNetHumanScored: raw.teleopNetHumanScored || 0,

            failedClimb: raw.failedClimb || 0,
            stageStatus: raw.stageStatus || "None",

            incidents: raw.incidents || [],
            notes: raw.notes || "",

            timestamp: raw.timestamp || 0,
          });
        });
        setEntries(data);
      } catch (err) {
        console.error("Error loading analytics:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function deleteEntry(id: string) {
    if (!confirm("Delete this entry?")) return;
    try {
      await deleteDoc(doc(db, "scoutingEntries", id));
      setEntries(entries.filter((e) => e.id !== id));
    } catch (err) {
      console.error("Delete error:", err);
      alert("Failed to delete entry");
    }
  }

  function handleSort(key: string) {
    setSortConfig((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc",
    }));
  }

  const sortLabel = (key: string, label: string) => {
    if (sortConfig.key === key) {
      return `${label} ${sortConfig.dir === "asc" ? "▲" : "▼"}`;
    }
    return label;
  };

  const sorted = [...entries].sort((a, b) => {
    const k = sortConfig.key;
    const dir = sortConfig.dir === "asc" ? 1 : -1;

    // @ts-ignore
    const valA = a[k] ?? "";
    // @ts-ignore
    const valB = b[k] ?? "";

    if (typeof valA === "number" && typeof valB === "number") {
      return (valA - valB) * dir;
    }
    if (typeof valA === "boolean" && typeof valB === "boolean") {
      return (valA === valB ? 0 : valA ? 1 : -1) * dir;
    }
    return String(valA).localeCompare(String(valB)) * dir;
  });

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* HEADER */}
        <div className="p-4 bg-white border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: "#c42221" }}>
                Analytics
              </h1>
              <p className="text-sm text-gray-600">{entries.length} entries</p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                Game:
                <select
                  value={selectedGame || ""}
                  onChange={(e) => setSelectedGame(e.target.value as "reefscape")}
                  className="border rounded px-3 py-1.5"
                >
                  <option value="reefscape">REEFSCAPE</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-4xl mb-4 animate-spin">🔄</div>
              <p className="text-gray-600">Loading analytics...</p>
            </div>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-6xl mb-4">📊</div>
              <p className="text-xl text-gray-600">No entries yet</p>
              <p className="text-sm text-gray-500 mt-2">
                Scout some matches to see analytics here
              </p>
            </div>
          </div>
        ) : (
          <>
            {selectedGame === "reefscape" ? (
              <div className="flex-1 p-4 overflow-hidden">
                <div className="bg-white rounded-xl shadow h-full table-scroll">
                  <table>
                    <thead className="sticky-header">
                      {/* ROW 1: TOP LEVEL GROUPS */}
                      <tr>
                        <th className="sticky-left bg-red-300" colSpan={1}>Information</th>
                        <th className="bg-yellow-300" colSpan={3}>Pre-Match</th>
                        <th className="bg-green-300" colSpan={9}>Autonomous</th>
                        <th className="bg-blue-300" colSpan={13}>Teleoperated</th>
                        <th className="bg-yellow-300" colSpan={2}>Endgame</th>
                        <th className="bg-purple-300" colSpan={1}>Incidents</th>
                        <th className="bg-pink-300" colSpan={3}>General</th>
                        <th className="bg-gray-300" colSpan={1}>Actions</th>
                      </tr>

                      {/* ROW 2: SUB-CATEGORIES */}
                      <tr>
                        <th className="sticky-left bg-red-200" colSpan={1}>Match/Team</th>
                        <th className="bg-yellow-200" colSpan={1}>Scout</th>
                        <th className="bg-yellow-200" colSpan={1}>Starting Position</th>
                        <th className="bg-yellow-200" colSpan={1}>Leave</th>
                        <th className="bg-green-200" colSpan={4}>Coral</th>
                        <th className="bg-green-200" colSpan={2}>Algae Processor</th>
                        <th className="bg-green-200" colSpan={2}>Algae Net</th>
                        <th className="bg-green-200" colSpan={1}>Missed</th>
                        <th className="bg-blue-200" colSpan={5}>Coral</th>
                        <th className="bg-blue-200" colSpan={1}>Algae Collection</th>
                        <th className="bg-blue-200" colSpan={2}>Algae Processor</th>
                        <th className="bg-blue-200" colSpan={2}>Algae Net (Robot)</th>
                        <th className="bg-blue-200" colSpan={2}>Algae Net (Human)</th>
                        <th className="bg-blue-200" colSpan={1}>Climb</th>
                        <th className="bg-yellow-200" colSpan={2}>Climb</th>
                        <th className="bg-purple-200" colSpan={1}>Incidents</th>
                        <th className="bg-pink-200" colSpan={1}>Comments</th>
                        <th className="bg-pink-200" colSpan={1}>Accuracy Script</th>
                        <th className="bg-pink-200" colSpan={1}>Script Status</th>
                        <th className="bg-gray-200" colSpan={1}>Actions</th>
                      </tr>

                      {/* ROW 3: COLUMN LABELS */}
                      <tr>
                        <th className="sticky-left cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("matchNumber")}>
                          {sortLabel("matchNumber", "Match")}
                        </th>
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("scoutName")}>
                          {sortLabel("scoutName", "Scout")}
                        </th>
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("startingPosition")}>
                          {sortLabel("startingPosition", "Starting Position")}
                        </th>
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("leftStartingZone")}>
                          {sortLabel("leftStartingZone", "Leave")}
                        </th>
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
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("autoAlgaeProcessorMissed")}>
                          {sortLabel("autoAlgaeProcessorMissed", "Missed")}
                        </th>
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("autoAlgaeProcessorScored")}>
                          {sortLabel("autoAlgaeProcessorScored", "Scored")}
                        </th>
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("autoAlgaeNetMissed")}>
                          {sortLabel("autoAlgaeNetMissed", "Missed")}
                        </th>
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("autoAlgaeNetScored")}>
                          {sortLabel("autoAlgaeNetScored", "Scored")}
                        </th>
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("autoCoralMissed")}>
                          {sortLabel("autoCoralMissed", "Missed")}
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
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("teleopCoralMissed")}>
                          {sortLabel("teleopCoralMissed", "Missed")}
                        </th>
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("teleopAlgaeRemoved")}>
                          {sortLabel("teleopAlgaeRemoved", "Remove Algae from Reef")}
                        </th>
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("teleopProcessorMissed")}>
                          {sortLabel("teleopProcessorMissed", "Missed")}
                        </th>
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("teleopProcessorScored")}>
                          {sortLabel("teleopProcessorScored", "Scored")}
                        </th>
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("teleopNetRobotMissed")}>
                          {sortLabel("teleopNetRobotMissed", "Missed")}
                        </th>
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("teleopNetRobotScored")}>
                          {sortLabel("teleopNetRobotScored", "Scored")}
                        </th>
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("teleopNetHumanMissed")}>
                          {sortLabel("teleopNetHumanMissed", "Missed")}
                        </th>
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("teleopNetHumanScored")}>
                          {sortLabel("teleopNetHumanScored", "Scored")}
                        </th>
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("failedClimb")}>
                          {sortLabel("failedClimb", "Failed")}
                        </th>
                        <th className="cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort("stageStatus")}>
                          {sortLabel("stageStatus", "Stage Status")}
                        </th>
                        <th>Score</th>
                        <th>Incidents</th>
                        <th>Notes</th>
                        <th>Accuracy</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>

                    <tbody>
                      {sorted.map((e) => {
                        const score = scoreEntry(e);
                        return (
                          <tr key={e.id}>
                            <td className="sticky-left">{e.matchNumber || "-"}</td>
                            <td>{e.scoutName}</td>
                            <td>{e.startingPosition || "-"}</td>
                            <td>{e.leftStartingZone ? "Yes" : "No"}</td>
                            <td>{e.autoCoralL1}</td>
                            <td>{e.autoCoralL2}</td>
                            <td>{e.autoCoralL3}</td>
                            <td>{e.autoCoralL4}</td>
                            <td>{e.autoAlgaeProcessorMissed}</td>
                            <td>{e.autoAlgaeProcessorScored}</td>
                            <td>{e.autoAlgaeNetMissed}</td>
                            <td>{e.autoAlgaeNetScored}</td>
                            <td>{e.autoCoralMissed}</td>
                            <td>{e.teleopCoralL1}</td>
                            <td>{e.teleopCoralL2}</td>
                            <td>{e.teleopCoralL3}</td>
                            <td>{e.teleopCoralL4}</td>
                            <td>{e.teleopCoralMissed}</td>
                            <td>{e.teleopAlgaeRemoved ? "Yes" : "No"}</td>
                            <td>{e.teleopProcessorMissed}</td>
                            <td>{e.teleopProcessorScored}</td>
                            <td>{e.teleopNetRobotMissed}</td>
                            <td>{e.teleopNetRobotScored}</td>
                            <td>{e.teleopNetHumanMissed}</td>
                            <td>{e.teleopNetHumanScored}</td>
                            <td>{e.failedClimb}</td>
                            <td>{e.stageStatus}</td>
                            <td className="font-semibold">{score}</td>
                            <td>{e.incidents.join(", ") || "-"}</td>
                            <td className="max-w-[200px] truncate" title={e.notes}>
                              {e.notes || "-"}
                            </td>
                            <td>-</td>
                            <td>-</td>
                            <td>
                              <button
                                onClick={() => deleteEntry(e.id)}
                                className="text-red-600 hover:text-red-800 text-xs px-2 py-1"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <style jsx global>{`
        .table-scroll {
          overflow: auto;
          position: relative;
        }

        table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          table-layout: auto;
        }

        th,
        td {
          padding: 8px 12px;
          border: 1px solid #e5e7eb;
          text-align: center;
          white-space: nowrap;
          font-size: 0.875rem;
          background: white;
        }

        th {
          font-weight: 600;
          position: sticky;
          top: 0;
          z-index: 2;
        }

        .sticky-header {
          position: sticky;
          top: 0;
          z-index: 3;
        }

        .sticky-left {
          position: sticky;
          left: 0;
          z-index: 1;
          background: white;
          box-shadow: 2px 0 4px rgba(0, 0, 0, 0.05);
        }

        thead .sticky-left {
          z-index: 4;
        }

        tbody tr:hover td {
          background: #f9fafb;
        }

        tbody tr:hover .sticky-left {
          background: #f9fafb;
        }
      `}</style>
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