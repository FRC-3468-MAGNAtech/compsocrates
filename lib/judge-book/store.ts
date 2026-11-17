"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, getDocs, onSnapshot, query, runTransaction, updateDoc, where } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { describeFirestoreError, reportFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";
import {
  addCardsToRaw,
  buildCardPatch,
  buildNewCards,
  cardFromLegacyDoc,
  cardsFromTeamDoc,
  judgeBookEditGrants,
  removeCardFromRaw,
  sortJudgeBookCards,
  updateCardInRaw,
  type Actor,
  type CardDraft,
  type CardPatch,
  type JudgeBookCard,
} from "@/lib/judge-book/model";

// Persistence for the Judge Book. Storage is CS's (D1, docs/ROUTES.md): the cards are an array on the team doc
// (`teams/{id}.judgeBookCards[]`, `judgeBookUpdatedAt`) and a legacy top-level `judgeBookCards` collection is read only
// while the array is empty. Team-doc writes run in a transaction over the *latest* array and merge-write (D10), so two
// editors compose and a field or row this code doesn't know is never dropped.
//
// Production CS rules (docs/cs-firestore.rules) deny the legacy collection, so that read is best-effort and fails
// silently. CS also fell back to writing the legacy collection when the team-doc write failed; that workaround is not
// ported (a denied team-doc write is reported instead), so only cards that were *read* from the legacy collection are
// written back there.

const TEAMS = "teams";
const LEGACY = "judgeBookCards";

export type WriteResult = { ok: true } | { ok: false; message: string };

function writeFailureMessage(err: unknown, action: string): string {
  if (err instanceof Error && err.message.startsWith("That card")) return err.message;
  const { code } = describeFirestoreError(action, err);
  if (code === "permission-denied") return `${action}: the team's database rules didn't allow it. Ask a team admin.`;
  if (code === "unavailable" || code === "deadline-exceeded") return `${action}: couldn't reach the server. Check your connection and try again.`;
  return `${action}. Try again.`;
}

/** Runs `change` on the latest `judgeBookCards` array of the team doc and merge-writes the result with a fresh `judgeBookUpdatedAt`. */
async function mutateTeamCards(teamId: string, change: (raw: unknown) => unknown[]): Promise<void> {
  const ref = doc(db, TEAMS, teamId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const next = change(snap.exists() ? snap.data().judgeBookCards : undefined);
    tx.set(ref, { judgeBookCards: next, judgeBookUpdatedAt: Date.now() }, { merge: true });
  });
}

async function createCards(actor: Actor, cards: JudgeBookCard[]): Promise<void> {
  await mutateTeamCards(actor.teamId, (raw) => addCardsToRaw(raw, cards));
}

async function updateCard(teamId: string, card: JudgeBookCard, patch: CardPatch): Promise<void> {
  if (card.source === "legacy-collection") {
    await updateDoc(doc(db, LEGACY, card.id), { ...patch });
    return;
  }
  let found = true;
  await mutateTeamCards(teamId, (raw) => {
    const result = updateCardInRaw(raw, card.id, patch);
    found = result.found;
    return result.rows;
  });
  if (!found) throw new Error("That card no longer exists. Reload the Judge Book.");
}

async function deleteCard(teamId: string, card: JudgeBookCard): Promise<void> {
  if (card.source === "legacy-collection") {
    await deleteDoc(doc(db, LEGACY, card.id));
    return;
  }
  await mutateTeamCards(teamId, (raw) => removeCardFromRaw(raw, card.id));
}

/** Best-effort read of the legacy collection. Any failure (the production rules deny it) is an empty list, never an error. */
async function readLegacyCards(teamId: string): Promise<JudgeBookCard[]> {
  try {
    const snap = await getDocs(query(collection(db, LEGACY), where("teamId", "==", teamId)));
    const now = Date.now();
    const cards: JudgeBookCard[] = [];
    for (const d of snap.docs) {
      const card = cardFromLegacyDoc(d.id, d.data(), now);
      if (card) cards.push({ ...card, teamId });
    }
    return sortJudgeBookCards(cards);
  } catch {
    return [];
  }
}

