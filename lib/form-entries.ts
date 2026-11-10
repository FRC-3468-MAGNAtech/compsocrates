"use client";

import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch, type QueryConstraint } from "firebase/firestore";
import { buildAuditEntry, newAuditLogRef } from "@/lib/audit-log";
import { useEffect, useMemo, useState } from "react";
import { CURRENT_GAME_ID } from "@/config/games";
import { auth, db, isFirebaseConfigured } from "@/lib/firebase/client";
import { reportFirestoreError } from "@/lib/firestore-errors";
import { formEntryDoc, toFormEntry, type FormEntry, type FormEntryType, type NewFormEntry } from "@/lib/form-entries-model";
import { diffEntryValues } from "@/lib/form-entries-model";
import type { FormValues, StickyNote } from "@/lib/forms/types";
import {
  CS_COMPLETION_COLLECTIONS,
  CS_FORM_COLLECTIONS,
  CS_FORM_SPECS,
  CS_FORM_TYPES,
  CS_LEAD_FALLBACK_COLLECTION,
  csCompletedMatchKeys,
  csDocGame,
  csDocToFormEntry,
  csFlagEntityTypeFor,
  csFlagStateDocId,
  csFormTypeForCollection,
  eventCodesMatch,
  formEntryToCsPatch,
  formEntryToFlagStatePatch,
  formTypeForFormId,
  isCsBackedFormType,
  isLeadFallbackDoc,
  type CompletedMatches,
  type CsCompletionCollection,
  type CsFormCollection,
  type CsFormType,
} from "@/data/cs/forms";
import type { CsFlagState, CsRecord } from "@/data/cs/types";

// Form entries (docs/ROUTES.md D1). Lead Scout, Pit Scout, Team Strategy, Match Strategy, Drive Reflection and Helper entries live in CS's six collections
// (`pitScouting`, `leadScouting`, `strategyScouting`, `matchStrategyPlans`, `driveScouting`, `helperReports`) in CS's shapes; `data/cs/forms.ts` converts both
// ways. A lead entry CS wrote into `scouting` (its permission fallback, `entryType: "lead"`) is read too. Custom forms have no CS collection and stay in
// CE's `formEntries`. Manual flags live in `scoutingFlagStates` (read here, written by `adminUpdateFormEntry`). Writes are merge writes of the known fields
// only, so a field this app does not know is never dropped (D10).

const CUSTOM_COLLECTION = "formEntries";
const FLAG_COLLECTION = "scoutingFlagStates";

type Where = CsFormCollection | typeof CS_LEAD_FALLBACK_COLLECTION | typeof CUSTOM_COLLECTION;
type EntryRef = { collection: Where; formType: FormEntryType };

/** Which collection each entry id was read from, so the id-only calls the pages make (`deleteFormEntry(id)`) know where to go. Filled by every read and save. */
const known = new Map<string, EntryRef>();

/** What a caller may hand to the update / delete functions: just the id (as the pages do), or an entry (which carries its own place). */
export type FormEntryHandle = string | Pick<FormEntry, "id" | "formType" | "legacy">;

const PROBE_ORDER: Where[] = [...CS_FORM_COLLECTIONS, CS_LEAD_FALLBACK_COLLECTION, CUSTOM_COLLECTION];

async function resolveRef(handle: FormEntryHandle): Promise<{ id: string; ref: EntryRef }> {
  if (typeof handle !== "string") {
    const place: Where = handle.legacy?.collection ?? (isCsBackedFormType(handle.formType) ? CS_FORM_SPECS[handle.formType].collection : CUSTOM_COLLECTION);
    return { id: handle.id, ref: { collection: place, formType: handle.formType } };
  }
  const hit = known.get(handle);
  if (hit) return { id: handle, ref: hit };
  // Not read in this session (a deep link, a stale tab): find the doc.
  for (const place of PROBE_ORDER) {
    const snap = await getDoc(doc(db, place, handle));
    if (!snap.exists()) continue;
    const data = snap.data() as CsRecord;
    if (place === CS_LEAD_FALLBACK_COLLECTION && !isLeadFallbackDoc(data)) continue;
    const formType: FormEntryType = place === CUSTOM_COLLECTION ? ((data.formType as FormEntryType | undefined) ?? "custom") : csFormTypeForCollection(place);
    const ref = { collection: place, formType };
    known.set(handle, ref);
    return { id: handle, ref };
  }
  throw new Error(`Form entry ${handle} was not found.`);
}

