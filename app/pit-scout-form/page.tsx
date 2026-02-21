"use client";

import { useMemo, useState } from "react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { APP_EVENT_BY_KEY } from "@/app/utils/events";

type PitScoutPlaceholder = {
  scoutName: string;
  teamNumber: string;
  robotPictureUrl: string;
  autoCapabilities: string;
  notes: string;
};

function buildPitReefscapePayload(input: PitScoutPlaceholder, userId: string, teamId: string) {
  const now = Date.now();
  const eventKey = "app-testing";
  const eventName = APP_EVENT_BY_KEY[eventKey]?.name || "App Testing";
  return {
    scoutName: input.scoutName.trim(),
    teamNumber: input.teamNumber.trim(),
    robotPictureUrl: input.robotPictureUrl.trim(),
    autoCapabilities: input.autoCapabilities.trim(),
    notes: input.notes.trim(),
    eventKey,
    eventName,
    game: "REEFSCAPE",
    teamId,
    submittedBy: userId,
    createdAt: now,
    isPlaceholderForm: true,
    pitDisposition: false,
    driveDisposition: false,
    driveBaseType: "",
    centerOfGravity: "",
    collectCoralStation: false,
    collectCoralGround: false,
    coralL4: false,
    coralL3: false,
    coralL2: false,
    coralL1: false,
    collectAlgaeReef: false,
    collectAlgaeGround: false,
    scoreProcessor: false,
    scoreNetRobot: false,
    bargeCapability: "",
    startingOpposite: false,
    startingMiddle: false,
    startingProcessor: false,
    betterAt: "",
    rating: 3,
  };
}

function PitScoutPlaceholderContent() {
  const { userData } = useAuth();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PitScoutPlaceholder>({
    scoutName: userData?.displayName || "",
    teamNumber: "",
    robotPictureUrl: "",
    autoCapabilities: "",
    notes: "",
  });

  const canSubmit = useMemo(() => {
    return form.scoutName.trim().length > 0 && form.teamNumber.trim().length > 0;
  }, [form]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!userData?.uid || !canSubmit) return;
    setSaving(true);
    try {
      const payload = buildPitReefscapePayload(form, userData.uid, userData.teamId || "");
      await addDoc(collection(db, "pitScouting"), payload);
      alert("Pit Scout placeholder submitted.");
      setForm((prev) => ({
        ...prev,
        teamNumber: "",
        robotPictureUrl: "",
        autoCapabilities: "",
        notes: "",
      }));
    } catch (error) {
      console.error("Error submitting placeholder pit scout form:", error);
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
              Pit Scout Form (Placeholder Rebuild)
            </h1>
            <p className="text-sm text-gray-600">
              Rebuilt placeholder while preserving Reefscape pit payload fields for assignment compatibility.
            </p>
          </div>

          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            <h2 className="text-lg font-semibold">Core Inputs</h2>
            <input
              type="text"
              value={form.scoutName}
              onChange={(event) => setForm({ ...form, scoutName: event.target.value })}
              className="w-full border rounded p-3"
              placeholder="Scout Name"
              required
            />
            <input
              type="text"
              value={form.teamNumber}
              onChange={(event) => setForm({ ...form, teamNumber: event.target.value })}
              className="w-full border rounded p-3"
              placeholder="Team Number"
              required
            />
            <input
              type="url"
              value={form.robotPictureUrl}
              onChange={(event) => setForm({ ...form, robotPictureUrl: event.target.value })}
              className="w-full border rounded p-3"
              placeholder="Picture of Robot URL"
            />
            <input
              type="text"
              value={form.autoCapabilities}
              onChange={(event) => setForm({ ...form, autoCapabilities: event.target.value })}
              className="w-full border rounded p-3"
              placeholder="Capabilities in auto"
            />
            <textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              className="w-full border rounded p-3 h-36"
              placeholder="Placeholder notes"
            />
          </div>

          <button
            type="submit"
            disabled={!canSubmit || saving}
            className="w-full py-3 rounded text-white font-semibold disabled:opacity-60"
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            {saving ? "Submitting..." : "Submit Placeholder Pit Scout Form"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function PitScoutPlaceholderPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["pit-scout", "lead-strategist", "lead-scout", "pit-team", "drive-team", "match-scout", "coach", "scout"]}>
      <PitScoutPlaceholderContent />
    </ProtectedRoute>
  );
}

