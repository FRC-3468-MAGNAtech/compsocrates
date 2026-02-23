"use client";

import Link from "next/link";
import { useState } from "react";
import { collection, doc, getDocs, query, setDoc, where, writeBatch } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";

function AdminPanelContent() {
  const { userData } = useAuth();
  const [savingDashboard, setSavingDashboard] = useState(false);
  const [deletingBayou, setDeletingBayou] = useState(false);
  const [deletingMatchOnlyRows, setDeletingMatchOnlyRows] = useState(false);
  const dashboardOptions = [
    { label: "Match Scout", value: "/match-scout-dashboard" },
    { label: "Pit Scout", value: "/pit-scout-dashboard" },
    { label: "Pit Team", value: "/pit-team-dashboard" },
    { label: "Drive Team", value: "/drive-team-dashboard" },
    { label: "Lead Scout", value: "/lead-scout-dashboard" },
    { label: "Lead Strategist", value: "/lead-strategist-dashboard" },
    { label: "Team Coach", value: "/team-coach-dashboard" },
  ];

  async function savePreferredDashboard(nextValue: string) {
    if (!userData?.uid) return;
    setSavingDashboard(true);
    try {
      await setDoc(doc(db, "users", userData.uid), { preferredDashboard: nextValue }, { merge: true });
      alert("Default dashboard updated.");
    } catch (error) {
      console.error("Failed to save preferred dashboard:", error);
      alert("Unable to save default dashboard.");
    } finally {
      setSavingDashboard(false);
    }
  }

  async function deleteBayou2025ReefscapeMatches() {
    if (!userData?.isTeamAdmin) {
      alert("Only team admins can run this action.");
      return;
    }

    const phrase = window.prompt(
      'This will permanently delete scouting rows where eventKey="2025lake" and game="REEFSCAPE".\n\nType DELETE to continue:'
    );
    if (phrase !== "DELETE") {
      alert("Delete cancelled.");
      return;
    }

    setDeletingBayou(true);
    try {
      const targetQuery = query(
        collection(db, "scouting"),
        where("eventKey", "==", "2025lake"),
        where("game", "==", "REEFSCAPE")
      );
      const snap = await getDocs(targetQuery);
      if (snap.empty) {
        alert("No matching Bayou 2025 REEFSCAPE scouting rows found.");
        return;
      }

      const docs = snap.docs;
      let deleted = 0;
      for (let i = 0; i < docs.length; i += 450) {
        const chunk = docs.slice(i, i + 450);
        const batch = writeBatch(db);
        chunk.forEach((row) => batch.delete(row.ref));
        await batch.commit();
        deleted += chunk.length;
      }

      alert(`Deleted ${deleted} Bayou 2025 REEFSCAPE scouting rows.`);
    } catch (error) {
      console.error("Failed deleting Bayou 2025 REEFSCAPE rows:", error);
      alert("Delete failed. Check console for details.");
    } finally {
      setDeletingBayou(false);
    }
  }

  function isMatchOnlyRow(entry: Record<string, unknown>) {
    const isEffectivelyEmptyText = (value: unknown) => {
      const raw = String(value ?? "").trim().toLowerCase();
      return raw === "" || raw === "0" || raw === "-" || raw === "n/a" || raw === "na" || raw === "unknown";
    };
    const numbers = [
      entry.autoCoralMissed,
      entry.autoCoralL1,
      entry.autoCoralL2,
      entry.autoCoralL3,
      entry.autoCoralL4,
      entry.autoAlgaeProcessorMissed,
      entry.autoAlgaeProcessorScored,
      entry.autoAlgaeNetMissed,
      entry.autoAlgaeNetScored,
      entry.teleopCoralMissed,
      entry.teleopCoralL1,
      entry.teleopCoralL2,
      entry.teleopCoralL3,
      entry.teleopCoralL4,
      entry.teleopProcessorMissed,
      entry.teleopProcessorScored,
      entry.teleopNetRobotMissed,
      entry.teleopNetRobotScored,
      entry.teleopNetHumanMissed,
      entry.teleopNetHumanScored,
      entry.failedClimb,
    ];
    const hasAnyNumbers = numbers.some((value) => Number(value || 0) > 0);
    return (
      isEffectivelyEmptyText(entry.teamNumber) &&
      isEffectivelyEmptyText(entry.scoutName) &&
      isEffectivelyEmptyText(entry.startingPosition) &&
      isEffectivelyEmptyText(entry.stageStatus) &&
      isEffectivelyEmptyText(entry.notes) &&
      (!Array.isArray(entry.incidents) || entry.incidents.length === 0) &&
      !Boolean(entry.leftStartingZone) &&
      !Boolean(entry.teleopAlgaeRemoved) &&
      !hasAnyNumbers
    );
  }

  async function deleteMatchOnlyRows() {
    if (!userData?.isTeamAdmin) {
      alert("Only team admins can run this action.");
      return;
    }

    setDeletingMatchOnlyRows(true);
    try {
      const snap = await getDocs(collection(db, "scouting"));
      const matchOnlyDocs = snap.docs.filter((row) => isMatchOnlyRow(row.data() as Record<string, unknown>));
      if (matchOnlyDocs.length === 0) {
        alert("No match-only rows found.");
        return;
      }

      const ok = window.confirm(
        `Delete ${matchOnlyDocs.length} match-only rows? This removes rows that only contain a match label.`
      );
      if (!ok) {
        alert("Delete cancelled.");
        return;
      }

      let deleted = 0;
      for (let i = 0; i < matchOnlyDocs.length; i += 450) {
        const chunk = matchOnlyDocs.slice(i, i + 450);
        const batch = writeBatch(db);
        chunk.forEach((row) => batch.delete(row.ref));
        await batch.commit();
        deleted += chunk.length;
      }

      alert(`Deleted ${deleted} match-only rows.`);
    } catch (error) {
      console.error("Failed deleting match-only rows:", error);
      alert("Delete failed. Check console for details.");
    } finally {
      setDeletingMatchOnlyRows(false);
    }
  }

  if (!userData?.isTeamAdmin) {
    return (
      <div className="flex h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-xl bg-white rounded-xl shadow-md p-6">
            <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>Admin Panel</h1>
            <p className="text-gray-600">Only team admins can access this panel.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>Admin Panel</h1>
          <p className="text-gray-600 mb-8">Search Firestore IDs for scouting and practice session records.</p>

          <div className="bg-white rounded-xl shadow-md p-6 border mb-4">
            <h2 className="text-xl font-semibold mb-2">Default Dashboard</h2>
            <p className="text-sm text-gray-600 mb-3">Set where your Dashboard button sends you by default.</p>
            <select
              className="w-full max-w-md border rounded p-2"
              value={String(userData.preferredDashboard || "")}
              onChange={(event) => void savePreferredDashboard(event.target.value)}
              disabled={savingDashboard}
            >
              <option value="">Role-Based Default</option>
              {dashboardOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Link href="/admin/match-scout-ids" className="bg-white rounded-xl shadow-md p-6 border hover:bg-gray-50">
              <h2 className="text-xl font-semibold mb-2">Match Scout IDs</h2>
              <p className="text-sm text-gray-600">Search scouting document IDs for official match scouting rows.</p>
            </Link>
            <Link href="/admin/practice-session-ids" className="bg-white rounded-xl shadow-md p-6 border hover:bg-gray-50">
              <h2 className="text-xl font-semibold mb-2">Practice Session IDs</h2>
              <p className="text-sm text-gray-600">Search practice session document IDs for team members.</p>
            </Link>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6 border mt-4">
            <h2 className="text-xl font-semibold mb-2">Maintenance</h2>
            <p className="text-sm text-gray-600 mb-3">
              Permanently delete Bayou 2025 REEFSCAPE match scouting rows.
            </p>
            <button
              type="button"
              onClick={() => void deleteBayou2025ReefscapeMatches()}
              disabled={deletingBayou}
              className="px-4 py-2 rounded text-white disabled:opacity-60"
              style={{ backgroundColor: "#b91c1c" }}
            >
              {deletingBayou ? "Deleting..." : "Delete Bayou 2025 REEFSCAPE Matches"}
            </button>

            <div className="mt-5">
              <p className="text-sm text-gray-600 mb-3">
                Remove match-only rows with no scouting data (only a match label).
              </p>
              <button
                type="button"
                onClick={() => void deleteMatchOnlyRows()}
                disabled={deletingMatchOnlyRows}
                className="px-4 py-2 rounded text-white disabled:opacity-60"
                style={{ backgroundColor: "#b91c1c" }}
              >
                {deletingMatchOnlyRows ? "Deleting..." : "Delete Match-Only Rows"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminPanelPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach", "scout"]}>
      <AdminPanelContent />
    </ProtectedRoute>
  );
}


