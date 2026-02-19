"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { Calendar, Users, Trash2, Plus, ClipboardCheck } from "lucide-react";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import { getEventMatches, type TBAMatch } from "@/app/utils/tba-api";

interface Assignment {
  id: string;
  eventKey: string;
  matchKey: string;
  matchLabel: string;
  scoutId: string;
  scoutName: string;
  teamNumber: number;
  assignedBy: string;
  assignedAt: number;
}

interface TeamMember {
  uid: string;
  displayName: string;
  role: string;
}

type MatchOption = {
  key: string;
  label: string;
  teams: number[];
  compLevel: TBAMatch["comp_level"];
  matchNumber: number;
  setNumber: number;
  scheduleTime: number;
};

function compLevelPriority(compLevel: string) {
  if (compLevel === "qm") return 0;
  if (compLevel === "ef") return 1;
  if (compLevel === "qf") return 2;
  if (compLevel === "sf") return 3;
  if (compLevel === "f") return 4;
  return 999;
}

function matchLabel(match: TBAMatch) {
  if (match.comp_level === "qm") return `Qualification ${match.match_number}`;
  if (match.comp_level === "f") return `Finals ${match.match_number}`;
  if (match.comp_level === "sf") return `Semifinal ${match.set_number}-${match.match_number}`;
  if (match.comp_level === "qf") return `Quarterfinal ${match.set_number}-${match.match_number}`;
  if (match.comp_level === "ef") return `Octofinal ${match.set_number}-${match.match_number}`;
  return match.key;
}

