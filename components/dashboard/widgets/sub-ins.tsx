"use client";

import { useMemo, useState } from "react";
import { Trash2, UserCog } from "lucide-react";
import { Widget } from "@/components/dashboard/widget";
import { useNow } from "@/components/dashboard/shared";
import { ConfirmDialog } from "@/components/scout/confirm-dialog";
import { SubInRequestsPanel } from "@/components/sub-ins/sub-in-requests-panel";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/lib/dashboard/data";
import { cancelSubIn, claimSubIn, clearAllSubIns, useSubInRequests } from "@/lib/sub-ins/store";
import { visibleRequests, type SubInRequest } from "@/lib/sub-ins/model";

/**
 * CS "Sub-In Requests" card (match scout and coach dashboards): the event's open requests from the last 6 hours, live (no 20 s poll), with Take Sub-In, Delete
 * Request and, for a team admin, Clear All (confirmed in a dialog). The listener lives here, not in the DashboardProvider: only these two roles show it.
 */
export function SubInRequestsWidget() {
  const d = useDashboard();
  const { requests, loaded } = useSubInRequests(d.teamId);
  const now = useNow(30_000);
  const code = d.event?.code ?? null;
  const visible = useMemo(() => (code ? visibleRequests(requests, code, now) : []), [requests, code, now]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const actor = d.uid ? { uid: d.uid, name: d.userName } : null;
  const run = async (id: string, job: () => Promise<{ ok: true } | { ok: false; reason: string }>) => {
    setBusyId(id);
    setError(null);
    const result = await job();
    setBusyId(null);
    if (!result.ok) setError(result.reason);
  };

  const loading = !d.eventsLoaded || !loaded;
  return (
    <Widget
      title="Sub-in requests"
      icon={UserCog}
      size="medium"
      status={loading ? "loading" : visible.length === 0 ? "empty" : "ready"}
      emptyText={code ? "No open sub-in requests. A scout who has to leave can ask for cover from the Match Scout Form." : "No active event."}
      headerRight={
        d.isAdmin && visible.length > 0 ? (
          <Button size="sm" variant="ghost" className="min-h-11 gap-1.5 text-red-300" disabled={clearing} onClick={() => setConfirmClear(true)}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden /> Clear all
          </Button>
        ) : undefined
      }
    >
      <SubInRequestsPanel
        requests={visible}
        uid={d.uid}
        now={now}
        busyId={busyId}
        scoutHref={code ? `/scout?event=${encodeURIComponent(code)}&load=next` : null}
        onClaim={(r: SubInRequest) => actor && void run(r.id, () => claimSubIn(r.id, actor))}
        onCancel={(r: SubInRequest) => void run(r.id, () => cancelSubIn(r.id))}
      />
      {error && (
        <p role="alert" className="text-xs font-medium text-red-300">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear all sub-in requests?"
        description="Deletes every sub-in request and assignment for this team, at every event."
        confirmLabel={clearing ? "Clearing…" : "Clear all"}
        cancelLabel="Keep them"
        onConfirm={() => {
          setClearing(true);
          void clearAllSubIns(requests).then((result) => {
            setClearing(false);
            if (!result.ok) setError(result.reason);
          });
        }}
      />
    </Widget>
  );
}
