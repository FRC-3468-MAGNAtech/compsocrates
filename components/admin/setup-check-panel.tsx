"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { authedApi } from "@/lib/api-client";

/** One variable the server reports as unset. Names and descriptions only: values never leave the server. */
export type SetupCheckItem = { name: string; group: "cs" | "required" | "optional"; purpose: string; whenMissing: string };

export type SetupCheckData = { missing: SetupCheckItem[]; optionalOff: SetupCheckItem[] };

const GROUP_LABEL: Record<SetupCheckItem["group"], string> = {
  cs: "CompSocrates setting",
  required: "Required by the server",
  optional: "Optional",
};

/** The panel's states (loading, error, all clear, missing list) as a pure view, so it can be tested without the network. */
export function SetupCheckView({
  data,
  loading,
  error,
  onRetry,
}: {
  data: SetupCheckData | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="setup-check-panel">
      <GlassPanel className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Setup Check</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Settings the server could not find. Only names are shown, never values. Change them in your host&apos;s environment variables, then redeploy.
          </p>
        </div>
        <Button variant="glass" className="min-h-11 min-w-11" onClick={onRetry} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
          Check again
        </Button>
      </GlassPanel>

      {loading && !data && !error && <div className="glass-card h-24 animate-pulse" role="status" aria-label="Checking the server setup" />}

      {error && (
        <GlassPanel role="alert" className="flex flex-wrap items-start gap-3 border-red-400/30">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-300" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-red-300">Could not run the check.</p>
            <p className="mt-1 break-words text-sm text-[var(--muted-foreground)]">{error}</p>
          </div>
          <Button variant="outline" className="min-h-11 min-w-11" onClick={onRetry}>
            Try again
          </Button>
        </GlassPanel>
      )}

      {data && data.missing.length === 0 && (
        <GlassPanel role="status" className="flex items-center gap-3 border-emerald-400/30">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" aria-hidden />
          <p className="text-sm font-medium">Everything required is configured</p>
        </GlassPanel>
      )}

      {data && data.missing.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="Missing settings">
          {data.missing.map((item) => (
            <li key={item.name} className="glass-card flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <code className="break-all text-sm font-semibold">{item.name}</code>
                <Badge variant={item.group === "required" ? "danger" : "warning"}>{GROUP_LABEL[item.group]}</Badge>
              </div>
              <p className="text-sm text-[var(--muted-foreground)]">
                <span className="font-medium text-[var(--foreground)]">Without it:</span> {item.whenMissing}
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">{item.purpose}</p>
            </li>
          ))}
        </ul>
      )}

      {data && data.optionalOff.length > 0 && (
        <details className="glass-card p-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Optional features that are off ({data.optionalOff.length})</summary>
          <ul className="mt-2 flex flex-col gap-2" aria-label="Optional settings that are not set">
            {data.optionalOff.map((item) => (
              <li key={item.name} className="text-sm">
                <code className="break-all font-medium">{item.name}</code>
                <span className="text-[var(--muted-foreground)]"> {item.whenMissing}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Admin Panel > Setup Check: fetches the server's list of unset variables (admin-only route) and shows it. */
export function SetupCheckPanel() {
  const [data, setData] = useState<SetupCheckData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    authedApi<SetupCheckData>("/api/admin/setup-check")
      .then((res) => setData({ missing: res.missing, optionalOff: res.optionalOff }))
      .catch((e: unknown) => {
        setData(null);
        setError(e instanceof Error ? e.message : "Something went wrong.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Deliberate: the data-fetching effect itself; it moves the panel into its loading state on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return <SetupCheckView data={data} loading={loading} error={error} onRetry={load} />;
}
