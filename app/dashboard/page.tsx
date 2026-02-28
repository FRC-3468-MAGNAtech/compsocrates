"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { addDoc, collection, doc, getDoc, getDocs, limit, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";
import { TEAM_ROLES, TeamRole, getRoleLabel, normalizeLegacyRole } from "@/app/utils/roles";

type TeamJoinRequest = {
  id: string;
  teamId: string;
  teamDisplayLabel?: string;
  requestedRole?: TeamRole;
  status: string;
  createdAt?: number;
};

function fallbackTeamLabel(teamCode: string): string {
  const raw = String(teamCode || "").trim().toUpperCase();
  return `Team ${raw}`;
}

function formatTeamLabelFromNameOrCode(teamName: string, teamCode: string): string {
  const trimmedName = String(teamName || "").trim();
  if (trimmedName) {
    const parsed = Number(trimmedName);
    if (Number.isFinite(parsed) && parsed > 0) return `Team ${parsed}`;
    return trimmedName;
  }
  return fallbackTeamLabel(teamCode);
}

function isFallbackCodeLabel(label: string, teamCode: string): boolean {
  return String(label || "").trim().toLowerCase() === fallbackTeamLabel(teamCode).toLowerCase();
}

function readFirestoreRestStringField(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const row = value as { stringValue?: string; integerValue?: string; doubleValue?: number };
  if (typeof row.stringValue === "string") return row.stringValue;
  if (typeof row.integerValue === "string") return row.integerValue;
  if (typeof row.doubleValue === "number") return String(row.doubleValue);
  return "";
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
        teamDisplayLabel: (() => {
          const teamId = String(row.teamId || "");
          const raw = String(row.teamDisplayLabel || "").trim();
          return raw && !isFallbackCodeLabel(raw, teamId) ? raw : undefined;
        })(),
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
    teamDisplayLabel: row.teamDisplayLabel || "",
    requestedRole: row.requestedRole || "match-scout",
    createdAt: row.createdAt || Date.now(),
  }));
  localStorage.setItem(LOCAL_PENDING_CACHE_KEY, JSON.stringify(safe));
}

function updateCachedTeamLabel(teamCode: string, label: string) {
  const normalized = String(teamCode || "").trim().toUpperCase();
  if (!normalized || !label) return;
  const rows = readLocalPendingCache();
  if (rows.length === 0) return;
  const next = rows.map((row) =>
    String(row.teamId || "").trim().toUpperCase() === normalized
      ? { ...row, teamDisplayLabel: label }
      : row
  );
  writeLocalPendingCache(next);
}

