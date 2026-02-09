"use client";

import { useState, useEffect } from "react";
import { collection, getDocs, updateDoc, doc, query, where } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { getTeamName } from "@/app/utils/stats-calculator";

interface TeamMember {
  uid: string;
  displayName: string;
  email: string;
  role: "coach" | "scout";
  specialRole?: "lead-scout" | "lead-strategist" | "pit-scout" | null;
  isTeamAdmin: boolean;
  teamId: string;
}

function TeamManagementContent() {
  const { userData } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamName, setTeamName] = useState("");
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [showInviteCode, setShowInviteCode] = useState(false);

  useEffect(() => {
    loadTeamData();
  }, [userData?.teamId]);

  async function loadTeamData() {
    if (!userData?.teamId) return;
    
    setLoading(true);
    try {
      // Load team members
      const q = query(collection(db, "users"), where("teamId", "==", userData.teamId));
      const snapshot = await getDocs(q);
      const teamMembers = snapshot.docs.map(doc => ({
        uid: doc.id,
        ...doc.data()
      })) as TeamMember[];
      
      setMembers(teamMembers);
      
      // Get team name from teams collection
      const fetchedTeamName = await getTeamName(userData.teamId);
      setTeamName(fetchedTeamName);
    } catch (error) {
      console.error("Error loading team data:", error);
    } finally {
      setLoading(false);
    }
  }

  async function updateMemberRole(uid: string, newRole: "coach" | "scout") {
    try {
      await updateDoc(doc(db, "users", uid), { role: newRole });
      await loadTeamData();
      setEditingMember(null);
      alert("Member role updated successfully!");
    } catch (error) {
      console.error("Error updating member:", error);
      alert("Failed to update member role");
    }
  }

  async function removeMember(uid: string) {
    if (!confirm("Are you sure you want to remove this team member?")) return;
    
    try {
      await updateDoc(doc(db, "users", uid), { teamId: "", isTeamAdmin: false });
      await loadTeamData();
      alert("Member removed from team");
    } catch (error) {
      console.error("Error removing member:", error);
      alert("Failed to remove member");
    }
  }

  async function updateSpecialRole(uid: string, specialRole: string | null) {
    try {
      await updateDoc(doc(db, "users", uid), { 
        specialRole: specialRole || null 
      });
      await loadTeamData();
      alert("Special role updated!");
    } catch (error) {
      console.error("Error updating special role:", error);
      alert("Failed to update special role");
    }
  }

  const coaches = members.filter(m => m.role === "coach");
  const scouts = members.filter(m => m.role === "scout");

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
            Team Management
          </h1>
          <p className="text-gray-600 mb-8">
            Manage your team members, roles, and permissions
          </p>

          {loading ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">🔄</div>
              <p className="text-gray-600">Loading team members...</p>
            </div>
          ) : (
            <>
              {/* TEAM INFO */}
              <div className="bg-white rounded-xl shadow-md p-6 mb-6 border-l-4" style={{ borderColor: "#c42221" }}>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-2xl font-bold mb-1" style={{ color: "#c42221" }}>
                      Team {teamName}
                    </h2>
                    <p className="text-gray-600 mb-1">{members.length} team members</p>
                    <p className="text-sm text-gray-500">Team Code: <span className="font-mono font-bold">{userData?.teamId}</span></p>
                  </div>
                  <button
                    onClick={() => setShowInviteCode(!showInviteCode)}
                    className="px-4 py-2 rounded-lg text-white font-medium"
                    style={{ backgroundColor: "#c42221" }}
                  >
                    {showInviteCode ? "Hide" : "Show"} Invite Code
                  </button>
                </div>

                {showInviteCode && (
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-2">Share this code with new team members:</p>
                    <div className="flex items-center gap-3">
                      <code className="text-2xl font-bold tracking-wider" style={{ color: "#c42221" }}>
                        {userData?.teamId}
                      </code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(userData?.teamId || "");
                          alert("Team code copied to clipboard!");
                        }}
                        className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-sm font-medium"
                      >
                        Copy
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      New members can use this code during signup to join your team
                    </p>
                  </div>
                )}
              </div>

              {/* STATS */}
              <div className="grid md:grid-cols-3 gap-6 mb-6">
                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Total Members</h3>
                    <span className="text-2xl">👥</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {members.length}
                  </p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Coaches</h3>
                    <span className="text-2xl">🎓</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {coaches.length}
                  </p>
                </div>

                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-700">Scouts</h3>
                    <span className="text-2xl">📝</span>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#c42221" }}>
                    {scouts.length}
                  </p>
                </div>
              </div>

              {/* COACHES LIST */}
              <div className="bg-white rounded-xl shadow-md p-6 mb-6">
                <h2 className="text-xl font-semibold mb-4">Coaches ({coaches.length})</h2>
                <div className="space-y-3">
                  {coaches.map((member) => (
                    <div
                      key={member.uid}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center text-white font-bold text-lg">
                          {member.displayName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold">{member.displayName}</p>
                          <p className="text-sm text-gray-600">{member.email}</p>
                          {member.isTeamAdmin && (
                            <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-800 rounded mt-1 inline-block">
                              Team Admin
                            </span>
                          )}
                          {/* Special Role Selector - show for all coaches if you're team admin */}
                          {userData?.isTeamAdmin && (
                            <div className="mt-2">
                              <label className="text-xs text-gray-600 mr-2">Special Role:</label>
                              <select
                                value={member.specialRole || ""}
                                onChange={(e) => updateSpecialRole(member.uid, e.target.value || null)}
                                className="text-xs border rounded px-2 py-1"
                              >
                                <option value="">None</option>
                                <option value="lead-scout">Lead Scout</option>
                                <option value="lead-strategist">Lead Strategist</option>
                                <option value="pit-scout">Pit Scout</option>
                              </select>
                            </div>
                          )}
                        </div>
                      </div>

                      {userData?.isTeamAdmin && member.uid !== userData?.uid && (
                        <div className="flex gap-2">
                          {editingMember === member.uid ? (
                            <>
                              <button
                                onClick={() => updateMemberRole(member.uid, "scout")}
                                className="px-3 py-1 rounded bg-blue-500 text-white text-sm"
                              >
                                Make Scout
                              </button>
                              <button
                                onClick={() => setEditingMember(null)}
                                className="px-3 py-1 rounded bg-gray-300 text-gray-700 text-sm"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => setEditingMember(member.uid)}
                                className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-sm"
                              >
                                Change Role
                              </button>
                              <button
                                onClick={() => removeMember(member.uid)}
                                className="px-3 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 text-sm"
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {coaches.length === 0 && (
                    <p className="text-gray-500 text-center py-8">No coaches yet</p>
                  )}
                </div>
              </div>

              {/* SCOUTS LIST */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-semibold mb-4">Scouts ({scouts.length})</h2>
                <div className="space-y-3">
                  {scouts.map((member) => (
                    <div
                      key={member.uid}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold text-lg">
                          {member.displayName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold">{member.displayName}</p>
                          <p className="text-sm text-gray-600">{member.email}</p>
                        </div>
                      </div>

                      {userData?.isTeamAdmin && (
                        <div className="flex gap-2">
                          {editingMember === member.uid ? (
                            <>
                              <button
                                onClick={() => updateMemberRole(member.uid, "coach")}
                                className="px-3 py-1 rounded bg-blue-500 text-white text-sm"
                              >
                                Make Coach
                              </button>
                              <button
                                onClick={() => setEditingMember(null)}
                                className="px-3 py-1 rounded bg-gray-300 text-gray-700 text-sm"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => setEditingMember(member.uid)}
                                className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-sm"
                              >
                                Change Role
                              </button>
                              <button
                                onClick={() => removeMember(member.uid)}
                                className="px-3 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 text-sm"
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {scouts.length === 0 && (
                    <p className="text-gray-500 text-center py-8">No scouts yet</p>
                  )}
                </div>
              </div>

              {!userData?.isTeamAdmin && (
                <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800">
                    ℹ️ Only team admins can manage team members. Contact your team admin to make changes.
                  </p>
                </div>
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
