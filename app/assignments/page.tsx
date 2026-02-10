"use client";

import { useState, useEffect } from "react";
import { collection, query, where, getDocs, addDoc, deleteDoc, doc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { Calendar, Users, Trash2, Plus } from "lucide-react";

interface Assignment {
  id: string;
  eventKey: string;
  matchKey: string;
  scoutId: string;
  scoutName: string;
  robotPosition: 1 | 2 | 3;
  assignedBy: string;
  assignedAt: number;
}

interface Scout {
  uid: string;
  displayName: string;
  role: string;
  specialRole?: string; // FIX: Add this optional property
}

function AssignmentsContent() {
  const { userData } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [scouts, setScouts] = useState<Scout[]>([]);
  const [selectedEvent, setSelectedEvent] = useState("2026arli");
  const [loading, setLoading] = useState(true);
  const [showAssignModal, setShowAssignModal] = useState(false);

  const events = [
    { key: "2026arli", name: "Arkansas Regional" },
    { key: "2026labr", name: "Bayou Regional" },
  ];

  useEffect(() => {
    loadData();
  }, [selectedEvent, userData?.teamId]);

  async function loadData() {
    if (!userData?.teamId) return;
    
    setLoading(true);
    try {
      // Load scouts
      const scoutsQuery = query(
        collection(db, "users"),
        where("teamId", "==", userData.teamId)
      );
      const scoutsSnap = await getDocs(scoutsQuery);
      const scoutsList = scoutsSnap.docs
        .map(doc => ({ uid: doc.id, ...doc.data() } as Scout))
        .filter(u => u.role === "scout" || (u.role === "coach" && u.specialRole));
      setScouts(scoutsList);

      // Load assignments
      const assignmentsQuery = query(
        collection(db, "matchAssignments"),
        where("eventKey", "==", selectedEvent)
      );
      const assignmentsSnap = await getDocs(assignmentsQuery);
      const assignmentsList = assignmentsSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Assignment[];
      setAssignments(assignmentsList);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  }

  async function createAssignment(matchKey: string, scoutId: string, robotPosition: 1 | 2 | 3) {
    if (!userData) return;

    const scout = scouts.find(s => s.uid === scoutId);
    if (!scout) return;

    try {
      await addDoc(collection(db, "matchAssignments"), {
        eventKey: selectedEvent,
        matchKey,
        scoutId,
        scoutName: scout.displayName,
        robotPosition,
        assignedBy: userData.uid,
        assignedAt: Date.now(),
      });
      await loadData();
      setShowAssignModal(false);
    } catch (error) {
      console.error("Error creating assignment:", error);
      alert("Error creating assignment");
    }
  }

  async function deleteAssignment(id: string) {
    if (!confirm("Are you sure you want to delete this assignment?")) return;
    
    try {
      await deleteDoc(doc(db, "matchAssignments", id));
      await loadData();
    } catch (error) {
      console.error("Error deleting assignment:", error);
      alert("Error deleting assignment");
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
                Match Assignments
              </h1>
              <p className="text-gray-600">
                Assign scouts to specific matches and robot positions
              </p>
            </div>
            <button
              onClick={() => setShowAssignModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded text-white font-semibold hover:opacity-90"
              style={{ backgroundColor: "#c42221" }}
            >
              <Plus size={20} />
              New Assignment
            </button>
          </div>

          {/* Event Selector */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Event
            </label>
            <select
              value={selectedEvent}
              onChange={(e) => setSelectedEvent(e.target.value)}
              className="w-full max-w-md border rounded p-2"
            >
              {events.map(event => (
                <option key={event.key} value={event.key}>
                  {event.name}
                </option>
              ))}
            </select>
          </div>

          {/* Assignments List */}
          {loading ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <div className="text-4xl mb-4">⏳</div>
              <p className="text-gray-600">Loading assignments...</p>
            </div>
          ) : assignments.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <div className="text-6xl mb-4">📋</div>
              <h2 className="text-2xl font-semibold mb-2">No Assignments Yet</h2>
              <p className="text-gray-600 mb-6">
                Create assignments to organize your scouting team for this event.
              </p>
              <button
                onClick={() => setShowAssignModal(true)}
                className="px-6 py-3 rounded text-white font-semibold"
                style={{ backgroundColor: "#c42221" }}
              >
                Create First Assignment
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Match
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Scout
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Robot Position
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Assigned
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {assignments.map(assignment => (
                    <tr key={assignment.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Calendar size={16} className="text-gray-400" />
                          <span className="font-medium">{assignment.matchKey}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Users size={16} className="text-gray-400" />
                          <span>{assignment.scoutName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          Robot {assignment.robotPosition}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {new Date(assignment.assignedAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => deleteAssignment(assignment.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Assignment Modal */}
          {showAssignModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
                <h2 className="text-2xl font-bold mb-4" style={{ color: "#c42221" }}>
                  New Assignment
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Match Key
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., qm1, sf1m1"
                      className="w-full border rounded p-2"
                      id="matchKeyInput"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Scout
                    </label>
                    <select className="w-full border rounded p-2" id="scoutSelect">
                      <option value="">Select Scout</option>
                      {scouts.map(scout => (
                        <option key={scout.uid} value={scout.uid}>
                          {scout.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Robot Position
                    </label>
                    <select className="w-full border rounded p-2" id="positionSelect">
                      <option value="">Select Position</option>
                      <option value="1">Robot 1</option>
                      <option value="2">Robot 2</option>
                      <option value="3">Robot 3</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => {
                      const matchKey = (document.getElementById("matchKeyInput") as HTMLInputElement)?.value;
                      const scoutId = (document.getElementById("scoutSelect") as HTMLSelectElement)?.value;
                      const position = (document.getElementById("positionSelect") as HTMLSelectElement)?.value;
                      
                      if (matchKey && scoutId && position) {
                        createAssignment(matchKey, scoutId, parseInt(position) as 1 | 2 | 3);
                      } else {
                        alert("Please fill in all fields");
                      }
                    }}
                    className="flex-1 py-2 rounded text-white font-semibold"
                    style={{ backgroundColor: "#c42221" }}
                  >
                    Create
                  </button>
                  <button
                    onClick={() => setShowAssignModal(false)}
                    className="flex-1 py-2 rounded border-2 border-gray-300 text-gray-700 font-medium"
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

export default function AssignmentsPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach"]}>
      <AssignmentsContent />
    </ProtectedRoute>
  );
}