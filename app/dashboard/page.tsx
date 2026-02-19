"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
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

async function fetchPendingRequestsByEmail(email: string): Promise<TeamJoinRequest[]> {
  if (!email) return [];
  const requestsQuery = query(collection(db, "teamJoinRequests"), where("userEmail", "==", email));
  const requestsSnap = await getDocs(requestsQuery);
  return requestsSnap.docs
    .map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }))
    .filter((request) => request.status === "pending") as TeamJoinRequest[];
}

async function resolveTeamCode(code: string): Promise<string | null> {
  const normalized = code.trim();
  if (!normalized) return null;
  const attempts = [normalized, normalized.toUpperCase(), normalized.toLowerCase()];
  for (const attempt of attempts) {
    const teamDoc = await getDoc(doc(db, "teams", attempt));
    if (teamDoc.exists()) return attempt;
  }
  return null;
}

function NoTeamDashboardContent() {
  const router = useRouter();
  const { user, userData, logOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [pendingRequests, setPendingRequests] = useState<TeamJoinRequest[]>([]);
  const [teamCode, setTeamCode] = useState("");
  const [requestedRole, setRequestedRole] = useState<"scout" | "coach">("scout");
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [requestError, setRequestError] = useState("");

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
        setPendingRequests(await fetchPendingRequestsByEmail(email));
      } catch (error) {
        console.error("Error loading pending requests:", error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, userData, router]);

  async function handleCreateRequest(event: React.FormEvent) {
    event.preventDefault();
    if (!user || !userData) return;

    setRequestError("");
    const normalizedTeamCode = teamCode.trim();
    if (!normalizedTeamCode) {
      setRequestError("Please enter a team code.");
      return;
    }

    if (pendingRequests.some((request) => request.teamId.toLowerCase() === normalizedTeamCode.toLowerCase())) {
      setRequestError("You already have a pending request for that team.");
      return;
    }

    setSubmittingRequest(true);
    try {
      const resolvedTeamCode = await resolveTeamCode(normalizedTeamCode);
      if (!resolvedTeamCode) {
        setRequestError("Team not found. Please check the team code.");
        return;
      }

      await addDoc(collection(db, "teamJoinRequests"), {
        userId: user.uid,
        userEmail: userData.email || user.email || "",
        userName: userData.displayName || user.displayName || "",
        userRole: requestedRole,
        teamId: resolvedTeamCode,
        status: "pending",
        createdAt: Date.now(),
      });

      setPendingRequests(await fetchPendingRequestsByEmail(userData.email || user.email || ""));
      setTeamCode("");
      setRequestError("");
    } catch (error) {
      console.error("Error creating team request:", error);
      setRequestError("Unable to create request right now.");
    } finally {
      setSubmittingRequest(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-xl shadow p-8">
        <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
          Dashboard
        </h1>
        <p className="text-gray-600 mb-6">
          Your account is active, but you are not on a team yet.
        </p>

        <form onSubmit={handleCreateRequest} className="mb-6 border rounded p-4 bg-gray-50 space-y-3">
          <h2 className="text-lg font-semibold">Request To Join A Team</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Team Code</label>
            <input
              value={teamCode}
              onChange={(event) => setTeamCode(event.target.value)}
              className="w-full border rounded p-2"
              placeholder="Enter team code"
              disabled={submittingRequest}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={requestedRole}
              onChange={(event) => setRequestedRole(event.target.value as "scout" | "coach")}
              className="w-full border rounded p-2"
              disabled={submittingRequest}
            >
              <option value="scout">Scout</option>
              <option value="coach">Coach</option>
            </select>
          </div>
          {requestError && <p className="text-sm text-red-600">{requestError}</p>}
          <button
            type="submit"
            disabled={submittingRequest}
            className="px-4 py-2 rounded text-white font-semibold disabled:opacity-60"
            style={{ backgroundColor: "#c42221" }}
          >
            {submittingRequest ? "Submitting..." : "Send Request"}
          </button>
        </form>

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
