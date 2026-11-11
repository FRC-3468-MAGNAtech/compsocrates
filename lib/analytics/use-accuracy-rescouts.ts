"use client";

import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { reportFirestoreError } from "@/lib/firestore-errors";
import { isDeletedRescout, toRescout, type Rescout, type RescoutAlliance, type RescoutPatch } from "@/lib/analytics/rescouts";

// `accuracyRescouts` (CS): re-scout requests for high-accuracy matches. The app has no hook for this collection, so it lives here, next to the
// model in rescouts.ts. Reads are the team's own rows (the rule needs `teamId` in the query); soft-deleted rows are left out.

const COLLECTION = "accuracyRescouts";

/** The team's re-scouts, live. `error` is set when the subscription failed (for example the collection's rule is not deployed). */
export function useAccuracyRescouts(teamId: string | null): { rescouts: Rescout[]; loaded: boolean; error: boolean } {
  const [held, setHeld] = useState<{ teamId: string; rescouts: Rescout[]; error: boolean } | null>(null);

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) return;
    return onSnapshot(
      query(collection(db, COLLECTION), where("teamId", "==", teamId)),
      (snap) => setHeld({ teamId, rescouts: snap.docs.map((d) => toRescout(d.id, d.data())).filter((r) => !isDeletedRescout(r)), error: false }),
      (err) => {
        reportFirestoreError("accuracy rescouts subscription failed", err, COLLECTION);
        setHeld({ teamId, rescouts: [], error: true });
      }
    );
  }, [teamId]);

  if (!teamId) return { rescouts: [], loaded: true, error: false };
  return held?.teamId === teamId ? { rescouts: held.rescouts, loaded: true, error: held.error } : { rescouts: [], loaded: false, error: false };
}

export type NewRescout = {
  teamId: string;
  eventKey: string;
  eventName: string;
  matchKey: string;
  matchLabel: string;
  game: string;
  alliance: RescoutAlliance;
  teamNumber: number;
  scoutId: string;
  scoutName: string;
  originalScouts: string[];
};

/** Starts a re-scout request (status `pending`); returns its id, which the Practice Scouting flow submits against. */
export async function createRescout(input: NewRescout): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(collection(db, COLLECTION), { ...input, status: "pending", accuracy: null, criticalFlag: false, createdAt: now, updatedAt: now });
  return ref.id;
}

/** Deletes a re-scout; when the rules refuse the delete it is marked `deleted` instead (CS's fallback), which readers skip. */
export async function deleteRescout(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, COLLECTION, id));
  } catch (error) {
    reportFirestoreError("accuracy rescout delete failed, marking it deleted", error, COLLECTION);
    await updateDoc(doc(db, COLLECTION, id), { status: "deleted", deletedAt: Date.now() });
  }
}

/** The derived values CS writes back onto re-scout rows (see `planRescoutUpdates`). Failures are reported, never thrown: the page works without them. */
export async function applyRescoutPatches(patches: readonly RescoutPatch[]): Promise<void> {
  await Promise.allSettled(
    patches.map((p) =>
      updateDoc(doc(db, COLLECTION, p.id), { ...p.patch }).catch((error) => {
        reportFirestoreError("accuracy rescout update failed", error, COLLECTION);
      })
    )
  );
}
