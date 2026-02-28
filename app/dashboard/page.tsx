"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { addDoc, collection, deleteDoc, doc, getDocs, query, where } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";
import { TEAM_ROLES, TeamRole, getRoleLabel, normalizeLegacyRole } from "@/app/utils/roles";

type TeamJoinRequest = {
  id: string;
  teamId: string;
  requestedRole?: TeamRole;
  status: string;
  createdAt?: number;
};

function formatTeamLabelFromCode(teamCode: string): string {
  const raw = String(teamCode || "").trim().toUpperCase();
  const numericChunk = raw.match(/\d+/)?.[0] || "";
  const parsed = Number(numericChunk);
  if (Number.isFinite(parsed) && parsed > 0) return `Team ${parsed}`;
  return `Team ${raw}`;
}

const LOCAL_PENDING_CACHE_KEY = "pending-join-request-cache";

function readLocalPendingCache(): TeamJoinRequest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_PENDING_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    return parsed
      .map((row) => ({
        id: String(row.id || ""),
        teamId: String(row.teamId || ""),
        requestedRole: normalizeLegacyRole(String(row.requestedRole || "match-scout")),
        status: "pending",
        createdAt: Number(row.createdAt || Date.now()),
      }))
      .filter((row) => row.id && row.teamId);
  } catch {
    return [];
  }
}

