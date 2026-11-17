"use client";

import { useState } from "react";
import { ChevronDown, Pencil, Plus } from "lucide-react";
import { PlatformChangelogEditor } from "@/components/admin/platform-changelog-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Shimmer } from "@/components/ui/shimmer";
import { PROGRAMS } from "@/config/programs";
import { formatEntryDate, localIsoDate } from "@/lib/changelog";
import { usePlatformFeed } from "@/lib/platform-changelog/client";
import { emptyEntryInput, entryToInput, taggedForAll, type EntryInput, type PlatformEntry } from "@/lib/platform-changelog/model";
import { v2Template } from "@/lib/platform-changelog/template";
import { cn } from "@/lib/utils";

type EditorState = { key: number; entry: PlatformEntry | null; initial: EntryInput };

const tagText = (e: PlatformEntry) => (taggedForAll(e.programs) ? "Both programs" : e.programs.map((id) => PROGRAMS[id].brand.label).join(" + "));

function Row({ entry, onEdit }: { entry: PlatformEntry; onEdit: () => void }) {
  return (
    <li className={cn("flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--glass-border)] bg-white/4 p-4", entry.status === "draft" && "border-dashed")}>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {entry.version && <span className="font-mono text-sm font-semibold">{entry.version}</span>}
          <Badge variant={entry.status === "published" ? "success" : "warning"}>{entry.status === "published" ? "Published" : "Draft"}</Badge>
          <Badge variant="outline">{tagText(entry)}</Badge>
          <span className="text-xs text-[var(--muted-foreground)]">{formatEntryDate(entry.date)}</span>
        </div>
        <p className="truncate text-sm font-medium">{entry.title}</p>
        <p className="text-xs text-[var(--muted-foreground)]">
          {entry.items.length} {entry.items.length === 1 ? "item" : "items"}
        </p>
      </div>
      <Button variant="outline" size="sm" className="min-h-11" onClick={onEdit} aria-label={`Edit ${entry.title}`}>
        <Pencil className="h-4 w-4" /> Edit
      </Button>
    </li>
  );
}

/**
 * Admin Panel > Changelog (platform owner only, the same tab in every program): every entry, drafts and published, legacy ones collapsed, with the
 * create/edit dialog. Reads and writes go through the server routes; the owner is checked there, not here.
 */
export function PlatformChangelogPanel() {
  const { entries, loaded, error, reload } = usePlatformFeed({ drafts: true });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [open, setOpen] = useState(false);
  const [counter, setCounter] = useState(0);
  const [showLegacy, setShowLegacy] = useState(false);

  const openEditor = (entry: PlatformEntry | null, initial?: EntryInput) => {
    setCounter((c) => c + 1);
    setEditor({ key: counter + 1, entry, initial: initial ?? (entry ? entryToInput(entry) : emptyEntryInput(localIsoDate(new Date()))) });
    setOpen(true);
  };
  const current = entries.filter((e) => !e.legacy);
  const legacy = entries.filter((e) => e.legacy);

  return (
    <GlassPanel className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Changelog</h2>
          <p className="text-sm text-[var(--muted-foreground)]">One changelog for the whole site. Tag each entry and each item for one program or both; drafts are only visible to you.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Fills the editor only: nothing is saved until the owner presses Save as draft or Publish. */}
          <Button variant="outline" className="min-h-11" onClick={() => openEditor(null, v2Template(localIsoDate(new Date())))} disabled={!loaded || !!error}>
            Start from the v2.0.0 template
          </Button>
          <Button className="min-h-11" onClick={() => openEditor(null)} disabled={!loaded || !!error}>
            <Plus className="h-4 w-4" /> New entry
          </Button>
        </div>
      </div>

      {!loaded ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading the changelog entries">
          {[0, 1, 2].map((i) => (
            <Shimmer key={i} className="h-[84px] w-full" />
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="flex flex-col items-start gap-3 text-sm text-red-300">
          <p>{error}</p>
          <Button variant="outline" size="sm" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {current.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No entries yet. Press New entry to write the first one.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {current.map((e) => (
                <Row key={e.id} entry={e} onEdit={() => openEditor(e)} />
              ))}
            </ul>
          )}
          {legacy.length > 0 && (
            <div className="flex flex-col gap-3">
              <Button variant="ghost" className="min-h-11 justify-start self-start" aria-expanded={showLegacy} onClick={() => setShowLegacy((s) => !s)}>
                <ChevronDown className={cn("h-4 w-4 transition-transform", showLegacy && "rotate-180")} /> Legacy entries ({legacy.length})
              </Button>
              {showLegacy && (
                <ul className="flex flex-col gap-3">
                  {legacy.map((e) => (
                    <Row key={e.id} entry={e} onEdit={() => openEditor(e)} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {editor && <PlatformChangelogEditor key={editor.key} open={open} onOpenChange={setOpen} entry={editor.entry} initial={editor.initial} onSaved={reload} />}
    </GlassPanel>
  );
}
