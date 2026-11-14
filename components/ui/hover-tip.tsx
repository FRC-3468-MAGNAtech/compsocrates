"use client";

import { useId, useRef, useState } from "react";
import { FloatingPanel } from "@/components/ui/floating-panel";
import { cn } from "@/lib/utils";

/**
 * Wraps any inline content so a tooltip opens on hover, keyboard focus, or tap
 * (touch has no hover). Unlike `InfoTip` there's no "i" button — the wrapped
 * content itself is the trigger (a column label, a percentage). The panel is
 * `.glass-overlay`, the solid backing for anything floating over page content,
 * so the text stays legible in every theme.
 */
export function HoverTip({
  content,
  children,
  className,
  align = "center",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
}) {
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;

  return (
    <span
      ref={rootRef}
      className={cn("relative inline-flex", className)}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <span
        tabIndex={0}
        role="button"
        aria-describedby={open ? id : undefined}
        onClick={() => setPinned((v) => !v)}
        onFocus={() => setHover(true)}
        onBlur={() => {
          setHover(false);
          setPinned(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setHover(false);
            setPinned(false);
          }
        }}
        className="cursor-help rounded outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]"
      >
        {children}
      </span>
      <FloatingPanel
        open={open}
        anchorRef={rootRef}
        align={align}
        id={id}
        role="tooltip"
        className="pointer-events-none block w-max max-w-[min(18rem,calc(100vw-2rem))] rounded-xl p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-[var(--foreground)] shadow-2xl"
      >
        {content}
      </FloatingPanel>
    </span>
  );
}
