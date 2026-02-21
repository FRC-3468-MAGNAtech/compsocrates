"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { APP_EVENT_BY_KEY } from "@/app/utils/events";
import { isEventActive } from "@/app/utils/eventDates";

type MatchScoutPlaceholder = {
  scoutName: string;
  teamNumber: string;
  matchLabel: string;
  notes: string;
};

function buildReefscapeCompatibilityPayload(input: MatchScoutPlaceholder) {
  const now = Date.now();
  const eventKey = "app-testing";
  const eventName = APP_EVENT_BY_KEY[eventKey]?.name || "App Testing";
  const matchLabel = input.matchLabel.trim() || "Q1";
  const matchType = matchLabel.toLowerCase().startsWith("f")
    ? "finals"
    : matchLabel.toLowerCase().startsWith("p")
    ? "practice"
    : "qualification";

  return {
    scoutName: input.scoutName.trim(),
    teamNumber: input.teamNumber.trim(),
    notes: input.notes.trim(),
    matchId: matchLabel.toLowerCase(),
    matchNumber: matchLabel.replace(/[^0-9]/g, "") || "1",
    matchType,
    bracket: null,
    eventKey,
    eventName,
    game: "REEFSCAPE",
    timestamp: now,
    submittedAt: now,
    isPlaceholderForm: true,
    startingPosition: "",
    leftStartingZone: false,
    autoCoralMissed: 0,
    autoCoralL1: 0,
    autoCoralL2: 0,
    autoCoralL3: 0,
    autoCoralL4: 0,
    autoAlgaeProcessorMissed: 0,
    autoAlgaeProcessorScored: 0,
    autoAlgaeNetMissed: 0,
    autoAlgaeNetScored: 0,
    teleopCoralMissed: 0,
    teleopCoralL1: 0,
    teleopCoralL2: 0,
    teleopCoralL3: 0,
    teleopCoralL4: 0,
    teleopAlgaeRemoved: false,
    teleopProcessorMissed: 0,
    teleopProcessorScored: 0,
    teleopNetRobotMissed: 0,
    teleopNetRobotScored: 0,
    teleopNetHumanMissed: 0,
    teleopNetHumanScored: 0,
    failedClimb: 0,
    stageStatus: "",
    incidents: [],
    penaltyPoints: 0,
    scoutedScore: 0,
  };
}

function MatchScoutFormContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const showEventWarning = !isEventActive();
  if (!userData?.isTeamAdmin) {
    return (
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto bg-white rounded-xl shadow p-6">
            <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
              Match Scout Placeholder
            </h1>
            <p className="text-gray-600">This page is currently available only to team admins.</p>
          </div>
        </div>
      </div>
    );
  }
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<MatchScoutPlaceholder>({
    scoutName: userData?.displayName || "",
    teamNumber: "",
    matchLabel: "",
    notes: "",
  });

  const canSubmit = useMemo(() => {
    return form.scoutName.trim().length > 0 && form.teamNumber.trim().length > 0 && form.matchLabel.trim().length > 0;
  }, [form]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!userData?.uid || !canSubmit) return;
    setSaving(true);
    try {
      const payload = buildReefscapeCompatibilityPayload(form);
      await addDoc(collection(db, "scouting"), {
        ...payload,
        submittedBy: userData.uid,
        teamId: userData.teamId || "",
      });
      alert("Match Scout placeholder submitted.");
      setForm((prev) => ({
        ...prev,
        teamNumber: "",
        matchLabel: "",
        notes: "",
      }));
    } catch (error) {
      console.error("Error submitting placeholder match scout form:", error);
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
              Match Scout Form
            </h1>
            <p className="text-sm text-gray-600">REBUILT form view.</p>
            <div className="mt-3 max-w-sm">
              <label className="block text-sm font-medium text-gray-700 mb-1">Form Select (Admin)</label>
              <select
                className="w-full border rounded p-2"
                value="placeholder"
                onChange={(event) => {
                  if (event.target.value === "reefscape") {
                    router.push("/scout-form");
                  }
                }}
              >
                <option value="reefscape">REEFSCAPE Form</option>
                <option value="placeholder">REBUILT Form</option>
              </select>
            </div>
          </div>
          {showEventWarning && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
              <p className="text-sm text-yellow-700">
                Note: Official scouting is only during events (Arkansas: March 18-21, Bayou: April 1-4).
              </p>
            </div>
          )}

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
              type="text"
              value={form.matchLabel}
              onChange={(event) => setForm({ ...form, matchLabel: event.target.value })}
              className="w-full border rounded p-3"
              placeholder="Match Label (Q12, P3, F1)"
              required
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
            {saving ? "Submitting..." : "Submit Match Scout Form"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function MatchScoutFormPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["match-scout", "lead-scout", "lead-strategist", "pit-team", "drive-team", "pit-scout", "coach", "scout"]}>
      <MatchScoutFormContent />
    </ProtectedRoute>
  );
}

