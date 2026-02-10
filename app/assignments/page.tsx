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

    try {
      const scout = scouts.find(s => s.uid === scoutId);
      if (!scout) return;

      await addDoc(collection(db, "matchAssignments"), {
        eventKey: selectedEvent,
        matchKey,
        scoutId,
        scoutName: scout.displayName,
        robotPosition,
        assignedBy: userData.displayName,
        assignedAt: Date.now(),
      });

      loadData();
      alert("Assignment created!");
    } catch (error) {
      console.error("Error creating assignment:", error);
      alert("Failed to create assignment");
    }
  }

  async function deleteAssignment(assignmentId: string) {
    if (!confirm("Remove this assignment?")) return;

    try {
      await deleteDoc(doc(db, "matchAssignments", assignmentId));
      loadData();
    } catch (error) {
      console.error("Error deleting assignment:", error);
      alert("Failed to delete assignment");
    }
  }

  // Group assignments by match
  const assignmentsByMatch = assignments.reduce((acc, a) => {
    if (!acc[a.matchKey]) acc[a.matchKey] = [];
    acc[a.matchKey].push(a);
    return acc;
  }, {} as Record<string, Assignment[]>);

  // Generate sample matches (Q1-Q50)
  const allMatches = Array.from({ length: 50 }, (_, i) => `q${i + 1}`);
  const unassignedMatches = allMatches.filter(m => !assignmentsByMatch[m] || assignmentsByMatch[m].length < 3);

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
          Match Assignments
        </h1>
        <p className="text-gray-600 mb-6">Assign scouts to specific matches and robots</p>

        {/* Event Selector */}
        <div className="bg-white rounded-xl shadow-md p-4 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Event</label>
          <select
            value={selectedEvent}
            onChange={(e) => setSelectedEvent(e.target.value)}
            className="w-full md:w-64 border rounded-lg p-2"
          >
            {events.map(e => (
              <option key={e.key} value={e.key}>{e.name}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-4 animate-spin">🔄</div>
            <p className="text-gray-600">Loading assignments...</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Assigned Matches */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Assigned Matches</h2>
                <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-semibold">
                  {Object.keys(assignmentsByMatch).length}
                </div>
              </div>

              <div className="space-y-3">
                {Object.keys(assignmentsByMatch).length === 0 ? (
                  <div className="bg-white rounded-xl p-8 text-center text-gray-500">
                    <Calendar className="mx-auto mb-2" size={48} />
                    <p>No assignments yet</p>
                  </div>
                ) : (
                  Object.entries(assignmentsByMatch)
                    .sort(([a], [b]) => {
                      const aNum = parseInt(a.slice(1));
                      const bNum = parseInt(b.slice(1));
                      return aNum - bNum;
                    })
                    .map(([matchKey, matchAssignments]) => (
                      <div key={matchKey} className="bg-white rounded-xl shadow p-4">
                        <div className="font-bold mb-2 uppercase">{matchKey}</div>
                        <div className="space-y-2">
                          {matchAssignments.map(a => (
                            <div key={a.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-800 flex items-center justify-center text-xs font-bold">
                                  {a.robotPosition}
                                </div>
                                <span className="text-sm font-medium">{a.scoutName}</span>
                              </div>
                              <button
                                onClick={() => deleteAssignment(a.id)}
                                className="p-1 hover:bg-red-100 rounded text-red-600"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>

            {/* Quick Assign */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Quick Assign</h2>
                <div className="bg-gray-200 text-gray-800 px-3 py-1 rounded-full text-sm font-semibold">
                  {scouts.length} scouts
                </div>
              </div>

              <div className="bg-white rounded-xl shadow p-4 mb-4">
                <h3 className="font-semibold mb-3">Unassigned Matches</h3>
                <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                  {unassignedMatches.slice(0, 20).map(match => (
                    <button
                      key={match}
                      onClick={() => {
                        const matchKey = match;
                        const scout = scouts[0];
                        if (scout) createAssignment(matchKey, scout.uid, 1);
                      }}
                      className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded font-mono text-sm uppercase"
                    >
                      {match}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl shadow p-4">
                <h3 className="font-semibold mb-3">Available Scouts</h3>
                <div className="space-y-2">
                  {scouts.map(scout => (
                    <div key={scout.uid} className="flex items-center gap-3 p-3 bg-gray-50 rounded">
                      <Users size={20} className="text-gray-400" />
                      <div className="flex-1">
                        <div className="font-medium">{scout.displayName}</div>
                        <div className="text-xs text-gray-600 capitalize">{scout.role}</div>
                      </div>
                      <div className="text-xs text-gray-500">
                        {assignments.filter(a => a.scoutId === scout.uid).length} assigned
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
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