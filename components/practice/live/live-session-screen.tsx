"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Send, X } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScoutForm, type ScoutFormHandle } from "@/components/scout/scout-form";
import { allianceRoleFor } from "@/lib/forms/alliance-role";
import { ScoutingWorkspace } from "@/components/practice/scouting-workspace";
import { embedUrlFor, parseStreamUrl } from "@/lib/live/stream";
import { LIVE_CONFIG } from "@/lib/live/config";
import { liveMatchKey, removePresence, upsertPresence } from "@/lib/live-presence";
import { useAuth } from "@/lib/auth";
import { useProgram } from "@/lib/program/context";
import { calculateScore } from "@/lib/forms/scoring";
import { useLockedForm } from "@/lib/forms/forms-context";
import { deletePracticeSession, updatePracticeSession, type PracticeSession } from "@/lib/practice-sessions";
import { entryPayloadFor, getEntriesForSession, saveEntry } from "@/lib/scout-entries";
import type { StickyNote } from "@/lib/forms/types";
import { joinNotes } from "@/lib/forms/values";
import { notesForSave } from "@/lib/sticky-notes";
import { LoadError } from "@/components/practice/load-error";
import { describeFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";

/**
 * P7: the stream embed only ever shows the live broadcast — it doesn't
 * attempt to capture `streamStartSec`/`streamEndSec` (both always written
 * as `null`, same as the schema already allows for "not captured"). Doing
 * that reliably needs the platform's own JS player SDK wired up with
 * postMessage round-trips, which couldn't be verified end-to-end without a
 * real live stream to test against. A clear
 * "Open stream in a new tab" card still always works regardless.
 */
export function LiveSessionScreen({
  session,
  streamUrl,
  onExitToLanding,
  onCompleted,
}: {
  session: PracticeSession;
  streamUrl: string;
  onExitToLanding: () => void;
  onCompleted: () => void;
}) {
  const { user } = useAuth();
  const program = useProgram();
  const form = useLockedForm(session.seasonId);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [validationError, setValidationError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<FirestoreFailure | null>(null);
  const scoutFormRef = useRef<ScoutFormHandle>(null);
  // the comments drawer's text, which is the form's `comments` value (ScoutForm commentsMode="popout")
  const [notes, setNotes] = useState<StickyNote[]>([]);

  const stream = parseStreamUrl(streamUrl);
  const matchKey = session.eventCode && session.matchType && session.matchNumber !== null ? liveMatchKey(session.eventCode, session.matchType, session.matchNumber) : null;
  const teamNumber = session.robots[0];

  // Presence heartbeat — written immediately on mount, then every
  // PRESENCE_HEARTBEAT_INTERVAL_MS, removed on unmount (Cancel/Submit both
  // unmount this screen one way or another).
  useEffect(() => {
    if (!matchKey || !user || !session.alliance) return;
    const write = () =>
      void upsertPresence(
        matchKey,
        {
          uid: user.uid,
          teamId: session.teamId,
          name: session.scoutName,
          robot: teamNumber,
          alliance: session.alliance!,
          sessionId: session.id,
        },
        program
      ).catch(() => undefined); // a failed heartbeat is reported by the store; the next one tries again
    write();
    const interval = setInterval(write, LIVE_CONFIG.PRESENCE_HEARTBEAT_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      void removePresence(matchKey, user.uid, program).catch(() => undefined);
    };
  }, [matchKey, user, session.alliance, session.teamId, session.scoutName, session.id, teamNumber, program]);

  const handleCancel = async () => {
    await deletePracticeSession(session.id, program);
    onExitToLanding();
  };

  const handleSubmit = async () => {
    const handle = scoutFormRef.current;
    if (!handle || !handle.validate()) {
      setValidationError(true);
      return;
    }
    setValidationError(false);
    setSubmitting(true);
    setError(null);
    try {
      const values = handle.getValues();
      const score = calculateScore(form, values.values);
      await saveEntry(session.teamId, session.uid, {
        scoutName: session.scoutName,
        eventCode: session.eventCode!,
        matchType: session.matchType!,
        matchNumber: session.matchNumber!,
        teamNumber,
        ...entryPayloadFor(form, values.values, score, { stickyNotes: notesForSave(notes) }),
        source: "live",
        mode: null,
        sessionId: session.id,
        libraryMatchId: session.libraryMatchId,
      }, program);
      const entries = await getEntriesForSession(session.teamId, session.id, program);
      await updatePracticeSession(session.id, {
        status: "completed",
        completedRobots: [teamNumber],
        entryIds: entries.map((e) => e.id),
        finishedAt: new Date().toISOString(),
      }, undefined, program);
      // Try to resolve scores immediately — the server-side poller/fallback
      // still cover it if the official score isn't posted yet.
      try {
        await fetch("/api/live/check-scores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ program }) });
      } catch {
        // Best-effort — the cron/client-poll fallbacks still cover this.
      }
      onCompleted();
    } catch (err) {
      setError(describeFirestoreError("Couldn't submit that entry.", err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <ScoutingWorkspace
        video={
          stream && stream.platform === "youtube" ? (
            <iframe src={embedUrlFor(stream)} title="Live stream" className="h-full w-full" allow="autoplay; encrypted-media" allowFullScreen />
          ) : stream && stream.platform === "twitch" ? (
            <iframe src={embedUrlFor(stream, typeof window !== "undefined" ? window.location.hostname : undefined)} title="Live stream" className="h-full w-full" allowFullScreen />
          ) : (
            <GlassPanel className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-[var(--muted-foreground)]">Can&apos;t embed this stream.</p>
              <a href={streamUrl} target="_blank" rel="noreferrer">
                <Button variant="glass" className="gap-2">
                  <ExternalLink className="h-4 w-4" /> Open stream in a new tab
                </Button>
              </a>
            </GlassPanel>
          )
        }
        form={
          <ScoutForm
            key={`${form.id}@${form.version}`}
            schema={form}
            ref={scoutFormRef}
            mode="live"
            layout="side-panel"
            hideMatchPicker
            showSubmitButton={false}
            lockedFields={["teamNumber"]}
            prefill={{ teamNumber, scoutName: session.scoutName }}
            allianceRole={allianceRoleFor(form, { eventKey: session.eventCode ?? "", matchType: session.matchType ?? "", matchNumber: session.matchNumber ?? 0, alliance: session.alliance, teams: session.allianceTeams, teamNumber })}
            commentsMode="popout"
            comments={joinNotes(notes)}
            onCommentsChange={() => undefined}
          />
        }
        comments={{ notes, onChange: setNotes, label: `Robot: #${teamNumber}` }}
        notice={
          <>
            {validationError && <p className="mt-2 text-sm font-medium text-red-300">Fill in the form before submitting.</p>}
            {error && <LoadError failure={error} />}
          </>
        }
        actions={
          <>
            <Button variant="ghost" className="gap-1.5 text-red-300" onClick={() => setCancelConfirmOpen(true)}>
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button size="lg" className="gap-2" onClick={handleSubmit} disabled={submitting}>
              <Send className="h-4 w-4" /> {submitting ? "Submitting…" : "Submit Scouting"}
            </Button>
          </>
        }
      />

      <Dialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <DialogContent>
          <DialogTitle>Cancel this session?</DialogTitle>
          <DialogDescription>Nothing will be saved. This can&apos;t be undone.</DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCancelConfirmOpen(false)}>
              Keep going
            </Button>
            <Button variant="danger" onClick={handleCancel}>
              Cancel session
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
