"use client";

import { useState, useEffect } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { Trophy, Users } from "lucide-react";

interface MatchRobot {
  teamNumber: string;
  alliance: "red" | "blue";
  autoPoints: number;
  teleopPoints: number;
  endgamePoints: number;
  totalPoints: number;
  scoutName: string;
}

function MatchBreakdownContent() {
  const [selectedMatch, setSelectedMatch] = useState("");
  const [matchData, setMatchData] = useState<MatchRobot[]>([]);
  const [allMatches, setAllMatches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMatches();
  }, []);

  useEffect(() => {
    if (selectedMatch) {
      loadMatchData(selectedMatch);
    }
  }, [selectedMatch]);

  async function loadMatches() {
    try {
      const entriesSnap = await getDocs(collection(db, "scoutingEntries"));
      const matches = [...new Set(entriesSnap.docs.map(doc => doc.data().matchId || doc.data().matchNumber))]
        .filter(Boolean)
        .sort((a, b) => {
          const aType = a[0].toLowerCase();
          const bType = b[0].toLowerCase();
          const typeOrder = { p: 0, q: 1, f: 2 };
          if (typeOrder[aType] !== typeOrder[bType]) {
            return typeOrder[aType] - typeOrder[bType];
          }
          return parseInt(a.slice(1)) - parseInt(b.slice(1));
        });
      setAllMatches(matches);
      if (matches.length > 0) setSelectedMatch(matches[0]);
    } catch (error) {
      console.error("Error loading matches:", error);
    } finally {
      setLoading(false);
    }
  }

  async function loadMatchData(matchId: string) {
    setLoading(true);
    try {
      const q = query(
        collection(db, "scoutingEntries"),
        where("matchId", "==", matchId)
      );
      const snap = await getDocs(q);
      const entries = snap.docs.map(doc => doc.data());

      const robots = entries.map(e => {
        const autoPoints = 
          (e.leftStartingZone ? 3 : 0) +
          (e.autoCoralL1 || 0) * 3 +
          (e.autoCoralL2 || 0) * 4 +
          (e.autoCoralL3 || 0) * 6 +
          (e.autoCoralL4 || 0) * 7 +
          (e.autoAlgaeProcessorScored || 0) * 6 +
          (e.autoAlgaeNetScored || 0) * 4;

        const teleopPoints =
          (e.teleopCoralL1 || 0) * 2 +
          (e.teleopCoralL2 || 0) * 3 +
          (e.teleopCoralL3 || 0) * 4 +
          (e.teleopCoralL4 || 0) * 5 +
          (e.teleopProcessorScored || 0) * 6 +
          (e.teleopNetRobotScored || 0) * 4 +
          (e.teleopNetHumanScored || 0) * 4 +
          (e.teleopAlgaeRemoved ? 2 : 0);

        let endgamePoints = 0;
        if (e.stageStatus?.toLowerCase().includes("deep")) endgamePoints = 12;
        else if (e.stageStatus?.toLowerCase().includes("shallow")) endgamePoints = 6;
        else if (e.stageStatus?.toLowerCase().includes("park")) endgamePoints = 2;

        return {
          teamNumber: e.teamNumber,
          alliance: e.alliance || "red",
          autoPoints,
          teleopPoints,
          endgamePoints,
          totalPoints: autoPoints + teleopPoints + endgamePoints,
          scoutName: e.scoutName || "Unknown",
        };
      });

      setMatchData(robots);
    } catch (error) {
      console.error("Error loading match data:", error);
    } finally {
      setLoading(false);
    }
  }

  const redAlliance = matchData.filter(r => r.alliance === "red");
  const blueAlliance = matchData.filter(r => r.alliance === "blue");
  const redScore = redAlliance.reduce((sum, r) => sum + r.totalPoints, 0);
  const blueScore = blueAlliance.reduce((sum, r) => sum + r.totalPoints, 0);
  const winner = redScore > blueScore ? "red" : blueScore > redScore ? "blue" : "tie";

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
          Match Breakdown
        </h1>
        <p className="text-gray-600 mb-6">Compare all 6 robots in a match side-by-side</p>

        {/* Match Selector */}
        <div className="bg-white rounded-xl shadow-md p-4 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Select Match</label>
          <select
            value={selectedMatch}
            onChange={(e) => setSelectedMatch(e.target.value)}
            className="w-full md:w-64 border rounded-lg p-2 text-lg font-semibold uppercase"
            style={{ color: "#c42221" }}
          >
            {allMatches.map(match => (
              <option key={match} value={match}>{match}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-4 animate-spin">🔄</div>
            <p className="text-gray-600">Loading match data...</p>
          </div>
        ) : matchData.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md p-8 text-center">
            <p className="text-gray-600">No data available for this match</p>
          </div>
        ) : (
          <>
            {/* Score Summary */}
            <div className="grid md:grid-cols-2 gap-6 mb-6">
              <div className={`rounded-xl shadow-md p-6 ${winner === "red" ? "bg-red-100 border-4 border-red-500" : "bg-red-50"}`}>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xl font-bold text-red-800">Red Alliance</h2>
                  {winner === "red" && <Trophy className="text-red-600" size={32} />}
                </div>
                <p className="text-5xl font-bold text-red-600">{redScore}</p>
                <p className="text-sm text-red-700 mt-2">{redAlliance.length} robots</p>
              </div>

              <div className={`rounded-xl shadow-md p-6 ${winner === "blue" ? "bg-blue-100 border-4 border-blue-500" : "bg-blue-50"}`}>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xl font-bold text-blue-800">Blue Alliance</h2>
                  {winner === "blue" && <Trophy className="text-blue-600" size={32} />}
                </div>
                <p className="text-5xl font-bold text-blue-600">{blueScore}</p>
                <p className="text-sm text-blue-700 mt-2">{blueAlliance.length} robots</p>
              </div>
            </div>

            {/* Red Alliance Robots */}
            <div className="mb-6">
              <h3 className="text-lg font-bold mb-3 text-red-600">Red Alliance Robots</h3>
              <div className="grid md:grid-cols-3 gap-4">
                {redAlliance.map((robot, i) => (
                  <RobotCard key={i} robot={robot} color="red" />
                ))}
              </div>
            </div>

            {/* Blue Alliance Robots */}
            <div>
              <h3 className="text-lg font-bold mb-3 text-blue-600">Blue Alliance Robots</h3>
              <div className="grid md:grid-cols-3 gap-4">
                {blueAlliance.map((robot, i) => (
                  <RobotCard key={i} robot={robot} color="blue" />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RobotCard({ robot, color }: { robot: MatchRobot; color: "red" | "blue" }) {
  const bgColor = color === "red" ? "bg-red-50" : "bg-blue-50";
  const borderColor = color === "red" ? "border-red-200" : "border-blue-200";
  const textColor = color === "red" ? "text-red-800" : "text-blue-800";

  return (
    <div className={`${bgColor} border-2 ${borderColor} rounded-xl p-4`}>
      <div className="flex items-center justify-between mb-3">
        <h4 className={`text-2xl font-bold ${textColor}`}>Team {robot.teamNumber}</h4>
        <Users className={textColor} size={20} />
      </div>
      
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Auto:</span>
          <span className="font-bold">{robot.autoPoints}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Teleop:</span>
          <span className="font-bold">{robot.teleopPoints}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Endgame:</span>
          <span className="font-bold">{robot.endgamePoints}</span>
        </div>
        <div className="flex justify-between pt-2 border-t border-gray-300">
          <span className="font-semibold">Total:</span>
          <span className={`text-xl font-bold ${textColor}`}>{robot.totalPoints}</span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-300">
        <p className="text-xs text-gray-600">Scouted by: {robot.scoutName}</p>
      </div>
    </div>
  );
}

export default function MatchBreakdownPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <MatchBreakdownContent />
    </ProtectedRoute>
  );
}