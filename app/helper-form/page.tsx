"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { addDoc, collection, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";

function HelperFormContent() {
  const { userData } = useAuth();
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");
  const editCollectionParam = searchParams.get("editCollection");
  const editMode = Boolean(editId);
  const [saving, setSaving] = useState(false);
  const [mobileNotesOpen, setMobileNotesOpen] = useState(false);
  const [teamNumber, setTeamNumber] = useState("");
  const [successful, setSuccessful] = useState(false);
  const [issueSolved, setIssueSolved] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!editId) return;
    let isActive = true;
    const collectionName = editCollectionParam || "helperReports";
    async function loadEditEntry() {
      try {
        const snap = await getDoc(doc(db, collectionName, editId));
        if (!snap.exists()) return;
        const data = snap.data() as Record<string, unknown>;
        if (!isActive) return;
        setTeamNumber(String(data.assistedTeamNumber || data.teamNumber || ""));
        setSuccessful(Boolean(data.wasSuccessful));
        setIssueSolved(String(data.issueSolved || ""));
        setNotes(String(data.notes || ""));
      } catch (error) {
        console.error("Failed to load helper edit entry:", error);
      }
    }
    void loadEditEntry();
    return () => {
      isActive = false;
    };
  }, [editId, editCollectionParam]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!userData?.uid || !userData.teamId || !teamNumber.trim()) return;
    setSaving(true);
    try {
      const payload = {
        helperName: userData.displayName || "",
        helperId: userData.uid,
        teamId: userData.teamId,
        assistedTeamNumber: teamNumber.trim(),
        wasSuccessful: successful,
        issueSolved: issueSolved.trim(),
        notes: notes.trim(),
        game: "REBUILT",
        createdAt: Date.now(),
        submittedAt: Date.now(),
      };
      if (editMode && editId && editCollectionParam) {
        await setDoc(doc(db, editCollectionParam, editId), payload, { merge: true });
        alert("Helper Form updated.");
      } else {
        await addDoc(collection(db, "helperReports"), payload);
        alert("Helper Form submitted.");
        if (typeof window !== "undefined") {
          window.location.reload();
        }
        setTeamNumber("");
        setSuccessful(false);
        setIssueSolved("");
        setNotes("");
      }
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
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row justify-center">
        <form onSubmit={handleSubmit} className="flex-1 p-4 space-y-4 max-w-3xl">
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
            {saving ? "Submitting..." : editMode ? "Update Helper Form" : "Submit Helper Form"}
          </button>
        </form>

        <div className="hidden md:block w-80 p-4">
          <div className="bg-white rounded-xl shadow p-4 flex flex-col sticky top-4" style={{ height: "calc(100vh - 2rem)" }}>
            <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--primary-color)" }}>Notes</h2>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="flex-1 border rounded p-2 resize-none"
              placeholder="Optional notes..."
            />
          </div>
        </div>

        <div className="md:hidden fixed right-0 top-1/2 -translate-y-1/2 z-50">
          <button
            onClick={() => setMobileNotesOpen((prev) => !prev)}
            className="px-2 py-4 rounded-l-xl text-white"
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            {mobileNotesOpen ? ">" : "<"}
          </button>
        </div>
        {mobileNotesOpen && (
          <>
            <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setMobileNotesOpen(false)} />
            <div className="fixed right-0 top-0 h-full w-screen bg-white shadow-xl p-4 z-50">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-semibold" style={{ color: "var(--primary-color)" }}>Notes</h2>
                <button onClick={() => setMobileNotesOpen(false)} className="px-3 py-1 rounded bg-gray-100">Close</button>
              </div>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="w-full h-[calc(100%-3rem)] border rounded p-3 text-base resize-none"
                placeholder="Helper notes..."
              />
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}

export default function HelperFormPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["pit-team"]} formKey="helper-form">
      <HelperFormContent />
    </ProtectedRoute>
  );
}
