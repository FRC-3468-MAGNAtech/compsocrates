import type { TeamLabel } from "@/lib/team-label";
import { cn } from "@/lib/utils";

/**
 * A team label drawn the one way everywhere (switcher trigger, switcher rows, My teams): the number in bold, the name beneath, both WRAPPING (never cut off at an edge; the number
 * line never truncates). While the label is pending it is a skeleton, never an id.
 */
export function TeamLabelView({ label, className, nameLines = 2 }: { label: TeamLabel; className?: string; nameLines?: 2 | 3 }) {
  if (label.state === "pending") {
    return (
      <span className={cn("block min-w-0", className)} data-testid="team-label-pending" aria-label={label.text} role="img">
        <span className="block h-4 w-16 animate-pulse rounded bg-white/15" />
        <span className="mt-1 block h-3 w-28 max-w-full animate-pulse rounded bg-white/10" />
      </span>
    );
  }
  return (
    <span className={cn("block min-w-0", className)} data-testid="team-label">
      <span className="block break-words text-sm font-bold leading-tight" data-testid="team-label-number">
        {label.number ?? label.name}
      </span>
      {label.number !== null && label.name && (
        <span className={cn("mt-0.5 block break-words text-xs leading-snug text-[var(--muted-foreground)]", nameLines === 2 ? "line-clamp-2" : "line-clamp-3")} data-testid="team-label-name">
          {label.name}
        </span>
      )}
    </span>
  );
}
