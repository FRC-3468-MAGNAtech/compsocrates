"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormRenderer } from "@/components/forms/form-renderer";
import { logAuditEvent } from "@/lib/audit-log";
import { adminUpdateFormEntry } from "@/lib/form-entries";
import type { FormEntry } from "@/lib/form-entries-model";
import { useForms } from "@/lib/forms/forms-context";
import { withoutSystemFields } from "@/lib/forms/editable-form";
import type { FormValues } from "@/lib/forms/types";
import { defaultValues, normalizeValues } from "@/lib/forms/values";
import { useProgram } from "@/lib/program/context";

/**
 * Admin-only answer editor for an entry of any of the team's other forms (Lead Scout, Pit Scout, Team Strategy, Match Strategy, Drive Reflection, Helper, and
 * custom forms): the same idea as `EntryEditDialog` for match scouting entries. It edits the answers in the form (and version) the entry was saved with, writes
 * them with `adminUpdateFormEntry`, and logs the before and after in the Audit Log. Editing is never closed by the team's submission switches.
 */
export function FormEntryEditDialog({
  entry,
  open,
  onOpenChange,
  teamId,
  actorUid,
  actorName,
}: {
  entry: FormEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  actorUid: string;
  actorName: string;
}) {
  const forms = useForms();
  const program = useProgram();
  const form = useMemo(() => (entry ? (forms.forEntry(entry) ?? forms.latest(entry.formId)) : null), [forms, entry]);
  const editable = useMemo(() => (form ? withoutSystemFields(form) : null), [form]);
  const [values, setValues] = useState<FormValues>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry || !form) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues({ ...defaultValues(form), ...normalizeValues(form, entry.values) });
    setError(null);
  }, [entry, form]);

  if (!entry) return null;

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const next = normalizeValues(form, values);
      await adminUpdateFormEntry(entry, { values: next }, program);
      await logAuditEvent(teamId, actorUid, actorName, "edit-entry", { entryId: entry.id, formId: entry.formId, teamNumber: entry.teamNumber ?? null }, { values: entry.values }, { values: next }, program);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't save that. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,640px)] max-h-[85vh] overflow-y-auto" data-testid="form-entry-edit">
        <DialogTitle>Edit entry</DialogTitle>
        <DialogDescription>
          {entry.matchKey ? `${entry.matchKey} • ` : ""}
          {entry.teamNumber ? `Team ${entry.teamNumber} • ` : ""}
          {entry.scoutName}
        </DialogDescription>
        {!form || !editable ? (
          <p className="mt-4 text-sm text-[var(--muted-foreground)]">This entry&apos;s form (&ldquo;{entry.formId}&rdquo;) isn&apos;t available, so it can&apos;t be edited.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <FormRenderer
              form={editable}
              values={values}
              onValuesChange={setValues}
              entry={{ eventCode: entry.eventCode, matchKey: entry.matchKey ?? null, alliance: entry.alliance ?? null, teamNumber: entry.teamNumber ?? null, scoutName: entry.scoutName }}
              onEntryChange={() => undefined}
              events={[]}
              teams={[]}
              allianceTeams={[]}
              disabled={saving}
            />
            {error && (
              <p role="alert" className="text-sm text-red-400" data-testid="form-entry-edit-error">
                {error}
              </p>
            )}
            <Button size="lg" disabled={saving} onClick={handleSave} data-testid="form-entry-edit-save">
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
