"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { DELETE_CONFIRMATION_WORD } from "@/lib/deletion/constants";
import { deletionApi, type DeletionJobRow } from "@/lib/deletion/client";
import { DELETION_ADMIN_TEXT as T, friendlyDeletionError } from "@/lib/deletion/strings";

const when = (ms: number) => (ms > 0 ? new Date(ms).toLocaleString() : "—");

/** One row: opaque id, status, step, times. No name, no email, no uid. */
export function DeletionRow({ job, now, busy, onResume }: { job: DeletionJobRow; now: number; busy: boolean; onResume: (opaqueId: string) => void }) {
  const waitMin = job.notBeforeMs !== null && job.notBeforeMs > now ? Math.ceil((job.notBeforeMs - now) / 60000) : 0;
  return (
    <li className="glass-card flex flex-col gap-2 p-3 sm:flex-row sm:items-center" data-testid="deletion-row">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs">{job.opaqueId}</p>
        <p className="text-xs text-[var(--muted-foreground)]">
          Step: {job.step} · started {when(job.startedAt)} · updated {when(job.updatedAt)} · runs {job.runs}
          {job.sweepLoops > 0 ? ` · sweeps ${job.sweepLoops}` : ""}
          {waitMin > 0 ? ` · cooldown ends in about ${waitMin} min` : ""}
        </p>
        {job.lastError && <p className="text-xs text-amber-400">{job.lastError}</p>}
      </div>
      <Badge variant="glass" className="w-fit text-[10px]">
        {T.statusLabels[job.status] ?? job.status}
      </Badge>
      <Button type="button" variant="glass" size="sm" className="min-h-11 sm:min-h-8" disabled={busy} onClick={() => onResume(job.opaqueId)}>
        {T.resume}
      </Button>
    </li>
  );
}

/**
 * Admin Panel > Account deletions (platform owner only, the same tab in both programs, shown only while the deletion switch is ON). One read when it opens and one
 * per Refresh, never a listener. It shows opaque ids and statuses and nothing that names a person; the only place a uid is typed is the owner's own "delete an account" form.
 */
export function AccountDeletionsPanel() {
  const [jobs, setJobs] = useState<DeletionJobRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uid, setUid] = useState("");
  const [confirm, setConfirm] = useState("");
  const [now, setNow] = useState(() => Date.now());

  // One read when the tab opens and one per Refresh (or after an action): the effect re-runs when `reload` changes. Never a listener.
  const [reload, setReload] = useState(0);
  const load = () => setReload((n) => n + 1);

  useEffect(() => {
    let alive = true;
    deletionApi
      .list()
      .then((r) => {
        if (!alive) return;
        setError(null);
        setJobs(r.jobs);
        setNow(Date.now());
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? friendlyDeletionError(err.code, err.message) : "Could not load the list.");
      });
    return () => {
      alive = false;
    };
  }, [reload]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? friendlyDeletionError(err.code, err.message) : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassPanel className="flex flex-col gap-4" data-testid="account-deletions-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            <Trash2 className="h-4 w-4" aria-hidden /> {T.title}
          </h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">{T.intro}</p>
        </div>
        <Button type="button" variant="glass" size="sm" className="min-h-11 gap-2 sm:min-h-8" onClick={load} disabled={busy}>
          <RefreshCw className="h-4 w-4" aria-hidden /> {T.refresh}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {jobs === null ? (
        <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
      ) : jobs.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">{T.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {jobs.map((j) => (
            <DeletionRow key={j.opaqueId} job={j} now={now} busy={busy} onResume={(id) => void act(() => deletionApi.resume(id))} />
          ))}
        </ul>
      )}
      <form
        className="flex flex-col gap-3 border-t border-[var(--glass-border)] pt-4 sm:max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await deletionApi.start(uid.trim());
            setUid("");
            setConfirm("");
          });
        }}
      >
        <h3 className="text-sm font-semibold">{T.startTitle}</h3>
        <p className="text-xs text-[var(--muted-foreground)]">{T.startHint}</p>
        <div>
          <Label htmlFor="deletion-uid">Account uid</Label>
          <Input id="deletion-uid" value={uid} onChange={(e) => setUid(e.target.value)} autoComplete="off" disabled={busy} />
        </div>
        <div>
          <Label htmlFor="deletion-confirm">{T.startConfirm}</Label>
          <Input id="deletion-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" disabled={busy} />
        </div>
        <Button type="submit" variant="danger" className="min-h-11 self-start" disabled={busy || uid.trim() === "" || confirm !== DELETE_CONFIRMATION_WORD}>
          {T.startSubmit}
        </Button>
      </form>
    </GlassPanel>
  );
}