function AssignmentsContent() {
  const { userData } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selectedEvent, setSelectedEvent] = useState("2026arli");
  const [loading, setLoading] = useState(true);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [matchOptions, setMatchOptions] = useState<MatchOption[]>([]);
  const [eventAttendees, setEventAttendees] = useState<Record<string, string[]>>({});

  const [selectedMatchKey, setSelectedMatchKey] = useState("");
  const [selectedScoutId, setSelectedScoutId] = useState("");
  const [selectedTeamNumber, setSelectedTeamNumber] = useState("");
  const [selectedMatchType, setSelectedMatchType] = useState<"practice" | "qualification" | "finals">("qualification");

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
      const [membersSnap, assignmentsSnap, teamDoc] = await Promise.all([
        getDocs(query(collection(db, "users"), where("teamId", "==", userData.teamId))),
        getDocs(query(collection(db, "matchAssignments"), where("eventKey", "==", selectedEvent))),
        getDoc(doc(db, "teams", userData.teamId)),
      ]);

      setMembers(membersSnap.docs.map((memberDoc) => ({ uid: memberDoc.id, ...memberDoc.data() } as TeamMember)));
      setAssignments(
        assignmentsSnap.docs.map((assignmentDoc) => ({
          id: assignmentDoc.id,
          ...assignmentDoc.data(),
        })) as Assignment[]
      );

      const teamData = teamDoc.exists() ? teamDoc.data() : {};
      setEventAttendees(teamData.eventAttendees || {});

      try {
        const matches = await getEventMatches(selectedEvent);
        const sorted = [...matches].sort((a, b) => {
          const priorityDiff = compLevelPriority(a.comp_level) - compLevelPriority(b.comp_level);
          if (priorityDiff !== 0) return priorityDiff;
          if (a.set_number !== b.set_number) return a.set_number - b.set_number;
          return a.match_number - b.match_number;
        });

        const options = sorted.map((match) => ({
          key: match.key,
          label: matchLabel(match),
          teams: [...match.alliances.red.team_keys, ...match.alliances.blue.team_keys]
            .map((teamKey) => parseInt(teamKey.replace("frc", ""), 10))
            .filter((teamNumber) => !Number.isNaN(teamNumber)),
          compLevel: match.comp_level,
          matchNumber: match.match_number,
          setNumber: match.set_number,
          scheduleTime: match.actual_time || match.predicted_time || match.time || 0,
        }));
        setMatchOptions(options);
      } catch (error) {
        console.error("Unable to fetch TBA matches for assignments:", error);
        setMatchOptions([]);
      }
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  }

  const selectedMatch = useMemo(
    () => matchOptions.find((match) => match.key === selectedMatchKey) || null,
    [matchOptions, selectedMatchKey]
  );
  const activeOrNextMatchKey = useMemo(() => {
    const now = Date.now() / 1000;
    const timedMatches = [...matchOptions]
      .filter((match) => match.scheduleTime > 0)
      .sort((a, b) => a.scheduleTime - b.scheduleTime);
    if (timedMatches.length === 0) return "";
    const active = timedMatches.find((match) => now >= match.scheduleTime && now <= match.scheduleTime + 8 * 60);
    if (active) return active.key;
    const next = timedMatches.find((match) => match.scheduleTime >= now);
    return next?.key || timedMatches[timedMatches.length - 1].key;
  }, [matchOptions]);

  const typeFilteredMatches = useMemo(() => {
    if (selectedMatchType === "practice") {
      return matchOptions.filter((match) => match.compLevel === "qm").slice(0, 20);
    }
    if (selectedMatchType === "qualification") {
      return matchOptions.filter((match) => match.compLevel === "qm");
    }
    return matchOptions.filter((match) => match.compLevel !== "qm");
  }, [matchOptions, selectedMatchType]);

  async function createAssignment() {
    if (!userData || !selectedMatch || !selectedScoutId || !selectedTeamNumber) return;
    const scout = members.find((member) => member.uid === selectedScoutId);
    if (!scout) return;

    try {
      await addDoc(collection(db, "matchAssignments"), {
        eventKey: selectedEvent,
        matchKey: selectedMatch.key,
        matchLabel: selectedMatch.label,
        scoutId: selectedScoutId,
        scoutName: scout.displayName,
        teamNumber: parseInt(selectedTeamNumber, 10),
        assignedBy: userData.uid,
        assignedAt: Date.now(),
      });
      setSelectedMatchKey("");
      setSelectedScoutId("");
      setSelectedTeamNumber("");
      setSelectedMatchType("qualification");
      setShowAssignModal(false);
      await loadData();
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

  async function randomizeAllAssignments() {
    if (!userData || !selectedEvent) return;
    const qualificationMatches = matchOptions.filter((match) => match.compLevel === "qm");
    if (qualificationMatches.length === 0) {
      alert("No qualification matches available to randomize.");
      return;
    }

    const attendeeNames = eventAttendees[selectedEvent] || [];
    const attendeeMembers = members.filter((member) => attendeeNames.includes(member.displayName));
    const eligibleMembers = (attendeeMembers.length > 0 ? attendeeMembers : members).filter(
      (member) => member.displayName.trim().length > 0
    );
    if (eligibleMembers.length === 0) {
      alert("No available members to assign.");
      return;
    }

    if (!confirm("Randomize all qualification assignments for this event? Existing assignments will be replaced.")) return;

    try {
      const existing = assignments.filter((assignment) => assignment.eventKey === selectedEvent);
      await Promise.all(existing.map((assignment) => deleteDoc(doc(db, "matchAssignments", assignment.id))));

      const newAssignments: Array<Omit<Assignment, "id">> = [];
      let scoutPointer = 0;
      qualificationMatches.forEach((match) => {
        match.teams.forEach((teamNumber) => {
          const scout = eligibleMembers[scoutPointer % eligibleMembers.length];
          scoutPointer += 1;
          newAssignments.push({
            eventKey: selectedEvent,
            matchKey: match.key,
            matchLabel: match.label,
            scoutId: scout.uid,
            scoutName: scout.displayName,
            teamNumber,
            assignedBy: userData.uid,
            assignedAt: Date.now(),
          });
        });
      });

      await Promise.all(newAssignments.map((assignment) => addDoc(collection(db, "matchAssignments"), assignment)));
      await loadData();
      alert(`Randomized ${newAssignments.length} assignments across ${qualificationMatches.length} matches.`);
    } catch (error) {
      console.error("Error randomizing assignments:", error);
      alert("Error randomizing assignments.");
    }
  }

  function toggleAttendee(displayName: string) {
    const current = eventAttendees[selectedEvent] || [];
    const updated = current.includes(displayName)
      ? current.filter((name) => name !== displayName)
      : [...current, displayName];
    setEventAttendees((prev) => ({ ...prev, [selectedEvent]: updated }));
  }

  async function saveAttendees() {
    if (!userData?.teamId) return;
    try {
      await setDoc(doc(db, "teams", userData.teamId), { eventAttendees }, { merge: true });
      alert("Event attendees saved.");
    } catch (error) {
      console.error("Error saving attendees:", error);
      alert("Could not save attendees.");
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold mb-2 theme-text">Match Assignments</h1>
              <p className="text-gray-600">Assign team members and set who is attending each event.</p>
            </div>
            <button
              onClick={() => setShowAssignModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded text-white font-semibold hover:opacity-90"
              style={{ backgroundColor: "var(--primary-color)" }}
            >
              <Plus size={20} />
              New Assignment
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Select Event</label>
            <select
              value={selectedEvent}
              onChange={(e) => setSelectedEvent(e.target.value)}
              className="w-full max-w-md border rounded p-2"
            >
              {events.map((event) => (
                <option key={event.key} value={event.key}>
                  {event.name}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Event Attendance</h2>
              <button
                onClick={saveAttendees}
                className="px-4 py-2 rounded text-white text-sm font-medium"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                Save Attendees
              </button>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {members.map((member) => (
                <label key={member.uid} className="flex items-center gap-2 p-3 border rounded-lg">
                  <input
                    type="checkbox"
                    checked={(eventAttendees[selectedEvent] || []).includes(member.displayName)}
                    onChange={() => toggleAttendee(member.displayName)}
                  />
                  <span className="font-medium">{member.displayName}</span>
                  <span className="text-xs text-gray-500 capitalize">{member.role}</span>
                </label>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <LoadingSpinner />
              <p className="text-gray-600">Loading assignments...</p>
            </div>
          ) : assignments.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <ClipboardCheck size={56} className="mx-auto mb-4 text-gray-400" />
              <h2 className="text-2xl font-semibold mb-2">No Assignments Yet</h2>
              <p className="text-gray-600 mb-6">Create assignments to organize your scouting team for this event.</p>
              <button
                onClick={() => setShowAssignModal(true)}
                className="px-6 py-3 rounded text-white font-semibold"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                Create First Assignment
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Match</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Member</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assigned</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {assignments.map((assignment) => (
                    <tr key={assignment.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Calendar size={16} className="text-gray-400" />
                          <span className="font-medium">{assignment.matchLabel || assignment.matchKey}</span>
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
                          Team {assignment.teamNumber}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {new Date(assignment.assignedAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button onClick={() => deleteAssignment(assignment.id)} className="text-red-600 hover:text-red-800">
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-md overflow-hidden mt-6">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Match Schedule</h2>
                <p className="text-sm text-gray-600">Live schedule with assigned scouts for each team.</p>
              </div>
              <button
                onClick={randomizeAllAssignments}
                className="px-4 py-2 rounded text-white text-sm font-semibold"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                Randomize All
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Match</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assignments</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {matchOptions.map((match) => {
                    const matchAssignments = assignments.filter((assignment) => assignment.matchKey === match.key);
                    const isActive = activeOrNextMatchKey === match.key;
                    return (
                      <tr key={match.key} className={isActive ? "bg-yellow-50" : ""}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="font-medium">{match.label}</span>
                          {isActive && <span className="ml-2 text-xs font-semibold text-yellow-700">ACTIVE/NEXT</span>}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {match.scheduleTime > 0
                            ? new Date(match.scheduleTime * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                            : "TBD"}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {matchAssignments.length === 0
                            ? "Unassigned"
                            : matchAssignments
                                .map((assignment) => `T${assignment.teamNumber}: ${assignment.scoutName}`)
                                .join(" | ")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {showAssignModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
                <h2 className="text-2xl font-bold mb-4 theme-text">New Assignment</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Match</label>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <button
                        onClick={() => {
                          setSelectedMatchType("practice");
                          setSelectedMatchKey("");
                          setSelectedTeamNumber("");
                        }}
                        className={`py-2 rounded text-sm font-medium ${selectedMatchType === "practice" ? "bg-red-600 text-white" : "bg-gray-100"}`}
                      >
                        Practice
                      </button>
                      <button
                        onClick={() => {
                          setSelectedMatchType("qualification");
                          setSelectedMatchKey("");
                          setSelectedTeamNumber("");
                        }}
                        className={`py-2 rounded text-sm font-medium ${selectedMatchType === "qualification" ? "bg-red-600 text-white" : "bg-gray-100"}`}
                      >
                        Qual
                      </button>
                      <button
                        onClick={() => {
                          setSelectedMatchType("finals");
                          setSelectedMatchKey("");
                          setSelectedTeamNumber("");
                        }}
                        className={`py-2 rounded text-sm font-medium ${selectedMatchType === "finals" ? "bg-red-600 text-white" : "bg-gray-100"}`}
                      >
                        Finals
                      </button>
                    </div>
                    <div className="max-h-48 overflow-y-auto border rounded p-2 space-y-2">
                      {typeFilteredMatches.map((match) => (
                        <button
                          key={match.key}
                          onClick={() => {
                            setSelectedMatchKey(match.key);
                            setSelectedTeamNumber("");
                          }}
                          className={`w-full text-left px-3 py-2 rounded border ${
                            selectedMatchKey === match.key ? "border-red-500 bg-red-50" : "border-gray-200 hover:bg-gray-50"
                          }`}
                        >
                          <span className="font-medium">{match.label}</span>
                        </button>
                      ))}
                      {typeFilteredMatches.length === 0 && (
                        <p className="text-sm text-gray-500 text-center py-4">No matches found for this type.</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Member</label>
                    <select
                      className="w-full border rounded p-2"
                      value={selectedScoutId}
                      onChange={(e) => setSelectedScoutId(e.target.value)}
                    >
                      <option value="">Select Member</option>
                      {members.map((member) => (
                        <option key={member.uid} value={member.uid}>
                          {member.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Team</label>
                    <select
                      className="w-full border rounded p-2 disabled:bg-gray-100 disabled:text-gray-500"
                      value={selectedTeamNumber}
                      onChange={(e) => setSelectedTeamNumber(e.target.value)}
                      disabled={!selectedMatch}
                    >
                      <option value="">{selectedMatch ? "Select Team" : "Select Match First"}</option>
                      {selectedMatch?.teams.map((team) => (
                        <option key={team} value={team}>
                          Team {team}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={createAssignment}
                    className="flex-1 py-2 rounded text-white font-semibold disabled:opacity-50"
                    style={{ backgroundColor: "var(--primary-color)" }}
                    disabled={!selectedMatchKey || !selectedScoutId || !selectedTeamNumber}
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
