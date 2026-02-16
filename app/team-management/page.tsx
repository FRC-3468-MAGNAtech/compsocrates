// FILE: app/team-management/page.tsx
// ADDITION: Team join request approvals

"use client";

import { useState, useEffect } from "react";
import { collection, query, where, getDocs, updateDoc, doc, deleteDoc, setDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { X, Check, Clock, Users } from "lucide-react";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { getTeamName } from "@/app/utils/stats-calculator";

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
      const requests = requestsSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as JoinRequest[];
      
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
      // Update request status
      await updateDoc(doc(db, "teamJoinRequests", request.id), {
        status: "approved"
      });

      // Find or create user document
      const usersQuery = query(
        collection(db, "users"),
        where("email", "==", request.userEmail)
      );
      const usersSnap = await getDocs(usersQuery);
      
      if (!usersSnap.empty) {
        const userDoc = usersSnap.docs[0];
        await updateDoc(doc(db, "users", userDoc.id), {
          teamId: request.teamId
        });
      }

      alert(`${request.userName} has been added to the team!`);
      loadTeamData();
    } catch (error) {
      console.error("Error approving request:", error);
      alert("Error approving request");
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
    try {
      await updateDoc(doc(db, "users", uid), {
        role,
        specialRole: specialRoles.includes("lead-scout") ? "lead-scout" : 
                    specialRoles.includes("lead-strategist") ? "lead-strategist" :
                    specialRoles.includes("pit-scout") ? "pit-scout" : null,
        specialRoles,
      });
      await loadTeamData();
    } catch (error) {
      console.error("Error updating role:", error);
      alert("Error updating role");
    }
  }

  async function handleKickMember(uid: string) {
    if (!confirm("Are you sure you want to remove this member from the team?")) return;
    
    try {
      await updateDoc(doc(db, "users", uid), {
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
      await updateDoc(doc(db, "users", uid), {
        isTeamAdmin: true,
      });
      await loadTeamData();
    } catch (error) {
      console.error("Error making admin:", error);
      alert("Error updating admin status");
    }
  }

  const isUserAdmin = userData?.isTeamAdmin || false;

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
          <p className="text-gray-600 mb-8">
            Manage your team members and their roles
          </p>

          {/* Team Info */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold mb-1">{teamName || "Your Team"}</h2>
                <p className="text-gray-600">Team ID: {userData?.teamId}</p>
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
                        Requested {new Date(request.createdAt).toLocaleDateString()} • Role: {request.userRole}
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

          {/* Team Members Table - EXISTING CODE CONTINUES HERE */}
          {/* ... rest of your existing team management table ... */}

        </div>
      </div>
    </div>
  );
}

export default function TeamManagementPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach"]}>
      <TeamManagementContent />
    </ProtectedRoute>
  );
}
