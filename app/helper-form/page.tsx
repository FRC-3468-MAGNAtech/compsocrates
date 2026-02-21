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
  const [assistedTeamNumber, setAssistedTeamNumber] = useState("");
  const [workPerformed, setWorkPerformed] = useState("");
  const [outcome, setOutcome] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!userData?.uid || !assistedTeamNumber.trim()) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "helperReports"), {
        helperName: userData.displayName || "",
        helperId: userData.uid,
        teamId: userData.teamId || "",
        assistedTeamNumber: assistedTeamNumber.trim(),
        workPerformed: workPerformed.trim(),
        outcome: outcome.trim(),
        game: "REEFSCAPE",
        createdAt: Date.now(),
        isPlaceholderForm: true,
      });
      alert("Helper Form submitted.");
      setAssistedTeamNumber("");
      setWorkPerformed("");
      setOutcome("");
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
            <p className="text-sm text-gray-600">Placeholder form for documenting pit-team assistance given to other teams.</p>
          </div>
          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            <input className="w-full border rounded p-3" placeholder="Assisted Team Number" value={assistedTeamNumber} onChange={(e) => setAssistedTeamNumber(e.target.value)} required />
            <textarea className="w-full border rounded p-3 h-28" placeholder="What work was performed?" value={workPerformed} onChange={(e) => setWorkPerformed(e.target.value)} />
            <textarea className="w-full border rounded p-3 h-28" placeholder="Outcome / result" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
          </div>
          <button type="submit" disabled={saving} className="w-full py-3 rounded text-white font-semibold disabled:opacity-60" style={{ backgroundColor: "var(--primary-color)" }}>
            {saving ? "Submitting..." : "Submit Helper Form"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function HelperFormPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["pit-team", "lead-scout", "lead-strategist", "coach", "scout"]}>
      <HelperFormContent />
    </ProtectedRoute>
  );
}

