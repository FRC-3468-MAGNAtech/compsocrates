"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, deleteDoc, doc, getDocs, query, where } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";

type TeamJoinRequest = {
  id: string;
  teamId: string;
  requestedRole?: "scout" | "coach";
  status: string;
  createdAt?: number;
};

async function fetchPendingRequestsForUser(userId: string): Promise<TeamJoinRequest[]> {
  if (!userId) return [];
  const byId = new Map<string, TeamJoinRequest>();

  const byUserIdQuery = query(collection(db, "teamJoinRequests"), where("userId", "==", userId));
  const byUserIdSnap = await getDocs(byUserIdQuery);
  byUserIdSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() as Record<string, unknown>;
    const request: TeamJoinRequest = {
      id: docSnap.id,
      teamId: String(data.teamId || ""),
      requestedRole: (data.requestedRole || data.userRole || data.role || "scout") as "scout" | "coach",
      status: String(data.status || ""),
      createdAt: typeof data.createdAt === "number" ? data.createdAt : undefined,
    };
    if (request.status === "pending") byId.set(request.id, request);
  });

  return Array.from(byId.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function createTeamJoinRequestWithFallback(input: {
  userId: string;
  userEmail: string;
  userName: string;
  requestedRole: "scout" | "coach";
  teamId: string;
}) {
  const createdAt = Date.now();
  const normalizedEmail = input.userEmail.trim().toLowerCase();
  const fullPayload = {
    userId: input.userId,
    userEmail: input.userEmail,
    userEmailLower: normalizedEmail,
    userName: input.userName,
    userRole: input.requestedRole,
    requestedRole: input.requestedRole,
    teamId: input.teamId,
    status: "pending",
    createdAt,
  };
  const fallbackPayloads: Array<Record<string, unknown>> = [
    fullPayload,
    {
      userId: input.userId,
      userEmail: input.userEmail,
      userEmailLower: normalizedEmail,
      userName: input.userName,
      requestedRole: input.requestedRole,
      teamId: input.teamId,
      status: "pending",
      createdAt,
    },
    {
      userId: input.userId,
      userName: input.userName,
      requestedRole: input.requestedRole,
      teamId: input.teamId,
      status: "pending",
      createdAt,
    },
    {
      userId: input.userId,
      role: input.requestedRole,
      teamId: input.teamId,
      status: "pending",
      createdAt,
    },
    {
      userId: input.userId,
      teamId: input.teamId,
      status: "pending",
      createdAt,
    },
  ];

  let lastError: unknown = null;
  for (const payload of fallbackPayloads) {
    try {
      await addDoc(collection(db, "teamJoinRequests"), payload);
      return;
    } catch (error) {
      lastError = error;
      const message = String((error as { message?: string })?.message || "").toLowerCase();
      const isPermissionLike =
        message.includes("permission") ||
        message.includes("insufficient") ||
        message.includes("missing or insufficient");
      if (!isPermissionLike) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Unable to create team join request.");
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
  const [cancelingRequestId, setCancelingRequestId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!user || !userData) return;
      if (userData.teamId) {
        router.push(getDashboardRoute(userData));
        return;
      }

      setLoading(true);
      try {
        setPendingRequests(await fetchPendingRequestsForUser(user.uid));
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
      const refreshedPending = await fetchPendingRequestsForUser(user.uid);
      setPendingRequests(refreshedPending);

      if (refreshedPending.some((request) => request.teamId.toLowerCase() === normalizedTeamCode.toLowerCase())) {
        setRequestError("You already have a pending request for that team.");
        return;
      }

      await createTeamJoinRequestWithFallback({
        userId: user.uid,
        userEmail: userData.email || user.email || "",
        userName: userData.displayName || user.displayName || "",
        requestedRole,
        teamId: normalizedTeamCode,
      });

      setPendingRequests(await fetchPendingRequestsForUser(user.uid));
      setTeamCode("");
      setRequestError("");
    } catch (error) {
      console.error("Error creating team request:", error);
      const message = error instanceof Error ? error.message : String(error || "");
      setRequestError(message ? `Unable to create request: ${message}` : "Unable to create request right now.");
    } finally {
      setSubmittingRequest(false);
    }
  }

  async function handleCancelRequest(requestId: string) {
    if (!user || !userData || cancelingRequestId) return;
    if (!window.confirm("Cancel this join request?")) return;

    setCancelingRequestId(requestId);
    setRequestError("");
    try {
      await deleteDoc(doc(db, "teamJoinRequests", requestId));
      setPendingRequests(await fetchPendingRequestsForUser(user.uid));
    } catch (error) {
      console.error("Error canceling request:", error);
      setRequestError("Unable to cancel this request right now.");
    } finally {
      setCancelingRequestId(null);
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
                <div key={request.id} className="border rounded p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">Team {request.teamId}</p>
                    <p className="text-sm text-gray-600">
                      Status: Pending ({request.requestedRole || "scout"})
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCancelRequest(request.id)}
                    disabled={cancelingRequestId === request.id}
                    className="px-3 py-1.5 rounded border border-red-200 text-red-700 text-sm font-semibold hover:bg-red-50 disabled:opacity-60"
                  >
                    {cancelingRequestId === request.id ? "Canceling..." : "Cancel"}
                  </button>
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
