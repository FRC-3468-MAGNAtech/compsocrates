"use client";

import { useState } from "react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";

type FormState = {
  scoutName: string;
  teamNumber: string;
  robotPictureUrl: string;
  pitDisposition: string;
  driveDisposition: string;
  driveBaseType: string;
  centerOfGravity: string;
  collectCoralStation: boolean;
  collectCoralGround: boolean;
  coralL4: boolean;
  coralL3: boolean;
  coralL2: boolean;
  coralL1: boolean;
  collectAlgaeReef: boolean;
  collectAlgaeGround: boolean;
  scoreProcessor: boolean;
  scoreNetRobot: boolean;
  barge: string;
  autoCapabilities: string;
  startingPositions: string[];
  betterAt: string;
  rating: number;
  comments: string;
};

function PitScoutFormContent() {
  const { userData } = useAuth();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>({
    scoutName: userData?.displayName || "",
    teamNumber: "",
    robotPictureUrl: "",
    pitDisposition: "",
    driveDisposition: "",
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
    barge: "",
    autoCapabilities: "",
    startingPositions: [],
    betterAt: "",
    rating: 3,
    comments: "",
  });

  function toggleStartingPosition(position: string) {
    setForm((prev) => ({
      ...prev,
      startingPositions: prev.startingPositions.includes(position)
        ? prev.startingPositions.filter((p) => p !== position)
        : [...prev.startingPositions, position],
    }));
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await addDoc(collection(db, "pitScouting"), {
        ...form,
        teamId: userData?.teamId || "",
        submittedBy: userData?.uid || "",
        createdAt: Date.now(),
      });
      alert("Pit scouting form submitted.");
      setForm((prev) => ({ ...prev, teamNumber: "", robotPictureUrl: "", comments: "" }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-md p-6">
          <h1 className="text-3xl font-bold mb-2 theme-text">Pit Scout Form</h1>
          <p className="text-gray-600 mb-6">Copy of 3468 Pit Scouting Form</p>
          <form onSubmit={submitForm} className="space-y-5">
            <input value={form.scoutName} onChange={(e) => setForm({ ...form, scoutName: e.target.value })} className="w-full border rounded p-3" placeholder="Your Name" required />
            <input value={form.teamNumber} onChange={(e) => setForm({ ...form, teamNumber: e.target.value })} className="w-full border rounded p-3" placeholder="Team Number" required />
            <input value={form.robotPictureUrl} onChange={(e) => setForm({ ...form, robotPictureUrl: e.target.value })} className="w-full border rounded p-3" placeholder="Picture of Robot (URL)" />

            <select value={form.pitDisposition} onChange={(e) => setForm({ ...form, pitDisposition: e.target.value })} className="w-full border rounded p-3">
              <option value="">Team Disposition (Pit)</option>
              <option>Friendly & easy to work with (Pit)</option>
            </select>
            <select value={form.driveDisposition} onChange={(e) => setForm({ ...form, driveDisposition: e.target.value })} className="w-full border rounded p-3">
              <option value="">Team Disposition (Drive)</option>
              <option>Friendly & easy to work with (Drive)</option>
            </select>

            <select value={form.driveBaseType} onChange={(e) => setForm({ ...form, driveBaseType: e.target.value })} className="w-full border rounded p-3">
              <option value="">Drive Base Type</option>
              <option>Swerve L1</option><option>Swerve L2</option><option>Swerve L3</option><option>Tank</option><option>Mecanum</option>
            </select>
            <select value={form.centerOfGravity} onChange={(e) => setForm({ ...form, centerOfGravity: e.target.value })} className="w-full border rounded p-3">
              <option value="">Center of Gravity</option><option>Low</option><option>Center</option><option>High</option>
            </select>

            <div className="grid md:grid-cols-2 gap-2 text-sm">
              <label><input type="checkbox" checked={form.collectCoralStation} onChange={(e) => setForm({ ...form, collectCoralStation: e.target.checked })} className="mr-2" />Can receive coral from the station</label>
              <label><input type="checkbox" checked={form.collectCoralGround} onChange={(e) => setForm({ ...form, collectCoralGround: e.target.checked })} className="mr-2" />Can pick up coral from the ground</label>
              <label><input type="checkbox" checked={form.coralL4} onChange={(e) => setForm({ ...form, coralL4: e.target.checked })} className="mr-2" />Coral Level 4</label>
              <label><input type="checkbox" checked={form.coralL3} onChange={(e) => setForm({ ...form, coralL3: e.target.checked })} className="mr-2" />Coral Level 3</label>
              <label><input type="checkbox" checked={form.coralL2} onChange={(e) => setForm({ ...form, coralL2: e.target.checked })} className="mr-2" />Coral Level 2</label>
              <label><input type="checkbox" checked={form.coralL1} onChange={(e) => setForm({ ...form, coralL1: e.target.checked })} className="mr-2" />Coral Level 1</label>
              <label><input type="checkbox" checked={form.collectAlgaeReef} onChange={(e) => setForm({ ...form, collectAlgaeReef: e.target.checked })} className="mr-2" />Can collect algae from the reef</label>
              <label><input type="checkbox" checked={form.collectAlgaeGround} onChange={(e) => setForm({ ...form, collectAlgaeGround: e.target.checked })} className="mr-2" />Can pick up algae from the ground</label>
              <label><input type="checkbox" checked={form.scoreProcessor} onChange={(e) => setForm({ ...form, scoreProcessor: e.target.checked })} className="mr-2" />Can score at processor</label>
              <label><input type="checkbox" checked={form.scoreNetRobot} onChange={(e) => setForm({ ...form, scoreNetRobot: e.target.checked })} className="mr-2" />Can score in net with robot</label>
            </div>

            <select value={form.barge} onChange={(e) => setForm({ ...form, barge: e.target.value })} className="w-full border rounded p-3">
              <option value="">Barge Capability</option><option>Can climb shallow cage</option><option>Can climb deep cage</option>
            </select>
            <input value={form.autoCapabilities} onChange={(e) => setForm({ ...form, autoCapabilities: e.target.value })} className="w-full border rounded p-3" placeholder="Capabilities in Auto" required />

            <div>
              <p className="font-medium mb-2">Starting Positions</p>
              <div className="flex flex-wrap gap-4">
                {["Opposite Side", "Middle", "Processor Side"].map((pos) => (
                  <label key={pos}>
                    <input type="checkbox" checked={form.startingPositions.includes(pos)} onChange={() => toggleStartingPosition(pos)} className="mr-2" />
                    {pos}
                  </label>
                ))}
              </div>
            </div>

            <select value={form.betterAt} onChange={(e) => setForm({ ...form, betterAt: e.target.value })} className="w-full border rounded p-3">
              <option value="">This robot is better at...</option><option>Coral</option><option>Algae</option>
            </select>

            <div>
              <label className="block mb-2 font-medium">How would you rate this bot? ({form.rating})</label>
              <input type="range" min={1} max={5} value={form.rating} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} className="w-full" />
            </div>

            <textarea value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} className="w-full border rounded p-3 h-32" placeholder="Comments" />

            <button disabled={saving} className="w-full py-3 rounded text-white font-semibold disabled:opacity-50" style={{ background: "var(--primary-gradient)" }}>
              {saving ? "Submitting..." : "Submit Pit Scout Form"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function PitScoutFormPage() {
  return (
    <ProtectedRoute requireAuth={true}>
      <PitScoutFormContent />
    </ProtectedRoute>
  );
}
