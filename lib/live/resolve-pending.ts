import "server-only";
import { FieldValue, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";
import { ALLIANCE_SIZE } from "@/config/alliance";
import { csDocToScoutEntry, entryAccuracyToCsPatch } from "@/data/cs/scouting";
import type { CsRecord } from "@/data/cs/types";
import { str } from "@/data/cs/util";
import { fetchMatchesForEventInternal } from "@/lib/events/matches-internal";
import type { EventMatch } from "@/lib/events/types";
import { LIVE_CONFIG } from "@/lib/live/config";
import { isAllianceReadyToNotify } from "@/lib/live/notify";
import { resolveLiveAllianceScoring } from "@/lib/live/scoring";
import type { ScoutEntry } from "@/lib/scout-entries";

/** CS's collection of scouted entries (official, live and practice rows alike; D1). */
const SCOUTING = "scouting";

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
 */
export async function resolvePendingLiveMatches(db: Firestore, messaging: Messaging | null, uid?: string): Promise<{ checked: number; resolved: number }> {
  let q = db.collection("practiceSessions").where("kind", "==", "live").where("status", "==", "completed").where("accuracy", "==", null);
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
    // A session records the whole alliance it belongs to; that length (3 for FRC) is how many completed sessions cover it.
    const required: number = Array.isArray(da.allianceTeams) && da.allianceTeams.length > 0 ? da.allianceTeams.length : ALLIANCE_SIZE;
    if (docs.length !== required) continue; // alliance not yet covered by every robot's completed session

    const matchCacheKey = `${da.eventCode}|${da.matchType}`;
    let matches = matchCache.get(matchCacheKey);
    if (!matches) {
      try {
        matches = await fetchMatchesForEventInternal(da.eventCode, da.matchType);
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

    // D1: a session's entries are CS `scouting` docs; the adapter turns them into app entries (score computed, never stored).
    const entrySnaps = await Promise.all(entryIds.map((id) => db.collection(SCOUTING).doc(id!).get()));
    if (entrySnaps.some((s) => !s.exists)) continue;
    const rawById = new Map(entrySnaps.map((s) => [s.id, s.data() as CsRecord]));
    const adapted = entrySnaps.map((s) => csDocToScoutEntry(s.id, s.data() as CsRecord));
    if (adapted.some((e) => e === null)) continue;
    const entries = adapted as ScoutEntry[];

    const result = resolveLiveAllianceScoring(match, da.alliance, entries);
    if (!result) continue; // score hasn't posted yet

    const batch = db.batch();
    for (const sessionDoc of docs) {
      batch.update(sessionDoc.ref, {
        accuracy: result.sessionAccuracy,
        scoutedTotal: result.sessionScoutedTotal,
        officialScore: result.sessionOfficialScore,
        penaltyPoints: result.sessionPenaltyPoints,
        flags: result.sessionFlags,
      });
    }
    for (const entry of entries) {
      // CS keeps the accuracy percent and `accuracyDetails` on the doc and computes auto flags at read time (nothing to store for them).
      const raw = rawById.get(entry.id) ?? {};
      const patch = entryAccuracyToCsPatch(result.entryAccuracy, raw, str(raw.matchLabel) || str(raw.matchId), str(raw.eventKey), Date.now());
      if (Object.keys(patch).length > 0) batch.update(db.collection(SCOUTING).doc(entry.id), patch);
    }
    await batch.commit();
    resolved++;

    const notifyEligible = isAllianceReadyToNotify(
      entries.map((e) => ({ uid: e.uid, submittedAt: e.submittedAt })),
      LIVE_CONFIG.LIVE_BOTH_ROBOTS_WINDOW_MINUTES,
      required
    );
    if (notifyEligible) {
      await notifyScoutsForSessions(db, messaging, docs, da.teamId);
    }
  }

  return { checked: snap.size, resolved };
}

async function notifyScoutsForSessions(db: Firestore, messaging: Messaging | null, sessionDocs: QueryDocumentSnapshot[], teamId: string): Promise<void> {
  for (const sessionDoc of sessionDocs) {
    const s = sessionDoc.data();
    const notificationRef = db.collection("notifications").doc(sessionDoc.id);
    const existing = await notificationRef.get();
    if (existing.exists) continue; // idempotency guard

    const title = "Scores are available";
    const body = `Your live match (${s.matchType} ${s.matchNumber}) has been scored.`;
    await notificationRef.set({
      teamId,
      uid: s.uid,
      sessionId: sessionDoc.id,
      type: "live-score-ready",
      title,
      body,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (!messaging) continue;
    try {
      const userSnap = await db.collection("users").doc(s.uid).get();
      const tokens: string[] = userSnap.data()?.fcmTokens ?? [];
      if (tokens.length === 0) continue;
      await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: { sessionId: sessionDoc.id, url: "/practice-scouting" },
      });
    } catch (err) {
      // Push delivery failing shouldn't undo the already-written notification
      // doc or scoring — the in-app "View results" list still works either way.
      console.error("poll-live-scores: push send failed for", s.uid, err);
    }
  }
}
