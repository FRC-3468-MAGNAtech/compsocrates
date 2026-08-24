"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import { useAuth } from "@/app/AuthContext";
import { APP_EVENT_BY_KEY } from "@/app/utils/events";
import { isEventActive } from "@/app/utils/eventDates";
import { ShieldAlert, TriangleAlert } from "lucide-react";
import { HudCanvas, HudViewport, CommandBar, Surface, Deck, PageIntro, Chip, Action } from "@/app/components/Hud";

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
  const router = useRouter();
  const { userData } = useAuth();
  const showEventWarning = !isEventActive();
  if (!userData?.isTeamAdmin) {
    return (
      <HudCanvas>
        <HudViewport>
          <Deck priority="critical" className="mx-auto max-w-xl">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl border border-red-300/60 bg-red-50/60 p-3 text-red-800">
                <ShieldAlert size={24} />
              </div>
              <div>
                <h1 className="font-display text-3xl text-slate-950">Pit Scout Placeholder</h1>
                <p className="mt-2 text-sm text-slate-600">This page is currently available only to team admins.</p>
              </div>
            </div>
          </Deck>
        </HudViewport>
      </HudCanvas>
    );
  }
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
      if (typeof window !== "undefined") {
        window.location.reload();
      }
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
    <HudCanvas>
      <CommandBar>
        <Chip label="Mode" value="Admin" tone="crimson" />
        <select
          className="!min-h-0 !rounded-full !border-amber-300/60 !bg-white/60 !py-1.5 !pl-4 !pr-8 text-xs font-bold uppercase tracking-wider text-slate-800"
          value="placeholder"
          onChange={(event) => {
            if (event.target.value === "reefscape") router.push("/pit-scout-form");
          }}
        >
          <option value="reefscape">REEFSCAPE Form</option>
          <option value="placeholder">REBUILT Form</option>
        </select>
      </CommandBar>

      <HudViewport className="pb-32">
        <PageIntro
          eyebrow="Admin-Only Quick Intake"
          title={<>Pit Scout <span className="gradient-text">Placeholder</span></>}
          subtitle="REBUILT form view. A minimal admin intake used to seed a placeholder pit entry."
          actions={<Chip label="Access" value="Team Admin" tone="gold" />}
        />

        {showEventWarning && (
          <Surface className="mt-6 flex items-start gap-3 border-l-4 !border-l-amber-400 p-4">
            <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-700" />
            <p className="text-sm text-amber-900">
              Note: Official scouting is only during events (Arkansas: March 18-21, Bayou: April 1-4).
            </p>
          </Surface>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
            <Deck priority="high" className="lg:col-span-7">
              <h2 className="font-display text-2xl text-slate-950">Core Inputs</h2>
              <div className="mt-4 space-y-4">
                <input
                  value={form.scoutName}
                  onChange={(event) => setForm({ ...form, scoutName: event.target.value })}
                  className="w-full"
                  placeholder="Scout Name"
                  required
                />
                <input
                  value={form.teamNumber}
                  onChange={(event) => setForm({ ...form, teamNumber: event.target.value })}
                  className="w-full font-data"
                  placeholder="Team Number"
                  required
                />
                <input
                  type="url"
                  value={form.robotPictureUrl}
                  onChange={(event) => setForm({ ...form, robotPictureUrl: event.target.value })}
                  className="w-full font-data text-sm"
                  placeholder="Picture of Robot URL"
                />
                <input
                  value={form.autoCapabilities}
                  onChange={(event) => setForm({ ...form, autoCapabilities: event.target.value })}
                  className="w-full"
                  placeholder="Capabilities in auto"
                />
              </div>
            </Deck>

            <Deck className="lg:col-span-5 lg:mt-8">
              <h2 className="font-display text-2xl text-slate-950">Notes</h2>
              <textarea
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                className="mt-4 h-40 w-full resize-none"
                placeholder="Placeholder notes"
              />
            </Deck>
          </div>

          <div className="mt-8 flex justify-end">
            <Action type="submit" disabled={!canSubmit || saving} className="!px-8">
              {saving ? "Submitting..." : "Submit Pit Scout Form"}
            </Action>
          </div>
        </form>
      </HudViewport>
    </HudCanvas>
  );
}

export default function PitScoutPlaceholderPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["pit-scout", "lead-strategist", "lead-scout", "pit-team", "drive-team", "match-scout", "coach", "scout"]}>
      <PitScoutPlaceholderContent />
    </ProtectedRoute>
  );
}
