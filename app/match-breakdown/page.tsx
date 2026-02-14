// FILE: app/match-breakdown/page.tsx
// COMPLETE REWRITE - Uses AnalyticsLayout, proper match display

"use client";

import { useState, useEffect } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AnalyticsLayout from "@/app/components/AnalyticsLayout";
import { Trophy } from "lucide-react";
import { sortMatches, formatMatchDisplay } from "@/app/utils/matchSorting";
import { calculateScoutedScore } from "@/app/utils/practiceTypes";

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
  const [selectedGame, setSelectedGame] = useState("REEFSCAPE");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMatches();
  }, [selectedGame]);

  useEffect(() => {
    if (selectedMatch) {
      loadMatchData(selectedMatch);
    }
  }, [selectedMatch]);

  async function loadMatches() {
    try {
      const entriesSnap = await getDocs(collection(db, "scouting"));
      const entries = entriesSnap.docs.map(doc => doc.data());
      
      const matches = [...new Set(entries
        .filter(e => e.game === selectedGame)
        .map(doc => doc.matchNumber || doc.matchId))]
        .filter(Boolean);
      
      const sorted = sortMatches(matches);
      setAllMatches(sorted);
      if (sorted.length > 0) setSelectedMatch(sorted[0]);
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
        where("matchNumber", "==", matchId)
      );
      const entriesSnap = await getDocs(entriesQuery);
      
      const robots: MatchRobot[] = entriesSnap.docs.map(doc => {
        const data = doc.data();
        
        const autoPoints = calculateAutoScore(data);
        const teleopPoints = calculateTeleopScore(data);
        const endgamePoints = calculateEndgameScore(data);
        
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

  function calculateAutoScore(e: any): number {
    let score = 0;
    if (e.leftStartingZone) score += 3;
    score += (e.autoCoralL1 || 0) * 3;
    score += (e.autoCoralL2 || 0) * 4;
    score += (e.autoCoralL3 || 0) * 6;
    score += (e.autoCoralL4 || 0) * 7;
    score += (e.autoAlgaeProcessorScored || 0) * 6;
    score += (e.autoAlgaeNetScored || 0) * 4;
    return score;
  }

  function calculateTeleopScore(e: any): number {
    let score = 0;
    score += (e.teleopCoralL1 || 0) * 2;
    score += (e.teleopCoralL2 || 0) * 3;
    score += (e.teleopCoralL3 || 0) * 4;
    score += (e.teleopCoralL4 || 0) * 5;
    score += (e.teleopProcessorScored || 0) * 6;
    score += (e.teleopNetRobotScored || 0) * 4;
    score += (e.teleopNetHumanScored || 0) * 4;
    if (e.teleopAlgaeRemoved) score += 2;
    return score;
  }

  function calculateEndgameScore(e: any): number {
    const stage = (e.stageStatus || "").toLowerCase();
    if (stage.includes('deep')) return 12;
    if (stage.includes('shallow')) return 6;
    if (stage.includes('park')) return 2;
    return 0;
  }

  const redAlliance = matchData.filter(r => r.alliance === "red");
  const blueAlliance = matchData.filter(r => r.alliance === "blue");
  
  const redTotal = redAlliance.reduce((sum, r) => sum + r.totalPoints, 0);
  const blueTotal = blueAlliance.reduce((sum, r) => sum + r.totalPoints, 0);

  return (
    <AnalyticsLayout
      currentPage="match-breakdown"
      title="Match Breakdown"
      loading={loading}
      selectedGame={selectedGame}
      onGameChange={setSelectedGame}
    >
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
            <option key={match} value={match}>{formatMatchDisplay(match)}</option>
          ))}
        </select>
      </div>

      {matchData.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md p-12 text-center">
          <div className="text-6xl mb-4">📊</div>
          <h2 className="text-2xl font-semibold mb-2">No Data Available</h2>
          <p className="text-gray-600">No scouting data found for this match.</p>
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
    </AnalyticsLayout>
  );
}

export default function MatchBreakdownPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <MatchBreakdownContent />
    </ProtectedRoute>
  );
}
