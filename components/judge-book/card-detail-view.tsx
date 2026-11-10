"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { CardImage } from "@/components/judge-book/card-image";
import { formatUpdated } from "@/components/judge-book/card-tile";
import { EditCardDialog } from "@/components/judge-book/edit-card-dialog";
import { CardSkeleton, LoadError, NoTeamNotice } from "@/components/judge-book/load-state";
import { safeImageUrl, type JudgeBookCard } from "@/lib/judge-book/model";
import { useJudgeBookSession } from "@/lib/judge-book/use-judge-book-session";

/** One Judge Book card in full: question, answer, optional image, and an Edit button for editors. */
export function CardDetailView({ cardId }: { cardId: string }) {
  const book = useJudgeBookSession();
  const [editing, setEditing] = useState<JudgeBookCard | null>(null);
  const card = book.cards.find((c) => c.id === cardId) ?? null;
  const image = safeImageUrl(card?.imageUrl);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/judge-book"
        className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-full text-sm text-[var(--muted-foreground)] outline-none hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Judge Book
      </Link>

      {!book.hasTeam ? (
        <NoTeamNotice />
      ) : !book.loaded ? (
        <CardSkeleton />
      ) : book.error ? (
        <LoadError error={book.error} onRetry={book.retry} />
      ) : !card ? (
        <GlassPanel className="flex flex-col items-center gap-2 py-10 text-center">
          <SearchX className="h-8 w-8 text-[var(--muted-foreground)]" aria-hidden />
          <p className="font-semibold">Card not found.</p>
          <p className="text-sm text-[var(--muted-foreground)]">It may have been deleted, or it belongs to another team.</p>
        </GlassPanel>
      ) : (
        <GlassPanel className="flex flex-col gap-6">
          <header>
            <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{card.prompt}</h1>
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">Updated {formatUpdated(card)}</p>
          </header>
          <div className={image ? "grid gap-6 lg:grid-cols-[2fr_1fr]" : undefined}>
            <p className="min-h-24 whitespace-pre-wrap break-words">{card.answer}</p>
            {image && <CardImage src={image} />}
          </div>
          {book.canEdit && (
            <div>
              <Button onClick={() => setEditing(card)} className="gap-2">
                <Pencil className="h-4 w-4" /> Edit card
              </Button>
            </div>
          )}
        </GlassPanel>
      )}

      {book.canEdit && <EditCardDialog card={editing} onClose={() => setEditing(null)} onSave={book.update} />}
    </div>
  );
}
