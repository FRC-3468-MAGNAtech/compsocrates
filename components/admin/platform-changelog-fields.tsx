"use client";

import { Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CHANGE_TYPES, type ChangeType } from "@/lib/changelog";
import { categoryState } from "@/lib/platform-changelog/selection";

// Session 9: the small, shared pieces of the owner's changelog editor (one editor for every program; entries are tagged by program as data, so
// nothing here asks which program is open). Kept apart from the dialog so each can be rendered and tested on its own.

function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1.5 text-xs text-red-300">
      {children}
    </p>
  );
}

export const ORIGINAL_DATE_LABEL = "Original date from CompSocrates v1";

/**
 * The release date. A legacy entry's date is locked by default (read-only, labelled "Original date from CompSocrates v1") until the owner presses
 * "Unlock to change"; the editor relocks it after a save because the dialog is mounted afresh. A current entry has the normal Date field.
 */
export function EntryDateField({ value, onChange, error, legacy, unlocked, onUnlock }: { value: string; onChange: (v: string) => void; error?: string; legacy: boolean; unlocked: boolean; onUnlock: () => void }) {
  const locked = legacy && !unlocked;
  return (
    <div>
      <Label htmlFor="pcl-date">{legacy ? ORIGINAL_DATE_LABEL : "Date"}</Label>
      <div className="flex items-center gap-2">
        <Input id="pcl-date" type="date" value={value} onChange={(e) => onChange(e.target.value)} readOnly={locked} disabled={locked} aria-invalid={!!error} data-locked={locked ? "true" : undefined} />
        {locked && (
          <Button type="button" variant="outline" size="sm" className="min-h-11 shrink-0" onClick={onUnlock}>
            Unlock to change
          </Button>
        )}
      </div>
      {legacy && (
        <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
          {locked
            ? "Imported dates are the UTC day of the old note's creation time, so an evening note can be a day off. Unlock to correct it by hand."
            : "Unlocked: this date decides where the entry sits in the list. It locks again after you save."}
        </p>
      )}
      <FieldError>{error}</FieldError>
    </div>
  );
}

/** "Time posted" and "Last edited": optional, the owner's local time (stored as UTC), each with a Clear button. Empty means the page shows the date only. */
export function EntryTimeFields({ posted, edited, onPosted, onEdited, error }: { posted: string; edited: string; onPosted: (v: string) => void; onEdited: (v: string) => void; error?: string }) {
  const field = (id: string, label: string, value: string, set: (v: string) => void, help: string) => (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} type="datetime-local" value={value} onChange={(e) => set(e.target.value)} />
        <Button type="button" variant="ghost" size="sm" className="min-h-11 shrink-0" onClick={() => set("")} disabled={value === ""} aria-label={`Clear ${label}`}>
          Clear
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">{help}</p>
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {field("pcl-posted", "Time posted", posted, onPosted, "Your local time. Leave empty to show the date only.")}
        {field("pcl-edited", "Last edited", edited, onEdited, "Your local time. Set by the server when you save, unless you tick the box below.")}
      </div>
      <FieldError>{error}</FieldError>
    </div>
  );
}

/** "Don't record this edit": ticked by default for a legacy entry (cleanup is not an edit), unticked for a current one. */
export function RecordEditToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} aria-label="Don't record this edit" />
      <span>Don&apos;t record this edit</span>
    </label>
  );
}

type SelRow = { key: number; category: ChangeType };

/**
 * Multi-select tools over the item list: "select all" per category group, "Move selected to...", "Delete selected" (the editor confirms) and Undo,
 * which steps back through bulk moves and deletes until the entry is saved.
 */
export function ItemSelectionBar({
  rows,
  selected,
  undoCount,
  onToggleCategory,
  onMove,
  onDelete,
  onUndo,
}: {
  rows: readonly SelRow[];
  selected: ReadonlySet<number>;
  undoCount: number;
  onToggleCategory: (c: ChangeType) => void;
  onMove: (c: ChangeType) => void;
  onDelete: () => void;
  onUndo: () => void;
}) {
  const n = selected.size;
  const groups = CHANGE_TYPES.map((t) => ({ ...t, count: rows.filter((r) => r.category === t.id).length })).filter((g) => g.count > 0);
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[var(--glass-border)] bg-white/4 p-3" data-testid="selection-bar">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Select</span>
        {groups.map((g) => {
          const state = categoryState(rows, selected, g.id);
          return (
            <label key={g.id} className="flex min-h-11 items-center gap-2 text-sm">
              <Checkbox checked={state === "all" ? true : state === "some" ? "indeterminate" : false} onCheckedChange={() => onToggleCategory(g.id)} aria-label={`Select all ${g.label} (${g.count})`} />
              <span>
                All {g.label} ({g.count})
              </span>
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-[var(--muted-foreground)]" aria-live="polite">
          {n} selected
        </span>
        <Select value="" onValueChange={(v) => onMove(v as ChangeType)} disabled={n === 0}>
          <SelectTrigger aria-label="Move selected to" className="w-48">
            <SelectValue placeholder="Move selected to…" />
          </SelectTrigger>
          <SelectContent>
            {CHANGE_TYPES.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="sm" className="min-h-11 hover:text-red-300" onClick={onDelete} disabled={n === 0}>
          <Trash2 className="h-3.5 w-3.5" /> Delete selected
        </Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={onUndo} disabled={undoCount === 0}>
          <Undo2 className="h-3.5 w-3.5" /> Undo{undoCount > 0 ? ` (${undoCount})` : ""}
        </Button>
      </div>
    </div>
  );
}
