"use client";

import { useState, useEffect } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { TrendingUp, Award, Target } from "lucide-react";

interface TeamAverage {
  teamNumber: string;
  matchesPlayed: number;
  avgAutoCoralL1: number;
  avgAutoCoralL2: number;
  avgAutoCoralL3: number;
  avgAutoCoralL4: number;
  avgAutoAlgae: number;
  avgTeleopCoralL1: number;
  avgTeleopCoralL2: number;
  avgTeleopCoralL3: number;
  avgTeleopCoralL4: number;
  avgTeleopAlgae: number;
  climbSuccessRate: number;
  avgPointsContributed: number;
}

function TeamAveragesContent() {
  const [selectedTeam, setSelectedTeam] = useState("");
  const [teamData, setTeamData] = useState<TeamAverage | null>(null);
  const [allTeams, setAllTeams] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTeams();
  }, []);

  useEffect(() => {
    if (selectedTeam) {
      loadTeamData(selectedTeam);
    }
  }, [selectedTeam]);

  async function loadTeams() {
    try {
      const entriesSnap = await getDocs(collection(db, "scoutingEntries"));
      const teams = [...new Set(entriesSnap.docs.map(doc => doc.data().teamNumber))].sort();
      setAllTeams(teams);
      if (teams.length > 0) setSelectedTeam(teams[0]);
    } catch (error) {
      console.error("Error loading teams:", error);
    } finally {
      setLoading(false);
    }
  }

  async function loadTeamData(teamNumber: string) {
    setLoading(true);
    try {
      const q = query(
        collection(db, "scoutingEntries"),
        where("teamNumber", "==", teamNumber)
      );
      const snap = await getDocs(q);
      const entries = snap.docs.map(doc => doc.data());

      if (entries.length === 0) {
        setTeamData(null);
        setLoading(false);
        return;
      }

      // Calculate averages
      const avg = (field: string) => {
        const sum = entries.reduce((acc, e) => acc + (e[field] || 0), 0);
        return entries.length > 0 ? (sum / entries.length).toFixed(1) : "0.0";
      };

      const climbSuccesses = entries.filter(e => 
        e.stageStatus && !e.stageStatus.toLowerCase().includes("none")
      ).length;

      const avgPoints = entries.reduce((acc, e) => {
        let points = 0;
        points += (e.autoCoralL1 || 0) * 3;
        points += (e.autoCoralL2 || 0) * 4;
        points += (e.autoCoralL3 || 0) * 6;
        points += (e.autoCoralL4 || 0) * 7;
        points += (e.teleopCoralL1 || 0) * 2;
        points += (e.teleopCoralL2 || 0) * 3;
        points += (e.teleopCoralL3 || 0) * 4;
        points += (e.teleopCoralL4 || 0) * 5;
        if (e.stageStatus?.toLowerCase().includes("deep")) points += 12;
        else if (e.stageStatus?.toLowerCase().includes("shallow")) points += 6;
        else if (e.stageStatus?.toLowerCase().includes("park")) points += 2;
        return acc + points;
      }, 0) / entries.length;

      setTeamData({
        teamNumber,
        matchesPlayed: entries.length,
        avgAutoCoralL1: parseFloat(avg("autoCoralL1")),
        avgAutoCoralL2: parseFloat(avg("autoCoralL2")),
        avgAutoCoralL3: parseFloat(avg("autoCoralL3")),
        avgAutoCoralL4: parseFloat(avg("autoCoralL4")),
        avgAutoAlgae: parseFloat(avg("autoAlgaeProcessorScored")) + parseFloat(avg("autoAlgaeNetScored")),
        avgTeleopCoralL1: parseFloat(avg("teleopCoralL1")),
        avgTeleopCoralL2: parseFloat(avg("teleopCoralL2")),
        avgTeleopCoralL3: parseFloat(avg("teleopCoralL3")),
        avgTeleopCoralL4: parseFloat(avg("teleopCoralL4")),
        avgTeleopAlgae: parseFloat(avg("teleopProcessorScored")) + parseFloat(avg("teleopNetRobotScored")),
        climbSuccessRate: (climbSuccesses / entries.length) * 100,
        avgPointsContributed: avgPoints,
      });
    } catch (error) {
      console.error("Error loading team data:", error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
          Team Averages
        </h1>
        <p className="text-gray-600 mb-6">View average performance statistics for each team</p>

        {/* Team Selector */}
        <div className="bg-white rounded-xl shadow-md p-4 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Select Team</label>
          <select
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
            className="w-full md:w-64 border rounded-lg p-2 text-lg font-semibold"
            style={{ color: "#c42221" }}
          >
            {allTeams.map(team => (
              <option key={team} value={team}>Team {team}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-4 animate-spin">🔄</div>
            <p className="text-gray-600">Loading team data...</p>
          </div>
        ) : !teamData ? (
          <div className="bg-white rounded-xl shadow-md p-8 text-center">
            <p className="text-gray-600">No data available for this team</p>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid md:grid-cols-3 gap-6 mb-6">
              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-700">Matches Played</h3>
                  <TrendingUp className="text-blue-500" />
                </div>
                <p className="text-4xl font-bold" style={{ color: "#c42221" }}>
                  {teamData.matchesPlayed}
                </p>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-700">Avg Points</h3>
                  <Award className="text-yellow-500" />
                </div>
                <p className="text-4xl font-bold" style={{ color: "#c42221" }}>
                  {teamData.avgPointsContributed.toFixed(1)}
                </p>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-700">Climb Rate</h3>
                  <Target className="text-green-500" />
                </div>
                <p className="text-4xl font-bold" style={{ color: "#c42221" }}>
                  {teamData.climbSuccessRate.toFixed(0)}%
                </p>
              </div>
            </div>

            {/* Detailed Stats */}
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-bold mb-4">Autonomous</h2>
                <div className="space-y-3">
                  <StatRow label="Coral L1" value={teamData.avgAutoCoralL1} />
                  <StatRow label="Coral L2" value={teamData.avgAutoCoralL2} />
                  <StatRow label="Coral L3" value={teamData.avgAutoCoralL3} />
                  <StatRow label="Coral L4" value={teamData.avgAutoCoralL4} />
                  <StatRow label="Algae" value={teamData.avgAutoAlgae} />
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-bold mb-4">Teleop</h2>
                <div className="space-y-3">
                  <StatRow label="Coral L1" value={teamData.avgTeleopCoralL1} />
                  <StatRow label="Coral L2" value={teamData.avgTeleopCoralL2} />
                  <StatRow label="Coral L3" value={teamData.avgTeleopCoralL3} />
                  <StatRow label="Coral L4" value={teamData.avgTeleopCoralL4} />
                  <StatRow label="Algae" value={teamData.avgTeleopAlgae} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <span className="text-lg font-bold" style={{ color: "#c42221" }}>
        {value.toFixed(1)}
      </span>
    </div>
  );
}

export default function TeamAveragesPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <TeamAveragesContent />
    </ProtectedRoute>
  );
}