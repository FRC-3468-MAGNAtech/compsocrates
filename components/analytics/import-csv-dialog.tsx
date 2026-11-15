"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { dedupeAgainstExisting, parseImportCsv, type ImportedRow } from "@/lib/analytics/csv";
import { canImportCsv, planCsvImport, runCsvImport, type CsvImportPlan, type CsvImportResult } from "@/lib/analytics/csv-import";
import { formatMatch } from "@/lib/analytics/game-schema";
import { useAuth } from "@/lib/auth";
import { useProgramData } from "@/lib/program/data";
import { entryPayloadFor, saveEntry, type ScoutEntry } from "@/lib/scout-entries";
import { calculateScore } from "@/lib/forms/scoring";
import { normalizeValues } from "@/lib/forms/values";
import type { Form } from "@/lib/forms/types";
import type { GameSchema } from "@/lib/analytics/game-schema";

export function ImportCsvDialog({
  open,
  onOpenChange,
  schema,
  form,
  teamId,
  uid,
  eventCode,
  existingEntries,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: GameSchema;
  /** P21: the form the imported rows are scouted with (the one `schema` was derived from): scores are recomputed against it and entries are stamped with its id and version. */
  form: Form;
  /** The importing admin's own team/uid — imported rows can name any scout
   * via their free-text `scoutName`, but `uid` (who's allowed to write the
   * doc, per firestore.rules) is attributed to whoever ran the import. */
  teamId: string;
  uid: string;
  eventCode: string;
  existingEntries: ScoutEntry[];
  onImported: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [toInsert, setToInsert] = useState<ImportedRow[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  // A program with its own data port imports through it: a preview with row errors, stable ids, batches of 400 and a result summary.
  // The default program keeps the import it always had.
  const port = useProgramData();
  const { profile } = useAuth();
  const [plan, setPlan] = useState<CsvImportPlan | null>(null);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const mayImport = !port || canImportCsv(profile);

  const reset = () => {
    setErrors([]);
    setToInsert([]);
    setSkipped(0);
    setPlan(null);
    setResult(null);
    setImportError(null);
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    const { rows, errors: parseErrors } = parseImportCsv(schema, text);
    setFileName(file.name);
    setResult(null);
    setImportError(null);
    if (port) {
      setPlan(planCsvImport({ rows, errors: parseErrors }, existingEntries, teamId, eventCode));
      return;
    }
    if (parseErrors.length > 0) {
      setErrors(parseErrors);
      setToInsert([]);
      setSkipped(0);
      return;
    }
    const { toInsert: fresh, skipped: dupes } = dedupeAgainstExisting(rows, existingEntries);
    setErrors([]);
    setToInsert(fresh);
    setSkipped(dupes);
  };

  const [importing, setImporting] = useState(false);

  const confirmPortImport = async () => {
    if (!port || !plan) return;
    setImporting(true);
    setImportError(null);
    try {
      const outcome = await runCsvImport({
        port: port.scoutEntries,
        importer: profile,
        teamId,
        uid,
        plan,
        buildInput: (row) => {
          const values = normalizeValues(form, row.values);
          return {
            scoutName: row.scoutName,
            eventCode,
            matchType: row.matchType,
            matchNumber: row.matchNumber,
            teamNumber: row.teamNumber,
            ...entryPayloadFor(form, values, calculateScore(form, values)),
          };
        },
      });
      setResult(outcome);
      if (outcome.written > 0) onImported();
    } catch (err) {
      setImportError(err instanceof Error && err.message ? err.message : "The import did not run.");
    } finally {
      setImporting(false);
    }
  };

  const confirmImport = async () => {
    setImporting(true);
    try {
      await Promise.all(
        toInsert.map((row) => {
          const values = normalizeValues(form, row.values);
          return saveEntry(teamId, uid, {
            scoutName: row.scoutName,
            eventCode,
            matchType: row.matchType,
            matchNumber: row.matchNumber,
            teamNumber: row.teamNumber,
            ...entryPayloadFor(form, values, calculateScore(form, values)),
            // an admin's import is not a scout submitting: the team's submission switches do not apply
            gate: { bypass: true },
          });
        })
      );
      onImported();
      onOpenChange(false);
      reset();
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="w-[min(92vw,680px)] max-h-[85vh] overflow-y-auto">
        <DialogTitle>Import CSV</DialogTitle>
        <DialogDescription>Same column format as Export CSV. Duplicates (same match + team + scout) are skipped.</DialogDescription>

        <div className="mt-4 flex flex-col gap-4">
          {!mayImport && (
            <p role="alert" className="text-sm text-red-300">
              Only an admin or a Lead Scout can import entries.
            </p>
          )}
          {mayImport && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              <Button variant="glass" size="lg" className="gap-2 self-start" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" /> Choose CSV file
              </Button>
            </>
          )}
          {fileName && <p className="text-sm text-[var(--muted-foreground)]">{fileName}</p>}

          {port && plan && <PortPreview plan={plan} result={result} importError={importError} importing={importing} onImport={confirmPortImport} />}

          {!port && errors.length > 0 && (
            <div className="glass-card flex flex-col gap-1 p-4 text-sm text-red-300">
              {errors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          )}

          {!port && fileName && errors.length === 0 && (
            <>
              <p className="text-sm text-[var(--muted-foreground)]">
                <span className="font-semibold text-[var(--foreground)]">{toInsert.length}</span> new row
                {toInsert.length === 1 ? "" : "s"} to import, <span className="font-semibold text-[var(--foreground)]">{skipped}</span>{" "}
                duplicate{skipped === 1 ? "" : "s"} skipped.
              </p>
              {toInsert.length > 0 && (
                <Table>
                  <THead>
                    <TR>
                      <TH>Match</TH>
                      <TH>Team</TH>
                      <TH>Scout</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {toInsert.slice(0, 8).map((r, i) => (
                      <TR key={i}>
                        <TD>{formatMatch({ matchType: r.matchType, matchNumber: r.matchNumber })}</TD>
                        <TD>{r.teamNumber}</TD>
                        <TD>{r.scoutName}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
              {toInsert.length > 8 && (
                <p className="text-xs text-[var(--muted-foreground)]">...and {toInsert.length - 8} more.</p>
              )}
              <Button size="lg" disabled={toInsert.length === 0 || importing} onClick={confirmImport}>
                {importing ? "Importing…" : `Import ${toInsert.length} row${toInsert.length === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The preview and result of a ported program's import: row counts, every unreadable row by number and reason, then what was written and what failed. */
function PortPreview({ plan, result, importError, importing, onImport }: { plan: CsvImportPlan; result: CsvImportResult | null; importError: string | null; importing: boolean; onImport: () => void }) {
  if (plan.fileError) {
    return (
      <div role="alert" className="glass-card flex flex-col gap-1 p-4 text-sm text-red-300">
        <p>{plan.fileError}</p>
        <p className="text-[var(--muted-foreground)]">Nothing was imported. Export a CSV from this page and use its columns.</p>
      </div>
    );
  }
  const count = plan.toWrite.length;
  return (
    <>
      {!result && (
        <p className="text-sm text-[var(--muted-foreground)]" data-testid="import-preview">
          <span className="font-semibold text-[var(--foreground)]">{count}</span> new row{count === 1 ? "" : "s"} to import,{" "}
          <span className="font-semibold text-[var(--foreground)]">{plan.duplicates}</span> duplicate{plan.duplicates === 1 ? "" : "s"} skipped,{" "}
          <span className="font-semibold text-[var(--foreground)]">{plan.rowErrors.length}</span> row{plan.rowErrors.length === 1 ? "" : "s"} with errors (not imported).
        </p>
      )}
      {plan.rowErrors.length > 0 && (
        <div role="alert" className="glass-card flex max-h-40 flex-col gap-1 overflow-y-auto p-4 text-sm text-red-300">
          {plan.rowErrors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
      {!result && count > 0 && (
        <Table>
          <THead>
            <TR>
              <TH>Match</TH>
              <TH>Team</TH>
              <TH>Scout</TH>
            </TR>
          </THead>
          <TBody>
            {plan.toWrite.slice(0, 8).map(({ id, row }) => (
              <TR key={id}>
                <TD>{formatMatch({ matchType: row.matchType, matchNumber: row.matchNumber })}</TD>
                <TD>{row.teamNumber}</TD>
                <TD>{row.scoutName}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {!result && count > 8 && <p className="text-xs text-[var(--muted-foreground)]">...and {count - 8} more.</p>}
      {importError && (
        <p role="alert" className="text-sm text-red-300">
          {importError}
        </p>
      )}
      {result && (
        <div className="glass-card flex flex-col gap-1 p-4 text-sm" data-testid="import-result">
          <p>
            Imported <span className="font-semibold">{result.written}</span> row{result.written === 1 ? "" : "s"}. {plan.duplicates} duplicate{plan.duplicates === 1 ? "" : "s"} skipped,{" "}
            {plan.rowErrors.length} row{plan.rowErrors.length === 1 ? "" : "s"} not imported because of errors.
          </p>
          {result.failures.map((f, i) => (
            <p key={i} role="alert" className="text-red-300">
              Did not save rows {f.rows.filter((r) => r !== null).join(", ") || "of one batch"}: {f.reason}
            </p>
          ))}
        </div>
      )}
      {!result && (
        <Button size="lg" disabled={count === 0 || importing} onClick={onImport}>
          {importing ? "Importing…" : `Import ${count} row${count === 1 ? "" : "s"}`}
        </Button>
      )}
    </>
  );
}
