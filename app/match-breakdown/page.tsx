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
      const entriesSnap = await getDocs(collection(db, "scouting"));
      const matches = [...new Set(entriesSnap.docs.map(doc => doc.data().matchId || doc.data().matchNumber))]
        .filter(Boolean)
        .sort((a: any, b: any) => {
          const aType = a[0].toLowerCase();
          const bType = b[0].toLowerCase();
          const typeOrder: { [key: string]: number } = { p: 0, q: 1, f: 2 }; // FIX: Properly typed
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
      const entriesQuery = query(
        collection(db, "scouting"),
        where("matchId", "==", matchId)
      );
      const entriesSnap = await getDocs(entriesQuery);
      
      const robots: MatchRobot[] = entriesSnap.docs.map(doc => {
        const data = doc.data();
        
        // Calculate points (simplified)
        const autoPoints = (data.autoCoralL1 || 0) * 3 + 
                          (data.autoCoralL2 || 0) * 4 + 
                          (data.autoCoralL3 || 0) * 6 + 
                          (data.autoCoralL4 || 0) * 7 +
                          (data.autoAlgaeProcessorScored || 0) * 6 +
                          (data.autoAlgaeNetScored || 0) * 4 +
                          (data.leftStartingZone ? 3 : 0);
        
        const teleopPoints = (data.teleopCoralL1 || 0) * 2 + 
                            (data.teleopCoralL2 || 0) * 3 + 
                            (data.teleopCoralL3 || 0) * 4 + 
                            (data.teleopCoralL4 || 0) * 5 +
                            (data.teleopProcessorScored || 0) * 6 +
                            (data.teleopNetRobotScored || 0) * 4 +
                            (data.teleopNetHumanScored || 0) * 4 +
                            (data.teleopAlgaeRemoved ? 2 : 0);
        
        let endgamePoints = 0;
        const stage = (data.stageStatus || "").toLowerCase();
        if (stage.includes("deep")) endgamePoints = 12;
        else if (stage.includes("shallow")) endgamePoints = 6;
        else if (stage.includes("park")) endgamePoints = 2;
        
        return {
          teamNumber: data.teamNumber || "Unknown",
          alliance: data.alliance || "blue",
          autoPoints,
          teleopPoints,
          endgamePoints,
          totalPoints: autoPoints + teleopPoints + endgamePoints,
          scoutName: data.scoutName || "Unknown"
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
  
  const redTotal = redAlliance.reduce((sum, r) => sum + r.totalPoints, 0);
  const blueTotal = blueAlliance.reduce((sum, r) => sum + r.totalPoints, 0);

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
            Match Breakdown
          </h1>
          <p className="text-gray-600 mb-8">
            Detailed analysis of match performance by alliance
          </p>

          {/* Match Selector */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Match
            </label>
            <select
              value={selectedMatch}
              onChange={(e) => setSelectedMatch(e.target.value)}
              className="w-full max-w-md border rounded p-2"
            >
              {allMatches.map(match => (
                <option key={match} value={match}>{match}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <div className="text-4xl mb-4">⏳</div>
              <p className="text-gray-600">Loading match data...</p>
            </div>
          ) : matchData.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <div className="text-6xl mb-4">📊</div>
              <h2 className="text-2xl font-semibold mb-2">No Data Available</h2>
              <p className="text-gray-600">
                No scouting data found for this match.
              </p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {/* Red Alliance */}
              <div className="bg-white rounded-xl shadow-md overflow-hidden">
                <div className="bg-red-500 text-white p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Trophy size={24} />
                    <h2 className="text-xl font-bold">Red Alliance</h2>
                  </div>
                  <div className="text-2xl font-bold">{redTotal}</div>
                </div>
                <div className="p-6">
                  {redAlliance.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">No data available</p>
                  ) : (
                    <div className="space-y-4">
                      {redAlliance.map((robot, idx) => (
                        <div key={idx} className="border rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-lg">Team {robot.teamNumber}</span>
                            <span className="text-xl font-bold" style={{ color: "#c42221" }}>
                              {robot.totalPoints}
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-sm">
                            <div>
                              <p className="text-gray-600">Auto</p>
                              <p className="font-semibold">{robot.autoPoints}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">Teleop</p>
                              <p className="font-semibold">{robot.teleopPoints}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">Endgame</p>
                              <p className="font-semibold">{robot.endgamePoints}</p>
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 mt-2">Scouted by: {robot.scoutName}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Blue Alliance */}
              <div className="bg-white rounded-xl shadow-md overflow-hidden">
                <div className="bg-blue-500 text-white p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Trophy size={24} />
                    <h2 className="text-xl font-bold">Blue Alliance</h2>
                  </div>
                  <div className="text-2xl font-bold">{blueTotal}</div>
                </div>
                <div className="p-6">
                  {blueAlliance.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">No data available</p>
                  ) : (
                    <div className="space-y-4">
                      {blueAlliance.map((robot, idx) => (
                        <div key={idx} className="border rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-lg">Team {robot.teamNumber}</span>
                            <span className="text-xl font-bold text-blue-600">
                              {robot.totalPoints}
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-sm">
                            <div>
                              <p className="text-gray-600">Auto</p>
                              <p className="font-semibold">{robot.autoPoints}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">Teleop</p>
                              <p className="font-semibold">{robot.teleopPoints}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">Endgame</p>
                              <p className="font-semibold">{robot.endgamePoints}</p>
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 mt-2">Scouted by: {robot.scoutName}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
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