// FILE: app/pick-list/page.tsx
// COMPLETE REWRITE - Fixed, no AnalyticsLayout dependency

"use client";

import { useState, useEffect } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { Star, Award, ArrowUp, ArrowDown } from "lucide-react";

interface TeamPick {
  teamNumber: string;
  avgScore: number;
  highScore: number;
  consistency: number;
  matchesPlayed: number;
  rank: number;
  picked: boolean;
  pickOrder?: number;
}

function calculateScoutedScore(entry: any): number {
  let score = 0;
  
  if (entry.leftStartingZone) score += 3;
  score += (entry.autoCoralL1 || 0) * 3;
  score += (entry.autoCoralL2 || 0) * 4;
  score += (entry.autoCoralL3 || 0) * 6;
  score += (entry.autoCoralL4 || 0) * 7;
  score += (entry.autoAlgaeProcessorScored || 0) * 6;
  score += (entry.autoAlgaeNetScored || 0) * 4;
  
  score += (entry.teleopCoralL1 || 0) * 2;
  score += (entry.teleopCoralL2 || 0) * 3;
  score += (entry.teleopCoralL3 || 0) * 4;
  score += (entry.teleopCoralL4 || 0) * 5;
  score += (entry.teleopProcessorScored || 0) * 6;
  score += (entry.teleopNetRobotScored || 0) * 4;
  score += (entry.teleopNetHumanScored || 0) * 4;
  
  if (entry.teleopAlgaeRemoved) score += 2;
  
  const stage = (entry.stageStatus || "").toLowerCase();
  if (stage.includes('deep')) score += 12;
  else if (stage.includes('shallow')) score += 6;
  else if (stage.includes('park')) score += 2;
  
  return score;
}

