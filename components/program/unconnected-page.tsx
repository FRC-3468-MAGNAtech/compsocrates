"use client";

import Link from "@/components/program/link";
import { useProgramConfig } from "@/lib/program/context";

/**
 * What a signed-in person sees at a path whose data layer is not connected for their program yet (`ProgramConfig.connection.paths`). The shell is
 * there; the shared page is not rendered, because it would read another program's collections. Points at the first page that is connected.
 */
export function UnconnectedPage() {
  const { brand, connection } = useProgramConfig();
  const open = connection.paths === "all" ? null : connection.paths[0];
  return (
    <div className="glass-card flex flex-col gap-2 p-6" data-testid="unconnected-page">
      <h1 className="text-xl font-semibold">Not available in {brand.label} yet</h1>
      <p className="text-sm text-[var(--muted-foreground)]">This page is still being connected to your {brand.label} team&apos;s data and will appear here once it is.</p>
      {open && (
        <Link href={open} className="text-sm font-medium underline underline-offset-4">
          Go to a page that is ready
        </Link>
      )}
    </div>
  );
}