async function loadFlagState(entityType: ReturnType<typeof csFlagEntityTypeFor>, id: string): Promise<CsFlagState | undefined> {
  try {
    const snap = await getDoc(doc(db, FLAG_COLLECTION, csFlagStateDocId(entityType, id)));
    return snap.exists() ? (snap.data() as CsFlagState) : undefined;
  } catch (error) {
    reportFirestoreError("flag state read failed", error, FLAG_COLLECTION);
    return undefined;
  }
}

/** The stored entry as a `FormEntry` (fresh from the server) together with its raw doc. */
async function loadCsEntry(id: string, ref: EntryRef): Promise<{ entry: FormEntry; raw: CsRecord; flagState: CsFlagState | undefined }> {
  const snap = await getDoc(doc(db, ref.collection, id));
  if (!snap.exists()) throw new Error(`Form entry ${id} was not found.`);
  const raw = snap.data() as CsRecord;
  const formType = ref.formType as CsFormType;
  const flagState = await loadFlagState(csFlagEntityTypeFor(formType, ref.collection as CsFormCollection), id);
  return { entry: csDocToFormEntry(formType, id, raw, flagState, { collection: ref.collection as CsFormCollection }), raw, flagState };
}

/** Firestore refuses `undefined` anywhere in a document. */
function withoutUndefined<T extends Record<string, unknown>>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T;
}

/** Saves an entry as yourself. Resolves with its id (so a photo still uploading can be attached to it afterwards). */
export async function saveFormEntry(teamId: string, uid: string, input: NewFormEntry): Promise<string> {
  if (!isCsBackedFormType(input.formType)) {
    const ref = await addDoc(collection(db, CUSTOM_COLLECTION), formEntryDoc(teamId, uid, input));
    known.set(ref.id, { collection: CUSTOM_COLLECTION, formType: input.formType });
    return ref.id;
  }
  const spec = CS_FORM_SPECS[input.formType];
  const now = Date.now();
  const entry: FormEntry = {
    id: "",
    teamId,
    uid,
    scoutName: input.scoutName,
    formId: input.formId,
    formVersion: input.formVersion,
    formType: input.formType,
    eventCode: input.eventCode,
    matchKey: input.matchKey ?? null,
    alliance: input.alliance ?? null,
    teamNumber: input.teamNumber ?? null,
    values: input.values,
    stickyNotes: input.stickyNotes ?? [],
    linkedEntryId: input.linkedEntryId ?? null,
    ...(input.planDifferences !== undefined ? { planDifferences: input.planDifferences } : {}),
    flags: [],
    excluded: false,
    createdAtMs: now,
    updatedAtMs: now,
  };
  const ref = await addDoc(collection(db, spec.collection), withoutUndefined(formEntryToCsPatch(entry)));
  known.set(ref.id, { collection: spec.collection, formType: input.formType });
  return ref.id;
}

/** Applies a patch to the stored entry and returns the CS fields to merge into the doc (reads the doc first so `robots[]` keeps its unknown keys). */
async function csPatchFor(handle: FormEntryHandle, change: (entry: FormEntry) => FormEntry): Promise<{ id: string; ref: EntryRef; patch: CsRecord; next: FormEntry; flagState: CsFlagState | undefined }> {
  const { id, ref } = await resolveRef(handle);
  const { entry, raw, flagState } = await loadCsEntry(id, ref);
  const next = change(entry);
  return { id, ref, patch: withoutUndefined(formEntryToCsPatch(next, raw)), next, flagState };
}