function PickListContent() {
  const [teams, setTeams] = useState<TeamPick[]>([]);
  const [pickedTeams, setPickedTeams] = useState<TeamPick[]>([]);
  const [selectedGame, setSelectedGame] = useState("REEFSCAPE");
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"avgScore" | "highScore" | "consistency">("avgScore");

  useEffect(() => {
    loadTeams();
  }, [selectedGame, sortBy]);

  async function loadTeams() {
    setLoading(true);
    try {
      const entriesSnap = await getDocs(collection(db, "scouting"));
      const entries = entriesSnap.docs.map(doc => doc.data());

      const filtered = entries.filter(e => e.game === selectedGame && e.matchType !== "practice");

      const teamStats: { [team: string]: any } = {};
      
      filtered.forEach(entry => {
        const team = entry.teamNumber;
        if (!teamStats[team]) {
          teamStats[team] = { scores: [] };
        }
        teamStats[team].scores.push(calculateScoutedScore(entry));
      });

      const teamList: TeamPick[] = Object.entries(teamStats).map(([team, stats]) => {
        const avgScore = Math.round(stats.scores.reduce((a: number, b: number) => a + b, 0) / stats.scores.length);
        const variance = stats.scores.reduce((sum: number, s: number) => sum + Math.pow(s - avgScore, 2), 0) / stats.scores.length;
        
        return {
          teamNumber: team,
          avgScore,
          highScore: Math.max(...stats.scores),
          consistency: Math.round(Math.sqrt(variance)),
          matchesPlayed: stats.scores.length,
          rank: 0,
          picked: false
        };
      });

      teamList.sort((a, b) => b[sortBy] - a[sortBy]);
      teamList.forEach((t, i) => t.rank = i + 1);

      setTeams(teamList);
    } catch (error) {
      console.error("Error loading teams:", error);
    } finally {
      setLoading(false);
    }
  }

  function handlePick(team: TeamPick) {
    const updated = teams.map(t => 
      t.teamNumber === team.teamNumber 
        ? { ...t, picked: true, pickOrder: pickedTeams.length + 1 }
        : t
    );
    setTeams(updated);
    setPickedTeams([...pickedTeams, { ...team, picked: true, pickOrder: pickedTeams.length + 1 }]);
  }

  function handleUnpick(team: TeamPick) {
    const updated = teams.map(t =>
      t.teamNumber === team.teamNumber
        ? { ...t, picked: false, pickOrder: undefined }
        : t
    );
    setTeams(updated);
    const newPicked = pickedTeams.filter(t => t.teamNumber !== team.teamNumber);
    newPicked.forEach((t, i) => t.pickOrder = i + 1);
    setPickedTeams(newPicked);
  }

  function movePickUp(index: number) {
    if (index === 0) return;
    const newPicked = [...pickedTeams];
    [newPicked[index - 1], newPicked[index]] = [newPicked[index], newPicked[index - 1]];
    newPicked.forEach((t, i) => t.pickOrder = i + 1);
    setPickedTeams(newPicked);
  }

  function movePickDown(index: number) {
    if (index === pickedTeams.length - 1) return;
    const newPicked = [...pickedTeams];
    [newPicked[index], newPicked[index + 1]] = [newPicked[index + 1], newPicked[index]];
    newPicked.forEach((t, i) => t.pickOrder = i + 1);
    setPickedTeams(newPicked);
  }

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner message="Loading teams..." />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2 theme-text">Pick List</h1>
            <div className="flex items-center gap-4">
              <p className="text-gray-600">Create your alliance selection strategy</p>
              <select
                value={selectedGame}
                onChange={(e) => setSelectedGame(e.target.value)}
                className="border rounded px-3 py-1 text-sm"
              >
                <option value="REEFSCAPE">REEFSCAPE</option>
                <option value="REBUILT">REBUILT</option>
              </select>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Available Teams */}
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
              <div className="p-6 border-b">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold">Available Teams</h2>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="border rounded px-3 py-1 text-sm"
                  >
                    <option value="avgScore">Avg Score</option>
                    <option value="highScore">High Score</option>
                    <option value="consistency">Consistency</option>
                  </select>
                </div>
              </div>

              <div className="overflow-y-auto max-h-[600px]">
                {teams.filter(t => !t.picked).length === 0 ? (
                  <div className="p-12 text-center text-gray-500">
                    <p>No teams available</p>
                  </div>
                ) : (
                  teams.filter(t => !t.picked).map(team => (
                    <div
                      key={team.teamNumber}
                      className="p-4 border-b hover:bg-gray-50 cursor-pointer"
                      onClick={() => handlePick(team)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="text-2xl font-bold text-gray-400">#{team.rank}</div>
                          <div>
                            <p className="font-bold text-lg">Team {team.teamNumber}</p>
                            <div className="flex gap-4 text-sm text-gray-600">
                              <span>Avg: <strong>{team.avgScore}</strong></span>
                              <span>High: <strong>{team.highScore}</strong></span>
                              <span>±{team.consistency}</span>
                            </div>
                          </div>
                        </div>
                        <button className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
                          Pick
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Picked Teams */}
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
              <div className="p-6 border-b theme-primary">
                <div className="flex items-center gap-2">
                  <Star size={24} className="text-white" />
                  <h2 className="text-xl font-semibold text-white">Your Pick List ({pickedTeams.length})</h2>
                </div>
              </div>

              <div className="overflow-y-auto max-h-[600px]">
                {pickedTeams.length === 0 ? (
                  <div className="p-12 text-center text-gray-500">
                    <Award size={48} className="mx-auto mb-4 text-gray-300" />
                    <p>Click teams to add them to your pick list</p>
                  </div>
                ) : (
                  pickedTeams.map((team, index) => (
                    <div key={team.teamNumber} className="p-4 border-b">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1">
                          <div className="flex flex-col gap-1">
                            <button
                              onClick={() => movePickUp(index)}
                              disabled={index === 0}
                              className="p-1 hover:bg-gray-100 rounded disabled:opacity-30"
                            >
                              <ArrowUp size={16} />
                            </button>
                            <button
                              onClick={() => movePickDown(index)}
                              disabled={index === pickedTeams.length - 1}
                              className="p-1 hover:bg-gray-100 rounded disabled:opacity-30"
                            >
                              <ArrowDown size={16} />
                            </button>
                          </div>

                          <div className="w-8 h-8 rounded-full theme-primary-solid flex items-center justify-center font-bold text-white">
                            {team.pickOrder}
                          </div>
                          
                          <div className="flex-1">
                            <p className="font-bold text-lg">Team {team.teamNumber}</p>
                            <div className="flex gap-4 text-sm text-gray-600">
                              <span>Avg: <strong>{team.avgScore}</strong></span>
                              <span>High: <strong>{team.highScore}</strong></span>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => handleUnpick(team)}
                          className="px-3 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200 text-sm"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {pickedTeams.length > 0 && (
                <div className="p-4 border-t bg-gray-50">
                  <button
                    onClick={() => {
                      const pickListText = pickedTeams
                        .map(t => `${t.pickOrder}. Team ${t.teamNumber} (Avg: ${t.avgScore})`)
                        .join('\n');
                      navigator.clipboard.writeText(pickListText);
                      alert('Pick list copied to clipboard!');
                    }}
                    className="w-full py-2 rounded text-white font-semibold theme-primary"
                  >
                    Copy Pick List
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PickListPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <PickListContent />
    </ProtectedRoute>
  );
}
