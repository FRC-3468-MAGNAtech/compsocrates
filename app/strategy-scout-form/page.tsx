"use client";

import { useState } from "react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";

function StrategyScoutFormContent() {
  const { userData } = useAuth();
  if (!userData?.isTeamAdmin) {
    return (
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto bg-white rounded-xl shadow p-6">
            <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
              Strategy Scout Form
            </h1>
            <p className="text-gray-600">
              This form is temporarily limited to team admins while form rollout is in progress.
            </p>
          </div>
        </div>
      </div>
    );
  }
  const [saving, setSaving] = useState(false);
  const [teamNumber, setTeamNumber] = useState("");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!userData?.uid || !teamNumber.trim()) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "strategyScouting"), {
        scoutName: userData.displayName || "",
        scoutId: userData.uid,
        teamId: userData.teamId || "",
        teamNumber: teamNumber.trim(),
        strategySummary: summary.trim(),
        notes: notes.trim(),
        game: "REEFSCAPE",
        createdAt: Date.now(),
        isPlaceholderForm: true,
      });
      alert("Strategy Scout placeholder submitted.");
      setTeamNumber("");
      setSummary("");
      setNotes("");
    } catch (error) {
      console.error("Error submitting strategy scout form:", error);
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
              Strategy Scout Form
            </h1>
            <p className="text-sm text-gray-600">Placeholder form for pit strategy scouting.</p>
          </div>
          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            <input className="w-full border rounded p-3" placeholder="Team Number" value={teamNumber} onChange={(e) => setTeamNumber(e.target.value)} required />
            <input className="w-full border rounded p-3" placeholder="Strategy Summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
            <textarea className="w-full border rounded p-3 h-36" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <button type="submit" disabled={saving} className="w-full py-3 rounded text-white font-semibold disabled:opacity-60" style={{ backgroundColor: "var(--primary-color)" }}>
            {saving ? "Submitting..." : "Submit Strategy Scout Form"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function StrategyScoutFormPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <StrategyScoutFormContent />
    </ProtectedRoute>
  );
}
