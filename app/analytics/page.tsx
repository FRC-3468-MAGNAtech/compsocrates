"use client";

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase";

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
// MAIN PAGE
// -------------------------
export default function AnalyticsPage() {
  const [data, setData] = useState<Entry[]>([]);

  useEffect(() => {
    async function load() {
      const snapshot = await getDocs(collection(db, "scouting"));
      const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Entry[];
      setData(entries);
    }
    load();
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <h1 className="text-3xl font-bold mb-6">Analytics Dashboard</h1>

      <div className="overflow-auto border rounded-xl shadow bg-white">
        <table className="min-w-full border-collapse text-sm">
          {/* ---------------- HEADER GROUPS ---------------- */}
          <thead className="sticky top-0 bg-white z-20">
            <tr>
              <th className="sticky left-0 bg-red-300 border px-2 py-1 z-30" colSpan={4}>
                Information
              </th>
              <th className="bg-green-300 border px-2 py-1" colSpan={8}>
                Autonomous
              </th>
              <th className="bg-blue-300 border px-2 py-1" colSpan={12}>
                Teleoperated
              </th>
              <th className="bg-yellow-300 border px-2 py-1" colSpan={3}>
                Endgame
              </th>
              <th className="bg-purple-300 border px-2 py-1" colSpan={2}>
                Misc
              </th>
              <th className="bg-pink-300 border px-2 py-1" colSpan={1}>
                Accuracy
              </th>
            </tr>

            {/* ---------------- SUBHEADERS ---------------- */}
            <tr>
              {/* Sticky left column */}
              <th className="sticky left-0 bg-white border px-2 py-1 z-30">Match</th>
              <th className="sticky left-0 bg-white border px-2 py-1 z-30">Team</th>
              <th className="sticky left-0 bg-white border px-2 py-1 z-30">Scout</th>
              <th className="sticky left-0 bg-white border px-2 py-1 z-30">Start</th>

              {/* Auto */}
              <th className="border px-2 py-1">Leave</th>
              <th className="border px-2 py-1">A L1</th>
              <th className="border px-2 py-1">A L2</th>
              <th className="border px-2 py-1">A L3</th>
              <th className="border px-2 py-1">A L4</th>
              <th className="border px-2 py-1">Proc Miss</th>
              <th className="border px-2 py-1">Proc Score</th>
              <th className="border px-2 py-1">Net Miss</th>
              <th className="border px-2 py-1">Net Score</th>

              {/* Teleop */}
              <th className="border px-2 py-1">T Miss</th>
              <th className="border px-2 py-1">T L1</th>
              <th className="border px-2 py-1">T L2</th>
              <th className="border px-2 py-1">T L3</th>
              <th className="border px-2 py-1">T L4</th>
              <th className="border px-2 py-1">Remove</th>
              <th className="border px-2 py-1">Proc Miss</th>
              <th className="border px-2 py-1">Proc Score</th>
              <th className="border px-2 py-1">Net R Miss</th>
              <th className="border px-2 py-1">Net R Score</th>
              <th className="border px-2 py-1">Net H Miss</th>
              <th className="border px-2 py-1">Net H Score</th>

              {/* Endgame */}
              <th className="border px-2 py-1">Failed</th>
              <th className="border px-2 py-1">Stage</th>
              <th className="border px-2 py-1">Comments</th>

              {/* Misc */}
              <th className="border px-2 py-1">Incidents</th>
              <th className="border px-2 py-1">Notes</th>

              {/* Accuracy */}
              <th className="border px-2 py-1">Score</th>
            </tr>
          </thead>

          {/* ---------------- BODY ---------------- */}
          <tbody>
            {data.map((e) => {
              const score = scoreEntry(e);

              return (
                <tr key={e.id} className="odd:bg-gray-50">
                  {/* Sticky left column */}
                  <td className="sticky left-0 bg-white border px-2 py-1 z-20">{e.matchNumber || ""}</td>
                  <td className="sticky left-0 bg-white border px-2 py-1 z-20">{e.teamNumber}</td>
                  <td className="sticky left-0 bg-white border px-2 py-1 z-20">{e.scoutName}</td>
                  <td className="sticky left-0 bg-white border px-2 py-1 z-20">{e.startingPosition}</td>

                  {/* Auto */}
                  <td className="border px-2 py-1">{e.leftStartingZone ? "Y" : ""}</td>
                  <td className="border px-2 py-1">{e.autoCoralL1}</td>
                  <td className="border px-2 py-1">{e.autoCoralL2}</td>
                  <td className="border px-2 py-1">{e.autoCoralL3}</td>
                  <td className="border px-2 py-1">{e.autoCoralL4}</td>
                  <td className="border px-2 py-1">{e.autoAlgaeProcessorMissed}</td>
                  <td className="border px-2 py-1">{e.autoAlgaeProcessorScored}</td>
                  <td className="border px-2 py-1">{e.autoAlgaeNetMissed}</td>
                  <td className="border px-2 py-1">{e.autoAlgaeNetScored}</td>

                  {/* Teleop */}
                  <td className="border px-2 py-1">{e.teleopCoralMissed}</td>
                  <td className="border px-2 py-1">{e.teleopCoralL1}</td>
                  <td className="border px-2 py-1">{e.teleopCoralL2}</td>
                  <td className="border px-2 py-1">{e.teleopCoralL3}</td>
                  <td className="border px-2 py-1">{e.teleopCoralL4}</td>
                  <td className="border px-2 py-1">{e.teleopAlgaeRemoved ? "Y" : ""}</td>
                  <td className="border px-2 py-1">{e.teleopProcessorMissed}</td>
                  <td className="border px-2 py-1">{e.teleopProcessorScored}</td>
                  <td className="border px-2 py-1">{e.teleopNetRobotMissed}</td>
                  <td className="border px-2 py-1">{e.teleopNetRobotScored}</td>
                  <td className="border px-2 py-1">{e.teleopNetHumanMissed}</td>
                  <td className="border px-2 py-1">{e.teleopNetHumanScored}</td>

                  {/* Endgame */}
                  <td className="border px-2 py-1">{e.failedClimb}</td>
                  <td className="border px-2 py-1">{e.stageStatus}</td>
                  <td className="border px-2 py-1">{""}</td>

                  {/* Misc */}
                  <td className="border px-2 py-1">{e.incidents?.join(", ")}</td>
                  <td className="border px-2 py-1">{e.notes}</td>

                  {/* Accuracy */}
                  <td className="border px-2 py-1 font-bold">{score}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}