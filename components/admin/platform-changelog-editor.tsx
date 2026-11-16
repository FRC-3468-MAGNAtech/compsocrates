"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { EntryCard } from "@/components/changelog/entry-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PROGRAMS } from "@/config/programs";
import { PROGRAM_IDS, type ProgramId } from "@/config/programs/types";
import { CHANGE_TYPES, MAX_CHANGE_TEXT, MAX_TITLE, MAX_VERSION, type ChangeType } from "@/lib/changelog";
import { fetchFeed, ownerWrite } from "@/lib/platform-changelog/client";
import {
  MAX_ITEMS,
  choiceFromTags,
  entriesForProgram,
  entryToInput,
  moveItem,
  parseEntryInput,
  tagsFromChoice,
  type EntryErrors,
  type EntryInput,
  type PlatformEntry,
  type PlatformItem,
} from "@/lib/platform-changelog/model";
import { cn } from "@/lib/utils";

const label = (id: ProgramId) => PROGRAMS[id].brand.label;
const INHERIT = "inherit";
const ALL = "all";

function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1.5 text-xs text-red-300">
      {children}
    </p>
  );
}

/** A program-tag choice: every program, or one. `withInherit` adds "Entry default" (an item that follows its entry). */
function TagSelect({ value, onChange, withInherit, inheritLabel, ariaLabel, className }: { value: string; onChange: (v: string) => void; withInherit?: boolean; inheritLabel?: string; ariaLabel: string; className?: string }) {
  const text = value === INHERIT ? (inheritLabel ?? "Entry default") : value === ALL ? "Both" : label(value as ProgramId);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={ariaLabel} className={className}>
        <SelectValue>{text}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {withInherit && <SelectItem value={INHERIT}>{inheritLabel ?? "Entry default"}</SelectItem>}
        <SelectItem value={ALL}>Both</SelectItem>
        {PROGRAM_IDS.map((id) => (
          <SelectItem key={id} value={id}>
            {label(id)} only
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type Row = PlatformItem & { key: number };
// A stable React key per row, so reordering moves the row (and its focus) instead of rewriting its neighbours.
let nextKey = 0;

/**
 * The owner's create/edit dialog for one platform changelog entry. Mount it with a fresh `key` per opening so the form starts from `initial`.
 * Items: category, text, program tag (Both or one program, or the entry's default), reorder with buttons or Alt+Arrow keys in the text field.
 * The preview renders the SAME card the Changelog page uses. The list of items scrolls inside its own container.
 */
export function PlatformChangelogEditor({
  open,
  onOpenChange,
  entry,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = a new entry. */
  entry: PlatformEntry | null;
  initial: EntryInput;
  onSaved: () => void;
}) {
  const toRows = (items: PlatformItem[]): Row[] => items.map((i) => ({ ...i, key: nextKey++ }));
  const [title, setTitle] = useState(initial.title);
  const [version, setVersion] = useState(initial.version);
  const [date, setDate] = useState(initial.date);
  const [programs, setPrograms] = useState<ProgramId[]>(initial.programs);
  const [rows, setRows] = useState<Row[]>(() => toRows(initial.items));
  const [rev, setRev] = useState(entry?.rev ?? 0);
  const [errors, setErrors] = useState<EntryErrors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [latest, setLatest] = useState<PlatformEntry | null>(null);
  const [preview, setPreview] = useState(false);
  const [previewAs, setPreviewAs] = useState<string>(ALL);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const status = entry?.status ?? "draft";
  const input = (): EntryInput => ({ title, version, date, programs, items: rows.map(({ category, text, programs: p }) => ({ category, text, ...(p ? { programs: p } : {}) })) });

  const setRow = (key: number, patch: Partial<PlatformItem>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (index: number, delta: -1 | 1) => setRows((rs) => moveItem(rs, index, delta));
  const addRow = () => setRows((rs) => (rs.length >= MAX_ITEMS ? rs : [...rs, { key: nextKey++, category: rs[rs.length - 1]?.category ?? "new", text: "" }]));

  const previewEntry = (): PlatformEntry => {
    const parsed = parseEntryInput(input());
    const v = parsed.ok ? parsed.value : { ...input(), items: input().items.filter((i) => i.text.trim() !== "") };
    return { id: "preview", ...v, status, legacy: entry?.legacy ?? false, createdBy: "", createdAtMs: null, updatedAtMs: null, publishedAtMs: null, rev };
  };

  /** One save: validates (the server checks again), sends, and handles a conflict by fetching what is stored. */
  const submit = async (write: "save" | "publish" | "unpublish") => {
    setMessage(null);
    const parsed = parseEntryInput(input());
    setErrors(parsed.ok ? {} : parsed.errors);
    if (write !== "unpublish" && !parsed.ok) return;
    setBusy(true);
    try {
      const result = !entry
        ? parsed.ok
          ? await ownerWrite({ action: "create", entry: parsed.value, status: write === "publish" ? "published" : "draft" })
          : null
        : write === "unpublish"
          ? await ownerWrite({ action: "unpublish", id: entry.id, expectedRev: rev })
          : parsed.ok
            ? await ownerWrite({ action: "update", id: entry.id, expectedRev: rev, entry: parsed.value, ...(write === "publish" ? { status: "published" as const } : {}) })
            : null;
      if (!result) return;
      if (result.ok) {
        onSaved();
        onOpenChange(false);
        return;
      }
      setMessage(result.message);
      if (result.conflict && entry) {
        const feed = await fetchFeed({ drafts: true }).catch(() => null);
        setLatest(feed?.entries.find((e) => e.id === entry.id) ?? null);
      }
    } finally {
      setBusy(false);
    }
  };

  const loadLatest = () => {
    if (!latest) return;
    const i = entryToInput(latest);
    setTitle(i.title);
    setVersion(i.version);
    setDate(i.date);
    setPrograms(i.programs);
    setRows(toRows(i.items));
    setRev(latest.rev);
    setLatest(null);
    setMessage(null);
    setErrors({});
  };

  const remove = async () => {
    if (!entry) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await ownerWrite({ action: "delete", id: entry.id, expectedRev: rev });
      if (result.ok) {
        onSaved();
        setConfirmDelete(false);
        onOpenChange(false);
      } else {
        setConfirmDelete(false);
        setMessage(result.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const shownPreview = previewEntry();
  const asProgram = previewAs === ALL ? null : (previewAs as ProgramId);
  const previewEntries = entriesForProgram([shownPreview], asProgram);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] w-[min(94vw,760px)] overflow-y-auto">
          <DialogTitle className="pr-8">{entry ? "Edit changelog entry" : "New changelog entry"}</DialogTitle>
          <DialogDescription>
            {status === "published" ? "This entry is published: saving changes updates what everyone sees." : "A draft is only visible to you until you publish it."}
          </DialogDescription>

          <div className="mt-5 flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="pcl-version">Version (optional)</Label>
                <Input id="pcl-version" value={version} maxLength={MAX_VERSION} placeholder="CompSocrates v2.0.0" onChange={(e) => setVersion(e.target.value)} aria-invalid={!!errors.version} />
                <FieldError>{errors.version}</FieldError>
              </div>
              <div>
                <Label htmlFor="pcl-date">Date</Label>
                <Input id="pcl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={!!errors.date} />
                <FieldError>{errors.date}</FieldError>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_12rem]">
              <div>
                <Label htmlFor="pcl-title">Title</Label>
                <Input id="pcl-title" value={title} maxLength={MAX_TITLE} placeholder="What this release is about" onChange={(e) => setTitle(e.target.value)} aria-invalid={!!errors.title} />
                <FieldError>{errors.title}</FieldError>
              </div>
              <div>
                <Label>Default program tag</Label>
                <TagSelect ariaLabel="Default program tag" value={choiceFromTags(programs)} onChange={(v) => setPrograms(tagsFromChoice(v) ?? programs)} />
                <FieldError>{errors.programs}</FieldError>
              </div>
            </div>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Items ({rows.length}/{MAX_ITEMS})
              </legend>
              <div className="flex max-h-[min(46vh,420px)] flex-col gap-4 overflow-y-auto overscroll-contain pr-1" data-testid="item-list">
                {rows.map((row, i) => {
                  const rowError = errors.itemRows?.[i];
                  return (
                    <div key={row.key} className="flex flex-col gap-1.5 rounded-2xl border border-[var(--glass-border)] bg-white/4 p-3">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[9rem_12rem_1fr]">
                        <Select value={row.category} onValueChange={(v) => setRow(row.key, { category: v as ChangeType })}>
                          <SelectTrigger aria-label={`Item ${i + 1} category`}>
                            <SelectValue>{CHANGE_TYPES.find((t) => t.id === row.category)?.label}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {CHANGE_TYPES.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <TagSelect
                          ariaLabel={`Item ${i + 1} program tag`}
                          withInherit
                          inheritLabel={`Entry default (${programs.length === 1 ? label(programs[0]) : "Both"})`}
                          value={row.programs ? choiceFromTags(row.programs) : INHERIT}
                          onChange={(v) => setRow(row.key, { programs: v === INHERIT ? undefined : (tagsFromChoice(v) ?? undefined) })}
                        />
                        <Input
                          aria-label={`Item ${i + 1} text`}
                          value={row.text}
                          maxLength={MAX_CHANGE_TEXT}
                          placeholder="Describe the change (Alt+Up / Alt+Down moves it)"
                          onChange={(e) => setRow(row.key, { text: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                              e.preventDefault();
                              move(i, e.key === "ArrowUp" ? -1 : 1);
                            }
                          }}
                          aria-invalid={!!rowError}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <FieldError>{rowError}</FieldError>
                        <div className="ml-auto flex shrink-0 items-center">
                          <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={`Move item ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={`Move item ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" className="h-11 w-11 hover:text-red-300" aria-label={`Delete item ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <FieldError>{errors.items}</FieldError>
              <div>
                <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={rows.length >= MAX_ITEMS}>
                  <Plus className="h-3.5 w-3.5" /> Add item
                </Button>
              </div>
            </fieldset>

            <div className="flex flex-col gap-3 rounded-2xl border border-[var(--glass-border)] bg-white/4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-medium">Preview</span>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={previewAs} onValueChange={setPreviewAs}>
                    <SelectTrigger aria-label="Preview as" className="w-48">
                      <SelectValue>{previewAs === ALL ? "All programs" : `As ${label(previewAs as ProgramId)} sees it`}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All programs</SelectItem>
                      {PROGRAM_IDS.map((id) => (
                        <SelectItem key={id} value={id}>
                          As {label(id)} sees it
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="sm" onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
                    {preview ? "Hide preview" : "Show preview"}
                  </Button>
                </div>
              </div>
              {preview &&
                (previewEntries.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">Nothing in this entry is tagged for that program, so it would not be listed there.</p>
                ) : (
                  <EntryCard entry={previewEntries[0]} expanded onToggle={() => {}} showProgramBadges={asProgram === null} showDraftNote />
                ))}
            </div>

            {message && (
              <div role="alert" className="flex flex-col gap-2 text-sm text-red-300">
                <p>{message}</p>
                {latest && (
                  <div>
                    <Button type="button" variant="outline" size="sm" onClick={loadLatest}>
                      Load the latest version
                    </Button>
                    <span className="ml-2 text-xs text-[var(--muted-foreground)]">This replaces what is on screen. Copy anything you need first.</span>
                  </div>
                )}
              </div>
            )}

            <div className={cn("flex flex-wrap items-center gap-2", entry ? "justify-between" : "justify-end")}>
              {entry && (
                <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                  Cancel
                </Button>
                {status === "published" ? (
                  <>
                    <Button type="button" variant="outline" onClick={() => void submit("unpublish")} disabled={busy}>
                      Unpublish
                    </Button>
                    <Button type="button" onClick={() => void submit("save")} disabled={busy}>
                      {busy ? "Saving…" : "Save changes"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button type="button" variant="outline" onClick={() => void submit("save")} disabled={busy}>
                      {busy ? "Saving…" : "Save as draft"}
                    </Button>
                    <Button type="button" onClick={() => void submit("publish")} disabled={busy}>
                      Publish
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogTitle className="pr-8">Delete this entry?</DialogTitle>
          <DialogDescription>
            <strong className="text-[var(--foreground)]">{entry ? (entry.version ? `${entry.version} — ${entry.title}` : entry.title) : ""}</strong> will be removed for everyone
            {status === "published" ? " (it is currently published)" : ""}. This can&apos;t be undone.
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void remove()} disabled={busy}>
              {busy ? "Deleting…" : "Delete entry"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
