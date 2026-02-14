// FILE: app/scout-accuracy/page.tsx
// COMPLETE REWRITE - 5-tier system, everyone on leaderboard, lead scouts counted

"use client";

import { useState } from "react";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { useScoutAccuracy } from "@/app/hooks/useScoutAccuracy";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { Target, Trophy, Calendar } from "lucide-react";

function getAccuracyStatus(accuracy: number, practiceCount: number) {
  if (practiceCount === 0) {
    return {
      label: "Undetermined",
      color: "bg-gray-100 text-gray-700",
      showWarning: false
    };
  }
  
  if (accuracy < 50) {
    return {
      label: "Mentor Intervention",
      color: "bg-red-100 text-red-800",
      showWarning: true,
      message: "⚠️ Requires immediate mentor guidance before competition"
    };
  }
  
  if (accuracy < 80) {
    return {
      label: "Student Intervention",
      color: "bg-orange-100 text-orange-800",
      showWarning: true,
      message: "⚠️ Needs additional practice sessions before competition"
    };
  }
  
  if (accuracy < 90) {
    return {
      label: "Good",
      color: "bg-green-700 text-white",
      showWarning: false
    };
  }
  
  return {
    label: "Excellent",
    color: "bg-green-400 text-green-900",
    showWarning: false
  };
}

function ScoutAccuracyContent() {
  const { userData } = useAuth();
  const { scouts, loading, totalScouts } = useScoutAccuracy(userData?.teamId);
  const [selectedScout, setSelectedScout] = useState<any>(null);

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner message="Loading scout accuracy data..." />
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
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
              Check Scout Accuracy
            </h1>
            <p className="text-gray-600">
              Track practice session completion and accuracy for all team members
            </p>
          </div>

          {/* Stats Overview */}
          <div className="grid md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white rounded-xl shadow-md p-6">
              <div className="flex items-center gap-3 mb-2">
                <Target size={24} style={{ color: "#c42221" }} />
                <h3 className="font-semibold text-gray-700">Total Scouts</h3>
              </div>
              <p className="text-4xl font-bold" style={{ color: "#c42221" }}>
                {totalScouts}
              </p>
              <p className="text-sm text-gray-500 mt-1">Scouts + Lead Scouts</p>
            </div>

            <div className="bg-white rounded-xl shadow-md p-6">
              <div className="flex items-center gap-3 mb-2">
                <Trophy size={24} className="text-green-600" />
                <h3 className="font-semibold text-gray-700">Verified Scouts</h3>
              </div>
              <p className="text-4xl font-bold text-green-600">
                {scouts.filter(s => s.averageAccuracy >= 80).length}
              </p>
              <p className="text-sm text-gray-500 mt-1">80%+ accuracy</p>
            </div>

            <div className="bg-white rounded-xl shadow-md p-6">
              <div className="flex items-center gap-3 mb-2">
                <Calendar size={24} className="text-blue-600" />
                <h3 className="font-semibold text-gray-700">Practice Sessions</h3>
              </div>
              <p className="text-4xl font-bold text-blue-600">
                {scouts.reduce((sum, s) => sum + s.practiceSessionsCompleted, 0)}
              </p>
              <p className="text-sm text-gray-500 mt-1">Total completed</p>
            </div>
          </div>

          {/* Leaderboard */}
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            <div className="p-6 border-b">
              <h2 className="text-xl font-semibold">Scout Leaderboard</h2>
              <p className="text-sm text-gray-600 mt-1">
                All team members ranked by practice accuracy
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rank</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sessions</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Accuracy</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {scouts.map((scout, index) => {
                    const status = getAccuracyStatus(scout.averageAccuracy, scout.practiceSessionsCompleted);
                    const isScout = scout.role === "scout" || (scout.role === "coach" && scout.specialRole === "Lead Scout");
                    
                    return (
                      <tr key={scout.uid} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {index < 3 && scout.practiceSessionsCompleted > 0 ? (
                              <Trophy
                                size={20}
                                className={
                                  index === 0 ? "text-yellow-500" :
                                  index === 1 ? "text-gray-400" :
                                  "text-orange-600"
                                }
                              />
                            ) : (
                              <span className="text-gray-600">#{index + 1}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <p className="font-semibold">{scout.displayName}</p>
                            <p className="text-sm text-gray-500">{scout.email}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            <span className={`px-2 py-1 rounded text-xs font-medium inline-block ${
                              scout.role === "coach" ? "bg-blue-100 text-blue-800" : "bg-green-100 text-green-800"
                            }`}>
                              {scout.role === "coach" ? "Coach" : "Scout"}
                            </span>
                            {scout.specialRole && (
                              <span className="px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-800 inline-block">
                                {scout.specialRole}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="font-semibold">{scout.practiceSessionsCompleted}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-2xl font-bold" style={{ 
                            color: scout.averageAccuracy >= 80 ? "#22c55e" : 
                                   scout.averageAccuracy >= 50 ? "#eab308" : "#ef4444" 
                          }}>
                            {scout.averageAccuracy}%
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-3 py-1 rounded text-xs font-medium ${status.color}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={() => setSelectedScout(scout)}
                            className="text-sm font-medium hover:underline"
                            style={{ color: "#c42221" }}
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detail Modal */}
          {selectedScout && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
                <h2 className="text-2xl font-bold mb-4" style={{ color: "#c42221" }}>
                  {selectedScout.displayName}
                </h2>
                
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-600">Email</p>
                    <p className="font-semibold">{selectedScout.email}</p>
                  </div>
                  
                  <div>
                    <p className="text-sm text-gray-600">Role</p>
                    <p className="font-semibold capitalize">{selectedScout.role}</p>
                    {selectedScout.specialRole && (
                      <p className="text-sm text-purple-600">{selectedScout.specialRole}</p>
                    )}
                  </div>
                  
                  <div>
                    <p className="text-sm text-gray-600">Practice Sessions Completed</p>
                    <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                      {selectedScout.practiceSessionsCompleted}
                    </p>
                  </div>
                  
                  <div>
                    <p className="text-sm text-gray-600">Average Accuracy</p>
                    <p className="text-3xl font-bold text-green-600">
                      {selectedScout.averageAccuracy}%
                    </p>
                  </div>
                  
                  <div>
                    <p className="text-sm text-gray-600">Status</p>
                    <span className={`px-3 py-1 rounded text-sm font-medium inline-block ${
                      getAccuracyStatus(selectedScout.averageAccuracy, selectedScout.practiceSessionsCompleted).color
                    }`}>
                      {getAccuracyStatus(selectedScout.averageAccuracy, selectedScout.practiceSessionsCompleted).label}
                    </span>
                  </div>

                  {getAccuracyStatus(selectedScout.averageAccuracy, selectedScout.practiceSessionsCompleted).showWarning && (
                    <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded">
                      <p className="text-sm text-yellow-800">
                        {getAccuracyStatus(selectedScout.averageAccuracy, selectedScout.practiceSessionsCompleted).message}
                      </p>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setSelectedScout(null)}
                  className="w-full mt-6 py-2 rounded text-white font-semibold"
                  style={{ backgroundColor: "#c42221" }}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ScoutAccuracyPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach"]}>
      <ScoutAccuracyContent />
    </ProtectedRoute>
  );
}