/** The writer may change only values and notes; an admin may change more (the rules decide). */
export async function updateFormEntry(handle: FormEntryHandle, patch: { values?: FormValues; stickyNotes?: StickyNote[] }): Promise<void> {
  const { id, ref } = await resolveRef(handle);
  if (ref.collection === CUSTOM_COLLECTION) {
    await updateDoc(doc(db, CUSTOM_COLLECTION, id), { ...patch, updatedAt: serverTimestamp() });
    return;
  }
  const { patch: fields } = await csPatchFor(id, (e) => ({ ...e, ...(patch.values ? { values: patch.values } : {}), ...(patch.stickyNotes ? { stickyNotes: patch.stickyNotes } : {}), updatedAtMs: Date.now() }));
  await setDoc(doc(db, ref.collection, id), fields, { merge: true });
}

/**
 * A scout edits their own earlier entry (P29): the new values and notes, and an `edit-form-entry` audit entry with what changed, in one batch. The rules let the
 * writer change only `values`, `stickyNotes` and `updatedAt`; the log keeps the history (admins read it in Admin Panel > Audit Log).
 */
export async function editOwnFormEntry(actor: { teamId: string; uid: string; name: string }, entry: Pick<FormEntry, "id" | "formId" | "eventCode" | "teamNumber" | "values" | "stickyNotes">, patch: { values: FormValues; stickyNotes: StickyNote[] }): Promise<void> {
  const { id, ref } = await resolveRef(entry.id);
  const batch = writeBatch(db);
  if (ref.collection === CUSTOM_COLLECTION) {
    batch.update(doc(db, CUSTOM_COLLECTION, id), { values: patch.values, stickyNotes: patch.stickyNotes, updatedAt: serverTimestamp() });
  } else {
    const { patch: fields } = await csPatchFor(id, (e) => ({ ...e, values: patch.values, stickyNotes: patch.stickyNotes, updatedAtMs: Date.now() }));
    batch.set(doc(db, ref.collection, id), fields, { merge: true });
  }
  batch.set(
    newAuditLogRef(),
    buildAuditEntry(actor.teamId, actor.uid, actor.name, "edit-form-entry", { entryId: entry.id, formId: entry.formId, eventCode: entry.eventCode, teamNumber: entry.teamNumber ?? null }, { values: entry.values, notes: entry.stickyNotes.length }, { values: patch.values, notes: patch.stickyNotes.length, changedKeys: diffEntryValues(entry.values, patch.values) })
  );
  await batch.commit();
}

/**
 * Admins only (the rules decide): exclude an entry, set its flags, or fix its values (an import-time correction). For a CS-backed entry `excluded` is the doc's
 * own `excludeFromStats` and the flags are `scoutingFlagStates` (what CS's analytics Config modal writes), both in one batch.
 */
export async function adminUpdateFormEntry(handle: FormEntryHandle, patch: { excluded?: boolean; flags?: FormEntry["flags"]; values?: FormValues }): Promise<void> {
  const { id, ref } = await resolveRef(handle);
  if (ref.collection === CUSTOM_COLLECTION) {
    await updateDoc(doc(db, CUSTOM_COLLECTION, id), { ...patch, updatedAt: serverTimestamp() });
    return;
  }
  const now = Date.now();
  const actorUid = auth?.currentUser?.uid ?? "";
  const { patch: fields, next, flagState } = await csPatchFor(id, (e) => ({
    ...e,
    ...(patch.excluded !== undefined ? { excluded: patch.excluded } : {}),
    ...(patch.flags !== undefined ? { flags: patch.flags } : {}),
    ...(patch.values !== undefined ? { values: patch.values } : {}),
    ...(patch.values !== undefined ? { updatedAtMs: now } : {}),
  }));
  if (patch.excluded !== undefined) {
    fields.excludeFromStatsAt = now;
    fields.excludeFromStatsBy = actorUid;
  }
  const batch = writeBatch(db);
  batch.set(doc(db, ref.collection, id), fields, { merge: true });
  const flagWrite = formEntryToFlagStatePatch(next, flagState, { now, actorUid });
  if (flagWrite) batch.set(doc(db, FLAG_COLLECTION, flagWrite.id), withoutUndefined(flagWrite.data), { merge: true });
  await batch.commit();
}

