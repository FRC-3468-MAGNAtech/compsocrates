"use client";

import { useState } from "react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { APP_EVENT_BY_KEY } from "@/app/utils/events";
import { classifyRebuiltEventByTimestamp } from "@/app/utils/analyticsEvents";

type PitFormState = {
  scoutName: string;
  teamNumber: string;
  robotPictureUrl: string;
  pitDisposition: boolean;
  driveDisposition: boolean;
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
  bargeCapability: string;
  autoCapabilities: string;
  startingOpposite: boolean;
  startingMiddle: boolean;
  startingProcessor: boolean;
  betterAt: string;
  rating: number;
  notes: string;
};

function PitScoutFormContent() {
  const { userData } = useAuth();
  const [saving, setSaving] = useState(false);
  const [mobileNotesOpen, setMobileNotesOpen] = useState(false);
  const [form, setForm] = useState<PitFormState>({
    scoutName: userData?.displayName || "",
    teamNumber: "",
    robotPictureUrl: "",
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
    autoCapabilities: "",
    startingOpposite: false,
    startingMiddle: false,
    startingProcessor: false,
    betterAt: "",
    rating: 3,
    notes: "",
  });

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    if (!userData?.uid) return;

    setSaving(true);
    try {
      const now = Date.now();
      const eventKey = classifyRebuiltEventByTimestamp(now);
      const eventName = APP_EVENT_BY_KEY[eventKey]?.name || "App Testing";
      await addDoc(collection(db, "pitScouting"), {
        ...form,
        eventKey,
        eventName,
        game: "REBUILT",
        teamId: userData.teamId || "",
        submittedBy: userData.uid,
        createdAt: now,
      });
      alert("Pit scouting form submitted.");
      setForm((prev) => ({
        ...prev,
        teamNumber: "",
        robotPictureUrl: "",
        notes: "",
      }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row justify-center">
          <form onSubmit={submitForm} className="flex-1 p-4 space-y-6 max-w-3xl">
            <div className="bg-white rounded-xl shadow p-4">
              <h1 className="text-3xl font-bold mb-2 theme-text">Pit Scout Form</h1>
              <p className="text-sm text-gray-600">Structured to match your Match Scout form flow.</p>
            </div>

            <div className="bg-white rounded-xl shadow p-4 space-y-3">
              <h2 className="text-lg font-semibold theme-text">Information</h2>
              <input
                value={form.scoutName}
                onChange={(event) => setForm({ ...form, scoutName: event.target.value })}
                className="w-full border rounded p-3 bg-gray-100"
                placeholder="Scout Name"
                required
              />
              <input
                value={form.teamNumber}
                onChange={(event) => setForm({ ...form, teamNumber: event.target.value })}
                className="w-full border rounded p-3"
                placeholder="Team Number"
                required
              />
              <input
                value={form.robotPictureUrl}
                onChange={(event) => setForm({ ...form, robotPictureUrl: event.target.value })}
                className="w-full border rounded p-3"
                placeholder="Picture of Robot URL"
              />
            </div>

            <div className="bg-white rounded-xl shadow p-4 space-y-3">
              <h2 className="text-lg font-semibold theme-text">Disposition</h2>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.pitDisposition}
                  onChange={(event) => setForm({ ...form, pitDisposition: event.target.checked })}
                />
                Friendly and easy to work with (Pit)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.driveDisposition}
                  onChange={(event) => setForm({ ...form, driveDisposition: event.target.checked })}
                />
                Friendly and easy to work with (Drive)
              </label>
            </div>

            <div className="bg-white rounded-xl shadow p-4 space-y-3">
              <h2 className="text-lg font-semibold theme-text">Robot</h2>
              <select
                value={form.driveBaseType}
                onChange={(event) => setForm({ ...form, driveBaseType: event.target.value })}
                className="w-full border rounded p-3"
              >
                <option value="">Drive Base Type</option>
                <option>Swerve L1</option>
                <option>Swerve L2</option>
                <option>Swerve L3</option>
                <option>Tank</option>
                <option>Mecanum</option>
              </select>
              <select
                value={form.centerOfGravity}
                onChange={(event) => setForm({ ...form, centerOfGravity: event.target.value })}
                className="w-full border rounded p-3"
              >
                <option value="">Center of Gravity</option>
                <option>Low</option>
                <option>Center</option>
                <option>High</option>
              </select>
            </div>

            <div className="bg-white rounded-xl shadow p-4 space-y-3">
              <h2 className="text-lg font-semibold theme-text">Coral</h2>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.collectCoralStation} onChange={(event) => setForm({ ...form, collectCoralStation: event.target.checked })} />Can receive coral from the station</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.collectCoralGround} onChange={(event) => setForm({ ...form, collectCoralGround: event.target.checked })} />Can pick up coral from the ground</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.coralL4} onChange={(event) => setForm({ ...form, coralL4: event.target.checked })} />Can score coral Level 4</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.coralL3} onChange={(event) => setForm({ ...form, coralL3: event.target.checked })} />Can score coral Level 3</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.coralL2} onChange={(event) => setForm({ ...form, coralL2: event.target.checked })} />Can score coral Level 2</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.coralL1} onChange={(event) => setForm({ ...form, coralL1: event.target.checked })} />Can score coral Level 1</label>
            </div>

            <div className="bg-white rounded-xl shadow p-4 space-y-3">
              <h2 className="text-lg font-semibold theme-text">Algae</h2>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.collectAlgaeReef} onChange={(event) => setForm({ ...form, collectAlgaeReef: event.target.checked })} />Can collect algae from reef</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.collectAlgaeGround} onChange={(event) => setForm({ ...form, collectAlgaeGround: event.target.checked })} />Can pick up algae from ground</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.scoreProcessor} onChange={(event) => setForm({ ...form, scoreProcessor: event.target.checked })} />Can score at processor</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.scoreNetRobot} onChange={(event) => setForm({ ...form, scoreNetRobot: event.target.checked })} />Can score in net with robot</label>
            </div>

            <div className="bg-white rounded-xl shadow p-4 space-y-3">
              <h2 className="text-lg font-semibold theme-text">Auto / Endgame</h2>
              <select
                value={form.bargeCapability}
                onChange={(event) => setForm({ ...form, bargeCapability: event.target.value })}
                className="w-full border rounded p-3"
              >
                <option value="">Barge Capability</option>
                <option>Can climb shallow cage</option>
                <option>Can climb deep cage</option>
              </select>
              <input
                value={form.autoCapabilities}
                onChange={(event) => setForm({ ...form, autoCapabilities: event.target.value })}
                className="w-full border rounded p-3"
                placeholder="Capabilities in auto"
              />
              <p className="text-sm font-medium">Starting Positions</p>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.startingOpposite} onChange={(event) => setForm({ ...form, startingOpposite: event.target.checked })} />Opposite Side</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.startingMiddle} onChange={(event) => setForm({ ...form, startingMiddle: event.target.checked })} />Middle</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.startingProcessor} onChange={(event) => setForm({ ...form, startingProcessor: event.target.checked })} />Processor Side</label>
              <select
                value={form.betterAt}
                onChange={(event) => setForm({ ...form, betterAt: event.target.value })}
                className="w-full border rounded p-3"
              >
                <option value="">This robot is better at...</option>
                <option>Coral</option>
                <option>Algae</option>
              </select>
              <label className="block text-sm font-medium">How would you rate this bot? ({form.rating})</label>
              <input
                type="range"
                min={1}
                max={5}
                value={form.rating}
                onChange={(event) => setForm({ ...form, rating: Number(event.target.value) })}
                className="w-full"
              />
            </div>

            <div className="sticky bottom-0 bg-gray-100 pt-4 pb-2">
              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 rounded text-white font-semibold disabled:opacity-50"
                style={{ background: "var(--primary-gradient)" }}
              >
                {saving ? "Submitting..." : "Submit Pit Scout Form"}
              </button>
            </div>
          </form>

          <div className="hidden md:block w-80 p-4">
            <div className="bg-white rounded-xl shadow p-4 flex flex-col sticky top-4" style={{ height: "calc(100vh - 2rem)" }}>
              <h2 className="text-xl font-semibold mb-2 theme-text">Notes</h2>
              <textarea
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                className="flex-1 border rounded p-2 resize-none"
                placeholder="Team comments and observations..."
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
                  <h2 className="text-xl font-semibold theme-text">Notes</h2>
                  <button onClick={() => setMobileNotesOpen(false)} className="px-3 py-1 rounded bg-gray-100">Close</button>
                </div>
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  className="w-full h-[calc(100%-3rem)] border rounded p-3 text-base resize-none"
                  placeholder="Team comments and observations..."
                />
              </div>
            </>
          )}
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
