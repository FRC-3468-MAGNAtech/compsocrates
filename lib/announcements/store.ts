"use client";

import { addDoc, collection, deleteDoc, doc, onSnapshot, query, where } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { useProgramConfig } from "@/lib/program/context";
import { describeFirestoreError, reportFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";
import {
  ANNOUNCEMENT_COLLECTION,
  buildAnnouncement,
  checkBody,
  parseAnnouncement,
  sortNewestFirst,
  type AnnouncementActor,
  type AnnouncementType,
  type TeamAnnouncement,
} from "@/lib/announcements/model";

// Persistence for the Team Communication board: `teamAnnouncements/{id}` (CS's collection, unchanged). Every teammate reads (one team-scoped
// query, realtime) and posts as themselves; a team admin deletes; nothing is edited (firestore.rules). The query is `where teamId ==` only,
// sorted newest-first on the client: CS's `orderBy("createdAt")` needed a composite index this project does not deploy.

export type AnnouncementsState = { posts: TeamAnnouncement[]; loaded: boolean; error: FirestoreFailure | null; retry: () => void };

/** The team's announcements, live, newest first. A failed load is an `error` (never disguised as "no posts yet"); `retry` resubscribes. */
export function useTeamAnnouncements(teamId: string | null): AnnouncementsState {
  // A program that has not connected announcements has none: this hook reads the default program's collection only (never another program's).
  const { announcements: connected } = useProgramConfig().connection.features;
  const [held, setHeld] = useState<{ teamId: string; attempt: number; posts: TeamAnnouncement[]; error: FirestoreFailure | null } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!connected || !teamId || !isFirebaseConfigured()) return;
    const path = `${ANNOUNCEMENT_COLLECTION} where teamId == ${teamId}`;
    return onSnapshot(
      query(collection(db, ANNOUNCEMENT_COLLECTION), where("teamId", "==", teamId)),
      (snap) => setHeld({ teamId, attempt, posts: sortNewestFirst(snap.docs.map((d) => parseAnnouncement(d.id, d.data()))), error: null }),
      (err) => {
        reportFirestoreError("team announcements subscription failed", err, path);
        setHeld({ teamId, attempt, posts: [], error: describeFirestoreError("Couldn't load announcements", err, path) });
      }
    );
  }, [connected, teamId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return useMemo(() => {
    if (!connected || !teamId || !isFirebaseConfigured()) return { posts: [], loaded: true, error: null, retry };
    return held?.teamId === teamId && held.attempt === attempt ? { posts: held.posts, loaded: true, error: held.error, retry } : { posts: [], loaded: false, error: null, retry };
  }, [connected, teamId, held, attempt, retry]);
}

export type AnnouncementResult = { ok: true } | { ok: false; reason: string };

/** CS posts with `addDoc`; here the body is validated first and the result is returned instead of thrown, so the form can show the reason. */
export async function postAnnouncement(input: { teamId: string; actor: AnnouncementActor; body: string; type: AnnouncementType }): Promise<AnnouncementResult> {
  const checked = checkBody(input.body);
  if (!checked.ok) return checked;
  try {
    await addDoc(collection(db, ANNOUNCEMENT_COLLECTION), buildAnnouncement({ teamId: input.teamId, actor: input.actor, body: checked.body, type: input.type, now: Date.now() }));
    return { ok: true };
  } catch (error) {
    reportFirestoreError("team announcement post failed", error, ANNOUNCEMENT_COLLECTION);
    return { ok: false, reason: "Unable to post right now. Try again in a moment." };
  }
}

/** A team admin deletes one post for good (the rules refuse anyone else). */
export async function deleteAnnouncement(postId: string): Promise<AnnouncementResult> {
  try {
    await deleteDoc(doc(db, ANNOUNCEMENT_COLLECTION, postId));
    return { ok: true };
  } catch (error) {
    reportFirestoreError("team announcement delete failed", error, `${ANNOUNCEMENT_COLLECTION}/${postId}`);
    return { ok: false, reason: "Couldn't delete that post. Try again in a moment." };
  }
}
