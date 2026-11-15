"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { DEFAULT_PROGRAM, type ProgramId } from "@/config/programs/types";
import { buildAuditEntry, newAuditLogRef } from "@/lib/audit-log";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { programCollection, programDoc } from "@/lib/firebase/paths";
import { useProgram } from "@/lib/program/context";
import type { ProgramData } from "@/lib/program/data";
import { saveUserFields } from "@/lib/program/user-fields";
import { entryFromData, hasUnread, normalizeDraft, sortEntries, timestampMs, entryToDraft, type ChangelogDraft, type ChangelogEntry } from "@/lib/changelog";
import { starterDocId, starterEntriesFor } from "@/lib/changelog/seed";

// Persistence for the Changelog (P14): `changelog/{id}` (the root program) or `programs/<id>/changelog/{id}` (a namespaced program), through `programPath`.
// Members read published entries only; admins read and write everything (firestore.rules). Every function takes the program (default: the root one, so the
// default program reads and writes exactly what it always did); the hooks ask `useProgram()`. The seed, the audit entry and the team doc follow the program.

const COLLECTION = "changelog";

type Actor = { teamId: string; uid: string; name: string };

/** The entries query: equality-only (no orderBy, no new index). A member must ask for `status == "published"` themselves; an admin reads all of the team's. */
export function changelogQuery(program: ProgramId, teamId: string, isAdmin: boolean) {
  const base = programCollection(db, program, COLLECTION);
  return isAdmin ? query(base, where("teamId", "==", teamId)) : query(base, where("teamId", "==", teamId), where("status", "==", "published"));
}

/**
 * Realtime entries, newest first (pinned on top). Firestore rules aren't
 * filters, so a non-admin's query has to ask for `status == "published"`
 * itself — an unfiltered list would be rejected outright, not silently trimmed.
 */
export function useChangelog(teamId: string | null, isAdmin: boolean) {
  const program = useProgram();
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());
  // A failed read says so (the page shows it): it is never shown as an empty changelog.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntries([]);
      setError(null);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    const q = changelogQuery(program, teamId, isAdmin);
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setEntries(sortEntries(snap.docs.map((d) => entryFromData(d.id, d.data()))));
        setError(null);
        setLoaded(true);
      },
      (err) => {
        console.error("changelog subscription failed:", err);
        setEntries([]);
        setError("Couldn't load the changelog. Reload the page; if it keeps happening, check your connection.");
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId, isAdmin, program]);

  return { entries, loaded, error };
}

/**
 * The unread dot: true when a published entry went live after the user last
 * opened the Changelog (`lastSeenChangelogAt` on their user doc). Listens to
 * published entries only, for every role, so it costs the same for everyone.
 */
export function useChangelogUnread(teamId: string | null, lastSeenChangelogAt: unknown): boolean {
  const program = useProgram();
  const [published, setPublished] = useState<Pick<ChangelogEntry, "status" | "publishedAtMs" | "legacy">[]>([]);

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPublished([]);
      return;
    }
    const q = changelogQuery(program, teamId, false);
    const unsubscribe = onSnapshot(
      q,
      (snap) => setPublished(snap.docs.map((d) => ({ status: "published" as const, publishedAtMs: timestampMs(d.data().publishedAt), legacy: d.data().legacy === true }))),
      (err) => {
        console.error("changelog unread subscription failed:", err);
        setPublished([]);
      }
    );
    return unsubscribe;
  }, [teamId, program]);

  const seenMs = timestampMs(lastSeenChangelogAt);
  return useMemo(() => hasUnread(published, seenMs), [published, seenMs]);
}

/**
 * Stamps "I've seen the changelog up to now" on the user's own doc (the program's own through its port, else the root `users/{uid}`) — clears the dot.
 * A failure is reported and thrown (a `UserFieldsSaveError` with text to show), so the page can say the dot will stay.
 */
export async function markChangelogSeen(uid: string, port: Pick<ProgramData, "profile"> | null = null): Promise<void> {
  await saveUserFields(port, uid, { lastSeenChangelogAt: serverTimestamp() }, "Couldn't record the changelog visit");
}

/** What an entry looks like in the audit log: its content, not its timestamps. */
const auditView = (d: ChangelogDraft) => ({ version: d.version, title: d.title, date: d.date, summary: d.summary, changes: d.changes, status: d.status, pinned: d.pinned });

/**
 * Creates (`id` null) or updates an entry in a transaction, with its audit
 * entry in the same transaction. `publishedAt` is set when an entry first goes
 * live and kept through later edits, so tweaking a typo in an old entry doesn't
 * light the unread dot for everyone again; unpublishing clears it.
 */
