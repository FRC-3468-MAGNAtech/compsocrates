"use client";

import Link from "next/link";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";

function AdminPanelContent() {
  const { userData } = useAuth();

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


