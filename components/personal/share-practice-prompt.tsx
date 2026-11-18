"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { useAuth } from "@/lib/auth";
import { useMembershipsEnabled } from "@/lib/memberships/client";
import { useProgram } from "@/lib/program/context";
import { dismissShare, readShareState, runShare, type ShareState } from "@/lib/personal/share-client";
import { SHARE_PRACTICE_TEXT } from "@/lib/personal/strings";

/**
 * SHARE ON JOIN, the opt-in. `auto`: the card shown once, at the top of the dashboard, to a member who has private practice nobody has shared or declined yet. Not
 * `auto` (Practice Scouting): a plain button that reopens the same choice after "Not now". Never automatic: nothing is copied until the person presses Share. Memberships
 * ON only, and only for an account that now has a team (the server copies into the team on the person's own user document).
 */
export function SharePracticePrompt({ auto }: { auto: boolean }) {
  const memberships = useMembershipsEnabled();
  const { user, profile } = useAuth();
  const program = useProgram();
  const uid = user?.uid ?? null;
  const hasTeam = !!profile?.teamId;
  const [state, setState] = useState<ShareState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "done" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!memberships || !uid || !hasTeam) return;
    let alive = true;
    void readShareState(program, uid, { ignoreRemembered: !auto }).then((next) => alive && setState(next));
    return () => {
      alive = false;
    };
  }, [memberships, uid, hasTeam, program, auto]);

  if (!memberships || !uid || !hasTeam || !state) return null;
  const nothing = state.sessions === 0 || state.shared;
  if (nothing && message === null) return null;
  if (auto && state.dismissed && message === null) return null;

  const writes = state.sessions + state.entries;
  const share = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await runShare(program, uid);
      setMessage({ kind: "done", text: SHARE_PRACTICE_TEXT.done });
      setState({ ...state, shared: true });
      setOpen(false);
    } catch {
      setMessage({ kind: "error", text: SHARE_PRACTICE_TEXT.failed });
    } finally {
      setBusy(false);
    }
  };
  const notNow = async () => {
    setOpen(false);
    try {
      await dismissShare(program, uid);
      setState({ ...state, dismissed: true });
    } catch {
      /* the prompt just shows again next time */
    }
  };

  const body = (
    <>
      <p className="text-sm">{SHARE_PRACTICE_TEXT.body(state.sessions, state.entries)}</p>
      <p className="text-xs text-[var(--muted-foreground)]">{SHARE_PRACTICE_TEXT.cost(writes)}</p>
      {message?.kind === "error" && (
        <p role="alert" className="text-sm text-red-400">
          {message.text}
        </p>
      )}
    </>
  );

  if (message?.kind === "done" && !open) {
    return (
      <p role="status" className="text-sm text-emerald-400" data-testid="share-practice-done">
        {message.text}
      </p>
    );
  }

  if (!auto) {
    return (
      <>
        <Button variant="glass" size="sm" className="self-start" onClick={() => setOpen(true)} data-testid="share-practice-reopen">
          {SHARE_PRACTICE_TEXT.reopen}
        </Button>
        <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
          <DialogContent className="glass-overlay w-[min(94vw,480px)]">
            <DialogTitle>{SHARE_PRACTICE_TEXT.title}</DialogTitle>
            <DialogDescription className="sr-only">{SHARE_PRACTICE_TEXT.cost(writes)}</DialogDescription>
            <div className="mt-3 flex flex-col gap-3">{body}</div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                {SHARE_PRACTICE_TEXT.notNow}
              </Button>
              <Button onClick={() => void share()} disabled={busy}>
                {busy ? SHARE_PRACTICE_TEXT.sharing : SHARE_PRACTICE_TEXT.share}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <GlassPanel className="flex flex-col gap-3" data-testid="share-practice-prompt">
      <h2 className="text-base font-semibold">{SHARE_PRACTICE_TEXT.title}</h2>
      {body}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void share()} disabled={busy}>
          {busy ? SHARE_PRACTICE_TEXT.sharing : SHARE_PRACTICE_TEXT.share}
        </Button>
        <Button variant="ghost" onClick={() => void notNow()} disabled={busy}>
          {SHARE_PRACTICE_TEXT.notNow}
        </Button>
      </div>
    </GlassPanel>
  );
}
