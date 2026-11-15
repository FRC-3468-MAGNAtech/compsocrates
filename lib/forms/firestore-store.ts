"use client";

import { collection, doc, getDoc, getDocs, onSnapshot, query, runTransaction, updateDoc, where, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { DEFAULT_PROGRAM, type ProgramId } from "@/config/programs/types";
import { programPath } from "@/lib/firebase/paths";
import { programData } from "@/lib/program/data";
import type { Form } from "@/lib/forms/types";
import { formDocId, listFormSummaries, resolveForm, versionKey, type FormCatalog, type FormDoc, type FormSummary, type FormVersion } from "@/lib/forms/resolve";
import { archiveTransition, discardDraftTransition, plain, publishTransition, resetTransition, saveDraftTransition, FormStoreError, type Actor } from "@/lib/forms/transitions";
import type { FormStore } from "@/lib/forms/store";

// P21: the Firestore FormStore. Layout: `forms/{teamId}_{formId}` holds the working draft, the latest published version number and whether an
// override is active (FormDoc); `forms/{teamId}_{formId}/versions/{n}` holds each published version, write-once (rules refuse any update or
// delete). The id carries the team so two accounts' "rebuilt" overrides can't collide. Every write is one transaction around the pure
// transitions in lib/forms/transitions.ts, which also run in the in-memory store and the tests.
//
// Batch 5b: every function takes the program last (default: the default program, whose paths are exactly what they were). A namespaced program keeps the
// same layout under its own prefix (built by `programPath`) and reads each stored doc through its port's tolerant adapter.

const FORMS = "forms";

const formsPath = (program: ProgramId) => programPath(program, FORMS);
const docRef = (teamId: string, formId: string, program: ProgramId) => doc(db, formsPath(program), formDocId(teamId, formId));
const versionRef = (teamId: string, formId: string, version: number, program: ProgramId) => doc(db, formsPath(program), formDocId(teamId, formId), "versions", String(version));

/** A stored form doc as the app's `FormDoc`: the port's tolerant reader for a namespaced program, the doc as stored otherwise. */
function readFormDoc(program: ProgramId, id: string, data: unknown): FormDoc {
  const normalize = programData(program)?.forms.normalizeDoc;
  return normalize ? normalize(id, data as Record<string, unknown>) : (data as FormDoc);
}

/** A stored version doc as the app's `FormVersion` (null: not usable). */
function readFormVersion(program: ProgramId, id: string, data: unknown): FormVersion | null {
  const normalize = programData(program)?.forms.normalizeVersion;
  return normalize ? normalize(id, data as Record<string, unknown>) : (data as FormVersion);
}

/** Realtime: every form doc of the account (drafts, latest published version numbers, archived/active flags). Versions are loaded on demand. */
export function subscribeFormDocs(teamId: string, onDocs: (docs: Map<string, FormDoc>) => void, onError?: (err: unknown) => void, program: ProgramId = DEFAULT_PROGRAM): Unsubscribe {
  return onSnapshot(
    query(collection(db, formsPath(program)), where("teamId", "==", teamId)),
    (snap) => {
      const docs = new Map<string, FormDoc>();
      for (const d of snap.docs) {
        const data = readFormDoc(program, d.id, d.data());
        docs.set(data.formId, data);
      }
      onDocs(docs);
    },
    onError
  );
}

/** One published version, or null. */
export async function loadFormVersion(teamId: string, formId: string, version: number, program: ProgramId = DEFAULT_PROGRAM): Promise<Form | null> {
  const snap = await getDoc(versionRef(teamId, formId, version, program));
  return snap.exists() ? (readFormVersion(program, snap.id, snap.data())?.form ?? null) : null;
}

/** Every published version of a form (newest first), for the builder's version history. A built-in's own version 1 isn't stored: it lives in code. */
export async function loadAllVersions(teamId: string, formId: string, program: ProgramId = DEFAULT_PROGRAM): Promise<FormVersion[]> {
  const snap = await getDocs(collection(db, formsPath(program), formDocId(teamId, formId), "versions"));
  return snap.docs
    .map((d) => readFormVersion(program, formDocId(teamId, formId), d.data()))
    .filter((v): v is FormVersion => v !== null)
    .sort((a, b) => b.version - a.version);
}

/** The account's current form for an id, by reading just the docs it needs. */
async function loadCatalogFor(teamId: string, formId: string, version: number | undefined, program: ProgramId): Promise<FormCatalog> {
  const snap = await getDoc(docRef(teamId, formId, program));
  const docs = new Map<string, FormDoc>();
  const versions = new Map<string, Form>();
  if (snap.exists()) {
    const data = readFormDoc(program, snap.id, snap.data());
    docs.set(formId, data);
    const wanted = version ?? (data.active ? data.publishedVersion : null);
    if (wanted !== null && wanted !== undefined) {
      const form = await loadFormVersion(teamId, formId, wanted, program);
      if (form) versions.set(versionKey(formId, wanted), form);
    }
  } else if (version !== undefined) {
    const form = await loadFormVersion(teamId, formId, version, program);
    if (form) versions.set(versionKey(formId, version), form);
  }
  return { docs, versions };
}

export function createFirestoreFormStore(teamId: string, actor: Actor, program: ProgramId = DEFAULT_PROGRAM): FormStore {
  const now = () => Date.now();
  const existing = (snap: { id: string; exists(): boolean; data(): unknown }): FormDoc | null => (snap.exists() ? readFormDoc(program, snap.id, snap.data()) : null);
  return {
    async listForms(): Promise<FormSummary[]> {
      const snap = await getDocs(query(collection(db, formsPath(program)), where("teamId", "==", teamId)));
      const docs = new Map<string, FormDoc>();
      for (const d of snap.docs) {
        const data = readFormDoc(program, d.id, d.data());
        docs.set(data.formId, data);
      }
      return listFormSummaries({ docs, versions: new Map() });
    },
    async getForm(formId, version) {
      return resolveForm(await loadCatalogFor(teamId, formId, version, program), formId, version);
    },
    async getDraft(formId) {
      const snap = await getDoc(docRef(teamId, formId, program));
      return existing(snap)?.draft ?? null;
    },
    async listVersions(formId) {
      return loadAllVersions(teamId, formId, program);
    },
    async saveDraft(form) {
      await runTransaction(db, async (txn) => {
        const ref = docRef(teamId, form.id, program);
        const snap = await txn.get(ref);
        txn.set(ref, saveDraftTransition(existing(snap), teamId, form, actor, now()));
      });
    },
    async discardDraft(formId) {
      await runTransaction(db, async (txn) => {
        const ref = docRef(teamId, formId, program);
        const snap = await txn.get(ref);
        txn.set(ref, discardDraftTransition(existing(snap), actor, now()));
      });
    },
    async publish(formId, note) {
      return runTransaction(db, async (txn) => {
        const ref = docRef(teamId, formId, program);
        const snap = await txn.get(ref);
        const result = publishTransition(existing(snap), actor, now(), note);
        // Write-once: the rules only allow creating this version doc together with the doc's own version bump.
        txn.set(versionRef(teamId, formId, result.version.version, program), plain(result.version));
        txn.set(ref, result.doc);
        return { version: result.version.version };
      });
    },
    async archive(formId, archived) {
      await runTransaction(db, async (txn) => {
        const ref = docRef(teamId, formId, program);
        const snap = await txn.get(ref);
        txn.set(ref, archiveTransition(existing(snap), archived, actor, now()));
      });
    },
    async resetToBuiltin(formId) {
      await runTransaction(db, async (txn) => {
        const ref = docRef(teamId, formId, program);
        const snap = await txn.get(ref);
        txn.set(ref, resetTransition(existing(snap), actor, now()));
      });
    },
  };
}

/** Maps a season to the form scouts use for it (`teams.activeForms.{seasonId}`). Admin-only in the rules. The form must be publishable-as-active (see `canBeActive`). */
export async function setActiveForm(teamId: string, seasonId: string, formId: string, program: ProgramId = DEFAULT_PROGRAM): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(seasonId) || !/^[A-Za-z0-9_-]{1,40}$/.test(formId)) throw new FormStoreError("invalid", "That isn't a valid season or form.");
  await updateDoc(doc(db, programPath(program, "teams"), teamId), { [`activeForms.${seasonId}`]: formId });
}
