"use client";

import { useState, useEffect } from "react";
import { collection, query, where, getDocs, updateDoc, doc } from "firebase/firestore";
import { db } from "@/app/firebase";
import { useAuth } from "@/app/AuthContext";
import { UserCheck, UserX, Clock, Mail } from "lucide-react";

interface TeamRequest {
  id: string;
  teamId: string;
  userId?: string;
  userEmail: string;
  userName: string;
  requestedRole?: "scout" | "coach";
  userRole?: "scout" | "coach";
  status: "pending" | "approved" | "denied";
  createdAt: number;
}

export default function TeamRequestsPanel() {
  const { userData } = useAuth();
  const [requests, setRequests] = useState<TeamRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRequests();
  }, [userData?.teamId]);

  async function loadRequests() {
    if (!userData?.teamId) return;

    try {
      const q = query(
        collection(db, "teamJoinRequests"),
        where("teamId", "==", userData.teamId),
        where("status", "==", "pending")
      );
      
      const snapshot = await getDocs(q);
      const reqs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as TeamRequest[];
      
      setRequests(reqs);
    } catch (error) {
      console.error("Error loading requests:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(request: TeamRequest) {
    const resolvedRole = (request.requestedRole || request.userRole || "scout") as "scout" | "coach";
    if (!confirm(`Approve ${request.userName} to join as ${resolvedRole}?`)) return;

    try {
      const targetUserId = String(request.userId || "").trim();
      if (!targetUserId) {
        alert("Request is missing a user ID. Ask the scout to re-submit.");
        return;
      }
      // 1. Add user to team
      await updateDoc(doc(db, "users", targetUserId), {
        teamId: userData?.teamId,
        role: resolvedRole
      });

      // 2. Mark request approved after user update succeeds.
      await updateDoc(doc(db, "teamJoinRequests", request.id), {
        status: "approved",
        processedAt: Date.now(),
        processedBy: userData?.uid
      });

      alert(`${request.userName} has been approved!`);
      loadRequests(); // Refresh list
    } catch (error) {
      console.error("Error approving request:", error);
      alert("Failed to approve request");
    }
  }

  async function handleDeny(request: TeamRequest) {
    if (!confirm(`Deny ${request.userName}'s request?`)) return;

    try {
      await updateDoc(doc(db, "teamJoinRequests", request.id), {
        status: "denied",
        processedAt: Date.now(),
        processedBy: userData?.uid
      });

      alert(`Request denied`);
      loadRequests();
    } catch (error) {
      console.error("Error denying request:", error);
      alert("Failed to deny request");
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">Pending Join Requests</h2>
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">Pending Join Requests</h2>
        <p className="text-gray-500">No pending requests</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <Clock size={24} style={{ color: "var(--primary-color)" }} />
        Pending Join Requests ({requests.length})
      </h2>

      <div className="space-y-4">
        {requests.map(request => (
          <div key={request.id} className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Mail size={16} className="text-gray-400" />
                  <span className="font-semibold">{request.userName}</span>
                </div>
                <p className="text-sm text-gray-600 mb-1">{request.userEmail}</p>
                <p className="text-sm text-gray-500">
                  Requesting to join as <span className="font-medium">{request.requestedRole || request.userRole || "scout"}</span>
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  {new Date(request.createdAt).toLocaleDateString()}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleApprove(request)}
                  className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg flex items-center gap-2 transition-colors"
                >
                  <UserCheck size={16} />
                  Approve
                </button>
                <button
                  onClick={() => handleDeny(request)}
                  className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg flex items-center gap-2 transition-colors"
                >
                  <UserX size={16} />
                  Deny
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

