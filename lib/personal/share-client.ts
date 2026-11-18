"use client";

import { collection, doc, getCountFromServer, getDoc, query, setDoc, where } from "@/lib/firebase/metered";
import { db } from "@/lib/firebase/client";
import { programPath } from "@/lib/firebase/paths";
import type { ProgramId } from "@/config/programs/types";
import { storageKey } from "@/config/brand";
import { authedApi } from "@/lib/api-client";

/**
 * The browser side of SHARE ON JOIN (the server copy is `lib/server/practice-sharing.ts`). Reads are cheap and happen at most once per person per device until the
 * answer is final: the marker document (one `getDoc`), then two aggregate counts (a count query costs one read per 1,000 documents). An answer that can never change
 * (nothing to share, already shared, declined) is remembered in this browser so later page loads read nothing at all.
 */
export type ShareState = {
  /** Completed sessions that would be copied, and the entries stored for the practice (an upper bound: entries of unfinished sessions are not copied). */
  sessions: number;
  entries: number;
  dismissed: boolean;
  shared: boolean;
};

type Remembered = "none" | "shared" | "dismissed";
const rememberKey = (program: ProgramId, uid: string) => storageKey(`sharePractice.${program}.${uid}`);

function recall(program: ProgramId, uid: string): Remembered | null {
  try {
    const v = window.localStorage.getItem(rememberKey(program, uid));
    return v === "none" || v === "shared" || v === "dismissed" ? v : null;
  } catch {
    return null;
  }
}

function remember(program: ProgramId, uid: string, value: Remembered | null): void {
  try {
    if (value === null) window.localStorage.removeItem(rememberKey(program, uid));
    else window.localStorage.setItem(rememberKey(program, uid), value);
  } catch {
    /* storage blocked: the answer is just read again */
  }
}

const root = (program: ProgramId, uid: string) => `${programPath(program, "personalPractice")}/${uid}`;

/**
 * What there is to share. `ignoreRemembered` (the "Share my earlier practice" button on Practice Scouting) re-reads a declined answer; "none" and "shared" stay final.
 * A failed read (the additive rules are not deployed yet, offline) answers null: nothing is shown and nothing is remembered.
 */
export async function readShareState(program: ProgramId, uid: string, options: { ignoreRemembered?: boolean } = {}): Promise<ShareState | null> {
  const known = recall(program, uid);
  if (known === "none" || known === "shared") return { sessions: 0, entries: 0, dismissed: false, shared: known === "shared" };
  if (known === "dismissed" && !options.ignoreRemembered) return { sessions: 0, entries: 0, dismissed: true, shared: false };
  try {
    const marker = (await getDoc(doc(db, root(program, uid), "state", "share"))).data() ?? {};
    if (typeof marker.sharedAtMs === "number") {
      remember(program, uid, "shared");
      return { sessions: 0, entries: 0, dismissed: false, shared: true };
    }
    const [sessions, entries] = await Promise.all([
      getCountFromServer(query(collection(db, `${root(program, uid)}/sessions`), where("status", "==", "completed"))),
      getCountFromServer(collection(db, `${root(program, uid)}/entries`)),
    ]);
    const state: ShareState = { sessions: sessions.data().count, entries: entries.data().count, dismissed: marker.dismissed === true, shared: false };
    if (state.sessions === 0) remember(program, uid, "none");
    else if (state.dismissed) remember(program, uid, "dismissed");
    return state;
  } catch (err) {
    console.error("share-practice state could not be read:", err);
    return null;
  }
}

/** "Not now": the prompt stops appearing on its own (it can be reopened from Practice Scouting). Discards nothing. */
export async function dismissShare(program: ProgramId, uid: string): Promise<void> {
  await setDoc(doc(db, root(program, uid), "state", "share"), { dismissed: true }, { merge: true });
  remember(program, uid, "dismissed");
}

export type ShareProgress = { copiedSessions: number; copiedEntries: number; remaining: number; done: boolean };

/** Copies the practice into the team, calling the route again while it says it stopped at its write budget. Reports each step. */
export async function runShare(program: ProgramId, uid: string, onProgress?: (p: ShareProgress) => void): Promise<ShareProgress> {
  let last: ShareProgress = { copiedSessions: 0, copiedEntries: 0, remaining: 0, done: false };
  for (let call = 0; call < 25; call++) {
    const res = await authedApi<ShareProgress>("/api/team/share-practice", { method: "POST", body: { program }, timeoutMs: 58_000 });
    last = { copiedSessions: res.copiedSessions, copiedEntries: res.copiedEntries, remaining: res.remaining, done: res.done };
    onProgress?.(last);
    if (res.done) {
      remember(program, uid, "shared");
      return last;
    }
  }
  return last;
}
