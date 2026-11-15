"use client";

import { useMemo, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { MATCH_TYPE_OPTIONS, selectClass } from "@/components/admin/library/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/input";
import { parseMatchType } from "@/lib/library/ids";
import { bulkScheduleTemplate, summarizeBulkSchedule, validateBulkSchedule, type LibraryActor } from "@/lib/library/schedule";
import type { LibraryEvent } from "@/lib/library/store";
import type { LibraryMatch } from "@/lib/match-library";
import type { ProgramData } from "@/lib/program/data";

const MAX_PREVIEW_ROWS = 200;

/**
 * Paste rows from a spreadsheet (or choose a CSV) for ONE event. Every row is checked first and nothing is saved until Import. Imported matches start
 * unpublished with a "Needs review" badge (as in CE): look at them in the table, then publish. Importing the same rows again updates, never duplicates.
 */
export function ScheduleBulkImport({ event, eventMatches, actor, library, size, onClose, onDone }: { event: LibraryEvent; eventMatches: LibraryMatch[]; actor: LibraryActor; library: ProgramData["library"]; size: number; onClose: () => void; onDone: (text: string) => void }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [defaultType, setDefaultType] = useState("Q");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const preview = useMemo(() => (text.trim() === "" ? null : validateBulkSchedule({ text, eventCode: event.eventCode, size, defaultType: parseMatchType(defaultType), existingIds: new Set(eventMatches.map((m) => m.id)) })), [text, event.eventCode, size, defaultType, eventMatches]);
  const summary = preview ? summarizeBulkSchedule(preview) : null;

  const download = () => {
    const url = URL.createObjectURL(new Blob([bulkScheduleTemplate(size)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "match-schedule-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const runImport = async () => {
    if (!summary || summary.importable.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = await library.upsertMatches(actor, event, summary.importable, { newPublished: false, newNeedsReview: true });
      onDone(`Imported ${res.created} new and updated ${res.updated} match${res.created + res.updated === 1 ? "" : "es"}. They start unpublished with a Needs review badge: check them in the table, then publish.`);
    } catch (err) {
      setError(err instanceof Error && err.message ? `Couldn't import: ${err.message}. Importing the same rows again is safe.` : "Couldn't import. Importing the same rows again is safe.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !importing && onClose()}>
      <DialogContent className="glass-overlay max-h-[92vh] w-[min(96vw,820px)] overflow-y-auto">
        <DialogTitle className="pr-8">Bulk entry: {event.eventName}</DialogTitle>
        <DialogDescription>Paste rows from a spreadsheet or choose a CSV. Rows are checked first, and nothing is saved until you press Import.</DialogDescription>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="bulk-type">Match type when a row has none</Label>
              <select id="bulk-type" className={`${selectClass} w-full`} value={defaultType} onChange={(e) => setDefaultType(e.target.value)}>
                {MATCH_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setText(await file.text());
                setFileName(file.name);
              }}
            />
            <Button type="button" variant="glass" className="min-h-11 gap-2" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" /> {fileName ?? "Choose CSV"}
            </Button>
            <Button type="button" variant="ghost" className="min-h-11 gap-2" onClick={download}>
              <Download className="h-4 w-4" /> Template
            </Button>
          </div>
          <div>
            <Label htmlFor="bulk-text">Rows</Label>
            <textarea
              id="bulk-text"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setFileName(null);
              }}
              rows={7}
              spellCheck={false}
              placeholder={`Q\t1\t1111\t2222\t3333\t4444\t(time optional)`}
              className="w-full rounded-2xl border border-[var(--glass-border)] bg-white/5 p-3 font-mono text-xs text-[var(--foreground)] outline-none"
            />
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Columns: type, match number, red teams, blue teams, optional time. A header row is understood in any order.</p>
          </div>

          {preview && (
            <section className="flex flex-col gap-2" aria-live="polite">
              {preview.columnErrors.length > 0 ? (
                <ul className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {preview.columnErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              ) : (
                summary && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="success">{summary.creates} new</Badge>
                      {summary.updates > 0 && <Badge variant="warning">{summary.updates} will update existing matches</Badge>}
                      {summary.errors > 0 && <Badge variant="danger">{summary.errors} with errors (skipped)</Badge>}
                      {summary.superseded > 0 && <Badge variant="outline">{summary.superseded} duplicate row{summary.superseded === 1 ? "" : "s"} replaced by a later one</Badge>}
                    </div>
                    <div className="max-h-64 overflow-auto rounded-2xl border border-[var(--glass-border)]">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead className="sticky top-0 bg-[#1b1b26] text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                          <tr>
                            <th className="px-3 py-2">Row</th>
                            <th className="px-3 py-2">Match</th>
                            <th className="px-3 py-2">Result</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--glass-border)]">
                          {preview.rows.slice(0, MAX_PREVIEW_ROWS).map((row) => (
                            <tr key={row.rowNumber} className="align-top">
                              <td className="px-3 py-2 font-mono">{row.rowNumber}</td>
                              <td className="px-3 py-2 font-mono">{row.id ?? "?"}</td>
                              <td className="px-3 py-2">
                                {row.errors.length > 0 ? (
                                  <ul className="flex flex-col gap-0.5 text-red-300">
                                    {row.errors.map((e) => (
                                      <li key={e}>✕ {e}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className={row.superseded ? "text-[var(--muted-foreground)]" : row.action === "update" ? "text-amber-300" : "text-emerald-300"}>{row.superseded ? "Skipped" : row.action === "update" ? "Will update" : "New"}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {preview.rows.length > MAX_PREVIEW_ROWS && <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">Showing the first {MAX_PREVIEW_ROWS} of {preview.rows.length} rows.</p>}
                    </div>
                  </>
                )
              )}
            </section>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" className="min-h-11" onClick={onClose} disabled={importing}>
              Cancel
            </Button>
            <Button type="button" className="min-h-11" onClick={() => void runImport()} disabled={importing || !summary || summary.importable.length === 0}>
              {importing ? "Importing…" : summary && summary.importable.length > 0 ? `Import ${summary.importable.length} match${summary.importable.length === 1 ? "" : "es"}` : "Import"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
