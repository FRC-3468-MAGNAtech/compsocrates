"use client";

import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { useRouter } from "next/navigation";

function DashboardSelectorContent() {
  const { userData } = useAuth();
  const router = useRouter();

  const options = [
    { label: "Match Scout", href: "/match-scout-dashboard" },
    { label: "Pit Scout", href: "/pit-scout-dashboard" },
    { label: "Pit Team", href: "/pit-team-dashboard" },
    { label: "Drive Team", href: "/drive-team-dashboard" },
    { label: "Lead Scout", href: "/lead-scout-dashboard" },
    { label: "Lead Strategist", href: "/lead-strategist-dashboard" },
    { label: "Team Coach", href: "/coach-dashboard" },
  ];

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-8">
        <h1 className="text-3xl font-bold mb-2 theme-text">Dashboard Selector</h1>
        <p className="text-gray-600 mb-6">Team admins can jump to any role dashboard.</p>
        {!userData?.isTeamAdmin ? (
          <div className="bg-white rounded-xl shadow-md p-6 text-sm text-gray-700">Only team admins can use this page.</div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {options.map((option) => (
              <button
                key={option.href}
                onClick={() => router.push(option.href)}
                className="bg-white rounded-xl shadow-md p-5 text-left hover:bg-gray-50 border border-gray-200"
              >
                <p className="font-semibold">{option.label}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardSelectorPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <DashboardSelectorContent />
    </ProtectedRoute>
  );
}

