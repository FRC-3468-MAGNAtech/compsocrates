"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { GlassSkeletonGrid } from "@/components/ui/glass-skeleton";
import { Shimmer } from "@/components/ui/shimmer";
import { failureExplanation, type FirestoreFailure } from "@/lib/firestore-errors";

export function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading Judge Book">
      <GlassSkeletonGrid count={6} />
    </div>
  );
}

export function CardSkeleton() {
  return (
    <GlassPanel className="flex flex-col gap-4" role="status" aria-label="Loading card">
      <Shimmer className="h-8 w-2/3" />
      <Shimmer className="h-3 w-1/4" />
      <Shimmer className="h-40 w-full" />
    </GlassPanel>
  );
}

export function LoadError({ error, onRetry }: { error: FirestoreFailure; onRetry: () => void }) {
  return (
    <GlassPanel className="flex flex-col items-center gap-3 py-10 text-center" role="alert">
      <AlertTriangle className="h-8 w-8" style={{ color: "var(--color-primary)" }} />
      <div>
        <div className="font-semibold">{error.context}</div>
        <p className="mt-1 max-w-prose text-sm text-[var(--muted-foreground)]">{failureExplanation(error)}</p>
      </div>
      <Button variant="glass" onClick={onRetry} className="gap-2">
        <RefreshCw className="h-4 w-4" /> Retry
      </Button>
    </GlassPanel>
  );
}

export function NoTeamNotice() {
  return <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]">Join a team to use the Judge Book.</GlassPanel>;
}
