"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, type HTMLMotionProps } from "framer-motion";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { computePanelPosition, type FloatAlign } from "@/lib/floating-position";
import { portalContainer } from "@/lib/portal-container";

/**
 * STACKING RULE (read before adding any dropdown, popover or tooltip): a floating panel is never rendered inside the element it hangs from.
 * Glass panels use `backdrop-filter`, which makes each one a stacking context, so an `absolute z-50` menu inside a panel is trapped under
 * every later sibling that has its own z-index (the Analytics table's sticky header covered the event menu this way). FloatingPanel
 * therefore portals to the document root (or the fullscreen element, see lib/portal-container.ts), positions itself `fixed` from the
 * anchor's rectangle clamped to the viewport (lib/floating-position.ts), and takes its layer from the z-index scale in globals.css
 * (`--z-popover`, above sheets and dialogs). Radix selects and dialogs (components/ui/select.tsx, dialog.tsx) portal the same way and use the
 * same tokens. Never write a numeric z-index for an overlay: use the `--z-*` tokens.
 */
export function FloatingPanel({
  anchorRef,
  open,
  align = "start",
  offset = 8,
  panelRef,
  className,
  style,
  children,
  ...rest
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  align?: FloatAlign;
  offset?: number;
  /** For outside-click checks: the panel is not a DOM descendant of its anchor. */
  panelRef?: React.RefObject<HTMLDivElement | null>;
} & Omit<HTMLMotionProps<"div">, "ref">) {
  const internalRef = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? internalRef;

  // Position the panel by writing left/top on the element (an external system, so no React state and no re-render per scroll tick). Measured
  // before paint so it never flashes at the wrong spot (it starts `visibility: hidden`), then it follows the anchor on scroll (any scroller),
  // resize, and its own size changes (a list that loads in).
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      const panel = ref.current;
      if (!anchor || !panel) return;
      const a = anchor.getBoundingClientRect();
      const { left, top } = computePanelPosition({
        anchor: { left: a.left, top: a.top, width: a.width, height: a.height },
        panel: { width: panel.offsetWidth, height: panel.offsetHeight },
        viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
        align,
        offset,
      });
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.visibility = "visible";
    };
    place();
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (observer && ref.current) observer.observe(ref.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [open, anchorRef, ref, align, offset]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: -4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.97 }}
          transition={spring}
          {...rest}
          className={cn("glass-overlay fixed z-[var(--z-popover)]", className)}
          style={{ ...style, left: 0, top: 0, visibility: "hidden" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    portalContainer() ?? document.body
  );
}
