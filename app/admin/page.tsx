"use client";

import Link from "next/link";
import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";

function AdminPanelContent() {
  const { userData } = useAuth();
  const [savingDashboard, setSavingDashboard] = useState(false);
  const dashboardOptions = [
    { label: "Match Scout", value: "/match-scout-dashboard" },
    { label: "Pit Scout", value: "/pit-scout-dashboard" },
    { label: "Pit Team", value: "/pit-team-dashboard" },
    { label: "Drive Team", value: "/drive-team-dashboard" },
    { label: "Lead Scout", value: "/lead-scout-dashboard" },
    { label: "Lead Strategist", value: "/lead-strategist-dashboard" },
    { label: "Team Coach", value: "/team-coach-dashboard" },
  ];

  async function savePreferredDashboard(nextValue: string) {
    if (!userData?.uid) return;
    setSavingDashboard(true);
    try {
      await setDoc(doc(db, "users", userData.uid), { preferredDashboard: nextValue }, { merge: true });
      alert("Default dashboard updated.");
    } catch (error) {
      console.error("Failed to save preferred dashboard:", error);
      alert("Unable to save default dashboard.");
    } finally {
      setSavingDashboard(false);
    }
  }

  if (!userData?.isTeamAdmin) {
    return (
      <div className="flex h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-xl bg-white rounded-xl shadow-md p-6">
            <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>Admin Panel</h1>
            <p className="text-gray-600">Only team admins can access this panel.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>Admin Panel</h1>
          <p className="text-gray-600 mb-8">Search Firestore IDs for scouting and practice session records.</p>

          <div className="bg-white rounded-xl shadow-md p-6 border mb-4">
            <h2 className="text-xl font-semibold mb-2">Default Dashboard</h2>
            <p className="text-sm text-gray-600 mb-3">Set where your Dashboard button sends you by default.</p>
            <select
              className="w-full max-w-md border rounded p-2"
              value={String(userData.preferredDashboard || "")}
              onChange={(event) => void savePreferredDashboard(event.target.value)}
              disabled={savingDashboard}
            >
              <option value="">Role-Based Default</option>
              {dashboardOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Link href="/admin/match-scout-ids" className="bg-white rounded-xl shadow-md p-6 border hover:bg-gray-50">
              <h2 className="text-xl font-semibold mb-2">Match Scout IDs</h2>
              <p className="text-sm text-gray-600">Search scouting document IDs for official match scouting rows.</p>
            </Link>
            <Link href="/admin/practice-session-ids" className="bg-white rounded-xl shadow-md p-6 border hover:bg-gray-50">
              <h2 className="text-xl font-semibold mb-2">Practice Session IDs</h2>
              <p className="text-sm text-gray-600">Search practice session document IDs for team members.</p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminPanelPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <AdminPanelContent />
    </ProtectedRoute>
  );
}


