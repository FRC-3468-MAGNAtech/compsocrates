"use client";

import { useState, useEffect } from "react";
import { collection, query, where, getDocs, updateDoc, setDoc, doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import RoleSelector from "@/app/components/RoleSelector";
import { useAuth } from "@/app/AuthContext";
import { X, Check, Clock } from "lucide-react";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { getTeamName } from "@/app/utils/stats-calculator";
import { updateSecureUserDoc } from "@/app/utils/secureUserDoc";
import { deriveJoinRequestName } from "@/app/utils/joinRequestDisplay";
import {
  FormAccessOverrides,
  FormKey,
  FORM_LABELS,
  FORM_ROLE_REQUIREMENT,
  TeamRole,
  getRoleBadge,
  getRoleLabel,
  normalizeFormAccessOverrides,
  normalizeLegacyRole,
  sanitizeRoles,
} from "@/app/utils/roles";

interface TeamMember {
  uid: string;
  displayName: string;
  email: string;
  role: string;
  roles?: string[];
  isTeamAdmin: boolean;
  teamId: string;
  experiencedScout?: boolean;
}

interface JoinRequest {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  userRole: string;
  requestedRole?: string;
  teamId: string;
  status: string;
  createdAt: number;
}

type UserLookupRow = {
  displayName?: string;
  email?: string;
};

function TeamManagementContent() {
  const { userData, user } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamName, setTeamName] = useState("");
  const [showRoleSelector, setShowRoleSelector] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [showInviteCode, setShowInviteCode] = useState(false);
  const [showFormAccessModal, setShowFormAccessModal] = useState(false);
  const [formAccessOverrides, setFormAccessOverrides] = useState<FormAccessOverrides>({});
  const [draftFormAccessOverrides, setDraftFormAccessOverrides] = useState<FormAccessOverrides>({});

  const isUserAdmin = userData?.isTeamAdmin || false;
  const canManageExperienced =
    isUserAdmin || userData?.role === "coach" || String(userData?.role || "").toLowerCase() === "team-coach";

  useEffect(() => {
    void loadTeamData();
  }, [userData?.teamId]);

  async function loadTeamData() {
    if (!userData?.teamId) return;
    setLoading(true);
    try {
      const membersQuery = query(collection(db, "users"), where("teamId", "==", userData.teamId));
      const membersSnap = await getDocs(membersQuery);
      const teamMembers = membersSnap.docs.map((docSnap) => ({
        uid: docSnap.id,
        ...docSnap.data(),
      })) as TeamMember[];
      setMembers(teamMembers);

      const requestsQuery = query(
        collection(db, "teamJoinRequests"),
        where("teamId", "==", userData.teamId),
        where("status", "==", "pending")
      );
      const requestsSnap = await getDocs(requestsQuery);
      const mappedRequests = requestsSnap.docs.map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        const fallbackUserId = String(data.userId || "");
        return {
          id: docSnap.id,
          userId: fallbackUserId,
          userEmail: String(data.userEmail || ""),
          userName: String(data.userName || (fallbackUserId ? `User ${fallbackUserId.slice(0, 8)}` : "Unknown User")),
          userRole: String(data.userRole || data.role || "match-scout"),
          requestedRole: String(data.requestedRole || data.userRole || data.role || "match-scout"),
          teamId: String(data.teamId || ""),
          status: String(data.status || "pending"),
          createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
        } as JoinRequest;
      });
      const userIdsNeedingLookup = Array.from(
        new Set(
          mappedRequests
            .filter((request) => request.userId && (!request.userName || request.userName.startsWith("User ")))
            .map((request) => request.userId)
        )
      );
      const userLookup = new Map<string, UserLookupRow>();
      await Promise.all(
        userIdsNeedingLookup.map(async (uid) => {
          try {
            const userDoc = await getDoc(doc(db, "users", uid));
            if (!userDoc.exists()) return;
            const data = userDoc.data() as UserLookupRow;
            userLookup.set(uid, data);
          } catch {
            // Best-effort hydration; ignore per-user lookup failures.
          }
        })
      );
      const requests = mappedRequests.map((request) => {
        const lookup = userLookup.get(request.userId);
        const displayName = String(lookup?.displayName || "").trim();
        const email = String(lookup?.email || "").trim();
        const effectiveEmail = request.userEmail || email;
        return {
          ...request,
          userName: deriveJoinRequestName({
            userName: request.userName,
            fallbackDisplayName: displayName,
            userEmail: request.userEmail,
            fallbackEmail: email,
            userId: request.userId,
          }),
          userEmail: effectiveEmail,
        };
      });
      setJoinRequests(requests);

      const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
      const overrides = normalizeFormAccessOverrides(teamDoc.exists() ? teamDoc.data().formAccessOverrides : null);
      setFormAccessOverrides(overrides);
      setDraftFormAccessOverrides(overrides);

      const name = await getTeamName(userData.teamId);
      setTeamName(name);
    } catch (error) {
      console.error("Error loading team:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveRequest(request: JoinRequest) {
    const resolvedRole = normalizeLegacyRole(request.requestedRole || request.userRole || "match-scout");
    async function approveViaClientFallback() {
      const targetUserId = String(request.userId || "").trim();
      let profileSyncPending = false;
      try {
        await updateDoc(doc(db, "users", targetUserId), {
          teamId: request.teamId,
          role: resolvedRole,
          roles: [resolvedRole],
          specialRole: null,
          specialRoles: [],
        });
      } catch {
        try {
          await setDoc(
            doc(db, "users", targetUserId),
            {
              uid: targetUserId,
              teamId: request.teamId,
              role: resolvedRole,
              roles: [resolvedRole],
              specialRole: null,
              specialRoles: [],
              isTeamAdmin: false,
            },
            { merge: true }
          );
        } catch {
          profileSyncPending = true;
        }
      }
      await updateDoc(doc(db, "teamJoinRequests", request.id), {
        status: "approved",
        processedAt: Date.now(),
        processedBy: userData?.uid || "",
        profileSyncPending,
      });
      return { profileSyncPending };
    }

    try {
      const targetUserId = String(request.userId || "").trim();

      if (!targetUserId) {
        alert("This request is missing a user ID. Ask the user to submit a new request.");
        return;
      }
      const idToken = await user?.getIdToken();
      if (!idToken) {
        alert("You must be signed in to approve requests.");
        return;
      }
      const response = await fetch("/api/team-join-requests/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ requestId: request.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; userName?: string; profileSyncPending?: boolean };
      if (!response.ok) {
        if (response.status === 403) {
          const fallbackResult = await approveViaClientFallback();
          if (fallbackResult.profileSyncPending) {
            alert(`${request.userName} was approved. Their account will finish syncing when they next sign in.`);
          } else {
            alert(`${request.userName} has been added to the team.`);
          }
          await loadTeamData();
          return;
        }
        throw new Error(payload.error || "Approval failed");
      }
      const approvedName = String(payload.userName || request.userName || "User").trim();
      if (payload.profileSyncPending) {
        alert(`${approvedName} was approved. Their account will finish syncing when they next sign in.`);
      } else {
        alert(`${approvedName} has been added to the team.`);
      }
      await loadTeamData();
    } catch (error) {
      console.error("Error approving request:", error);
      const message = error instanceof Error && error.message ? error.message : "Error approving request";
      alert(message);
    }
  }

  async function handleDenyRequest(requestId: string) {
    try {
      await updateDoc(doc(db, "teamJoinRequests", requestId), { status: "denied" });
      alert("Request denied");
      await loadTeamData();
    } catch (error) {
      console.error("Error denying request:", error);
      alert("Error denying request");
    }
  }

  async function handleUpdateRole(uid: string, roles: TeamRole[], isTeamAdmin: boolean) {
    if (!isUserAdmin) {
      alert("Only team admins can change roles.");
      return;
    }
    try {
      const primaryRole = roles.includes("drive-team") ? "drive-team" : roles[0] || "match-scout";
      await updateSecureUserDoc(uid, {
        role: primaryRole,
        roles,
        specialRole: null,
        specialRoles: [],
        isTeamAdmin,
      });
      setShowRoleSelector(false);
      setSelectedMember(null);
      await loadTeamData();
    } catch (error) {
      console.error("Error updating role:", error);
      alert("Error updating role");
    }
  }

  async function handleExperiencedToggle(uid: string, checked: boolean) {
    if (!canManageExperienced) return;
    try {
      await updateSecureUserDoc(uid, { experiencedScout: checked });
      await loadTeamData();
    } catch (error) {
      console.error("Error updating experienced scout:", error);
      alert("Error updating experienced scout status.");
    }
  }

  async function handleKickMember(uid: string) {
    if (!confirm("Are you sure you want to remove this member from the team?")) return;
    try {
      await updateSecureUserDoc(uid, {
        teamId: "",
        role: "match-scout",
        roles: ["match-scout"],
        specialRoles: [],
        specialRole: null,
        isTeamAdmin: false,
      });
      await loadTeamData();
    } catch (error) {
      console.error("Error kicking member:", error);
      alert("Error removing member");
    }
  }

  function getMemberRoles(member: TeamMember): TeamRole[] {
    return sanitizeRoles(member.roles, member.role);
  }

  function hasPermissionByRole(formKey: FormKey, memberRoles: TeamRole[]): boolean {
    if (formKey === "judge-book-edit") {
      return memberRoles.includes("judge-awards") || memberRoles.includes("team-coach");
    }
    const requiredRole = FORM_ROLE_REQUIREMENT[formKey];
    if (!requiredRole) return true;
    return memberRoles.includes(requiredRole);
  }

  async function saveFormAccessOverrides() {
    if (!userData?.teamId || !isUserAdmin) return;
    try {
      await updateDoc(doc(db, "teams", userData.teamId), {
        formAccessOverrides: draftFormAccessOverrides,
      });
      setFormAccessOverrides(draftFormAccessOverrides);
      setShowFormAccessModal(false);
      alert("Permissions updated.");
    } catch (error) {
      console.error("Error saving permissions:", error);
      alert("Could not save permissions settings.");
    }
  }

  function toggleUserFormAccess(formKey: FormKey, uid: string, checked: boolean) {
    setDraftFormAccessOverrides((prev) => {
      const existing = prev[formKey] || [];
      const nextValues = checked
        ? Array.from(new Set([...existing, uid]))
        : existing.filter((value) => value !== uid);
      return { ...prev, [formKey]: nextValues };
    });
  }

  const normalizedTeamLabel = teamName?.trim() || "Your Team";
  const displayTeamLabel = /^team\b/i.test(normalizedTeamLabel) ? normalizedTeamLabel : `Team ${normalizedTeamLabel}`;

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner message="Loading team..." />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
            Team Management
          </h1>
          <p className="text-gray-600 mb-8">Manage your team members, roles, and permissions.</p>
          {showRoleSelector && selectedMember && (
            <div className="bg-white rounded-xl shadow-md p-4 mb-6 border-l-4" style={{ borderColor: "var(--primary-color)" }}>
              <p className="text-sm text-gray-600">Editing Roles For</p>
              <p className="text-xl font-semibold">{selectedMember.displayName}</p>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold mb-1">{displayTeamLabel}</h2>
                <p className="text-gray-600">Manage members, requests, and role-based access.</p>
              </div>
              <div className="flex gap-2">
                {isUserAdmin && (
                  <button
                    onClick={() => {
                      setDraftFormAccessOverrides(formAccessOverrides);
                      setShowFormAccessModal(true);
                    }}
                    className="px-4 py-2 rounded border font-semibold hover:bg-gray-50"
                  >
                    Permissions
                  </button>
                )}
                <button
                  onClick={() => setShowInviteCode(!showInviteCode)}
                  className="px-4 py-2 rounded text-white font-semibold"
                  style={{ backgroundColor: "var(--primary-color)" }}
                >
                  {showInviteCode ? "Hide" : "Show"} Join Code
                </button>
              </div>
            </div>
            {showInviteCode && (
              <div className="mt-4 p-4 bg-gray-50 rounded">
                <p className="text-sm text-gray-600 mb-2">Team Join Code:</p>
                <p className="text-2xl font-mono font-bold" style={{ color: "var(--primary-color)" }}>
                  {userData?.teamId}
                </p>
              </div>
            )}
          </div>

          {isUserAdmin && joinRequests.length > 0 && (
            <div className="bg-white rounded-xl shadow-md overflow-hidden mb-6">
              <div className="p-6 border-b bg-amber-100/90">
                <div className="flex items-center gap-3">
                  <Clock size={24} className="text-amber-700" />
                  <div>
                    <h2 className="text-xl font-semibold text-amber-900">Pending Join Requests</h2>
                    <p className="text-sm text-amber-800">{joinRequests.length} request(s) waiting for approval</p>
                  </div>
                </div>
              </div>
              <div className="divide-y">
                {joinRequests.map((request) => (
                  <div key={request.id} className="p-6 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-lg">{request.userName}</p>
                      <p className="text-sm text-gray-600">{request.userEmail}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Requested {new Date(request.createdAt).toLocaleDateString()} | Role: {getRoleLabel(normalizeLegacyRole(request.requestedRole))}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleApproveRequest(request)}
                        className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-2"
                      >
                        <Check size={16} />
                        Approve
                      </button>
                      <button
                        onClick={() => void handleDenyRequest(request.id)}
                        className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-2"
                      >
                        <X size={16} />
                        Deny
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-md overflow-hidden mb-6">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold">Team Members</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Member</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Admin</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Experienced</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {members.map((member) => {
                    const badge = getRoleBadge(member.role, member.roles);
                    const memberRoles = getMemberRoles(member);
                    const isDriveWithPit = memberRoles.includes("drive-team") && memberRoles.includes("pit-team");
                    return (
                      <tr key={member.uid}>
                        <td className="px-6 py-4">
                          <p className="font-semibold">{member.displayName}</p>
                          <p className="text-sm text-gray-600">{member.email}</p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-2">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${badge.bg} ${badge.text}`}>
                              {badge.label}
                            </span>
                            {isDriveWithPit && (
                              <span className="px-2 py-1 rounded text-xs font-medium bg-cyan-100 text-cyan-800">
                                Pit Team (auto)
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">{member.isTeamAdmin ? "Yes" : "No"}</td>
                        <td className="px-6 py-4">
                          {canManageExperienced ? (
                            <label className="inline-flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={Boolean(member.experiencedScout)}
                                onChange={(event) => void handleExperiencedToggle(member.uid, event.target.checked)}
                              />
                              {member.experiencedScout ? "Yes" : "No"}
                            </label>
                          ) : (
                            <span>{member.experiencedScout ? "Yes" : "No"}</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => {
                                if (!isUserAdmin) return;
                                setSelectedMember(member);
                                setShowRoleSelector(true);
                              }}
                              disabled={!isUserAdmin}
                              className="px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Change Roles
                            </button>
                            {isUserAdmin && member.uid !== userData?.uid && (
                              <button
                                onClick={() => void handleKickMember(member.uid)}
                                className="px-3 py-1.5 rounded bg-red-100 hover:bg-red-200 text-red-800 text-sm"
                              >
                                Kick
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {showRoleSelector && selectedMember && (
            <RoleSelector
              currentRoles={getMemberRoles(selectedMember)}
              isTeamAdmin={selectedMember.isTeamAdmin}
              memberName={selectedMember.displayName}
              onSave={(roles, memberIsAdmin) => void handleUpdateRole(selectedMember.uid, roles, memberIsAdmin)}
              onClose={() => {
                setShowRoleSelector(false);
                setSelectedMember(null);
              }}
            />
          )}

          {showFormAccessModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold">Permissions Overrides</h2>
                    <p className="text-sm text-gray-600">Grant extra access to users who do not have default role permissions.</p>
                  </div>
                  <button onClick={() => setShowFormAccessModal(false)} className="px-3 py-1 rounded border hover:bg-gray-50">
                    Close
                  </button>
                </div>
                <div className="p-6 space-y-6">
                  {(Object.keys(FORM_LABELS) as FormKey[])
                    .filter((formKey) => formKey !== "match-scout-form")
                    .map((formKey) => {
                      const requiredRole = FORM_ROLE_REQUIREMENT[formKey];
                      return (
                        <div key={formKey} className="border rounded-lg p-4">
                          <h3 className="font-semibold text-lg">{FORM_LABELS[formKey]}</h3>
                          <p className="text-sm text-gray-600 mb-3">
                            Default role access: {formKey === "judge-book-edit" ? "Judge Awards, Team Coach" : requiredRole ? getRoleLabel(requiredRole) : "All Team Members"}
                          </p>
                          <div className="grid md:grid-cols-2 gap-2">
                            {members.map((member) => {
                              const memberRoles = getMemberRoles(member);
                              const hasDefaultRole = hasPermissionByRole(formKey, memberRoles);
                              const hasAdminAccess = member.isTeamAdmin;
                              const hasSystemAccess = hasDefaultRole || hasAdminAccess;
                              const checked = (draftFormAccessOverrides[formKey] || []).includes(member.uid);
                              return (
                                <label key={`${formKey}-${member.uid}`} className="flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    disabled={hasSystemAccess}
                                    checked={hasSystemAccess || checked}
                                    onChange={(event) => toggleUserFormAccess(formKey, member.uid, event.target.checked)}
                                  />
                                  <span className={hasSystemAccess ? "text-gray-400" : "text-gray-700"}>
                                    {member.displayName} {hasAdminAccess ? "(team admin)" : hasDefaultRole ? "(role-based access)" : ""}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                </div>
                <div className="p-6 border-t flex gap-3">
                  <button
                    onClick={() => void saveFormAccessOverrides()}
                    className="px-4 py-2 rounded text-white font-semibold"
                    style={{ backgroundColor: "var(--primary-color)" }}
                  >
                    Save Overrides
                  </button>
                  <button
                    onClick={() => {
                      setDraftFormAccessOverrides(formAccessOverrides);
                      setShowFormAccessModal(false);
                    }}
                    className="px-4 py-2 rounded border"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TeamManagementPage() {
  return (
    <ProtectedRoute
      requireAuth={true}
      allowedRoles={[
        "lead-scout",
        "lead-strategist",
        "team-coach",
        "pit-team",
        "drive-team",
        "pit-scout",
        "match-scout",
        "coach",
        "scout",
      ]}
    >
      <TeamManagementContent />
    </ProtectedRoute>
  );
}
