"use client";

/**
 * Fresh glass-HUD notes/expandable-cell primitive shared across the analytics
 * rebuild pages (match-strategy, drive-reflection, team-strategy, lead,
 * match-breakdown). Built from scratch against the floating-HUD design
 * system — NOT a port of the old ExpandableNotesCell markup/classes, though
 * it preserves the same auto-expand-notes behavior (AnalyticsNotesContext)
 * and overflow-driven expand/collapse interaction.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useAnalyticsNotesSettings } from "@/app/components/AnalyticsNotesContext";

type GlassNotesCellProps = {
  text?: string | null;
  placeholder?: string;
  maxLines?: number;
  className?: string;
};

export default function GlassNotesCell({
  text,
  placeholder = "—",
  maxLines = 1,
  className = "",
}: GlassNotesCellProps) {
  const { autoExpandNotes } = useAnalyticsNotesSettings();
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const content = useMemo(() => (text ?? "").trim(), [text]);

  useEffect(() => {
    setExpanded(autoExpandNotes);
  }, [autoExpandNotes]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const checkOverflow = () => {
      const heightOverflow = el.scrollHeight > el.clientHeight + 1;
      const widthOverflow = el.scrollWidth > el.clientWidth + 1;
      setIsOverflowing(heightOverflow || widthOverflow);
    };
    checkOverflow();
    const id = window.setTimeout(checkOverflow, 0);
    return () => window.clearTimeout(id);
  }, [content, expanded, maxLines]);

  if (!content) {
    return <span className="font-data text-xs text-slate-400">{placeholder}</span>;
  }

  const clampStyles: React.CSSProperties =
    expanded || autoExpandNotes
      ? { whiteSpace: "pre-wrap" }
      : maxLines <= 1
        ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }
        : {
            display: "-webkit-box",
            WebkitLineClamp: maxLines,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            whiteSpace: "pre-wrap",
          };

  return (
    <button
      type="button"
      onClick={() => {
        if (!isOverflowing && !expanded) return;
        setExpanded((prev) => !prev);
      }}
      className={`group block w-full max-w-[22rem] rounded-xl px-2 py-1 text-left transition-colors ${
        isOverflowing || expanded ? "cursor-pointer hover:bg-amber-100/40" : "cursor-default"
      } ${className}`}
      title={expanded ? "Collapse notes" : isOverflowing ? "Expand notes" : undefined}
      aria-expanded={expanded}
    >
      <div ref={containerRef} className="text-slate-800" style={clampStyles}>
        {content}
      </div>
      {isOverflowing && (
        <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-[0.16em] text-red-800/60 group-hover:text-red-800">
          {expanded ? "Collapse" : "Expand"}
        </span>
      )}
    </button>
  );
}
