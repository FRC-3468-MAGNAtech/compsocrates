"use client";

import { X } from "lucide-react";
import { dismissQuotaBanner, QUOTA_MESSAGE, useQuotaBanner } from "@/lib/quota";

/** One non-blocking notice above the page while the database's daily read allowance is used up. The page underneath keeps whatever it already shows. */
export function QuotaBanner({ className }: { className?: string }) {
  const show = useQuotaBanner();
  if (!show) return null;
  return (
    <div className={className} role="status" data-testid="quota-banner">
      <div className="glass-card flex items-center justify-between gap-3 px-4 py-2 text-sm">
        <span>{QUOTA_MESSAGE}</span>
        <button type="button" className="min-h-[44px] min-w-[44px] text-[var(--muted-foreground)]" onClick={dismissQuotaBanner} aria-label="Dismiss">
          <X className="mx-auto h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
