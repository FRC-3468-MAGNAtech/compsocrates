"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { addDoc, collection, doc, getDoc, setDoc } from "firebase/firestore";
import { ArrowLeft, CheckCircle2, ClipboardList, StickyNote, Wrench, XCircle } from "lucide-react";
import { db } from "@/app/firebase";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import { useAuth } from "@/app/AuthContext";
import { getDashboardRoute } from "@/app/utils/dashboardRoute";
import { Action, Chip, CommandBar, Deck, HudCanvas, HudViewport, PageIntro } from "@/app/components/Hud";

function HelperFormContent() {
  const { userData } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");
  const editCollectionParam = searchParams.get("editCollection");
  const editMode = Boolean(editId);
  const [saving, setSaving] = useState(false);
  const [teamNumber, setTeamNumber] = useState("");
  const [successful, setSuccessful] = useState(false);
  const [issueSolved, setIssueSolved] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!editId) return;
    let isActive = true;
    const editIdValue = editId;
    const collectionName: string = editCollectionParam || "helperReports";
    async function loadEditEntry() {
      try {
        const snap = await getDoc(doc(db, collectionName, editIdValue));
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

  const dashboardHref = getDashboardRoute(userData);

  return (
    <HudCanvas>
      <CommandBar>
        <Action variant="ghost" onClick={() => router.push(dashboardHref)}>
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </Action>
        <span className="hidden font-display text-sm text-slate-950 sm:inline">Pit Helper Log</span>
        <Chip icon={Wrench} label="Role" value="Pit Team" tone="gold" />
      </CommandBar>

      <HudViewport>
        <form onSubmit={handleSubmit} className="grid gap-6 xl:grid-cols-12">
          <div className="xl:col-span-12">
            <PageIntro
              eyebrow="Pit Assistance Report"
              title={editMode ? "Update Helper Entry" : "Helper Form"}
              subtitle="Log the assist you gave another team's pit crew — what broke, whether it got fixed, and anything worth flagging before their next match."
            />
          </div>

          <Deck priority="high" className="xl:col-span-7">
            <p className="text-xs font-black uppercase tracking-[0.28em] text-red-900/60">Who You Helped</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Scout Name</label>
                <input className="w-full font-data" value={userData?.displayName || ""} disabled />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Team Number Assisted</label>
                <input
                  className="w-full font-data"
                  value={teamNumber}
                  onChange={(e) => setTeamNumber(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="e.g. 118"
                  required
                />
              </div>
            </div>
          </Deck>

          <Deck priority="normal" className="xl:col-span-5 xl:translate-y-4">
            <p className="text-xs font-black uppercase tracking-[0.28em] text-amber-900/70">Outcome</p>
            <button
              type="button"
              onClick={() => setSuccessful((prev) => !prev)}
              className={`mt-4 flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                successful
                  ? "border-emerald-400/60 bg-emerald-50/60 text-emerald-900"
                  : "border-white/70 bg-white/40 text-slate-600"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-bold">
                {successful ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5 opacity-50" />}
                Were you successful?
              </span>
              <span className="font-data text-xs uppercase tracking-[0.14em]">{successful ? "Yes" : "No"}</span>
            </button>
          </Deck>

          <Deck priority="critical" className="xl:col-span-8">
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.28em] text-red-900/60">
              <ClipboardList className="h-4 w-4" />
              Issue Resolved
            </p>
            <label className="mb-1.5 mt-4 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              Describe the issue(s) you solved
            </label>
            <textarea
              className="h-36 w-full resize-none"
              value={issueSolved}
              onChange={(e) => setIssueSolved(e.target.value)}
              placeholder="What did you fix?"
            />
          </Deck>

          <Deck priority="normal" className="xl:col-span-4 xl:-translate-y-3">
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.28em] text-red-900/60">
              <StickyNote className="h-4 w-4" />
              Notes
            </p>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="mt-4 h-36 w-full resize-none"
              placeholder="Optional additional notes..."
            />
          </Deck>

          <div className="xl:col-span-12 flex justify-center pt-2">
            <Action type="submit" disabled={saving} className="w-full max-w-md justify-center py-3.5 text-base">
              {saving ? "Submitting..." : editMode ? "Update Helper Form" : "Submit Helper Form"}
            </Action>
          </div>
        </form>
      </HudViewport>
    </HudCanvas>
  );
}

export default function HelperFormPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["pit-team"]} formKey="helper-form">
      <HelperFormContent />
    </ProtectedRoute>
  );
}
