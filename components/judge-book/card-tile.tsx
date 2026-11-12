"use client";

import Link from "@/components/program/link";
import { Pencil, Trash2 } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import type { JudgeBookCard } from "@/lib/judge-book/model";

export function formatUpdated(card: Pick<JudgeBookCard, "updatedAt" | "createdAt">): string {
  return new Date(card.updatedAt || card.createdAt || 0).toLocaleString();
}

/** One card in the grid: the whole tile opens the card; editors also get Edit and Delete. */
export function CardTile({
  card,
  canEdit,
  onEdit,
  onDelete,
}: {
  card: JudgeBookCard;
  canEdit: boolean;
  onEdit: (card: JudgeBookCard) => void;
  onDelete: (card: JudgeBookCard) => void;
}) {
  return (
    <GlassPanel className="relative flex h-full flex-col gap-2">
      <h2 className="break-words text-lg font-semibold leading-snug">
        <Link
          href={`/judge-book/${encodeURIComponent(card.id)}`}
          className="rounded-md outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]"
        >
          {card.prompt}
        </Link>
      </h2>
      <p className="line-clamp-5 whitespace-pre-wrap break-words text-sm text-[var(--muted-foreground)]">{card.answer || "No answer yet."}</p>
      <p className="mt-auto pt-1 text-xs text-[var(--muted-foreground)]">Updated {formatUpdated(card)}</p>
      {canEdit && (
        <div className="relative z-10 flex gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => onEdit(card)} className="gap-1.5" aria-label={`Edit ${card.prompt}`}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => onDelete(card)} className="gap-1.5 text-red-300" aria-label={`Delete ${card.prompt}`}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      )}
    </GlassPanel>
  );
}
