import { useState, useEffect } from "react";
import { collection, query, where, getDocs, updateDoc, doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import { CheckCircle, XCircle, Clock, Mail } from "lucide-react";
import { updateSecureUserDoc } from "@/app/utils/secureUserDoc";

interface TeamRequest {
  id: string;
  teamId: string;
  userId?: string;
  userEmail: string;
  userName: string;
  requestedRole?: "scout" | "coach";
  userRole?: "scout" | "coach";
  status: "pending" | "approved" | "rejected";
  createdAt: number;
}

export default function TeamRequests({ teamId }: { teamId: string }) {
  const [requests, setRequests] = useState<TeamRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRequests();
  }, [teamId]);

  async function loadRequests() {
    setLoading(true);
    try {
      const q = query(
        collection(db, "teamJoinRequests"),
        where("teamId", "==", teamId),
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
    if (!confirm(`Approve ${request.userName} to join the team as ${resolvedRole}?`)) {
      return;
    }

    try {
      let targetUserId = "";
      if (request.userId) {
        const directUserDoc = await getDoc(doc(db, "users", request.userId));
        if (directUserDoc.exists()) {
          targetUserId = request.userId;
        }
      }
      if (!targetUserId) {
        const usersQuery = query(
          collection(db, "users"),
          where("email", "==", request.userEmail)
        );
        const usersSnapshot = await getDocs(usersQuery);
        if (!usersSnapshot.empty) {
          targetUserId = usersSnapshot.docs[0].id;
        }
      }
      if (!targetUserId) {
        alert("User not found");
        return;
      }
      await updateSecureUserDoc(targetUserId, {
        teamId,
        role: resolvedRole,
      });

      // Update request status
      await updateDoc(doc(db, "teamJoinRequests", request.id), {
        status: "approved",
        processedAt: Date.now(),
      });

      alert(`${request.userName} has been added to the team!`);
      loadRequests(); // Reload to remove from pending list
    } catch (error) {
      console.error("Error approving request:", error);
      alert("Failed to approve request");
    }
  }

  async function handleReject(request: TeamRequest) {
    if (!confirm(`Reject ${request.userName}'s request to join?`)) {
      return;
    }

    try {
      // Update request status to rejected
      await updateDoc(doc(db, "teamJoinRequests", request.id), {
        status: "denied",
        processedAt: Date.now(),
      });

      alert(`Request from ${request.userName} has been rejected.`);
      loadRequests();
    } catch (error) {
      console.error("Error rejecting request:", error);
      alert("Failed to reject request");
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Pending Join Requests</h2>
        <div className="text-center py-8 text-gray-500">Loading requests...</div>
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Pending Join Requests</h2>
        <div className="text-center py-8 text-gray-500">
          <Mail className="mx-auto mb-2 text-gray-400" size={48} />
          <p>No pending requests</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-md p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Pending Join Requests</h2>
        <div className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-sm font-semibold">
          {requests.length} pending
        </div>
      </div>

      <div className="space-y-3">
        {requests.map((request) => (
          <div
            key={request.id}
            className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border-2 border-yellow-200"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center">
                <Clock className="text-yellow-600" size={24} />
              </div>
              <div>
                <p className="font-semibold">{request.userName}</p>
                <p className="text-sm text-gray-600">{request.userEmail}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Wants to join as <span className="font-semibold capitalize">{request.requestedRole || request.userRole || "scout"}</span>
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleApprove(request)}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold flex items-center gap-2"
              >
                <CheckCircle size={18} />
                Approve
              </button>
              <button
                onClick={() => handleReject(request)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold flex items-center gap-2"
              >
                <XCircle size={18} />
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
