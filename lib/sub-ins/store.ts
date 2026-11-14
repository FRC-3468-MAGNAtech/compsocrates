"use client";

import { addDoc, collection, deleteDoc, doc, onSnapshot, query, runTransaction, where, writeBatch } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { reportFirestoreError } from "@/lib/firestore-errors";
import { useProgramConfig } from "@/lib/program/context";
import {
  buildSubInRequest,
  cancelPatch,
  checkCanClaim,
  checkCanRequest,
  claimPatch,
  parseSubInRequest,
  SUB_IN_COLLECTION,
  type SubInActor,
  type SubInRequest,
  type SubInTarget,
} from "@/lib/sub-ins/model";

// D7: `subInRequests/{id}`, team-scoped. Everyone on the team reads (one team-scoped query: realtime, replacing CS's 20 s poll); any member creates for
// themselves; the requester cancels; any other member claims; a team admin deletes (firestore.rules).

/** The team's sub-in requests, live, all events and statuses (the model decides what is visible). */
export function useSubInRequests(teamId: string | null): { requests: SubInRequest[]; loaded: boolean } {
  // A program that has not connected sub-ins has none: this hook reads the default program's collection only (never another program's).
  const { subIns: connected } = useProgramConfig().connection.features;
  const [held, setHeld] = useState<{ teamId: string; requests: SubInRequest[] } | null>(null);
  useEffect(() => {
    if (!connected || !teamId || !isFirebaseConfigured()) return;
    return onSnapshot(
      query(collection(db, SUB_IN_COLLECTION), where("teamId", "==", teamId)),
      (snap) => setHeld({ teamId, requests: snap.docs.map((d) => parseSubInRequest(d.id, d.data())) }),
      (err) => {
        reportFirestoreError("sub-in requests subscription failed", err, `${SUB_IN_COLLECTION} where teamId == ${teamId}`);
        setHeld({ teamId, requests: [] });
      }
    );
  }, [connected, teamId]);
  return useMemo(() => {
    if (!connected || !teamId || !isFirebaseConfigured()) return { requests: [], loaded: true };
    return held?.teamId === teamId ? { requests: held.requests, loaded: true } : { requests: [], loaded: false };
  }, [connected, teamId, held]);
}

export type SubInResult = { ok: true } | { ok: false; reason: string };

const failure = (error: unknown, fallback: string): SubInResult => ({ ok: false, reason: error instanceof Error && error.message ? error.message : fallback });

/** Requests cover for one match. Refused (not written) when one already stands for that robot in that match. */
export async function requestSubIn(input: { teamId: string; eventKey: string; actor: SubInActor; target: SubInTarget; existing: readonly SubInRequest[] }): Promise<SubInResult> {
  const now = Date.now();
  const check = checkCanRequest(input.existing, input.eventKey, input.target, now);
  if (!check.ok) return check;
  try {
    await addDoc(collection(db, SUB_IN_COLLECTION), buildSubInRequest({ teamId: input.teamId, eventKey: input.eventKey, actor: input.actor, target: input.target, now }));
    return { ok: true };
  } catch (error) {
    reportFirestoreError("sub-in request failed", error, SUB_IN_COLLECTION);
    return failure(error, "Could not submit the sub-in request.");
  }
}

/** Takes a request. A transaction re-reads it, so two scouts tapping Take at once cannot both win. */
export async function claimSubIn(requestId: string, actor: SubInActor): Promise<SubInResult> {
  const ref = doc(db, SUB_IN_COLLECTION, requestId);
  try {
    return await runTransaction(db, async (tx): Promise<SubInResult> => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return { ok: false, reason: "This request is gone." };
      const check = checkCanClaim(parseSubInRequest(snap.id, snap.data()), actor, Date.now());
      if (!check.ok) return check;
      tx.update(ref, claimPatch(actor, Date.now()));
      return { ok: true };
    });
  } catch (error) {
    reportFirestoreError("sub-in claim failed", error, `${SUB_IN_COLLECTION}/${requestId}`);
    return failure(error, "Could not take the sub-in.");
  }
}

/** The requester withdraws an open request (CS "Delete Request"). The doc stays as `cancelled` so the requester needs no delete right. */
export async function cancelSubIn(requestId: string): Promise<SubInResult> {
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, SUB_IN_COLLECTION, requestId);
      const snap = await tx.get(ref);
      if (snap.exists() && snap.data().status === "open") tx.update(ref, cancelPatch());
    });
    return { ok: true };
  } catch (error) {
    reportFirestoreError("sub-in cancel failed", error, `${SUB_IN_COLLECTION}/${requestId}`);
    return failure(error, "Could not cancel the request.");
  }
}

/** A team admin deletes one request for good. */
export async function deleteSubIn(requestId: string): Promise<SubInResult> {
  try {
    await deleteDoc(doc(db, SUB_IN_COLLECTION, requestId));
    return { ok: true };
  } catch (error) {
    reportFirestoreError("sub-in delete failed", error, `${SUB_IN_COLLECTION}/${requestId}`);
    return failure(error, "Could not delete the request.");
  }
}

/** CS "Clear All" (team admin): deletes every request of the team, in batches of 400. */
export async function clearAllSubIns(requests: readonly SubInRequest[]): Promise<SubInResult> {
  try {
    for (let i = 0; i < requests.length; i += 400) {
      const batch = writeBatch(db);
      for (const r of requests.slice(i, i + 400)) batch.delete(doc(db, SUB_IN_COLLECTION, r.id));
      await batch.commit();
    }
    return { ok: true };
  } catch (error) {
    reportFirestoreError("sub-in clear failed", error, SUB_IN_COLLECTION);
    return failure(error, "Could not clear the requests.");
  }
}
