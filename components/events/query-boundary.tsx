"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Shimmer } from "@/components/ui/shimmer";

type QueryLike = { status: "loading" | "success" | "empty" | "error"; error: { message: string } | null; refetch: () => void };

/** Loading shimmer, a retryable error, the empty message, or the content: the four states of every event data view. */
export function QueryBoundary({ query, what, empty, children }: { query: QueryLike; what: string; empty: React.ReactNode; children: React.ReactNode }) {
  if (query.status === "loading") {
    return (
      <div role="status" aria-label={`Loading ${what}`} className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Shimmer key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (query.status === "error") {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
        <AlertTriangle className="h-7 w-7" style={{ color: "var(--color-primary)" }} aria-hidden />
        <div>
          <div className="font-semibold">Couldn&apos;t load {what}</div>
          <p className="text-sm text-[var(--muted-foreground)]">{query.error?.message}</p>
        </div>
        <Button variant="glass" onClick={query.refetch} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }
  if (query.status === "empty") return <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">{empty}</p>;
  return <>{children}</>;
}
