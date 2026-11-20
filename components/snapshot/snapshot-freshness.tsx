"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProgram } from "@/lib/program/context";
import { refreshSnapshot, useSnapshotStatus } from "@/lib/snapshot/client";
import { describeFreshness, refreshCountdownSeconds, type SnapshotDataset } from "@/lib/snapshot/model";

/**
 * "Updated N min ago" and a Refresh button for the datasets a page shows from a snapshot (read reduction 2a). ONE component for every program and page: it renders
 * nothing while the datasets come straight from Firestore (the switches are off), so a page that mounts it looks exactly as before. Refresh asks the server for a rebuild,
 * which it grants at most once per 2 minutes per dataset; until then the button is disabled and counts down.
 */
export function SnapshotFreshness({ datasets }: { datasets: readonly SnapshotDataset[] }) {
  const program = useProgram();
  const status = useSnapshotStatus(datasets);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!status) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);
  if (!status) return null;
  const wait = refreshCountdownSeconds(status.refreshAvailableAt, now);
  const onRefresh = async () => {
    setBusy(true);
    try {
      await Promise.all(status.datasets.map((d) => refreshSnapshot(d, program)));
    } finally {
      setBusy(false);
      setNow(Date.now());
    }
  };
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]" data-testid="snapshot-freshness">
      <span>{describeFreshness(status.builtAt, now)}{status.stale ? " (the server could not refresh just now)" : ""}</span>
      <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={busy || wait > 0} aria-label={wait > 0 ? `Refresh available in ${wait} seconds` : "Refresh"}>
        <RefreshCw className={busy ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden="true" />
        {wait > 0 ? `Refresh in ${wait}s` : "Refresh"}
      </Button>
    </div>
  );
}
