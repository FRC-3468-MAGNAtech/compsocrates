"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, where } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";

type TeamJoinRequest = {
  id: string;
  teamId: string;
  status: string;
  createdAt?: number;
};

function NoTeamDashboardContent() {
  const router = useRouter();
  const { user, userData, logOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [pendingRequests, setPendingRequests] = useState<TeamJoinRequest[]>([]);

  useEffect(() => {
    async function load() {
      if (!user || !userData) return;
      if (userData.teamId) {
        router.push(getDashboardRoute(userData));
        return;
      }

      setLoading(true);
      try {
        const email = userData.email || user.email || "";
        if (!email) {
          setPendingRequests([]);
          return;
        }
        const requestsQuery = query(
          collection(db, "teamJoinRequests"),
          where("userEmail", "==", email),
          where("status", "==", "pending")
        );
        const requestsSnap = await getDocs(requestsQuery);
        setPendingRequests(
          requestsSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          })) as TeamJoinRequest[]
        );
      } catch (error) {
        console.error("Error loading pending requests:", error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, userData, router]);

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-xl shadow p-8">
        <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
          Dashboard
        </h1>
        <p className="text-gray-600 mb-6">
          Your account is active, but you are not on a team yet.
        </p>

        {loading ? (
          <p className="text-gray-500">Loading pending requests...</p>
        ) : pendingRequests.length > 0 ? (
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-3">Pending Requests</h2>
            <div className="space-y-2">
              {pendingRequests.map((request) => (
                <div key={request.id} className="border rounded p-3">
                  <p className="font-medium">Team {request.teamId}</p>
                  <p className="text-sm text-gray-600">Status: Pending</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-6 border rounded p-4 bg-gray-50">
            <p className="text-gray-700">No pending team requests found.</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => router.push("/account")}
            className="px-4 py-2 rounded text-white font-semibold"
            style={{ backgroundColor: "#c42221" }}
          >
            Go to Account
          </button>
          <button
            onClick={async () => {
              await logOut();
              router.push("/login");
            }}
            className="px-4 py-2 rounded border border-gray-300"
          >
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NoTeamDashboardPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <NoTeamDashboardContent />
    </ProtectedRoute>
  );
}
