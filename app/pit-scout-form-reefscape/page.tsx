"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import { useAuth } from "@/app/AuthContext";
import { Image as ImageIcon, Link as LinkIcon, Trash2, Waves, Ban, NotebookPen, X } from "lucide-react";
import { HudCanvas, HudViewport, CommandBar, Surface, Deck, PageIntro, Chip, Action } from "@/app/components/Hud";

type PitFormState = {
  scoutName: string;
  teamNumber: string;
  robotWeight: string;
  rookieTeam: boolean;
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
  const [notesOpen, setNotesOpen] = useState(false);
  const [robotPictureUrlInput, setRobotPictureUrlInput] = useState("");
  const [activeFormGame, setActiveFormGame] = useState<"REEFSCAPE" | "REBUILT">("REEFSCAPE");
  const [form, setForm] = useState<PitFormState>({
    scoutName: userData?.displayName || "",
    teamNumber: "",
    robotWeight: "",
    rookieTeam: false,
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
    alert("REEFSCAPE pit form submissions are disabled.");
    return;
  }

  return (
    <HudCanvas>
      <CommandBar>
        <Chip label="Game" value="REEFSCAPE" tone="gold" icon={Waves} />
        <select
          className="!min-h-0 !rounded-full !border-amber-300/60 !bg-white/60 !py-1.5 !pl-4 !pr-8 text-xs font-bold uppercase tracking-wider text-slate-800"
          value="reefscape"
          onChange={(event) => {
            if (event.target.value === "placeholder") router.push("/pit-scout-form");
          }}
        >
          <option value="reefscape">REEFSCAPE Form</option>
          <option value="placeholder">REBUILT Form</option>
        </select>
        <Action variant="ghost" type="button" onClick={() => setNotesOpen((prev) => !prev)}>
          <NotebookPen size={14} /> Notes
        </Action>
      </CommandBar>

      <HudViewport className="pb-40">
        <PageIntro
          eyebrow="Archived Season Reference"
          title={<>Pit Scout <span className="gradient-text">Form</span></>}
          subtitle="REEFSCAPE season reference view. Submissions are disabled for this game; use REBUILT for live intake."
          actions={<Chip label="Status" value="Read-only" tone="crimson" icon={Ban} />}
        />

        <form onSubmit={submitForm}>
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Identity */}
            <Deck priority="high" className="lg:col-span-6">
              <h2 className="font-display text-2xl text-slate-950">Information</h2>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Scout Name</label>
                  <input value={form.scoutName} disabled className="w-full" placeholder="Scout Name" required />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Team Number</label>
                  <input
                    value={form.teamNumber}
                    onChange={(event) => setForm({ ...form, teamNumber: event.target.value })}
                    className="w-full font-data"
                    placeholder="Team Number"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Robot Weight</label>
                  <input
                    value={form.robotWeight}
                    onChange={(event) => setForm({ ...form, robotWeight: event.target.value })}
                    className="w-full"
                    placeholder="Robot Weight"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.rookieTeam}
                    onChange={(event) => setForm({ ...form, rookieTeam: event.target.checked })}
                    className="!h-4 !w-4 !min-h-0 !rounded"
                  />
                  Rookie Team
                </label>

                <div className="rounded-2xl border border-white/60 bg-white/35 p-4">
                  <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Picture of Robot</p>
                  <div className="flex items-center gap-4">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/70 bg-white/50">
                      {form.robotPictureUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={form.robotPictureUrl} alt="Robot preview" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon size={20} className="text-slate-400" />
                      )}
                    </div>
                    <div className="flex-1 space-y-2">
                      <input
                        type="url"
                        value={robotPictureUrlInput}
                        onChange={(event) => setRobotPictureUrlInput(event.target.value)}
                        className="w-full font-data text-sm"
                        placeholder="https://example.com/robot.jpg"
                      />
                      <div className="flex gap-2">
                        <Action variant="primary" type="button" onClick={applyRobotPictureUrl} className="!px-3 !py-2 !text-xs">
                          <LinkIcon size={13} /> Apply URL
                        </Action>
                        <Action variant="ghost" type="button" onClick={clearRobotPictureUrl} className="!px-3 !py-2 !text-xs">
                          <Trash2 size={13} /> Remove
                        </Action>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Deck>

            {/* Disposition */}
            <Deck className="lg:col-span-6 lg:mt-8">
              <h2 className="font-display text-2xl text-slate-950">Disposition</h2>
              <div className="mt-4 space-y-3">
                <label className="flex items-center gap-3 rounded-2xl border border-white/60 bg-white/35 p-3 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.pitDisposition}
                    onChange={(event) => setForm({ ...form, pitDisposition: event.target.checked })}
                    className="!h-4 !w-4 !min-h-0 !rounded"
                  />
                  Friendly and easy to work with (Pit)
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-white/60 bg-white/35 p-3 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.driveDisposition}
                    onChange={(event) => setForm({ ...form, driveDisposition: event.target.checked })}
                    className="!h-4 !w-4 !min-h-0 !rounded"
                  />
                  Friendly and easy to work with (Drive)
                </label>
              </div>

              <h2 className="mt-6 font-display text-2xl text-slate-950">Robot</h2>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Drive Base Type</label>
                  <select
                    value={form.driveBaseType}
                    onChange={(event) => setForm({ ...form, driveBaseType: event.target.value })}
                    className="w-full"
                  >
                    <option value="">Select Drive Base Type</option>
                    <option>Swerve L1</option>
                    <option>Swerve L2</option>
                    <option>Swerve L3</option>
                    <option>Tank</option>
                    <option>Mecanum</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Center of Gravity</label>
                  <select
                    value={form.centerOfGravity}
                    onChange={(event) => setForm({ ...form, centerOfGravity: event.target.value })}
                    className="w-full"
                  >
                    <option value="">Select Center of Gravity</option>
                    <option>Low</option>
                    <option>Center</option>
                    <option>High</option>
                  </select>
                </div>
              </div>
            </Deck>

            {/* Coral */}
            <Deck priority="critical" className="lg:col-span-5">
              <h2 className="font-display text-2xl text-slate-950">Coral</h2>
              <div className="mt-4 space-y-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.collectCoralStation} onChange={(event) => setForm({ ...form, collectCoralStation: event.target.checked })} className="!h-4 !w-4 !min-h-0 !rounded" />Can receive coral from the station</label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.collectCoralGround} onChange={(event) => setForm({ ...form, collectCoralGround: event.target.checked })} className="!h-4 !w-4 !min-h-0 !rounded" />Can pick up coral from the ground</label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.coralL4} onChange={(event) => setForm({ ...form, coralL4: event.target.checked })} className="!h-4 !w-4 !min-h-0 !rounded" />Can score coral Level 4</label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.coralL3} onChange={(event) => setForm({ ...form, coralL3: event.target.checked })} className="!h-4 !w-4 !min-h-0 !rounded" />Can score coral Level 3</label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.coralL2} onChange={(event) => setForm({ ...form, coralL2: event.target.checked })} className="!h-4 !w-4 !min-h-0 !rounded" />Can score coral Level 2</label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.coralL1} onChange={(event) => setForm({ ...form, coralL1: event.target.checked })} className="!h-4 !w-4 !min-h-0 !rounded" />Can score coral Level 1</label>
              </div>
            </Deck>

            {/* Algae */}
            <Deck className="lg:col-span-3 lg:mt-6">
              <h2 className="font-display text-2xl text-slate-950">Algae</h2>
              <div className="mt-4 space-y-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.collectAlgaeReef} onChange={(event) => setForm({ ...form, collectAlgaeReef: event.target.checked })} className="!h-4 !w-4 !min-h-0 !rounded" />Can collect algae from reef</label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.collectAlgaeGround} onChange={(event) => setForm({ ...form, collectAlgaeGround: event.target.checked })} className="!h-4 !w-4 !min-h-0 !rounded" />Can pick up algae from ground</label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.scoreProcessor} onChange={(event) => setForm({ ...form, scoreProcessor: event.target.checked })} className="!h-4 !w-4 !min-h-0 !rounded" />Can score at processor</label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.scoreNetRobot} onChange={(event) => setForm({ ...form, scoreNetRobot: event.target.checked })} className="!h-4 !w-4 !min-h-0 !rounded" />Can score in net with robot</label>
              </div>
            </Deck>

            {/* Auto / Endgame */}
            <Deck className="lg:col-span-4 lg:mt-2">
              <h2 className="font-display text-2xl text-slate-950">Auto / Endgame</h2>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Barge Capability</label>
                  <select
                    value={form.bargeCapability}
                    onChange={(event) => setForm({ ...form, bargeCapability: event.target.value })}
                    className="w-full"
                  >
                    <option value="">Select Barge Capability</option>
                    <option>Can climb shallow cage</option>
                    <option>Can climb deep cage</option>
                  </select>
                </div>
                <input
                  value={form.autoCapabilities}
                  onChange={(event) => setForm({ ...form, autoCapabilities: event.target.value })}
                  className="w-full"
                  placeholder="Capabilities in auto"
                />
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Starting Positions</p>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.startingOpposite} onChange={(event) => setForm({ ...form, startingOpposite: event.target.checked })} className="!h-4 !w-4 !min-h-0 !rounded" />Opposite Side</label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.startingMiddle} onChange={(event) => setForm({ ...form, startingMiddle: event.target.checked })} className="!h-4 !w-4 !min-h-0 !rounded" />Middle</label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.startingProcessor} onChange={(event) => setForm({ ...form, startingProcessor: event.target.checked })} className="!h-4 !w-4 !min-h-0 !rounded" />Processor Side</label>
                <select
                  value={form.betterAt}
                  onChange={(event) => setForm({ ...form, betterAt: event.target.value })}
                  className="w-full"
                >
                  <option value="">This robot is better at...</option>
                  <option>Coral</option>
                  <option>Algae</option>
                </select>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Bot Rating ({form.rating})</label>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={form.rating}
                    onChange={(event) => setForm({ ...form, rating: Number(event.target.value) })}
                    className="!min-h-0 w-full"
                  />
                </div>
              </div>
            </Deck>
          </div>

          <div className="fixed inset-x-0 bottom-6 z-30 flex justify-center px-4">
            <Surface raised className="flex w-full max-w-xl items-center gap-4 !rounded-full px-6 py-3">
              <p className="hidden font-data text-xs text-slate-500 sm:block">REEFSCAPE submissions are archived — read-only reference form.</p>
              <Action type="submit" disabled className="ml-auto !px-8">
                Submission Disabled for REEFSCAPE
              </Action>
            </Surface>
          </div>
        </form>
      </HudViewport>

      {notesOpen && (
        <div className="fixed inset-0 z-[65] flex items-start justify-end p-4 sm:p-6">
          <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-md" onClick={() => setNotesOpen(false)} />
          <Surface raised className="relative flex h-full w-full max-w-md flex-col p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-2xl text-slate-950">Notes</h2>
              <button
                onClick={() => setNotesOpen(false)}
                className="rounded-full border border-white/70 bg-white/50 p-2 text-slate-700 transition hover:bg-white/80"
                aria-label="Close notes"
              >
                <X size={18} />
              </button>
            </div>
            <textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              className="flex-1 w-full resize-none"
              placeholder="Optional notes..."
            />
          </Surface>
        </div>
      )}
    </HudCanvas>
  );
}

export default function PitScoutFormPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["pit-scout"]} formKey="pit-scout-form">
      <PitScoutFormContent />
    </ProtectedRoute>
  );
}
