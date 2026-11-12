"use client";

import NextLink from "next/link";
import { PROGRAMS, PROGRAM_IDS } from "@/config/programs";
import { useProgram } from "@/lib/program/context";
import { cn } from "@/lib/utils";

/**
 * The program selector: one pill per program, the active one filled. Links go to the program's dashboard
 * (explicit `/<program>/dashboard`, so this is the one place that switches program on purpose).
 */
export function ProgramSwitcher({ className }: { className?: string }) {
  const active = useProgram();
  return (
    <div role="group" aria-label="Program" className={cn("glass-pill flex items-center gap-1 p-1", className)}>
      {PROGRAM_IDS.map((id) => (
        <NextLink
          key={id}
          href={`/${id}/dashboard`}
          aria-current={id === active ? "true" : undefined}
          title={PROGRAMS[id].brand.fullName}
          className={cn(
            "flex min-h-9 flex-1 items-center justify-center rounded-full px-3 text-xs font-semibold transition-colors",
            id === active
              ? "text-[var(--color-primary-foreground)]"
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
          )}
          style={id === active ? { background: "var(--theme-gradient)" } : undefined}
        >
          {PROGRAMS[id].brand.label}
        </NextLink>
      ))}
    </div>
  );
}

/** Home page: one card per program. */
export function ProgramCards({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
      {PROGRAM_IDS.map((id) => (
        <NextLink key={id} href={`/${id}/dashboard`} className="glass-card flex min-h-11 flex-col gap-2 p-5 transition-transform hover:-translate-y-0.5">
          <span className="text-lg font-semibold">{PROGRAMS[id].brand.label}</span>
          <span className="text-sm text-[var(--muted-foreground)]">{PROGRAMS[id].brand.fullName}</span>
        </NextLink>
      ))}
    </div>
  );
}
