"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyText, middleTruncate } from "@/lib/analytics/table-text";

/** How many characters of an id show before the middle is cut. With the 160px column this keeps the id and the copy button inside the column. */
export const SESSION_ID_VISIBLE_CHARS = 14;

/**
 * A Session ID cell: the id cut in the middle (start and end stay readable), the full id in the tooltip, and a copy button. It sits in a fixed-width
 * column and never grows, so a long id cannot run into the Source column. The id uses the app font (tabular numerals), like every other cell.
 */
export function SessionIdCell({ value }: { value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  if (!value || value === "—") return <span className="text-[var(--muted-foreground)]">{"—"}</span>;

  const copy = async () => {
    const ok = await copyText(value);
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1500);
  };

  return (
    <span className="flex min-w-0 max-w-full items-center gap-1">
      <span className="min-w-0 truncate text-xs text-[var(--muted-foreground)]" title={value} data-session-id={value}>
        {middleTruncate(value, SESSION_ID_VISIBLE_CHARS)}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={state === "copied" ? "Session ID copied" : state === "failed" ? "Could not copy the Session ID" : "Copy Session ID"}
        title={state === "failed" ? "Copy is blocked in this browser" : "Copy Session ID"}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] outline-none transition-colors hover:bg-white/10 hover:text-[var(--foreground)] focus-visible:bg-white/10 pointer-coarse:h-11 pointer-coarse:w-11"
      >
        {state === "copied" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
    </span>
  );
}
