/**
 * Adapter between an FTC `programs/ftc/formEntries/{id}` document (an entry of one of the team's other forms: Lead Scout, Pit Scout,
 * Team Strategy, Match Strategy, Drive Reflection, Helper, custom) and the app's `FormEntry` (lib/form-entries-model.ts).
 * No React, no Firebase. Match Scout entries are not here: they live in `scoutEntries` (data/ftc/scouting.ts).
 *
 * A tolerant read: a missing or malformed field gets its neutral value and nothing throws or drops the entry. An unknown or
 * missing `formType` reads as "custom" (the rules only let a custom form through without a page-access check).
 */
import { FORM_TYPES, type FormValues } from "@/lib/forms/types";
import type { FormEntry, FormEntryFlag, FormEntryType } from "@/lib/form-entries-model";
import { readStickyNotes, type FtcRawRow } from "@/data/ftc/scouting";
import { finiteNumber, isRecord, nonEmptyString, numberOr, str, toEpochMs } from "@/data/ftc/util";

/** `programs/ftc/formEntries/{id}` as stored. */
export type FtcFormEntryDoc = Record<string, unknown>;

const ENTRY_TYPES: readonly FormEntryType[] = FORM_TYPES.filter((type): type is FormEntryType => type !== "match-scout");

function readFlags(value: unknown): FormEntryFlag[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((flag) => {
    const id = nonEmptyString(flag.id);
    const reason = nonEmptyString(flag.reason);
    if (!id || !reason) return [];
    const note = nonEmptyString(flag.note);
    return [{ id, reason, ...(note ? { note } : {}), addedAt: str(flag.addedAt) }];
  });
}

/** Reads `programs/ftc/formEntries/{id}` as a `FormEntry`. */
export function ftcDocToFormEntry(id: string, doc: FtcFormEntryDoc): FormEntry {
  const teamNumber = finiteNumber(doc.teamNumber);
  const planDifferences = finiteNumber(doc.planDifferences);
  return {
    id,
    teamId: str(doc.teamId),
    uid: str(doc.uid),
    scoutName: str(doc.scoutName),
    formId: str(doc.formId),
    formVersion: numberOr(doc.formVersion, 0),
    formType: ENTRY_TYPES.find((type) => type === doc.formType) ?? "custom",
    eventCode: str(doc.eventCode),
    matchKey: nonEmptyString(doc.matchKey),
    alliance: doc.alliance === "red" || doc.alliance === "blue" ? doc.alliance : null,
    teamNumber: teamNumber !== null && teamNumber > 0 ? teamNumber : null,
    values: isRecord(doc.values) ? (doc.values as FormValues) : {},
    stickyNotes: readStickyNotes(doc.stickyNotes),
    linkedEntryId: nonEmptyString(doc.linkedEntryId),
    ...(planDifferences !== null ? { planDifferences } : {}),
    flags: readFlags(doc.flags),
    excluded: doc.excluded === true,
    createdAtMs: toEpochMs(doc.createdAt),
    updatedAtMs: toEpochMs(doc.updatedAt),
  };
}

/** Every row as an entry, newest first (equal times keep the order given). A row whose body is not a map is skipped. */
export function ftcDocsToFormEntries(rows: readonly FtcRawRow[]): FormEntry[] {
  const entries = rows.flatMap((row) => (isRecord(row.data) ? [ftcDocToFormEntry(row.id, row.data)] : []));
  return entries.sort((a, b) => b.createdAtMs - a.createdAtMs);
}