export async function saveEntry(actor: Actor, id: string | null, input: ChangelogDraft, program: ProgramId = DEFAULT_PROGRAM): Promise<string> {
  const draft = normalizeDraft(input);
  const ref = id ? programDoc(db, program, COLLECTION, id) : doc(programCollection(db, program, COLLECTION));
  await runTransaction(db, async (tx) => {
    let before: ChangelogDraft | null = null;
    let wasPublished = false;
    let createdBy = actor.uid;
    let createdAt: unknown = serverTimestamp();
    let publishedAt: unknown = null;
    let legacy = false;
    if (id) {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("That entry no longer exists.");
      const current = entryFromData(snap.id, snap.data());
      before = entryToDraft(current);
      wasPublished = current.status === "published";
      createdBy = snap.data().createdBy ?? actor.uid;
      createdAt = snap.data().createdAt ?? serverTimestamp();
      publishedAt = snap.data().publishedAt ?? null;
      legacy = current.legacy === true; // an edit keeps an old-app entry below the current ones
    }
    if (draft.status === "published") {
      if (!wasPublished || publishedAt === null) publishedAt = serverTimestamp();
    } else {
      publishedAt = null;
    }

    tx.set(ref, { teamId: actor.teamId, ...draft, createdBy, createdAt, updatedAt: serverTimestamp(), publishedAt, ...(legacy ? { legacy: true } : {}) });
    tx.set(
      newAuditLogRef(program),
      buildAuditEntry(actor.teamId, actor.uid, actor.name, id ? "edit-changelog-entry" : "create-changelog-entry", { entryId: ref.id, version: draft.version, title: draft.title }, before ? auditView(before) : null, auditView(draft))
    );
  });
  return ref.id;
}

/** Flips pinned and/or status on the *latest stored* entry, so a quick toggle never reverts someone's concurrent edit of its text. */
export async function patchEntry(actor: Actor, id: string, patch: Partial<Pick<ChangelogDraft, "pinned" | "status">>, program: ProgramId = DEFAULT_PROGRAM): Promise<void> {
  const ref = programDoc(db, program, COLLECTION, id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("That entry no longer exists.");
    const current = entryFromData(snap.id, snap.data());
    const before = entryToDraft(current);
    const after: ChangelogDraft = { ...before, ...patch };
    if (after.pinned === before.pinned && after.status === before.status) return;

    let publishedAt: unknown = snap.data().publishedAt ?? null;
    if (after.status === "published") {
      if (current.status !== "published" || publishedAt === null) publishedAt = serverTimestamp();
    } else {
      publishedAt = null;
    }
    tx.update(ref, { pinned: after.pinned, status: after.status, publishedAt, updatedAt: serverTimestamp() });
    tx.set(newAuditLogRef(program), buildAuditEntry(actor.teamId, actor.uid, actor.name, "edit-changelog-entry", { entryId: id, version: before.version, title: before.title }, auditView(before), auditView(after)));
  });
}

export async function deleteEntry(actor: Actor, id: string, program: ProgramId = DEFAULT_PROGRAM): Promise<void> {
  const ref = programDoc(db, program, COLLECTION, id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return; // already gone (another admin got there first)
    const before = entryToDraft(entryFromData(snap.id, snap.data()));
    tx.delete(ref);
    tx.set(newAuditLogRef(program), buildAuditEntry(actor.teamId, actor.uid, actor.name, "delete-changelog-entry", { entryId: id, version: before.version, title: before.title }, auditView(before), null));
  });
}

/**
 * Creates the starter drafts the first time an admin opens the Changelog. The
 * team doc's `changelogSeeded` flag is read and set in the same transaction, so
 * two admins opening the page at once seed once, and the drafts don't come back
 * after an admin deletes them. Everything is created as a draft: nothing goes
 * live until an admin publishes it.
 */
export async function seedChangelogIfNeeded(actor: Actor, program: ProgramId = DEFAULT_PROGRAM): Promise<boolean> {
  const teamRef = programDoc(db, program, "teams", actor.teamId);
  const starters = starterEntriesFor(program);
  return runTransaction(db, async (tx) => {
    const team = await tx.get(teamRef);
    if (!team.exists() || team.data().changelogSeeded === true) return false;

    for (const s of starters) {
      tx.set(programDoc(db, program, COLLECTION, starterDocId(actor.teamId, s.key)), {
        teamId: actor.teamId,
        version: s.version,
        title: s.title,
        date: s.date,
        summary: s.summary,
        changes: s.changes,
        status: "draft",
        pinned: false,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        publishedAt: null,
      });
    }
    tx.update(teamRef, { changelogSeeded: true });
    tx.set(newAuditLogRef(program), buildAuditEntry(actor.teamId, actor.uid, actor.name, "create-changelog-entry", { seeded: starters.length }, null, { drafts: starters.map((s) => s.version) }));
    return true;
  });
}

/** Runs a write and reports failure as a message instead of throwing — for buttons that show an inline error. */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>, failure: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      console.error(failure, err);
      setError(err instanceof Error && err.message.startsWith("That entry") ? err.message : failure);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clearError: () => setError(null) };
}
