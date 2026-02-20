// FILE: app/team-management/page.tsx
// ADDITION: Team join request approvals

"use client";

import { useState, useEffect } from "react";
import { collection, query, where, getDocs, updateDoc, doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import RoleSelector from "@/app/components/RoleSelector";
import { useAuth } from "@/app/AuthContext";
import { X, Check, Clock } from "lucide-react";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { getTeamName } from "@/app/utils/stats-calculator";
import { updateSecureUserDoc } from "@/app/utils/secureUserDoc";

interface TeamMember {
  uid: string;
  displayName: string;
  email: string;
  role: "coach" | "scout";
  specialRole?: "lead-scout" | "lead-strategist" | "pit-scout" | null;
  specialRoles?: string[];
  isTeamAdmin: boolean;
  teamId: string;
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

function TeamManagementContent() {
  const { userData } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamName, setTeamName] = useState("");
  const [showRoleSelector, setShowRoleSelector] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [showInviteCode, setShowInviteCode] = useState(false);

  useEffect(() => {
    loadTeamData();
  }, [userData?.teamId]);

  async function loadTeamData() {
    if (!userData?.teamId) return;
    
    setLoading(true);
    try {
      // Load team members
      const membersQuery = query(
        collection(db, "users"),
        where("teamId", "==", userData.teamId)
      );
      const membersSnap = await getDocs(membersQuery);
      const teamMembers = membersSnap.docs.map(doc => ({
        uid: doc.id,
        ...doc.data()
      })) as TeamMember[];
      
      setMembers(teamMembers);
      
      // Load join requests
      const requestsQuery = query(
        collection(db, "teamJoinRequests"),
        where("teamId", "==", userData.teamId),
        where("status", "==", "pending")
      );
      const requestsSnap = await getDocs(requestsQuery);
      const requests = requestsSnap.docs.map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        const fallbackUserId = String(data.userId || "");
        return {
          id: docSnap.id,
          userId: fallbackUserId,
          userEmail: String(data.userEmail || ""),
          userName: String(data.userName || (fallbackUserId ? `User ${fallbackUserId.slice(0, 8)}` : "Unknown User")),
          userRole: String(data.userRole || data.role || "scout"),
          requestedRole: String(data.requestedRole || data.userRole || data.role || "scout"),
          teamId: String(data.teamId || ""),
          status: String(data.status || "pending"),
          createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
        } as JoinRequest;
      });
      
      setJoinRequests(requests);
      
      const name = await getTeamName(userData.teamId);
      setTeamName(name);
    } catch (error) {
      console.error("Error loading team:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveRequest(request: JoinRequest) {
    try {
      const resolvedRole = (request.requestedRole || request.userRole || "scout") as "coach" | "scout";

      let targetUserId = "";
      if (request.userId) {
        const directUserDoc = await getDoc(doc(db, "users", request.userId));
        if (directUserDoc.exists()) {
          targetUserId = request.userId;
        }
      }

      if (!targetUserId && request.userEmail) {
        const usersQuery = query(
          collection(db, "users"),
          where("email", "==", request.userEmail)
        );
        const usersSnap = await getDocs(usersQuery);
        if (!usersSnap.empty) {
          targetUserId = usersSnap.docs[0].id;
        }
      }

      if (!targetUserId) {
        alert("Unable to find the user account for this request.");
        return;
      }

      // 1) First add the user to the team.
      // If this fails, keep the request pending so admins can retry.
      await updateSecureUserDoc(targetUserId, {
        teamId: request.teamId,
        role: resolvedRole,
      });

      // 2) Only mark approved after user update succeeds.
      await updateDoc(doc(db, "teamJoinRequests", request.id), {
        status: "approved",
        processedAt: Date.now(),
        processedBy: userData?.uid || "",
      });

      alert(`${request.userName} has been added to the team!`);
      loadTeamData();
    } catch (error) {
      console.error("Error approving request:", error);
      const message = error instanceof Error ? error.message : String(error || "");
      alert(message ? `Error approving request: ${message}` : "Error approving request");
    }
  }

  async function handleDenyRequest(requestId: string) {
    try {
      await updateDoc(doc(db, "teamJoinRequests", requestId), {
        status: "denied"
      });
      alert("Request denied");
      loadTeamData();
    } catch (error) {
      console.error("Error denying request:", error);
      alert("Error denying request");
    }
  }

  async function handleUpdateRole(uid: string, role: string, specialRoles: string[]) {
    if (!isUserAdmin) {
      alert("Only team admins can change roles.");
      return;
    }
    try {
      const isTeamAdmin = specialRoles.includes("team-admin");
      const filteredSpecialRoles = specialRoles.filter((r) => r !== "team-admin");
      await updateSecureUserDoc(uid, {
        role,
        specialRole: filteredSpecialRoles.includes("lead-scout") ? "lead-scout" : 
                    filteredSpecialRoles.includes("lead-strategist") ? "lead-strategist" :
                    filteredSpecialRoles.includes("pit-scout") ? "pit-scout" : null,
        specialRoles: filteredSpecialRoles,
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

  async function handleKickMember(uid: string) {
    if (!confirm("Are you sure you want to remove this member from the team?")) return;
    
    try {
      await updateSecureUserDoc(uid, {
        teamId: "",
        role: "scout",
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

  async function handleMakeAdmin(uid: string) {
    if (!confirm("Are you sure you want to make this person a team admin?")) return;
    
    try {
      await updateSecureUserDoc(uid, {
        isTeamAdmin: true,
      });
      await loadTeamData();
    } catch (error) {
      console.error("Error making admin:", error);
      alert("Error updating admin status");
    }
  }

  async function handleLeaveTeam() {
    if (!userData?.uid) return;
    if (!confirm("Leave this team? You will need to request access again to rejoin.")) return;
    await handleKickMember(userData.uid);
  }

  function formatRole(member: TeamMember): string {
    if (member.specialRole) return member.specialRole.replace(/-/g, " ");
    return member.role;
  }

  const isUserAdmin = userData?.isTeamAdmin || false;
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
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
            Team Management
          </h1>
          <p className="text-gray-600 mb-8">Manage your team members and their roles</p>

          {/* Team Info */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold mb-1">{displayTeamLabel}</h2>
                <p className="text-gray-600">Manage members, requests, and roles.</p>
              </div>
              <button
                onClick={() => setShowInviteCode(!showInviteCode)}
                className="px-4 py-2 rounded text-white font-semibold"
                style={{ backgroundColor: "#c42221" }}
              >
                {showInviteCode ? "Hide" : "Show"} Join Code
              </button>
            </div>
            {showInviteCode && (
              <div className="mt-4 p-4 bg-gray-50 rounded">
                <p className="text-sm text-gray-600 mb-2">Team Join Code:</p>
                <p className="text-2xl font-mono font-bold" style={{ color: "#c42221" }}>
                  {userData?.teamId}
                </p>
              </div>
            )}
          </div>

          {/* Join Requests */}
          {isUserAdmin && joinRequests.length > 0 && (
            <div className="bg-white rounded-xl shadow-md overflow-hidden mb-6">
              <div className="p-6 border-b bg-yellow-50">
                <div className="flex items-center gap-3">
                  <Clock size={24} className="text-yellow-600" />
                  <div>
                    <h2 className="text-xl font-semibold">Pending Join Requests</h2>
                    <p className="text-sm text-gray-600">{joinRequests.length} request(s) waiting for approval</p>
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
                        Requested {new Date(request.createdAt).toLocaleDateString()} • Role: {request.requestedRole || request.userRole}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApproveRequest(request)}
                        className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-2"
                      >
                        <Check size={16} />
                        Approve
                      </button>
                      <button
                        onClick={() => handleDenyRequest(request.id)}
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

          {/* Team Members */}
          <div className="bg-white rounded-xl shadow-md overflow-hidden mb-6">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Team Members</h2>
              <button
                onClick={handleLeaveTeam}
                className="px-3 py-2 rounded border border-red-300 text-red-700 hover:bg-red-50 text-sm font-semibold"
              >
                Leave Team
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Member</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Admin</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {members.map((member) => (
                    <tr key={member.uid}>
                      <td className="px-6 py-4">
                        <p className="font-semibold">{member.displayName}</p>
                        <p className="text-sm text-gray-600">{member.email}</p>
                      </td>
                      <td className="px-6 py-4 capitalize">
                        {formatRole(member)}
                      </td>
                      <td className="px-6 py-4">
                        {member.isTeamAdmin ? "Yes" : "No"}
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
                          {isUserAdmin && !member.isTeamAdmin && (
                            <button
                              onClick={() => handleMakeAdmin(member.uid)}
                              className="px-3 py-1.5 rounded bg-blue-100 hover:bg-blue-200 text-blue-800 text-sm"
                            >
                              Make Admin
                            </button>
                          )}
                          {isUserAdmin && member.uid !== userData?.uid && (
                            <button
                              onClick={() => handleKickMember(member.uid)}
                              className="px-3 py-1.5 rounded bg-red-100 hover:bg-red-200 text-red-800 text-sm"
                            >
                              Kick
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {showRoleSelector && selectedMember && (
            <RoleSelector
              currentRole={selectedMember.role}
              currentSpecialRoles={[
                ...(selectedMember.specialRoles || []),
                ...(selectedMember.isTeamAdmin ? ["team-admin"] : []),
              ]}
              onSave={(role, specialRoles) => handleUpdateRole(selectedMember.uid, role, specialRoles)}
              onClose={() => {
                setShowRoleSelector(false);
                setSelectedMember(null);
              }}
            />
          )}

        </div>
      </div>
    </div>
  );
}

export default function TeamManagementPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <TeamManagementContent />
    </ProtectedRoute>
  );
}
