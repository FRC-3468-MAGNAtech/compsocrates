"use client";

import { useCallback, useEffect, useState } from "react";
import { Info } from "lucide-react";
import { ConfirmDeleteDialog } from "@/components/credits/credit-dialogs";
import { CreditsBoard } from "@/components/credits/credits-board";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Shimmer } from "@/components/ui/shimmer";
import { fetchOwnerCredits, saveOwnerCredits, type StoredCredits } from "@/lib/credits/client";
import { applyCreditsOp, sameSections, type CreditSection, type CreditsOp } from "@/lib/credits/ops";
import { DEFAULT_CREDITS } from "@/lib/credits/seed";
import { parseCreditsInput } from "@/lib/credits/validate";

/**
 * Admin Panel > Credits (platform owner only, the same tab in every program): edit the site's ONE set of credits. The working copy lives here until
 * Save, which sends the whole document with the version it started from; if someone saved first the owner is told and can load the latest version.
 * Until a first save the starting point is the built-in list (which the public page shows too). The owner is checked on the server.
 */
export function PlatformCreditsPanel() {
  const [stored, setStored] = useState<StoredCredits | null>(null);
  const [sections, setSections] = useState<CreditSection[]>(DEFAULT_CREDITS);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; conflict: boolean; ok?: boolean } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const version = stored?.version ?? 0;
  const savedSections = stored?.sections ?? DEFAULT_CREDITS;
  const dirty = !sameSections(sections, savedSections);

  useEffect(() => {
    let cancelled = false;
    fetchOwnerCredits().then(
      (credits) => {
        if (cancelled) return;
        setStored(credits);
        setSections(credits?.sections ?? DEFAULT_CREDITS);
        setLoadError(false);
        setLoaded(true);
      },
      () => {
        if (cancelled) return;
        setLoadError(true);
        setLoaded(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const onOp = useCallback((op: CreditsOp) => setSections((s) => applyCreditsOp(s, op)), []);
  const reload = () => {
    setLoaded(false);
    setMessage(null);
    setAttempt((n) => n + 1);
  };

  const save = async () => {
    setMessage(null);
    const parsed = parseCreditsInput(sections);
    if (!parsed.ok) return setMessage({ text: parsed.error, conflict: false });
    setBusy(true);
    try {
      const result = await saveOwnerCredits(version, { sections: parsed.sections });
      if (result.ok) {
        setStored(result.credits);
        setSections(result.credits.sections);
        setMessage({ text: "Saved. The public Credits page updates within about 30 seconds.", conflict: false, ok: true });
      } else setMessage({ text: result.message, conflict: result.conflict });
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await saveOwnerCredits(version, { reset: true });
      if (result.ok) {
        setStored(result.credits);
        setSections(result.credits.sections);
        setMessage({ text: "Reset to the built-in list.", conflict: false, ok: true });
      } else setMessage({ text: result.message, conflict: result.conflict });
    } finally {
      setBusy(false);
      setResetOpen(false);
    }
  };

  return (
    <GlassPanel className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Credits</h2>
          <p className="text-sm text-[var(--muted-foreground)]">One set of credits for the whole site, shown on the public Credits page and inside both programs.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => setPreview((p) => !p)} aria-pressed={preview} disabled={!loaded || loadError}>
            {preview ? "Back to editing" : "Preview"}
          </Button>
          <Button variant="outline" className="min-h-11" onClick={() => { setConfirmReset(true); setResetOpen(true); }} disabled={!loaded || loadError || busy}>
            Reset to built-in list
          </Button>
          <Button className="min-h-11" onClick={() => void save()} disabled={!loaded || loadError || busy || !dirty}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {loaded && !loadError && stored === null && (
        <p className="flex items-start gap-2 self-start rounded-2xl border border-[var(--glass-border)] bg-white/5 px-4 py-2.5 text-xs text-[var(--muted-foreground)]">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>This is the built-in list. Edit anything, then Save: your version replaces it for everyone.</span>
        </p>
      )}
      {message && (
        <div role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-emerald-300" : "flex flex-col items-start gap-2 text-sm text-red-300"}>
          <p>{message.text}</p>
          {message.conflict && (
            <Button variant="outline" size="sm" onClick={reload}>
              Load the latest version
            </Button>
          )}
        </div>
      )}

      {!loaded ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading credits">
          {[0, 1].map((i) => (
            <Shimmer key={i} className="h-[96px] w-full" />
          ))}
        </div>
      ) : loadError ? (
        <div role="alert" className="flex flex-col items-start gap-3 text-sm text-red-300">
          <p>Couldn&apos;t load the saved credits. Editing is off so a saved set is never overwritten by mistake.</p>
          <Button variant="outline" size="sm" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : preview ? (
        <CreditsBoard sections={sections} admin={false} onOp={() => {}} />
      ) : (
        <CreditsBoard sections={sections} admin editing onOp={onOp} />
      )}

      {confirmReset && (
        <ConfirmDeleteDialog
          open={resetOpen}
          onOpenChange={setResetOpen}
          title="Reset to the built-in list?"
          detail="This replaces the saved credits with the built-in list, for everyone. The saved set can't be recovered afterwards."
          confirmLabel="Reset credits"
          onConfirm={() => void reset()}
        />
      )}
    </GlassPanel>
  );
}
