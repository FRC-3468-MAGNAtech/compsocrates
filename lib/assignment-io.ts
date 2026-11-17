"use client";

import { collection, doc, getDocs, query, where, writeBatch, type Query } from "firebase/firestore";
import { eventKeyVariants, type AssignmentWritePlan, type CsAssignmentRow } from "@/data/cs/assignments";
import type { CsUserDoc } from "@/data/cs/types";
import { csUserToMember } from "@/data/cs/users";
import { stripUndefined } from "@/data/cs/util";
import { db } from "@/lib/firebase/client";

// Firestore plumbing shared by the assignment stores (lib/assignments.ts, lib/team-assignments/store.ts, lib/event-attendance.ts).
// The pure side (row <-> app model, write plans) lives in data/cs/assignments.ts.

/** One team's rows in one CS assignment collection for an event (all legacy event-key spellings). */
export function eventRowsQuery(collectionName: string, teamId: string, eventCode: string): Query {
  return query(collection(db, collectionName), where("teamId", "==", teamId), where("eventKey", "in", eventKeyVariants(eventCode)));
}

/** Every row of one team in one CS assignment collection (all events). */
export function teamRowsQuery(collectionName: string, teamId: string): Query {
  return query(collection(db, collectionName), where("teamId", "==", teamId));
}

export async function fetchRows(q: Query): Promise<CsAssignmentRow[]> {
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

/** uid -> display name for the team's members (CS stores `scoutName` next to `scoutId` on every assignment). */
export async function fetchMemberNames(teamId: string): Promise<Map<string, string>> {
  const snap = await getDocs(query(collection(db, "users"), where("teamId", "==", teamId)));
  return new Map(snap.docs.map((d) => [d.id, csUserToMember(d.id, d.data() as CsUserDoc).name]));
}

const BATCH_LIMIT = 400;

/**
 * Applies a write plan to one collection. Patches are merge writes (a row's other fields, known or not, stay), removals are
 * deletes, creations are auto-id adds like CS's `addDoc`. Batched, so a publish lands as a few commits rather than one
 * request per row.
 */
export async function commitPlan(collectionName: string, plan: AssignmentWritePlan): Promise<void> {
  let batch = writeBatch(db);
  let pending = 0;
  const flush = async () => {
    if (pending === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    pending = 0;
  };
  const queue = async (op: (b: ReturnType<typeof writeBatch>) => void) => {
    op(batch);
    pending += 1;
    if (pending >= BATCH_LIMIT) await flush();
  };
  for (const id of plan.remove) await queue((b) => b.delete(doc(db, collectionName, id)));
  for (const u of plan.update) await queue((b) => b.set(doc(db, collectionName, u.id), stripUndefined(u.patch), { merge: true }));
  for (const data of plan.create) await queue((b) => b.set(doc(collection(db, collectionName)), stripUndefined(data)));
  await flush();
}