async function lookupTeamMeta(
  teamCode: string,
  idToken?: string
): Promise<{ label: string; exists: boolean; verified: boolean } | null> {
  const normalizedCode = String(teamCode || "").trim().toUpperCase();
  if (!normalizedCode) return null;
  try {
    const response = await fetch(`/api/team-label?teamCode=${encodeURIComponent(normalizedCode)}`, {
      cache: "no-store",
      headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { label?: string; exists?: boolean; verified?: boolean };
    return {
      label: String(payload.label || `Team ${normalizedCode}`).trim(),
      exists: Boolean(payload.exists),
      verified: Boolean(payload.verified),
    };
  } catch {
    return null;
  }
}

async function fetchPendingRequestsForUser(userId: string): Promise<TeamJoinRequest[]> {
  if (!userId) return [];
  const byId = new Map<string, TeamJoinRequest>();

  const byUserIdQuery = query(collection(db, "teamJoinRequests"), where("userId", "==", userId));
  const byUserIdSnap = await getDocs(byUserIdQuery);
  byUserIdSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() as Record<string, unknown>;
    const teamId = String(data.teamId || "");
    const rawDisplay = String(data.teamDisplayLabel || data.teamName || "").trim();
    const request: TeamJoinRequest = {
      id: docSnap.id,
      teamId,
      teamDisplayLabel: rawDisplay && !isFallbackCodeLabel(rawDisplay, teamId) ? rawDisplay : undefined,
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
  teamDisplayLabel?: string;
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
    ...(input.teamDisplayLabel ? { teamDisplayLabel: input.teamDisplayLabel } : {}),
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
      ...(input.teamDisplayLabel ? { teamDisplayLabel: input.teamDisplayLabel } : {}),
      status: "pending",
      createdAt,
    },
    {
      userId: input.userId,
      userName: input.userName,
      requestedRole: input.requestedRole,
      teamId: input.teamId,
      ...(input.teamDisplayLabel ? { teamDisplayLabel: input.teamDisplayLabel } : {}),
      status: "pending",
      createdAt,
    },
    {
      userId: input.userId,
      role: input.requestedRole,
      teamId: input.teamId,
      ...(input.teamDisplayLabel ? { teamDisplayLabel: input.teamDisplayLabel } : {}),
      status: "pending",
      createdAt,
    },
    {
      userId: input.userId,
      teamId: input.teamId,
      ...(input.teamDisplayLabel ? { teamDisplayLabel: input.teamDisplayLabel } : {}),
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
  const [teamLabelByCode, setTeamLabelByCode] = useState<Record<string, string>>({});
  const duplicatePendingText = "you already asked to join that team and your request is still pending.";

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
        teamDisplayLabel:
          teamLabelByCode[normalizedTeamId] && !isFallbackCodeLabel(teamLabelByCode[normalizedTeamId], normalizedTeamId)
            ? teamLabelByCode[normalizedTeamId]
            : undefined,
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
    if (!user || typeof window === "undefined") return;
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
    const teamExists = await ensureTeamExists(teamId);
    if (teamExists === "missing") {
      localStorage.removeItem("pending-join-request");
      setRequestSuccess("");
      setRequestError(`Team code "${teamId}" does not exist. Please check the code and try again.`);
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
      setRequestSuccess(`Join request already pending for ${teamLabelByCode[teamId] || fallbackTeamLabel(teamId)}.`);
      return;
    }

    try {
      const resolvedTeamLabel = await resolveTeamLabel(teamId);
      await createTeamJoinRequestWithFallback({
        userId: user.uid,
        userEmail: String(draft?.userEmail || userData?.email || user.email || ""),
        userName: String(draft?.userName || userData?.displayName || user.displayName || ""),
        requestedRole,
        teamId,
        teamDisplayLabel: !isFallbackCodeLabel(resolvedTeamLabel, teamId) ? resolvedTeamLabel : undefined,
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
      setRequestSuccess(`Join request submitted for ${teamLabelByCode[teamId] || fallbackTeamLabel(teamId)}. It is now pending approval.`);
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

  async function refreshPendingRequests(userId: string): Promise<TeamJoinRequest[]> {
    const fetched = await fetchPendingRequestsForUser(userId);
    // Firestore is source of truth. If empty, clear stale local pending cache.
    setPendingRequests(fetched);
    writeLocalPendingCache(fetched);
    return fetched;
  }

  async function resolveTeamLabel(teamCode: string): Promise<string> {
    const normalizedCode = String(teamCode || "").trim().toUpperCase();
    if (!normalizedCode) return fallbackTeamLabel(teamCode);
    if (teamLabelByCode[normalizedCode]) return teamLabelByCode[normalizedCode];
    const userToken = user ? await user.getIdToken().catch(() => "") : "";
    const meta = await lookupTeamMeta(normalizedCode, userToken);
    if (meta?.label) {
      setTeamLabelByCode((prev) => ({ ...prev, [normalizedCode]: meta.label }));
      updateCachedTeamLabel(normalizedCode, meta.label);
      return meta.label;
    }
    try {
      const response = await fetch(`/api/team-label?teamCode=${encodeURIComponent(normalizedCode)}`, { cache: "no-store" });
      if (response.ok) {
        const payload = (await response.json()) as { label?: string };
        const label = String(payload.label || "").trim();
        if (label) {
          setTeamLabelByCode((prev) => ({ ...prev, [normalizedCode]: label }));
          updateCachedTeamLabel(normalizedCode, label);
          return label;
        }
      }
    } catch {
      // Fall through to client-side reads.
    }
    try {
      const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
      const apiKey = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "").trim();
      if (projectId && apiKey) {
        const docUrl =
          `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/teams/${encodeURIComponent(normalizedCode)}` +
          `?key=${encodeURIComponent(apiKey)}`;
        const docResponse = await fetch(docUrl, { cache: "no-store" });
        if (docResponse.ok) {
          const payload = (await docResponse.json()) as { fields?: Record<string, unknown> };
          const fields = payload.fields || {};
          const label = formatTeamLabelFromNameOrCode(
            readFirestoreRestStringField(fields.teamName) || readFirestoreRestStringField(fields.teamNumber),
            normalizedCode
          );
          setTeamLabelByCode((prev) => ({ ...prev, [normalizedCode]: label }));
          updateCachedTeamLabel(normalizedCode, label);
          return label;
        }
      }
    } catch {
      // Fall through to SDK reads.
    }
    try {
      const teamDoc = await getDoc(doc(db, "teams", normalizedCode));
      if (teamDoc.exists()) {
        const data = teamDoc.data() as { teamNumber?: string | number; teamName?: string };
        const teamNameRaw = String(data.teamName || "").trim();
        const teamNumberRaw = String(data.teamNumber || "").trim();
        const label = formatTeamLabelFromNameOrCode(teamNameRaw || teamNumberRaw, normalizedCode);
        setTeamLabelByCode((prev) => ({ ...prev, [normalizedCode]: label }));
        updateCachedTeamLabel(normalizedCode, label);
        return label;
      }
    } catch {
      // Ignore and fall back to team code.
    }
    try {
      const byFieldQuery = query(collection(db, "teams"), where("teamId", "==", normalizedCode), limit(1));
      const byFieldSnap = await getDocs(byFieldQuery);
      if (!byFieldSnap.empty) {
        const data = byFieldSnap.docs[0].data() as { teamNumber?: string | number; teamName?: string };
        const teamNameRaw = String(data.teamName || "").trim();
        const teamNumberRaw = String(data.teamNumber || "").trim();
        const label = formatTeamLabelFromNameOrCode(teamNameRaw || teamNumberRaw, normalizedCode);
        setTeamLabelByCode((prev) => ({ ...prev, [normalizedCode]: label }));
        updateCachedTeamLabel(normalizedCode, label);
        return label;
      }
    } catch {
      // Ignore and fall back to team code.
    }
    return fallbackTeamLabel(normalizedCode);
  }

  async function ensureTeamExists(teamCode: string): Promise<"exists" | "missing" | "unknown"> {
    const normalizedCode = String(teamCode || "").trim().toUpperCase();
    if (!normalizedCode) return "missing";
    const userToken = user ? await user.getIdToken().catch(() => "") : "";
    const meta = await lookupTeamMeta(normalizedCode, userToken);
    if (meta) {
      if (meta.label) {
        setTeamLabelByCode((prev) => ({ ...prev, [normalizedCode]: meta.label }));
        updateCachedTeamLabel(normalizedCode, meta.label);
      }
      if (!meta.verified) return "unknown";
      return meta.exists ? "exists" : "missing";
    }
    try {
      const directDoc = await getDoc(doc(db, "teams", normalizedCode));
      if (directDoc.exists()) return "exists";
    } catch {
      // Ignore; continue fallback.
    }
    try {
      const byFieldQuery = query(collection(db, "teams"), where("teamId", "==", normalizedCode), limit(1));
      const byFieldSnap = await getDocs(byFieldQuery);
      if (!byFieldSnap.empty) return "exists";
    } catch {
      // Ignore.
    }
    return "unknown";
  }

  async function warmTeamLabels(requests: TeamJoinRequest[]) {
    setTeamLabelByCode((prev) => {
      const merged = { ...prev };
      for (const row of requests) {
        const code = String(row.teamId || "").trim().toUpperCase();
        const fromRequest = String(row.teamDisplayLabel || "").trim();
        if (!code || !fromRequest) continue;
        merged[code] = formatTeamLabelFromNameOrCode(fromRequest, code);
      }
      return merged;
    });
    const codes = Array.from(new Set(requests.map((row) => String(row.teamId || "").trim().toUpperCase()).filter(Boolean)));
    await Promise.all(codes.map((code) => resolveTeamLabel(code)));
  }

  useEffect(() => {
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }
      if (userData?.teamId) {
        router.push(getDashboardRoute(userData));
        return;
      }

      setLoading(true);
      try {
        const rows = await refreshPendingRequests(user.uid);
        await warmTeamLabels(rows);
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
    if (!user || userData?.teamId) return;
    const requestsQuery = query(collection(db, "teamJoinRequests"), where("userId", "==", user.uid));
    const unsubscribe = onSnapshot(
      requestsQuery,
      (snapshot) => {
        const rows: TeamJoinRequest[] = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data() as Record<string, unknown>;
            return {
              id: docSnap.id,
              teamId: String(data.teamId || ""),
              teamDisplayLabel: (() => {
                const teamId = String(data.teamId || "");
                const raw = String(data.teamDisplayLabel || data.teamName || "").trim();
                return raw && !isFallbackCodeLabel(raw, teamId) ? raw : undefined;
              })(),
              requestedRole: normalizeLegacyRole(String(data.requestedRole || data.userRole || data.role || "match-scout")),
              status: String(data.status || ""),
              createdAt: typeof data.createdAt === "number" ? data.createdAt : undefined,
            };
          })
          .filter((row) => row.status === "pending" && row.teamId)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setPendingRequests(rows);
        writeLocalPendingCache(rows);
        if (rows.length > 0) {
          void warmTeamLabels(rows);
        }
      },
      () => {
        // Ignore listener errors and keep existing fallback state.
      }
    );
    return () => unsubscribe();
  }, [user, userData]);

  useEffect(() => {
    const requestSubmitted = searchParams.get("requestSubmitted") === "1";
    if (!requestSubmitted) return;
    const team = String(searchParams.get("team") || "").trim().toUpperCase();
    if (team) {
      void resolveTeamLabel(team).then((label) => {
        setRequestSuccess(`Join request submitted for ${label}. It is now pending approval.`);
      });
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
    const teamExists = await ensureTeamExists(normalizedTeamCode);
    if (teamExists === "missing") {
      setRequestError(`Team code "${normalizedTeamCode}" does not exist. Please check the code and try again.`);
      setRequestSuccess("");
      return;
    }
    setSubmittingRequest(true);
    if (pendingRequests.some((request) => request.teamId.toLowerCase() === normalizedTeamCode.toLowerCase())) {
      ensurePendingVisible(normalizedTeamCode, requestedRole);
      setRequestError("");
      const teamLabel = await resolveTeamLabel(normalizedTeamCode);
      setRequestSuccess(`Join request already pending for ${teamLabel}.`);
      setSubmittingRequest(false);
      return;
    }
    try {
      const refreshedPending = await refreshPendingRequests(user.uid);

      if (refreshedPending.some((request) => request.teamId.toLowerCase() === normalizedTeamCode.toLowerCase())) {
        ensurePendingVisible(normalizedTeamCode, requestedRole);
        setRequestError("");
        const teamLabel = await resolveTeamLabel(normalizedTeamCode);
        setRequestSuccess(`Join request already pending for ${teamLabel}.`);
        return;
      }

      const resolvedTeamLabel = await resolveTeamLabel(normalizedTeamCode);
      await createTeamJoinRequestWithFallback({
        userId: user.uid,
        userEmail: userData?.email || user.email || "",
        userName: userData?.displayName || user.displayName || "",
        requestedRole,
        teamId: normalizedTeamCode,
        teamDisplayLabel: !isFallbackCodeLabel(resolvedTeamLabel, normalizedTeamCode) ? resolvedTeamLabel : undefined,
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
      const teamLabel = await resolveTeamLabel(normalizedTeamCode);
      setRequestSuccess(`Join request submitted for ${teamLabel}. It is now pending approval.`);
    } catch (error) {
      console.error("Error creating team request:", error);
      const message = error instanceof Error ? error.message : String(error || "");
      setRequestError(message ? `Unable to create request: ${message}` : "Unable to create request right now.");
      setRequestSuccess("");
    } finally {
      setSubmittingRequest(false);
    }
  }

  async function handleCancelRequest(requestId: string) {
    if (!user || cancelingRequestId) {
      if (!user) {
        setRequestError("Still loading your account. Try canceling again in a moment.");
      }
      return;
    }
    if (!window.confirm("Cancel this join request?")) return;

    setCancelingRequestId(requestId);
    setRequestError("");
    setRequestSuccess("");
    try {
      if (requestId.startsWith("local-")) {
        const next = pendingRequests.filter((request) => request.id !== requestId);
        setPendingRequests(next);
        writeLocalPendingCache(next);
        setRequestSuccess("Join request canceled.");
        return;
      }
      const idToken = await user.getIdToken();
      const response = await fetch("/api/team-join-requests/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ requestId }),
      });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          const message = String(payload.error || "");
          const lower = message.toLowerCase();
          const canTryClientUpdate =
            lower.includes("server firebase auth is not configured") ||
            lower.includes("unable to cancel request");
          if (canTryClientUpdate) {
            await updateDoc(doc(db, "teamJoinRequests", requestId), {
              status: "denied",
              canceledByUser: true,
              processedAt: Date.now(),
              processedBy: user.uid,
            });
          } else {
            throw new Error(message || "Unable to cancel request.");
          }
        }
      await refreshPendingRequests(user.uid);
      setRequestSuccess("Join request canceled.");
    } catch (error) {
      console.error("Error canceling request:", error);
      const message = error instanceof Error ? error.message : String(error || "");
      setRequestError(message ? `Unable to cancel this request: ${message}` : "Unable to cancel this request right now.");
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
                    <p className="font-medium">
                      {formatTeamLabelFromNameOrCode(
                        (() => {
                          const raw = String(request.teamDisplayLabel || "").trim();
                          return raw && !isFallbackCodeLabel(raw, request.teamId) ? raw : "";
                        })() ||
                          teamLabelByCode[String(request.teamId || "").trim().toUpperCase()] ||
                          "",
                        request.teamId
                      )}
                    </p>
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
              {requestSuccess.toLowerCase().includes("pending") ||
              requestError.toLowerCase().includes(duplicatePendingText) ||
              submittingRequest
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

