"use client";

import { useState } from "react";
import { FieldError } from "@/components/admin/library/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { useLibraryAdapter } from "@/lib/library/adapter";
import { matchLabel } from "@/lib/library/manual-match";
import { rawScoresOf, validateRawScores, type MatchScoreErrors, type MatchScores, type RawMatchScores } from "@/lib/library/schedule";
import type { Actor } from "@/lib/library/store";
import type { LibraryMatch } from "@/lib/match-library";

/**
 * The official score of ONE imported match (a program whose events API gives a schedule: `ProgramConfig.library.editImportedScores`). Hand-made matches
 * have their scores in the match dialog. Blank is "no official score yet", never 0; "Clear score" removes both. Mount with a fresh `key` per open.
 */
export function MatchScoreDialog({ match, actor, onClose, onSaved }: { match: LibraryMatch; actor: Actor; onClose: () => void; onSaved: (text: string) => void }) {
  const adapter = useLibraryAdapter();
  const [raw, setRaw] = useState<RawMatchScores>(() => rawScoresOf(match));
  const [errors, setErrors] = useState<MatchScoreErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const hasScores = match.alliances.red.scoreKnown !== false || match.alliances.blue.scoreKnown !== false;
  const label = matchLabel(match);

  const commit = async (scores: MatchScores | null, done: string) => {
    setSaving(true);
    setError(null);
    try {
      await adapter.setScores(actor, match.id, scores);
      onSaved(done);
    } catch (err) {
      setError(err instanceof Error && err.message ? `Couldn't save: ${err.message}` : "Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    const checked = validateRawScores(raw);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    void commit(checked.scores, `Official score saved for ${label}.`);
  };

  const field = (color: "red" | "blue", kind: "Score" | "Penalty") => {
    const key = `${color}${kind}` as keyof RawMatchScores;
    return (
      <div>
        <Label htmlFor={`ms-${key}`}>{kind === "Score" ? "Official score" : "Foul points awarded (optional)"}</Label>
        <Input id={`ms-${key}`} inputMode="numeric" value={raw[key]} onChange={(e) => setRaw({ ...raw, [key]: e.target.value })} aria-invalid={!!errors[key]} />
        <FieldError>{errors[key]}</FieldError>
      </div>
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="glass-overlay w-[min(95vw,480px)]">
        <DialogTitle className="pr-8">{`Official score for ${label}`}</DialogTitle>
        <DialogDescription>Practice scouts are compared with this. A match with no score still works: it shows the totals and &quot;No official score yet&quot;.</DialogDescription>
        <div className="mt-4 flex flex-col gap-4">
          {(["red", "blue"] as const).map((color) => (
            <fieldset key={color} className="flex flex-col gap-2">
              <legend className={color === "red" ? "text-sm font-medium text-red-300" : "text-sm font-medium text-blue-300"}>{color === "red" ? "Red alliance" : "Blue alliance"}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {field(color, "Score")}
                {field(color, "Penalty")}
              </div>
            </fieldset>
          ))}
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {hasScores && (
              <Button type="button" variant="glass" className="sm:mr-auto" disabled={saving} onClick={() => void commit(null, `Official score cleared for ${label}.`)}>
                Clear score
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save score"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
