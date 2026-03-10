"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAnalyticsNotesSettings } from "@/app/components/AnalyticsNotesContext";

type ExpandableNotesCellProps = {
  text?: string | null;
  placeholder?: string;
  maxLines?: number;
  className?: string;
};

export default function ExpandableNotesCell({
  text,
  placeholder = "-",
  maxLines = 2,
  className,
}: ExpandableNotesCellProps) {
  const { autoExpandNotes } = useAnalyticsNotesSettings();
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const content = useMemo(() => (text ?? "").trim(), [text]);

  useEffect(() => {
    if (autoExpandNotes) {
      setExpanded(true);
    } else {
      setExpanded(false);
    }
  }, [autoExpandNotes]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const checkOverflow = () => {
      setIsOverflowing(el.scrollHeight > el.clientHeight + 1);
    };
    checkOverflow();
    const id = window.setTimeout(checkOverflow, 0);
    return () => window.clearTimeout(id);
  }, [content, expanded, maxLines]);

  if (!content) {
    return <span className="text-gray-500">{placeholder}</span>;
  }

  const clampStyles: React.CSSProperties =
    expanded || autoExpandNotes
      ? { whiteSpace: "pre-wrap" }
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
      className={`w-full text-left ${isOverflowing || expanded ? "cursor-pointer" : "cursor-default"} ${className || ""}`}
      title={expanded ? "Collapse notes" : "Expand notes"}
      aria-expanded={expanded}
    >
      <div ref={containerRef} style={clampStyles}>
        {content}
      </div>
      {!autoExpandNotes && isOverflowing && !expanded && (
        <span className="block text-xs text-gray-500 mt-1">Click to expand</span>
      )}
    </button>
  );
}