function writeLocalPendingCache(rows: TeamJoinRequest[]) {
  if (typeof window === "undefined") return;
  const safe = rows.map((row) => ({
    id: row.id,
    teamId: row.teamId,
    requestedRole: row.requestedRole || "match-scout",
    createdAt: row.createdAt || Date.now(),
  }));
  localStorage.setItem(LOCAL_PENDING_CACHE_KEY, JSON.stringify(safe));
}

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
      requestedRole: normalizeLegacyRole(String(data.requestedRole || data.userRole || data.role || "match-scout")),
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
  requestedRole: TeamRole;
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
  const searchParams = useSearchParams();
  const { user, userData, logOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [pendingRequests, setPendingRequests] = useState<TeamJoinRequest[]>([]);
  const [teamCode, setTeamCode] = useState("");
  const [requestedRole, setRequestedRole] = useState<TeamRole>("match-scout");
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [requestSuccess, setRequestSuccess] = useState("");
  const [cancelingRequestId, setCancelingRequestId] = useState<string | null>(null);

  function ensurePendingVisible(teamId: string, role: TeamRole) {
    const normalizedTeamId = teamId.trim().toUpperCase();
    setPendingRequests((prev) => {
      const existing = prev.find((row) => row.teamId.toLowerCase() === normalizedTeamId.toLowerCase());
      if (existing) {
        writeLocalPendingCache(prev);
        return prev;
      }
      const next: TeamJoinRequest = {
        id: `local-${normalizedTeamId}-${Date.now()}`,
        teamId: normalizedTeamId,
        requestedRole: role,
        status: "pending",
        createdAt: Date.now(),
      };
      const merged = [next, ...prev];
      writeLocalPendingCache(merged);
      return merged;
    });
  }

  async function autoSendJoinDraftIfPresent() {
    if (!user || !userData || typeof window === "undefined") return;
    const raw = localStorage.getItem("pending-join-request");
    if (!raw) return;
    let draft: { teamId?: string; requestedRole?: TeamRole; userEmail?: string; userName?: string } | null = null;
    try {
      draft = JSON.parse(raw) as { teamId?: string; requestedRole?: TeamRole; userEmail?: string; userName?: string };
    } catch {
      localStorage.removeItem("pending-join-request");
      return;
    }
    const teamId = String(draft?.teamId || "").trim().toUpperCase();
    const requestedRole = normalizeLegacyRole(String(draft?.requestedRole || "match-scout"));
    if (!teamId) {
      localStorage.removeItem("pending-join-request");
      return;
    }

    const alreadyPending = await fetchPendingRequestsForUser(user.uid);
    if (alreadyPending.some((request) => request.teamId.toLowerCase() === teamId.toLowerCase())) {
      localStorage.removeItem("pending-join-request");
      if (alreadyPending.length > 0) {
        setPendingRequests(alreadyPending);
        writeLocalPendingCache(alreadyPending);
      } else {
        ensurePendingVisible(teamId, requestedRole);
      }
      setRequestSuccess(`Join request already pending for ${formatTeamLabelFromCode(teamId)}.`);
      return;
    }

    try {
      await createTeamJoinRequestWithFallback({
        userId: user.uid,
        userEmail: String(draft?.userEmail || userData.email || user.email || ""),
        userName: String(draft?.userName || userData.displayName || user.displayName || ""),
        requestedRole,
        teamId,
      });
      localStorage.removeItem("pending-join-request");
      const refreshed = await fetchPendingRequestsForUser(user.uid);
      if (refreshed.length > 0) {
        setPendingRequests(refreshed);
        writeLocalPendingCache(refreshed);
      } else {
        ensurePendingVisible(teamId, requestedRole);
      }
      setRequestError("");
      setRequestSuccess(`Join request submitted for ${formatTeamLabelFromCode(teamId)}. It is now pending approval.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "");
      setRequestSuccess("");
      setRequestError(
        message
          ? `Auto-send failed for Team ${teamId}: ${message}. You can tap Send Request manually.`
          : `Auto-send failed for Team ${teamId}. You can tap Send Request manually.`
      );
    }
  }

  useEffect(() => {
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }
      if (!userData) {
        setLoading(false);
        return;
      }
      if (userData.teamId) {
        router.push(getDashboardRoute(userData));
        return;
      }

      setLoading(true);
      try {
        const fetched = await fetchPendingRequestsForUser(user.uid);
        if (fetched.length > 0) {
          setPendingRequests(fetched);
          writeLocalPendingCache(fetched);
        } else {
          setPendingRequests(readLocalPendingCache());
        }
      } catch (error) {
        console.error("Error loading pending requests:", error);
        setPendingRequests(readLocalPendingCache());
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, userData, router]);

  useEffect(() => {
    const requestSubmitted = searchParams.get("requestSubmitted") === "1";
    if (!requestSubmitted) return;
    const team = String(searchParams.get("team") || "").trim().toUpperCase();
    if (team) {
      setRequestSuccess(`Join request submitted for ${formatTeamLabelFromCode(team)}. It is now pending approval.`);
    } else {
      setRequestSuccess("Join request submitted. It is now pending approval.");
    }
  }, [searchParams]);

  useEffect(() => {
    void autoSendJoinDraftIfPresent();
  }, [searchParams, user?.uid, userData?.uid]);

  async function handleCreateRequest(event: React.FormEvent) {
    event.preventDefault();
    if (!user) {
      setRequestError("Still loading your account. Try again in a moment.");
      setRequestSuccess("");
      return;
    }

    setRequestError("");
    setRequestSuccess("");
    const normalizedTeamCode = teamCode.trim().toUpperCase();
    if (!normalizedTeamCode) {
      setRequestError("Please enter a team code.");
      return;
    }
    setSubmittingRequest(true);
    if (pendingRequests.some((request) => request.teamId.toLowerCase() === normalizedTeamCode.toLowerCase())) {
      const duplicateMessage = "You already asked to join that team and your request is still pending.";
      ensurePendingVisible(normalizedTeamCode, requestedRole);
      setRequestError(duplicateMessage);
      window.alert(duplicateMessage);
      setSubmittingRequest(false);
      return;
    }
    try {
      const refreshedPending = await fetchPendingRequestsForUser(user.uid);
      if (refreshedPending.length > 0) {
        setPendingRequests(refreshedPending);
        writeLocalPendingCache(refreshedPending);
      }

      if (refreshedPending.some((request) => request.teamId.toLowerCase() === normalizedTeamCode.toLowerCase())) {
        const duplicateMessage = "You already asked to join that team and your request is still pending.";
        ensurePendingVisible(normalizedTeamCode, requestedRole);
        setRequestError(duplicateMessage);
        window.alert(duplicateMessage);
        return;
      }

      await createTeamJoinRequestWithFallback({
        userId: user.uid,
        userEmail: userData?.email || user.email || "",
        userName: userData?.displayName || user.displayName || "",
        requestedRole,
        teamId: normalizedTeamCode,
      });

      const refreshedAfterCreate = await fetchPendingRequestsForUser(user.uid);
      if (refreshedAfterCreate.length > 0) {
        setPendingRequests(refreshedAfterCreate);
        writeLocalPendingCache(refreshedAfterCreate);
      } else {
        ensurePendingVisible(normalizedTeamCode, requestedRole);
      }
      setTeamCode("");
      setRequestError("");
      setRequestSuccess(`Join request submitted for ${formatTeamLabelFromCode(normalizedTeamCode)}. It is now pending approval.`);
      window.alert(`Join request submitted for ${formatTeamLabelFromCode(normalizedTeamCode)}.`);
    } catch (error) {
      console.error("Error creating team request:", error);
      const message = error instanceof Error ? error.message : String(error || "");
      setRequestError(message ? `Unable to create request: ${message}` : "Unable to create request right now.");
      setRequestSuccess("");
      window.alert(message ? `Unable to create request: ${message}` : "Unable to create request right now.");
    } finally {
      setSubmittingRequest(false);
    }
  }

  async function handleCancelRequest(requestId: string) {
    if (!user || !userData || cancelingRequestId) return;
    if (!window.confirm("Cancel this join request?")) return;

    setCancelingRequestId(requestId);
    setRequestError("");
    setRequestSuccess("");
    try {
      if (requestId.startsWith("local-")) {
        const next = pendingRequests.filter((request) => request.id !== requestId);
        setPendingRequests(next);
        writeLocalPendingCache(next);
        return;
      }
      await deleteDoc(doc(db, "teamJoinRequests", requestId));
      const refreshed = await fetchPendingRequestsForUser(user.uid);
      setPendingRequests(refreshed);
      writeLocalPendingCache(refreshed);
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
        <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
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
              onChange={(event) => setTeamCode(event.target.value.toUpperCase())}
              className="w-full border rounded p-2"
              placeholder="Enter team code"
              autoCapitalize="characters"
              disabled={submittingRequest}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={requestedRole}
              onChange={(event) => setRequestedRole(event.target.value as TeamRole)}
              className="w-full border rounded p-2"
              disabled={submittingRequest}
            >
              {TEAM_ROLES.map((role) => (
                <option key={role} value={role}>
                  {getRoleLabel(role)}
                </option>
              ))}
            </select>
          </div>
          {requestError && <p className="text-sm text-red-600">{requestError}</p>}
          {requestSuccess && <p className="text-sm text-green-700">{requestSuccess}</p>}
          <button
            type="submit"
            disabled={submittingRequest || !user}
            className="px-4 py-2 rounded text-white font-semibold disabled:opacity-60"
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            {submittingRequest ? "Sending..." : "Send Request"}
          </button>
        </form>

        {loading ? (
          <p className="text-gray-500">Loading pending requests...</p>
        ) : pendingRequests.length > 0 ? (
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-3">Pending Requests</h2>
            <p className="text-sm text-gray-600 mb-3">Your join request was sent successfully and is waiting for a team admin to approve it.</p>
            <div className="space-y-2">
              {pendingRequests.map((request) => (
                <div key={request.id} className="border rounded p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{formatTeamLabelFromCode(request.teamId)}</p>
                    <p className="text-sm text-gray-600">
                      Status: Pending ({getRoleLabel(request.requestedRole || "match-scout")})
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
            <p className="text-gray-700">
              {requestSuccess.toLowerCase().includes("pending")
                ? "Refreshing pending requests..."
                : "No pending team requests found."}
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => router.push("/account")}
            className="px-4 py-2 rounded text-white font-semibold"
            style={{ backgroundColor: "var(--primary-color)" }}
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

