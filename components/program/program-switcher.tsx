"use client";

import NextLink from "next/link";
import { LayoutGrid } from "lucide-react";
import { PROGRAMS, PROGRAM_IDS } from "@/config/programs";
import { CHOOSE_PROGRAM_HREF } from "@/components/program/home-redirect";
import { useProgram } from "@/lib/program/context";
import { cn } from "@/lib/utils";

/**
 * The program selector: one pill per program, the active one filled. Links go to the program's dashboard
 * (explicit `/<program>/dashboard`, so this is the one place that switches program on purpose). There is no separate
 * "All programs" button here any more; the top bar's `ProgramChip` still links to the selector on the home page.
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

/** A compact chip for the mobile top bar: the active program's name, linking back to the selector. */
export function ProgramChip({ className }: { className?: string }) {
  const active = useProgram();
  return (
    <NextLink
      href={CHOOSE_PROGRAM_HREF}
      title="Switch program"
      aria-label={`${PROGRAMS[active].brand.fullName}: switch program`}
      className={cn("glass-pill flex h-11 items-center gap-1.5 px-3 text-xs font-semibold", className)}
    >
      {PROGRAMS[active].brand.label}
      <LayoutGrid className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
    </NextLink>
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
