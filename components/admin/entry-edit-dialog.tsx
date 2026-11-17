"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckboxTile } from "@/components/scout/checkbox-tile";
import { RenderedField } from "@/components/scout/scout-form";
import { formatMatch } from "@/lib/analytics/game-schema";
import { logAuditEvent } from "@/lib/audit-log";
import { entryValues } from "@/lib/forms/entry-values";
import { hasAllianceRoles, reconcileRoleAfterEdit, withoutRole } from "@/lib/forms/alliance-role";
import { calculateScore } from "@/lib/forms/scoring";
import { isSystemField, type FormValue, type FormValues } from "@/lib/forms/types";
import { normalizeValues } from "@/lib/forms/values";
import { visibleFieldKeys } from "@/lib/forms/visibility";
import { useForms } from "@/lib/forms/forms-context";
import { entryPayloadFor, updateEntry, type ScoutEntry } from "@/lib/scout-entries";
import { useProgram } from "@/lib/program/context";

/**
 * Admin-only raw field editor, for bug fixes — the original values are
 * never lost: `auditLog` is write-once (see firestore.rules), and this
 * writes the full before/after `{values, comments, score}` snapshot on
 * every save, so the history is always recoverable from the Audit Log tab.
 *
 * P21: the fields shown are the ones in the form (and version) the entry was scouted with, so an entry from a custom form edits like any other.
 */
export function EntryEditDialog({
  entry,
  open,
  onOpenChange,
  teamId,
  actorUid,
  actorName,
  onSaved,
}: {
  entry: ScoutEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  actorUid: string;
  actorName: string;
  onSaved?: () => void;
}) {
  const forms = useForms();
  const program = useProgram();
  const form = useMemo(() => (entry ? (forms.forEntry(entry) ?? forms.latest(entry.formId)) : null), [forms, entry]);
  const [values, setValues] = useState<FormValues>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!entry) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues(form ? normalizeValues(form, entryValues(entry, form)) : entryValues(entry));
  }, [entry, form]);

  if (!entry) return null;
  const setFieldValue = (key: string, value: FormValue) => setValues((v) => ({ ...v, [key]: value }));

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    try {
      // an admin can correct any field, so the role does not hide or zero anything here (and an entry given both roles' values stops carrying a role)
      const next = reconcileRoleAfterEdit(form, normalizeValues(form, values));
      const score = calculateScore(form, withoutRole(next));
      const payload = entryPayloadFor(form, next, score);
      await updateEntry(entry.id, payload, {}, program);
      await logAuditEvent(
        teamId,
        actorUid,
        actorName,
        "edit-entry",
        { entryId: entry.id, matchLabel: formatMatch(entry), teamNumber: entry.teamNumber },
        { values: entryValues(entry, form), comments: entry.comments, score: entry.score },
        { values: next, comments: payload.comments, score: payload.score },
        program
      );
      onSaved?.();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  // the editor shows every role's fields (an admin may correct any), so the entry's role is left out of the visibility check
  const visible = form ? visibleFieldKeys(form, withoutRole(values)) : new Set<string>();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,560px)] max-h-[85vh] overflow-y-auto">
        <DialogTitle>Edit entry</DialogTitle>
        <DialogDescription>
          {formatMatch(entry)} &bull; Team {entry.teamNumber} &bull; {entry.scoutName}
        </DialogDescription>

        {!form ? (
          <p className="mt-4 text-sm text-[var(--muted-foreground)]">This entry&apos;s form (&ldquo;{entry.formId}&rdquo;) isn&apos;t available, so it can&apos;t be edited.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {hasAllianceRoles(form) && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Hive, Flower and Garden are recorded by one scout per alliance. A field the scout was not asked to record shows 0 here but stays &ldquo;not recorded&rdquo; until you change it.
              </p>
            )}
            {form.sections.map((section) => {
              const fields = section.fields.filter((f) => !isSystemField(f) && visible.has(f.key));
              if (fields.length === 0) return null;
              return (
                <div key={section.id} className="flex flex-col gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{section.title}</h3>
                  <div className="flex flex-wrap gap-2">
                    {fields.map((field) =>
                      field.type === "checkbox" ? (
                        <CheckboxTile key={field.key} label={field.label} checked={Boolean(values[field.key])} onChange={(v) => setFieldValue(field.key, v)} />
                      ) : (
                        <div key={field.key} className={field.type === "toggle" || field.type === "counter" ? "" : "w-full"}>
                          <RenderedField form={form} field={field} value={values[field.key]} locked={false} onChange={setFieldValue} />
                        </div>
                      )
                    )}
                  </div>
                </div>
              );
            })}

            <Button size="lg" disabled={saving} onClick={handleSave}>
              {saving ? "Saving…" : form.scoringEnabled ? "Save & Recalculate Score" : "Save"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
