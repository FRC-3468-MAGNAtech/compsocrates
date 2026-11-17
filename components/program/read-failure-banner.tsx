"use client";

import { LoadError } from "@/components/practice/load-error";
import { useReadFailures } from "@/lib/read-failures";

/** A failed read of the program's data (a port's subscription) says so here, above the page, so an empty list is never mistaken for "no data". */
export function ReadFailureBanner({ className }: { className?: string }) {
  const failures = useReadFailures();
  if (failures.length === 0) return null;
  return (
    <div className={className} data-testid="read-failure-banner">
      {failures.slice(0, 3).map((failure) => (
        <LoadError key={`${failure.path ?? ""}|${failure.context}`} failure={failure} className="mb-3" />
      ))}
      {failures.length > 3 && <p className="text-xs text-[var(--muted-foreground)]">And {failures.length - 3} more reads failed.</p>}
    </div>
  );
}