/** Admins only. */
export async function deleteFormEntry(handle: FormEntryHandle): Promise<void> {
  const { id, ref } = await resolveRef(handle);
  await deleteDoc(doc(db, ref.collection, id));
  known.delete(id);
}

export type FormEntriesFilter = {
  formId?: string;
  /** An event, spelled any way (a legacy alias such as `2025lake` matches `2026lake`). */
  eventCode?: string;
  /** Only this form type (what `formId` resolves to for the built-in CS forms). */
  formType?: FormEntryType;
  /** Which game's docs to include: the current game by default (a doc with no `game` counts as CS counts it for that form), or `"all"`. */
  game?: string;
  /** CS's own practice-scouting rows (a practice session's output) are left out unless this is set, as CS's analytics leave them out by default. */
  includePractice?: boolean;
};

type Source = { id: string; place: Where; formType: FormEntryType | null; constraints: QueryConstraint[] };

/** The listeners one filter needs. `where teamId ==` only, like CS; event, game and practice are filtered on the client so aliases and missing keys work. */
function sourcesFor(teamId: string, filter: FormEntriesFilter): Source[] {
  const team = where("teamId", "==", teamId);
  const sources: Source[] = [];
  const wantsCustom = !filter.formType ? !filter.formId || !formTypeForFormId(filter.formId) : filter.formType === "custom";
  const csTypes: CsFormType[] = filter.formType ? (isCsBackedFormType(filter.formType) ? [filter.formType] : []) : filter.formId ? (formTypeForFormId(filter.formId) ? [formTypeForFormId(filter.formId) as CsFormType] : []) : [...CS_FORM_TYPES];
  for (const t of csTypes) {
    sources.push({ id: CS_FORM_SPECS[t].collection, place: CS_FORM_SPECS[t].collection, formType: t, constraints: [team] });
    if (t === "lead-scout") sources.push({ id: CS_LEAD_FALLBACK_COLLECTION, place: CS_LEAD_FALLBACK_COLLECTION, formType: t, constraints: [where("entryType", "==", "lead"), team] });
  }
  if (wantsCustom) sources.push({ id: CUSTOM_COLLECTION, place: CUSTOM_COLLECTION, formType: null, constraints: [team, ...(filter.formId ? [where("formId", "==", filter.formId)] : [])] });
  if (csTypes.length > 0) sources.push({ id: FLAG_COLLECTION, place: CUSTOM_COLLECTION, formType: null, constraints: [team] });
  return sources;
}

type Held = { key: string; bySource: Record<string, Array<{ id: string; data: CsRecord }>> };

