"use client";

import { useRef, useState } from "react";
import { FloatingPanel } from "@/components/ui/floating-panel";
import type { AccuracyResult } from "@/lib/scout-entries";
import { useGlassOverlap } from "@/lib/use-glass-overlap";
import { getPercentColor } from "@/lib/accuracy/engine";
import { cn } from "@/lib/utils";

export function AccuracyCell({ accuracy }: { accuracy: AccuracyResult | null }) {
  const [open, setOpen] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const overGlass = useGlassOverlap(tooltipRef, open);

  if (!accuracy || accuracy.status !== "complete" || accuracy.value === null) {
    return <span className="text-[var(--muted-foreground)]">-</span>;
  }

  const percent = Math.round(accuracy.value * 100);

  return (
    <span ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className={cn("cursor-help font-medium underline decoration-dotted underline-offset-4", getPercentColor(percent))}
      >
        {percent}%
      </button>
      <FloatingPanel
        open={open}
        anchorRef={rootRef}
        panelRef={tooltipRef}
        align="center"
        className="pointer-events-none w-48 rounded-xl p-3 text-xs shadow-2xl"
        style={overGlass ? undefined : ({ "--glass-shade": 1 } as React.CSSProperties)}
      >
            <div className="flex justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Scouted total</span>
              <span className="font-medium">{accuracy.scoutedTotal}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Penalties</span>
              <span className="font-medium">{accuracy.penaltyPoints}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Official score</span>
              <span className="font-medium">{accuracy.officialScore}</span>
            </div>
      </FloatingPanel>
    </span>
  );
}
