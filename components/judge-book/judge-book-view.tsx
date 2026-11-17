"use client";

import { useMemo, useState } from "react";
import { BookOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input } from "@/components/ui/input";
import { CardTile } from "@/components/judge-book/card-tile";
import { CreateCardsDialog } from "@/components/judge-book/create-dialog";
import { DeleteCardDialog } from "@/components/judge-book/delete-card-dialog";
import { EditCardDialog } from "@/components/judge-book/edit-card-dialog";
import { ListSkeleton, LoadError, NoTeamNotice } from "@/components/judge-book/load-state";
import { searchCards, type JudgeBookCard } from "@/lib/judge-book/model";
import { useJudgeBookSession } from "@/lib/judge-book/use-judge-book-session";

/** The Judge Book list: search, the card grid, and (for editors) add, edit and delete. */
export function JudgeBookView() {
  const book = useJudgeBookSession();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<JudgeBookCard | null>(null);
  const [deleting, setDeleting] = useState<JudgeBookCard | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const visible = useMemo(() => searchCards(book.cards, search), [book.cards, search]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Judge Book</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Build award interview notes with fast-edit cards and optional charts/images.</p>
        </div>
        {book.canEdit && (
          <Button onClick={() => setCreating(true)} className="shrink-0 gap-2" aria-label="Create Judge Book cards">
            <Plus className="h-4 w-4" /> Add
          </Button>
        )}
      </div>

      {book.loaded && !book.canEdit && book.hasTeam && (
        <GlassPanel className="py-4 text-sm text-[var(--muted-foreground)]">
          Read-only access. Only Judge Awards, Team Coach, Team Admin, or members granted Permissions access can add or edit cards.
        </GlassPanel>
      )}

      {notice && (
        <p role="status" className="text-sm text-emerald-400">
          {notice}
        </p>
      )}

      {book.loaded && book.cards.length > 0 && (
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Judge Book cards..."
          aria-label="Search Judge Book cards"
          className="md:max-w-md"
        />
      )}

      {!book.hasTeam ? (
        <NoTeamNotice />
      ) : !book.loaded ? (
        <ListSkeleton />
      ) : book.error ? (
        <LoadError error={book.error} onRetry={book.retry} />
      ) : book.cards.length === 0 ? (
        <GlassPanel className="flex flex-col items-center gap-2 py-10 text-center">
          <BookOpen className="h-8 w-8 text-[var(--muted-foreground)]" aria-hidden />
          <p className="font-semibold">No Judge Book cards yet.</p>
          {book.canEdit && <p className="text-sm text-[var(--muted-foreground)]">Use Add to create the first one.</p>}
        </GlassPanel>
      ) : visible.length === 0 ? (
        <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]">No Judge Book cards match your search.</GlassPanel>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((card) => (
            <li key={`${card.source}:${card.id}`}>
              <CardTile card={card} canEdit={book.canEdit} onEdit={setEditing} onDelete={setDeleting} />
            </li>
          ))}
        </ul>
      )}

      {book.canEdit && (
        <>
          <CreateCardsDialog
            open={creating}
            onOpenChange={setCreating}
            onCreate={book.create}
            onCreated={(added) => setNotice(`Added ${added} Judge Book card${added === 1 ? "" : "s"}.`)}
          />
          <EditCardDialog card={editing} onClose={() => setEditing(null)} onSave={book.update} />
          <DeleteCardDialog card={deleting} onClose={() => setDeleting(null)} onDelete={book.remove} />
        </>
      )}
    </div>
  );
}