/** The team's entries, live, optionally of one form and/or one event, newest first. */
export function useFormEntries(teamId: string | null, filter: FormEntriesFilter = {}): { entries: FormEntry[]; loaded: boolean } {
  const [held, setHeld] = useState<Held | null>(null);
  const { formId, eventCode, formType, game, includePractice } = filter;
  const key = teamId ? `${teamId}|${formId ?? ""}|${formType ?? ""}` : null;

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) return;
    const k = `${teamId}|${formId ?? ""}|${formType ?? ""}`;
    const sources = sourcesFor(teamId, { formId, formType });
    const publish = (source: Source, docs: Array<{ id: string; data: CsRecord }>) => setHeld((prev) => ({ key: k, bySource: { ...(prev?.key === k ? prev.bySource : {}), [source.id]: docs } }));
    const unsubs = sources.map((source) =>
      onSnapshot(
        query(collection(db, source.id), ...source.constraints),
        (snap) => {
          if (source.id !== FLAG_COLLECTION) {
            for (const d of snap.docs) {
              const type = source.place === CUSTOM_COLLECTION ? ((d.data().formType as FormEntryType | undefined) ?? "custom") : (source.formType as FormEntryType);
              known.set(d.id, { collection: source.place, formType: type });
            }
          }
          publish(source, snap.docs.map((d) => ({ id: d.id, data: d.data() as CsRecord })));
        },
        (err) => {
          reportFirestoreError("form entries subscription failed", err, source.id);
          publish(source, []);
        }
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [teamId, formId, formType]);

  const entries = useMemo(() => {
    if (!key || !teamId || held?.key !== key) return null;
    const wantedGame = game ?? CURRENT_GAME_ID;
    const flagStates = new Map<string, CsFlagState>();
    for (const d of held.bySource[FLAG_COLLECTION] ?? []) flagStates.set(d.id, d.data as CsFlagState);
    const out: FormEntry[] = [];
    for (const source of sourcesFor(teamId, { formId, formType })) {
      if (source.id === FLAG_COLLECTION) continue;
      for (const d of held.bySource[source.id] ?? []) {
        if (source.place === CUSTOM_COLLECTION) {
          const entry = toFormEntry(d.id, d.data);
          if (!formId || entry.formId === formId) out.push(entry);
          continue;
        }
        const t = source.formType as CsFormType;
        if (source.place === CS_LEAD_FALLBACK_COLLECTION && !isLeadFallbackDoc(d.data)) continue;
        if (wantedGame !== "all" && csDocGame(t, d.data) !== wantedGame) continue;
        const entry = csDocToFormEntry(t, d.id, d.data, flagStates.get(csFlagStateDocId(csFlagEntityTypeFor(t, source.place as CsFormCollection), d.id)), { collection: source.place as CsFormCollection });
        if (entry.legacy?.practiceScouted && !includePractice) continue;
        out.push(entry);
      }
    }
    return out.filter((e) => eventCodesMatch(e.eventCode, eventCode)).sort((a, b) => b.createdAtMs - a.createdAtMs);
  }, [held, key, teamId, formId, formType, game, includePractice, eventCode]);

  if (!key) return { entries: [], loaded: true };
  return entries ? { entries, loaded: true } : { entries: [], loaded: false };
}

/**
 * Which matches of an event are already scouted by the team: the client-side equivalent of CS's `POST /api/scout/completions` (no API route). It reads the same
 * four collections (`scouting` match rows, `leadScouting`, `matchStrategyPlans`, `driveScouting`) filtered by `teamId`, then keeps the event (aliases resolved) and
 * returns CE match keys (`Q12`, `P3`, `F7`, `F15`). Unlike CS it does not also read every other team's rows for the event: that was a cross-team read.
 * Per-form results are in `byCollection` (the lead form should grey out only lead-scouted matches, the plan form only planned ones).
 */
export async function fetchCompletedMatchKeys(teamId: string, eventCode: string): Promise<CompletedMatches> {
  if (!teamId || !isFirebaseConfigured()) return csCompletedMatchKeys([], eventCode);
  const results = await Promise.all(
    CS_COMPLETION_COLLECTIONS.map(async (name: CsCompletionCollection) => {
      try {
        const snap = await getDocs(query(collection(db, name), where("teamId", "==", teamId)));
        return snap.docs.map((d) => ({ collection: name, doc: d.data() as CsRecord }));
      } catch (error) {
        reportFirestoreError("completions read failed", error, name);
        return [];
      }
    })
  );
  return csCompletedMatchKeys(results.flat(), eventCode);
}
