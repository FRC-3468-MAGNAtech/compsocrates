"use client";

// The ONE door for Firestore reads in the browser. Everything `firebase/firestore` exports is re-exported unchanged; `getDocs`, `getDoc` and `onSnapshot` are
// wrapped so the read meter (lib/read-meter) can count the documents they return. While the meter is OFF each wrapper is one boolean check and a call straight
// through. A guard test (lib/firebase/metered.guard.test.ts) fails when a file imports those three directly from "firebase/firestore".
//
// What is counted (Firestore's billing, approximately): a one-time read costs the documents it returns (at least one); a listener costs every document of its
// first SERVER snapshot and every document added or modified afterwards. Snapshots served from the local cache (metadata.fromCache) are skipped, and so are
// local writes that have not reached the server (hasPendingWrites). Reads Firestore bills for evaluating security rules are NOT visible here.
import * as fs from "firebase/firestore";
import { isMeterActive, recordDocs } from "@/lib/read-meter/client";

export * from "firebase/firestore";

type AnySnap = {
  metadata?: { fromCache?: boolean; hasPendingWrites?: boolean };
  docs?: { ref: { parent: { path: string } } }[];
  docChanges?: () => { type: string; doc: { ref: { parent: { path: string } }; metadata?: { hasPendingWrites?: boolean } } }[];
  ref?: { parent: { path: string } };
  exists?: () => boolean;
};

const EMPTY = "(empty result)";

function countQuery(snap: AnySnap): void {
  if (snap.metadata?.fromCache) return;
  const docs = snap.docs ?? [];
  if (docs.length === 0) return recordDocs(EMPTY, 1); // Firestore bills at least one read for a query
  const byCollection = new Map<string, number>();
  for (const d of docs) byCollection.set(d.ref.parent.path, (byCollection.get(d.ref.parent.path) ?? 0) + 1);
  for (const [path, n] of byCollection) recordDocs(path, n);
}

function countSnapshot(snap: AnySnap): void {
  if (snap.metadata?.fromCache) return;
  if (typeof snap.docChanges === "function") {
    for (const change of snap.docChanges()) {
      if ((change.type === "added" || change.type === "modified") && !change.doc.metadata?.hasPendingWrites) recordDocs(change.doc.ref.parent.path, 1);
    }
    return;
  }
  if (snap.ref && !snap.metadata?.hasPendingWrites) recordDocs(snap.ref.parent.path, 1);
}

/** The metering never breaks a read: a counting error is dropped. */
const safely = (count: () => void) => {
  try {
    count();
  } catch {
    // counting is best effort
  }
};

export const getDocs = (async (...args: unknown[]) => {
  const snap = await (fs.getDocs as (...a: unknown[]) => Promise<unknown>)(...args);
  if (isMeterActive()) safely(() => countQuery(snap as AnySnap));
  return snap;
}) as typeof fs.getDocs;

export const getDoc = (async (...args: unknown[]) => {
  const snap = await (fs.getDoc as (...a: unknown[]) => Promise<unknown>)(...args);
  if (isMeterActive()) {
    safely(() => {
      const s = snap as AnySnap;
      if (!s.metadata?.fromCache && s.ref) recordDocs(s.ref.parent.path, 1);
    });
  }
  return snap;
}) as typeof fs.getDoc;

const wrapNext = (next: (snap: unknown) => void) => (snap: unknown) => {
  if (isMeterActive()) safely(() => countSnapshot(snap as AnySnap));
  next(snap);
};

export const onSnapshot = ((target: unknown, ...rest: unknown[]) => {
  let wrapped = false;
  const args = rest.map((arg) => {
    if (wrapped) return arg;
    if (typeof arg === "function") {
      wrapped = true;
      return wrapNext(arg as (snap: unknown) => void);
    }
    if (arg && typeof arg === "object" && typeof (arg as { next?: unknown }).next === "function") {
      wrapped = true;
      return { ...(arg as object), next: wrapNext((arg as { next: (snap: unknown) => void }).next.bind(arg)) };
    }
    return arg;
  });
  return (fs.onSnapshot as (...a: unknown[]) => fs.Unsubscribe)(target, ...args);
}) as typeof fs.onSnapshot;
