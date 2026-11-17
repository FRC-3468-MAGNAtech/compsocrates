"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { JudgeBookCard } from "@/lib/judge-book/model";
import type { WriteResult } from "@/lib/judge-book/store";

/** "Delete this Judge Book card?" (CS used window.confirm). */
export function DeleteCardDialog({
  card,
  onClose,
  onDelete,
}: {
  card: JudgeBookCard | null;
  onClose: () => void;
  onDelete: (card: JudgeBookCard) => Promise<WriteResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };

  const confirm = async () => {
    if (!card) return;
    setBusy(true);
    setError(null);
    const result = await onDelete(card);
    setBusy(false);
    if (result.ok) close();
    else setError(result.message);
  };

  return (
    <Dialog open={card !== null} onOpenChange={(open) => !open && !busy && close()}>
      <DialogContent>
        <DialogTitle>Delete this card?</DialogTitle>
        <DialogDescription>
          <strong>{card?.prompt}</strong> will be removed for the whole team.
        </DialogDescription>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={busy}>
            {busy ? "Deleting..." : "Delete card"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
