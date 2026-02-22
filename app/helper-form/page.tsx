"use client";

import { useState } from "react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";

function HelperFormContent() {
  const { userData } = useAuth();
  const [saving, setSaving] = useState(false);
  const [teamNumber, setTeamNumber] = useState("");
  const [successful, setSuccessful] = useState(false);
  const [issueSolved, setIssueSolved] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!userData?.uid || !userData.teamId || !teamNumber.trim()) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "helperReports"), {
        helperName: userData.displayName || "",
        helperId: userData.uid,
        teamId: userData.teamId,
        assistedTeamNumber: teamNumber.trim(),
        wasSuccessful: successful,
        issueSolved: issueSolved.trim(),
        game: "REBUILT",
        createdAt: Date.now(),
      });
      alert("Helper Form submitted.");
      setTeamNumber("");
      setSuccessful(false);
      setIssueSolved("");
    } catch (error) {
      console.error("Error submitting helper form:", error);
      alert("Could not submit form.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-6">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto space-y-4">
          <div className="bg-white rounded-xl shadow p-4">
            <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
              Helper Form
            </h1>
          </div>

          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Information</h2>
            <label className="block text-sm font-medium text-gray-700">Scout Name</label>
            <input className="w-full border rounded p-3 bg-gray-100 text-gray-600" value={userData?.displayName || ""} disabled />

            <label className="block text-sm font-medium text-gray-700">Team Number</label>
            <input
              className="w-full border rounded p-3"
              value={teamNumber}
              onChange={(e) => setTeamNumber(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="Team Number"
              required
            />
          </div>

          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            <h2 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>Issue</h2>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={successful} onChange={(e) => setSuccessful(e.target.checked)} />
              Were you successful?
            </label>
            <label className="block text-sm font-medium text-gray-700">Describe the issue(s) you solved</label>
            <textarea
              className="w-full border rounded p-3 h-32"
              value={issueSolved}
              onChange={(e) => setIssueSolved(e.target.value)}
              placeholder="What did you fix?"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 rounded text-white font-semibold disabled:opacity-60"
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            {saving ? "Submitting..." : "Submit Helper Form"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function HelperFormPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["pit-team"]}>
      <HelperFormContent />
    </ProtectedRoute>
  );
}
