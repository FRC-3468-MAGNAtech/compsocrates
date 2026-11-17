import "server-only";
import { FieldValue, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";
import { DEFAULT_PROGRAM, type ProgramId } from "@/config/programs/types";
import type { EventMatch } from "@/lib/events/types";
import { LIVE_CONFIG } from "@/lib/live/config";
import { isAllianceReadyToNotify } from "@/lib/live/notify";
import { resolveLiveAllianceScoring } from "@/lib/live/scoring";
import { liveProgramStore, type LiveProgramStore } from "@/lib/server/live-program";
import type { ScoutEntry } from "@/lib/scout-entries";

/**
 * The core of both app/api/cron/poll-live-scores and
 * app/api/live/check-scores (P7) — Admin SDK, so it bypasses
 * firestore.rules entirely; both routes have their own separate auth
 * (a CRON_SECRET bearer token / a verified signed-in session) rather than
 * relying on rules here. Idempotent by construction: a session only ever
 * matches the "pending" query (`accuracy == null`) once, so writing a
 * resolved accuracy is itself what prevents reprocessing on the next run
 * — no separate "already handled" flag needed. Notification docs are
 * additionally keyed by session id, so even a true double-run that somehow
 * re-resolved the same alliance wouldn't re-send a push.
 *
 * `program` picks whose sessions, entries and event API are used (default: the default program, exactly as before); a run covers ONE program, so the
 * cron route calls it once per program. `store` is for tests.
 */
export async function resolvePendingLiveMatches(
  db: Firestore,
  messaging: Messaging | null,
  uid?: string,
  program: ProgramId = DEFAULT_PROGRAM,
  store: LiveProgramStore = liveProgramStore(program)
): Promise<{ checked: number; resolved: number }> {
  let q = db.collection(store.paths.sessions).where("kind", "==", "live").where("status", "==", "completed").where("accuracy", "==", null);
  if (uid) q = q.where("uid", "==", uid);
  const snap = await q.get();
  if (snap.empty) return { checked: 0, resolved: 0 };

  const groups = new Map<string, QueryDocumentSnapshot[]>();
  for (const docSnap of snap.docs) {
    const d = docSnap.data();
    if (!d.eventCode || !d.matchType || d.matchNumber == null || !d.alliance) continue;
    const key = `${d.teamId}|${d.eventCode}|${d.matchType}|${d.matchNumber}|${d.alliance}`;
    const list = groups.get(key) ?? [];
    list.push(docSnap);
    groups.set(key, list);
  }

  const matchCache = new Map<string, EventMatch[]>();
  let resolved = 0;

  for (const docs of groups.values()) {
    const da = docs[0].data();
    // A session records the whole alliance it belongs to; that length (3 or 2) is how many completed sessions cover it.
    const required: number = Array.isArray(da.allianceTeams) && da.allianceTeams.length > 0 ? da.allianceTeams.length : store.allianceSize;
    if (docs.length !== required) continue; // alliance not yet covered by every robot's completed session

    const matchCacheKey = `${da.eventCode}|${da.matchType}`;
    let matches = matchCache.get(matchCacheKey);
    if (!matches) {
      try {
        matches = await store.fetchMatches(da.eventCode, da.matchType);
      } catch (err) {
        console.error("poll-live-scores: failed to fetch matches for", matchCacheKey, err);
        continue;
      }
      matchCache.set(matchCacheKey, matches);
    }
    const match = matches.find((m) => m.matchNumber === da.matchNumber);
    if (!match) continue;

    const entryIds = docs.map((d) => d.data().entryIds?.[0] as string | undefined);
    if (entryIds.some((id) => !id)) continue;

    // D1: a session's entries are the program's stored entry docs; its reader turns them into app entries (score computed, never stored).
    const entrySnaps = await Promise.all(entryIds.map((id) => db.collection(store.paths.entries).doc(id!).get()));
    if (entrySnaps.some((s) => !s.exists)) continue;
    const rawById = new Map(entrySnaps.map((s) => [s.id, s.data() as Record<string, unknown>]));
    const adapted = entrySnaps.map((s) => store.readEntry(s.id, s.data() as Record<string, unknown>));
    if (adapted.some((e) => e === null)) continue;
    const entries = adapted as ScoutEntry[];

    const result = resolveLiveAllianceScoring(match, da.alliance, entries);
    if (!result) continue; // score hasn't posted yet

    // One transaction that re-reads the sessions: if another run (the poller and a client check at once) resolved this alliance since our query, it writes
    // nothing and does not notify, so an alliance is resolved by exactly one run.
    const wrote = await db.runTransaction(async (txn) => {
      const fresh = await Promise.all(docs.map((d) => txn.get(d.ref)));
      if (fresh.some((s) => !s.exists || s.data()?.accuracy != null)) return false;
      for (const sessionDoc of docs) {
        txn.update(sessionDoc.ref, {
          accuracy: result.sessionAccuracy,
          scoutedTotal: result.sessionScoutedTotal,
          officialScore: result.sessionOfficialScore,
          penaltyPoints: result.sessionPenaltyPoints,
          flags: result.sessionFlags,
        });
      }
      for (const entry of entries) {
        const patch = store.entryPatch({ entry, raw: rawById.get(entry.id) ?? {}, result });
        if (Object.keys(patch).length > 0) txn.update(db.collection(store.paths.entries).doc(entry.id), patch);
      }
      return true;
    });
    if (!wrote) continue;
    resolved++;

    const notifyEligible = isAllianceReadyToNotify(
      entries.map((e) => ({ uid: e.uid, submittedAt: e.submittedAt })),
      LIVE_CONFIG.LIVE_BOTH_ROBOTS_WINDOW_MINUTES,
      required
    );
    if (notifyEligible) {
      await notifyScoutsForSessions(db, messaging, docs, da.teamId, store);
    }
  }

  return { checked: snap.size, resolved };
}

/** Firestore (Admin SDK) reports a `create` of an existing doc as gRPC code 6 / ALREADY_EXISTS. */
function isAlreadyExists(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  return e?.code === 6 || e?.code === "already-exists" || (typeof e?.message === "string" && e.message.includes("ALREADY_EXISTS"));
}

async function notifyScoutsForSessions(db: Firestore, messaging: Messaging | null, sessionDocs: QueryDocumentSnapshot[], teamId: string, store: LiveProgramStore): Promise<void> {
  for (const sessionDoc of sessionDocs) {
    const s = sessionDoc.data();
    const notificationRef = db.collection(store.paths.notifications).doc(sessionDoc.id);
    const title = "Scores are available";
    const body = `Your live match (${s.matchType} ${s.matchNumber}) has been scored.`;
    try {
      // `create` fails when the doc exists: the idempotency guard, atomic (a get-then-set would let two runs both send the push).
      await notificationRef.create({
        teamId,
        uid: s.uid,
        sessionId: sessionDoc.id,
        type: "live-score-ready",
        title,
        body,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      if (isAlreadyExists(err)) continue; // another run already notified this scout
      throw err;
    }

    if (!messaging) continue;
    try {
      const userSnap = await db.collection(store.paths.users).doc(s.uid).get();
      const tokens: string[] = userSnap.data()?.fcmTokens ?? [];
      if (tokens.length === 0) continue;
      await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: { sessionId: sessionDoc.id, url: store.practiceUrl },
      });
    } catch (err) {
      // Push delivery failing shouldn't undo the already-written notification
      // doc or scoring — the in-app "View results" list still works either way.
      console.error("poll-live-scores: push send failed for", s.uid, err);
    }
  }
}
