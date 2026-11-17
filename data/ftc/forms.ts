/**
 * Adapter between FTC `programs/ftc/forms/{teamId}_{formId}` documents (and their `versions/{n}` subcollection) and the app's
 * `FormDoc` / `FormVersion` (lib/forms/resolve.ts). No React, no Firebase.
 *
 * Storage: a form doc holds the working draft, the latest published version number and whether an override is active; each published
 * version is its own write-once doc under `versions`. The nested form itself (sections, fields) is passed through as stored: the
 * builder validates it before every write (lib/forms/validate.ts), and the rules cannot check it element by element.
 *
 * A tolerant read: a form doc missing its `teamId` / `formId` gets them from its own id (`{teamId}_{formId}`), and `active` defaults
 * to true (a custom form is always active; only an explicit false turns an override off).
 */
import type { Form, FormOrigin } from "@/lib/forms/types";
import type { FormDoc, FormVersion } from "@/lib/forms/resolve";
import { finiteNumber, isRecord, nonEmptyString, str, toEpochMs } from "@/data/ftc/util";

/** A stored form doc or version doc (the Firestore body, keys and values untouched). */
export type FtcFormDocBody = Record<string, unknown>;

const STORED_ORIGINS: readonly FormOrigin[] = ["built-in-override", "custom", "template"];

/** The form id inside a form doc id (`{teamId}_{formId}`; team ids have no underscore, form ids may). An id with no underscore is the form id. */
export function formIdFromDocId(docId: string): string {
  const at = docId.indexOf("_");
  return at === -1 ? docId : docId.slice(at + 1);
}

function teamIdFromDocId(docId: string): string {
  const at = docId.indexOf("_");
  return at === -1 ? "" : docId.slice(0, at);
}

const publishedNumber = (value: unknown): number | null => {
  const n = finiteNumber(value);
  return n !== null && n >= 1 ? n : null;
};

/** Reads `programs/ftc/forms/{docId}` as a `FormDoc`. */
export function ftcDocToFormDoc(docId: string, doc: FtcFormDocBody): FormDoc {
  const baseBuiltInId = nonEmptyString(doc.baseBuiltInId);
  const baseBuiltInHash = nonEmptyString(doc.baseBuiltInHash);
  const createdAt = toEpochMs(doc.createdAt);
  const updatedAt = toEpochMs(doc.updatedAt);
  const updatedBy = nonEmptyString(doc.updatedBy);
  return {
    teamId: nonEmptyString(doc.teamId) ?? teamIdFromDocId(docId),
    formId: nonEmptyString(doc.formId) ?? formIdFromDocId(docId),
    name: str(doc.name),
    origin: STORED_ORIGINS.find((origin) => origin === doc.origin) ?? "custom",
    ...(baseBuiltInId ? { baseBuiltInId } : {}),
    ...(baseBuiltInHash ? { baseBuiltInHash } : {}),
    publishedVersion: publishedNumber(doc.publishedVersion),
    draft: isRecord(doc.draft) ? (doc.draft as Form) : null,
    active: doc.active !== false,
    archived: doc.archived === true,
    createdBy: str(doc.createdBy),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(updatedBy ? { updatedBy } : {}),
  };
}

/** Every row as a form doc, keyed by form id (what `FormCatalog.docs` holds). A row whose body is not a map is skipped. */
export function ftcDocsToFormDocs(rows: readonly { id: string; data: unknown }[]): Map<string, FormDoc> {
  const docs = new Map<string, FormDoc>();
  for (const row of rows) {
    if (!isRecord(row.data)) continue;
    const doc = ftcDocToFormDoc(row.id, row.data);
    docs.set(doc.formId, doc);
  }
  return docs;
}

/** Reads `programs/ftc/forms/{docId}/versions/{n}` as a `FormVersion`; null when it has no form map or no valid version number (it cannot be used). */
export function ftcDocToFormVersion(docId: string, doc: FtcFormDocBody): FormVersion | null {
  const version = publishedNumber(doc.version);
  if (version === null || !isRecord(doc.form)) return null;
  const note = nonEmptyString(doc.note);
  const createdAt = toEpochMs(doc.createdAt);
  return {
    teamId: nonEmptyString(doc.teamId) ?? teamIdFromDocId(docId),
    formId: nonEmptyString(doc.formId) ?? formIdFromDocId(docId),
    version,
    form: doc.form as Form,
    ...(note ? { note } : {}),
    createdBy: str(doc.createdBy),
    ...(createdAt ? { createdAt } : {}),
  };
}
