"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CardFields } from "@/components/judge-book/card-fields";
import { cardToDraft, type CardDraft, type JudgeBookCard } from "@/lib/judge-book/model";
import type { WriteResult } from "@/lib/judge-book/store";

/** Edit one card in a dialog. Mount it with a `key` per card so the draft starts from that card. */
export function EditCardDialog({
  card,
  onClose,
  onSave,
}: {
  card: JudgeBookCard | null;
  onClose: () => void;
  onSave: (card: JudgeBookCard, draft: CardDraft) => Promise<WriteResult>;
}) {
  return (
    <Dialog open={card !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>{card && <EditForm key={card.id} card={card} onClose={onClose} onSave={onSave} />}</DialogContent>
    </Dialog>
  );
}

function EditForm({ card, onClose, onSave }: { card: JudgeBookCard; onClose: () => void; onSave: (card: JudgeBookCard, draft: CardDraft) => Promise<WriteResult> }) {
  const [draft, setDraft] = useState<CardDraft>(() => cardToDraft(card));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const result = await onSave(card, draft);
    setSaving(false);
    if (result.ok) onClose();
    else setError(result.message);
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div>
        <DialogTitle>Edit card</DialogTitle>
        <DialogDescription>Changes are saved for the whole team.</DialogDescription>
      </div>
      <CardFields draft={draft} onChange={setDraft} disabled={saving} />
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}
