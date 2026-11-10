"use client";

import { useId } from "react";
import { Input, Label, Textarea } from "@/components/ui/input";
import type { CardDraft } from "@/lib/judge-book/model";

/** The three fields of a card (question/title, answer/details, optional image link), shared by the create and edit forms. */
export function CardFields({ draft, onChange, disabled }: { draft: CardDraft; onChange: (next: CardDraft) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor={`${id}-prompt`}>Question / title</Label>
        <Input id={`${id}-prompt`} value={draft.prompt} onChange={(e) => onChange({ ...draft, prompt: e.target.value })} disabled={disabled} required />
      </div>
      <div>
        <Label htmlFor={`${id}-answer`}>Answer / details</Label>
        <Textarea id={`${id}-answer`} value={draft.answer} onChange={(e) => onChange({ ...draft, answer: e.target.value })} disabled={disabled} rows={5} />
      </div>
      <div>
        <Label htmlFor={`${id}-image`}>Image URL (optional)</Label>
        <Input
          id={`${id}-image`}
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          value={draft.imageUrl}
          onChange={(e) => onChange({ ...draft, imageUrl: e.target.value })}
          disabled={disabled}
          placeholder="https://..."
        />
      </div>
    </div>
  );
}
