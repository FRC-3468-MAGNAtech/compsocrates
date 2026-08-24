"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import { useAuth } from "@/app/AuthContext";
import { APP_EVENT_BY_KEY } from "@/app/utils/events";
import { isEventActive } from "@/app/utils/eventDates";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";
import { Action, CommandBar, Deck, HudCanvas, HudViewport, PageIntro } from "@/app/components/Hud";

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

function RestrictedNotice() {
  const router = useRouter();
  const { userData } = useAuth();
  return (
    <HudCanvas>
      <CommandBar>
        <button
          type="button"
          onClick={() => router.push(getDashboardRoute(userData))}
          className="flex items-center gap-2 rounded-full py-1.5 pl-2 pr-4"
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-red-800 via-red-600 to-amber-300 text-xs font-black text-white shadow-lg shadow-red-900/25">
            CS
          </span>
          <span className="font-display text-sm text-slate-900">Command</span>
        </button>
      </CommandBar>
      <HudViewport>
        <PageIntro eyebrow="Match Scout · REBUILT" title="Match Scout Placeholder" />
        <Deck priority="critical" className="mt-8 max-w-2xl">
          <p className="text-sm font-semibold text-slate-700">This page is currently available only to team admins.</p>
        </Deck>
      </HudViewport>
    </HudCanvas>
  );
}

function MatchScoutFormContent() {
  const router = useRouter();
  const { userData } = useAuth();
  const showEventWarning = !isEventActive();

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
      if (typeof window !== "undefined") {
        window.location.reload();
      }
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

  if (!userData?.isTeamAdmin) {
    return <RestrictedNotice />;
  }

  return (
    <HudCanvas>
      <CommandBar>
        <button
          type="button"
          onClick={() => router.push(getDashboardRoute(userData))}
          className="flex items-center gap-2 rounded-full py-1.5 pl-2 pr-4"
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-red-800 via-red-600 to-amber-300 text-xs font-black text-white shadow-lg shadow-red-900/25">
            CS
          </span>
          <span className="font-display text-sm text-slate-900">Command</span>
        </button>
        <select
          className="rounded-full border border-amber-300/50 bg-white/50 px-4 py-2 text-xs font-bold text-slate-800 backdrop-blur-xl"
          value="placeholder"
          onChange={(event) => {
            if (event.target.value === "reefscape") {
              router.push("/scout-form?lead=0");
            }
          }}
        >
          <option value="reefscape">REEFSCAPE Form</option>
          <option value="placeholder">REBUILT Form</option>
        </select>
      </CommandBar>

      <HudViewport>
        <PageIntro
          eyebrow="Match Scout · REBUILT"
          title="Match Scout Form"
          subtitle="REBUILT form view. Admin-only entry point pending the full REBUILT scouting build-out."
        />

        {showEventWarning && (
          <Deck priority="critical" className="mt-6">
            <p className="text-sm font-semibold text-slate-700">
              Note: Official scouting is only during events (Arkansas: March 18-21, Bayou: April 1-4).
            </p>
          </Deck>
        )}

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
          <Deck className="flex-1 lg:mr-10">
            <h2 className="font-display text-2xl text-slate-950">Core Inputs</h2>
            <div className="mt-4 space-y-3">
              <input
                type="text"
                value={form.scoutName}
                onChange={(event) => setForm({ ...form, scoutName: event.target.value })}
                className="w-full"
                placeholder="Scout Name"
                required
              />
              <input
                type="text"
                value={form.teamNumber}
                onChange={(event) => setForm({ ...form, teamNumber: event.target.value })}
                className="w-full"
                placeholder="Team Number"
                required
              />
              <input
                type="text"
                value={form.matchLabel}
                onChange={(event) => setForm({ ...form, matchLabel: event.target.value })}
                className="w-full"
                placeholder="Match Label (Q12, P3, F1)"
                required
              />
              <textarea
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                className="h-36 w-full resize-none rounded-2xl p-3"
                placeholder="Placeholder notes"
              />
            </div>

            <Action type="submit" disabled={!canSubmit || saving} className="mt-6 w-full justify-center py-3">
              {saving ? "Submitting..." : "Submit Match Scout Form"}
            </Action>
          </Deck>
        </form>
      </HudViewport>
    </HudCanvas>
  );
}

export default function MatchScoutFormPage() {
  return (
    <ProtectedRoute
      requireAuth={true}
      allowedRoles={["match-scout", "lead-scout", "lead-strategist", "pit-team", "drive-team", "pit-scout", "coach", "scout"]}
    >
      <MatchScoutFormContent />
    </ProtectedRoute>
  );
}
