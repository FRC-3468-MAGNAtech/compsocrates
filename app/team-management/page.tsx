"use client";

import { useState, useEffect } from "react";
import { collection, getDocs, updateDoc, doc, query, where, deleteDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { getTeamName } from "@/app/utils/stats-calculator";
import { X } from "lucide-react";

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

// ROLE SELECTOR COMPONENT
function RoleSelector({ 
  currentRole, 
  currentSpecialRoles = [], 
  onSave, 
  onClose 
}: { 
  currentRole: string;
  currentSpecialRoles: string[];
  onSave: (role: string, specialRoles: string[]) => void;
  onClose: () => void;
}) {
  const [selectedRole, setSelectedRole] = useState(currentRole);
  const [selectedSpecialRoles, setSelectedSpecialRoles] = useState<string[]>(currentSpecialRoles);

  const specialRoleOptions = [
    { value: "lead-scout", label: "Lead Scout" },
    { value: "lead-strategist", label: "Lead Strategist" },
    { value: "pit-scout", label: "Pit Scout" },
  ];

  function toggleSpecialRole(role: string) {
    if (selectedSpecialRoles.includes(role)) {
      setSelectedSpecialRoles(selectedSpecialRoles.filter(r => r !== role));
    } else {
      setSelectedSpecialRoles([...selectedSpecialRoles, role]);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold" style={{ color: "#c42221" }}>
            Change Roles
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X size={24} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Primary Role */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Primary Role
            </label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-full border rounded p-2"
            >
              <option value="scout">Scout</option>
              <option value="coach">Coach</option>
            </select>
          </div>

          {/* Special Roles */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Special Roles (Optional)
            </label>
            <div className="space-y-2">
              {specialRoleOptions.map(option => (
                <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSpecialRoles.includes(option.value)}
                    onChange={() => toggleSpecialRole(option.value)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-700">{option.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={() => onSave(selectedRole, selectedSpecialRoles)}
            className="flex-1 py-2 rounded text-white font-semibold"
            style={{ backgroundColor: "#c42221" }}
          >
            Save Changes
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded border-2 border-gray-300 text-gray-700 font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function TeamManagementContent() {
  const { userData } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
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
      const q = query(collection(db, "users"), where("teamId", "==", userData.teamId));
      const snapshot = await getDocs(q);
      const teamMembers = snapshot.docs.map(doc => ({
        uid: doc.id,
        ...doc.data()
      })) as TeamMember[];
      
      setMembers(teamMembers);
      
      const name = await getTeamName(userData.teamId);
      setTeamName(name);
    } catch (error) {
      console.error("Error loading team:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateRole(uid: string, role: string, specialRoles: string[]) {
    try {
      await updateDoc(doc(db, "users", uid), {
        role,
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
        teamId: null,
        role: "scout",
        specialRoles: [],
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

          {loading ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <div className="text-4xl mb-4">⏳</div>
              <p className="text-gray-600">Loading team...</p>
            </div>
          ) : (
            <>
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

              <div className="bg-white rounded-xl shadow-md overflow-hidden">
                <div className="p-6 border-b">
                  <h2 className="text-xl font-semibold">Team Members ({members.length})</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Special Roles</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        {isUserAdmin && (
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {members.map(member => (
                        <tr key={member.uid} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="font-medium">{member.displayName}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            {member.email}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              member.role === "coach" ? "bg-blue-100 text-blue-800" : "bg-green-100 text-green-800"
                            }`}>
                              {member.role === "coach" ? "Coach" : "Scout"}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            {member.specialRoles && member.specialRoles.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {member.specialRoles.map(role => (
                                  <span key={role} className="px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-800">
                                    {role.replace("-", " ").split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-sm text-gray-400">None</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {member.isTeamAdmin && (
                              <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                                Admin
                              </span>
                            )}
                          </td>
                          {isUserAdmin && (
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex gap-2">
                                <button
                                  onClick={() => {
                                    setSelectedMember(member);
                                    setShowRoleSelector(true);
                                  }}
                                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                                >
                                  Change Role
                                </button>
                                {!member.isTeamAdmin && (
                                  <>
                                    <button
                                      onClick={() => handleMakeAdmin(member.uid)}
                                      className="text-sm text-green-600 hover:text-green-800 font-medium"
                                    >
                                      Make Admin
                                    </button>
                                    <button
                                      onClick={() => handleKickMember(member.uid)}
                                      className="text-sm text-red-600 hover:text-red-800 font-medium"
                                    >
                                      Remove
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {!isUserAdmin && (
                <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded mt-6">
                  <p className="text-sm text-yellow-800">
                    ℹ️ Only team admins can manage team members. Contact your team admin to make changes.
                  </p>
                </div>
              )}

              {showRoleSelector && selectedMember && (
                <RoleSelector
                  currentRole={selectedMember.role}
                  currentSpecialRoles={selectedMember.specialRoles || []}
                  onSave={(role, specialRoles) => {
                    handleUpdateRole(selectedMember.uid, role, specialRoles);
                    setShowRoleSelector(false);
                  }}
                  onClose={() => setShowRoleSelector(false)}
                />
              )}
            </>
          )}
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