/**
 * The team's Judge Book, live. `grants` are the uids the team gave `judge-book-edit` (read off the same team-doc snapshot);
 * pair it with `canEditJudgeBook` for the signed-in member. The write helpers return a result instead of throwing, so the
 * UI can show the reason inline.
 */
export function useJudgeBook(teamId: string | null, actor: { uid: string; name: string } | null) {
  const [teamCards, setTeamCards] = useState<JudgeBookCard[]>([]);
  const [legacyCards, setLegacyCards] = useState<JudgeBookCard[]>([]);
  const [grants, setGrants] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());
  const [error, setError] = useState<FirestoreFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // Deliberate: no team (profile not loaded, or not on a team) means no cards, rather than a previous team's on screen.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTeamCards([]);
      setLegacyCards([]);
      setGrants([]);
      setError(null);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    setError(null);
    let cancelled = false;
    let legacyRun = 0;
    const unsubscribe = onSnapshot(
      doc(db, TEAMS, teamId),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        const rows = cardsFromTeamDoc(data.judgeBookCards, teamId);
        setTeamCards(rows);
        setGrants(judgeBookEditGrants(data.formAccessOverrides));
        if (rows.length > 0) {
          legacyRun++;
          setLegacyCards([]);
          setLoaded(true);
          return;
        }
        // The array is empty: look in the legacy collection (CS behavior). `legacyRun` drops a stale answer if a newer snapshot arrived.
        const run = ++legacyRun;
        void readLegacyCards(teamId).then((legacy) => {
          if (cancelled || run !== legacyRun) return;
          setLegacyCards(legacy);
          setLoaded(true);
        });
      },
      (err) => {
        reportFirestoreError("judge book subscription failed", err, `teams/${teamId}`);
        setError(describeFirestoreError("Couldn't load the Judge Book", err, `teams/${teamId}`));
        setTeamCards([]);
        setLegacyCards([]);
        setGrants([]);
        setLoaded(true);
      }
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [teamId, attempt]);

  const cards = useMemo(() => (teamCards.length > 0 ? teamCards : legacyCards), [teamCards, legacyCards]);

  const create = useCallback(
    async (drafts: CardDraft[]): Promise<WriteResult & { added?: number }> => {
      if (!teamId || !actor) return { ok: false, message: "You need to be on a team to add cards." };
      const created = buildNewCards(drafts, { ...actor, teamId });
      if (created.length === 0) return { ok: false, message: "Add at least one card with a title/question." };
      try {
        await createCards({ ...actor, teamId }, created);
        return { ok: true, added: created.length };
      } catch (err) {
        console.error("judge book create failed:", err);
        return { ok: false, message: writeFailureMessage(err, "Unable to save Judge Book cards") };
      }
    },
    [teamId, actor]
  );

  const update = useCallback(
    async (card: JudgeBookCard, draft: CardDraft): Promise<WriteResult> => {
      if (!teamId || !actor) return { ok: false, message: "You need to be on a team to edit cards." };
      const patch = buildCardPatch(draft, actor);
      if (!patch) return { ok: false, message: "Question/title is required." };
      try {
        await updateCard(teamId, card, patch);
        // A legacy card has no snapshot to refresh it, so reflect the edit locally.
        if (card.source === "legacy-collection") {
          setLegacyCards((prev) => sortJudgeBookCards(prev.map((c) => (c.id === card.id ? { ...c, ...patch } : c))));
        }
        return { ok: true };
      } catch (err) {
        console.error("judge book update failed:", err);
        return { ok: false, message: writeFailureMessage(err, "Unable to save this card") };
      }
    },
    [teamId, actor]
  );

  const remove = useCallback(
    async (card: JudgeBookCard): Promise<WriteResult> => {
      if (!teamId) return { ok: false, message: "You need to be on a team to delete cards." };
      try {
        await deleteCard(teamId, card);
        if (card.source === "legacy-collection") setLegacyCards((prev) => prev.filter((c) => c.id !== card.id));
        return { ok: true };
      } catch (err) {
        console.error("judge book delete failed:", err);
        return { ok: false, message: writeFailureMessage(err, "Unable to delete this card") };
      }
    },
    [teamId]
  );

  return { cards, grants, loaded, error, retry: () => setAttempt((n) => n + 1), create, update, remove };
}
