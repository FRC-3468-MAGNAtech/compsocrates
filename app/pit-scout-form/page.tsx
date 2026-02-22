"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { APP_EVENT_BY_KEY } from "@/app/utils/events";
import { Image as ImageIcon, Link as LinkIcon, Trash2 } from "lucide-react";

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
  const router = useRouter();
  const { userData } = useAuth();
  const [saving, setSaving] = useState(false);
  const [mobileNotesOpen, setMobileNotesOpen] = useState(false);
  const [robotPictureUrlInput, setRobotPictureUrlInput] = useState("");
  const [activeFormGame, setActiveFormGame] = useState<"REEFSCAPE" | "REBUILT">("REEFSCAPE");
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

  useEffect(() => {
    async function loadActivePitPreset() {
      if (!userData?.teamId) return;
      const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
      if (!teamDoc.exists()) return;
      const activePitFormPresetId = teamDoc.data().activePitFormPresetId as string | undefined;
      if (!activePitFormPresetId) return;
      const presetDoc = await getDoc(doc(db, "formPresets", activePitFormPresetId));
      if (!presetDoc.exists()) return;
      const preset = presetDoc.data() as { game?: "REEFSCAPE" | "REBUILT" };
      setActiveFormGame(preset.game === "REBUILT" ? "REBUILT" : "REEFSCAPE");
    }
    void loadActivePitPreset();
  }, [userData?.teamId]);

  useEffect(() => {
    if (!userData?.displayName) return;
    setForm((prev) => ({ ...prev, scoutName: userData.displayName }));
  }, [userData?.displayName]);

  const isValidImageUrl = (value: string): boolean => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  };

  const applyRobotPictureUrl = () => {
    const normalized = robotPictureUrlInput.trim();
    if (!normalized) {
      setForm((prev) => ({ ...prev, robotPictureUrl: "" }));
      return;
    }
    if (!isValidImageUrl(normalized)) {
      alert("Please enter a valid http(s) image URL.");
      return;
    }
    setForm((prev) => ({ ...prev, robotPictureUrl: normalized }));
  };

  const clearRobotPictureUrl = () => {
    setRobotPictureUrlInput("");
    setForm((prev) => ({ ...prev, robotPictureUrl: "" }));
  };

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    if (!userData?.uid) return;

    setSaving(true);
    try {
      const now = Date.now();
      const eventKey = "app-testing";
      const eventName = APP_EVENT_BY_KEY[eventKey]?.name || "App Testing";
      await addDoc(collection(db, "pitScouting"), {
        ...form,
        eventKey,
        eventName,
        game: activeFormGame,
        teamId: userData.teamId || "",
        submittedBy: userData.uid,
        createdAt: now,
      });
      alert("Pit scout form submitted.");
      setForm((prev) => ({
        ...prev,
        teamNumber: "",
        robotPictureUrl: "",
        notes: "",
      }));
      setRobotPictureUrlInput("");
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
              {userData?.isTeamAdmin && (
                <div className="mt-3 max-w-sm">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Form Select (Admin)</label>
                  <select
                    className="w-full border rounded p-2"
                    value="reefscape"
                    onChange={(event) => {
                      if (event.target.value === "placeholder") {
                        router.push("/pit-scout-form-placeholder");
                      }
                    }}
                  >
                    <option value="reefscape">REEFSCAPE Form</option>
                    <option value="placeholder">REBUILT Form</option>
                  </select>
                </div>
              )}
            </div>
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
              <p className="text-sm text-yellow-700">
                Note: Official scouting is only during events (Arkansas: March 18-21, Bayou: April 1-4).
              </p>
            </div>

            <div className="bg-white rounded-xl shadow p-4 space-y-3">
              <h2 className="text-lg font-semibold theme-text">Information</h2>
              <label className="block text-sm font-medium text-gray-700 mb-1">Scout Name</label>
              <input
                type="text"
                value={form.scoutName}
                disabled
                className="w-full border rounded p-3 bg-gray-100 text-gray-600"
                placeholder="Scout Name"
                required
              />
              <label className="block text-sm font-medium text-gray-700 mb-1">Team Number</label>
              <input
                type="text"
                value={form.teamNumber}
                onChange={(event) => setForm({ ...form, teamNumber: event.target.value })}
                className="w-full border rounded p-3"
                placeholder="Team Number"
                required
              />
              <label className="block text-sm font-medium text-gray-700 mb-1">Picture of Robot</label>
              <div className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 rounded-lg border flex items-center justify-center overflow-hidden bg-gray-100">
                    {form.robotPictureUrl ? (
                      <img
                        src={form.robotPictureUrl}
                        alt="Robot preview"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon size={20} className="text-gray-500" />
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <input
                      type="url"
                      value={robotPictureUrlInput}
                      onChange={(event) => setRobotPictureUrlInput(event.target.value)}
                      className="w-full border rounded p-3"
                      placeholder="https://example.com/robot.jpg"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={applyRobotPictureUrl}
                        className="px-3 py-2 rounded text-white text-sm font-semibold flex items-center gap-2"
                        style={{ backgroundColor: "var(--primary-color)" }}
                      >
                        <LinkIcon size={14} />
                        Apply URL
                      </button>
                      <button
                        type="button"
                        onClick={clearRobotPictureUrl}
                        className="px-3 py-2 rounded border text-sm font-semibold flex items-center gap-2"
                      >
                        <Trash2 size={14} />
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              </div>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Drive Base Type</label>
              <select
                value={form.driveBaseType}
                onChange={(event) => setForm({ ...form, driveBaseType: event.target.value })}
                className="w-full border rounded p-3"
              >
                <option value="">Select Drive Base Type</option>
                <option>Swerve L1</option>
                <option>Swerve L2</option>
                <option>Swerve L3</option>
                <option>Tank</option>
                <option>Mecanum</option>
              </select>
              <label className="block text-sm font-medium text-gray-700 mb-1">Center of Gravity</label>
              <select
                value={form.centerOfGravity}
                onChange={(event) => setForm({ ...form, centerOfGravity: event.target.value })}
                className="w-full border rounded p-3"
              >
                <option value="">Select Center of Gravity</option>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Barge Capability</label>
              <select
                value={form.bargeCapability}
                onChange={(event) => setForm({ ...form, bargeCapability: event.target.value })}
                className="w-full border rounded p-3"
              >
                <option value="">Select Barge Capability</option>
                <option>Can climb shallow cage</option>
                <option>Can climb deep cage</option>
              </select>
              <input
                type="text"
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
    <ProtectedRoute requireAuth={true} allowedRoles={["pit-scout"]}>
      <PitScoutFormContent />
    </ProtectedRoute>
  );
}
