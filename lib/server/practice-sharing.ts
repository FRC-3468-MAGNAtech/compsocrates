import "server-only";
import { createHash } from "node:crypto";
import { FieldValue, type DocumentData, type Firestore } from "firebase-admin/firestore";
import type { ProgramId } from "@/config/programs/types";
import { normalizeEventKey } from "@/config/event";
import { programPath } from "@/lib/firebase/paths";
import { MembershipError } from "@/lib/memberships/model";
import { parseProgram } from "@/lib/server/memberships";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { getMembershipsEnabled } from "@/lib/server/team-settings";
import { flowFail, runFlow, type Actor, type FlowResult } from "@/lib/server/membership-flows";
import { practicePatchToCsFields } from "@/data/cs/practice";
import { scoutEntryToCsDoc } from "@/data/cs/scouting";
import { ftcScoutEntryDoc } from "@/data/ftc/scouting";
import { ftcSessionPatch, ftcSessionStub } from "@/lib/ftc/practice";
import type { PracticeSession } from "@/lib/practice-sessions";
import type { SaveEntryInput, ScoutEntry } from "@/lib/scout-entries";

/**
 * SHARE ON JOIN: after a person with private practice (`personalPractice/{uid}`) joins a team, they may OPT IN to copy it into the team's practice data. Never automatic:
 * the person presses it, and the target team is the one on THEIR OWN user document (never from the body), so nobody can copy into a team they are not on.
 *
 *  - Only COMPLETED sessions are copied, with the entries that belong to them. A copy is a plain team session (`teamId`, the person's uid and scout name, `kind` solo) in
 *    the program's own shape, and a team entry; deterministic ids (`copiedId`) make a second run write the same documents again, never a second set.
 *  - Writes go in batches of 400 and one run writes at most `RUN_WRITE_BUDGET` documents; a run that stops short answers \`done: false\` and the next call resumes where the
 *    marker document (\`personalPractice/{uid}/state/share\`) says (documents are taken in id order, so the count already copied is the cursor).
 *  - The private copy is never deleted: sharing copies, it does not move.
 */
export const BATCH_SIZE = 400;
export const RUN_WRITE_BUDGET = 3000;
const HOUR_MS = 60 * 60 * 1000;

type Session = DocumentData & { id: string };

/** Where this program keeps team sessions and entries, and how a copied document is shaped. Data per program; the flow below never asks which program it is serving. */
type ShareTarget = {
  sessions: string;
  entries: string;
  session(teamId: string, uid: string, source: Session, newId: string, entryIds: string[], nowMs: number): Record<string, unknown>;
  entry(teamId: string, uid: string, source: DocumentData, sessionId: string, nowMs: number): Record<string, unknown>;
};

const SESSION_FIELDS = ["scoutName", "seasonId", "mode", "difficulty", "libraryMatchId", "eventCode", "alliance", "robots", "status", "completedRobots", "accuracy", "scoutedTotal", "penaltyPoints", "officialScore", "platform", "flags", "excluded", "startedAt", "finishedAt"] as const;

function sessionPatch(source: Session, entryIds: string[]): Partial<PracticeSession> {
  const patch: Record<string, unknown> = {};
  for (const key of SESSION_FIELDS) if (source[key] !== undefined) patch[key] = source[key];
  patch.entryIds = entryIds;
  patch.lobbyId = null;
  patch.pairId = null;
  return patch as Partial<PracticeSession>;
}

function entryInput(source: DocumentData, sessionId: string): SaveEntryInput {
  const { uid: _uid, teamId: _teamId, submittedAt: _submittedAt, excluded: _excluded, autoFlags: _a, manualFlags: _m, accuracy: _acc, id: _id, ...rest } = source;
  void [_uid, _teamId, _submittedAt, _excluded, _a, _m, _acc, _id];
  return { ...(rest as unknown as SaveEntryInput), source: "practice", sessionId };
}

const ROOT_TARGET: ShareTarget = {
  sessions: "practiceSessions",
  entries: "scouting",
  session(teamId, uid, source, _newId, entryIds, nowMs) {
    const patch = sessionPatch(source, entryIds);
    // The CS-compatible fields come from the patch alone (the library match context is not kept in a private session), so the app reads the copy as it reads any session.
    return { teamId, uid, kind: "solo", scoutId: uid, isLivePracticeScouting: false, timestamp: nowMs, createdAt: FieldValue.serverTimestamp(), ...patch, ...practicePatchToCsFields(patch, {}) };
  },
  entry(teamId, uid, source, sessionId, nowMs) {
    const input = entryInput(source, sessionId);
    const draft = {
      id: "",
      teamId,
      uid,
      source: "practice",
      mode: input.mode ?? null,
      formId: input.formId,
      formVersion: input.formVersion,
      scoutName: input.scoutName,
      eventCode: normalizeEventKey(input.eventCode),
      matchType: input.matchType,
      matchNumber: input.matchNumber,
      teamNumber: input.teamNumber,
      values: input.values,
      score: input.score,
      ...(input.scored === false ? { scored: false as const } : {}),
      comments: input.comments,
      ...(input.stickyNotes && input.stickyNotes.length > 0 ? { stickyNotes: input.stickyNotes } : {}),
      alliance: null,
      submittedAt: typeof source.submittedAt === "string" ? source.submittedAt : new Date(nowMs).toISOString(),
      excluded: false,
      autoFlags: [],
      manualFlags: [],
      accuracy: null,
      sessionId,
      libraryMatchId: input.libraryMatchId ?? null,
    } as ScoutEntry;
    const doc = scoutEntryToCsDoc(draft, undefined, { actorUid: uid, now: nowMs }) as Record<string, unknown>;
    for (const key of Object.keys(doc)) if (doc[key] === undefined) delete doc[key];
    return doc;
  },
};

const NAMESPACED_TARGET: ShareTarget = {
  sessions: "practiceSessions",
  entries: "scoutEntries",
  session(teamId, uid, source, _newId, entryIds, nowMs) {
    return { ...ftcSessionStub(teamId, uid, "solo", () => FieldValue.serverTimestamp(), typeof source.startedAt === "string" ? source.startedAt : new Date(nowMs).toISOString()), ...ftcSessionPatch(sessionPatch(source, entryIds)) };
  },
  entry(teamId, uid, source, sessionId, nowMs) {
    const submittedAt = typeof source.submittedAt === "string" ? source.submittedAt : new Date(nowMs).toISOString();
    return ftcScoutEntryDoc(teamId, uid, entryInput(source, sessionId), () => FieldValue.serverTimestamp(), submittedAt);
  },
};

/** Each program's team collections and document shapes, by program id. */
export const SHARE_TARGETS: Record<ProgramId, ShareTarget> = { frc: ROOT_TARGET, ftc: NAMESPACED_TARGET };

const digest = (uid: string) => createHash("sha1").update(uid).digest("hex").slice(0, 8);
/** The id a private document gets on the team: stable, so a second run overwrites the same document, and scoped to the person so two people's ids can never clash. */
export const copiedId = (privateId: string, uid: string): string => `${privateId}-${digest(uid)}`;

type Marker = { sharedSessions?: number; sharedEntries?: number; sharedTo?: string; sharedAtMs?: number; dismissed?: boolean };

export async function sharePractice(db: Firestore, caller: Actor, input: { program?: unknown }, nowMs: number = Date.now(), limits: { budget?: number; batch?: number } = {}): Promise<FlowResult> {
  const budget = limits.budget ?? RUN_WRITE_BUDGET;
  const batchSize = limits.batch ?? BATCH_SIZE;
  return runFlow(async () => {
    if (!(await getMembershipsEnabled(db, nowMs))) throw new MembershipError(404, "memberships_disabled", "Not found.");
    const parsed = parseProgram(input.program);
    if (!parsed.ok) throw new MembershipError(parsed.status, parsed.code, parsed.error);
    const program = parsed.program;
    const limit = await consumeRateLimit(db, `share-practice_${caller.uid}`, 60, HOUR_MS, nowMs);
    if (!limit.allowed) throw new MembershipError(429, "rate_limited", "Too many attempts. Try again in a while.");

    // The team is the one on the person's own user document in this program: a person with none has nothing to share it with.
    const user = (await db.doc(`${programPath(program, "users")}/${caller.uid}`).get()).data();
    const teamId = typeof user?.teamId === "string" ? user.teamId.trim() : "";
    if (!teamId) return flowFail(409, "no_team", "Join a team first: practice is shared with the team you are on.");

    const target = SHARE_TARGETS[program];
    const root = `${programPath(program, "personalPractice")}/${caller.uid}`;
    const markerRef = db.doc(`${root}/state/share`);
    const marker = ((await markerRef.get()).data() ?? {}) as Marker;
    if (marker.sharedTo && marker.sharedTo !== teamId) return flowFail(409, "already_shared", "You already shared your practice with another team.");

    const [sessionSnap, entrySnap] = await Promise.all([db.collection(`${root}/sessions`).get(), db.collection(`${root}/entries`).get()]);
    const sessions: Session[] = sessionSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Session).filter((s) => s.status === "completed").sort((a, b) => a.id.localeCompare(b.id));
    const entriesBySession = new Map<string, { id: string; data: DocumentData }[]>();
    for (const d of entrySnap.docs) {
      const sessionId = d.data().sessionId;
      if (typeof sessionId === "string") entriesBySession.set(sessionId, [...(entriesBySession.get(sessionId) ?? []), { id: d.id, data: d.data() }]);
    }
    const sessionIds = new Set(sessions.map((s) => s.id));
    const entries = [...entriesBySession].filter(([sid]) => sessionIds.has(sid)).flatMap(([sid, list]) => list.map((e) => ({ ...e, sessionId: sid }))).sort((a, b) => a.id.localeCompare(b.id));

    const doneSessions = Math.min(marker.sharedSessions ?? 0, sessions.length);
    const doneEntries = Math.min(marker.sharedEntries ?? 0, entries.length);
    const total = sessions.length + entries.length;
    const teamSessions = programPath(program, target.sessions);
    const teamEntries = programPath(program, target.entries);

    let writes = 0;
    let copiedSessions = doneSessions;
    let copiedEntries = doneEntries;
    // Entries first, so a session that points at its entries never exists before they do; sessions after. (Order within each is by id: the count already done is the cursor.)
    const queue: { ref: ReturnType<Firestore["doc"]>; data: Record<string, unknown>; kind: "entry" | "session" }[] = [];
    for (const e of entries.slice(doneEntries)) {
      const newSession = copiedId(e.sessionId, caller.uid);
      queue.push({ ref: db.doc(`${teamEntries}/${copiedId(e.id, caller.uid)}`), data: target.entry(teamId, caller.uid, e.data, newSession, nowMs), kind: "entry" });
    }
    for (const s of sessions.slice(doneSessions)) {
      const entryIds = (entriesBySession.get(s.id) ?? []).map((e) => copiedId(e.id, caller.uid));
      queue.push({ ref: db.doc(`${teamSessions}/${copiedId(s.id, caller.uid)}`), data: target.session(teamId, caller.uid, s, copiedId(s.id, caller.uid), entryIds, nowMs), kind: "session" });
    }

    const run = queue.slice(0, budget);
    for (let i = 0; i < run.length; i += batchSize) {
      const batch = db.batch();
      const chunk = run.slice(i, i + batchSize);
      for (const item of chunk) batch.set(item.ref, item.data);
      await batch.commit();
      for (const item of chunk) {
        if (item.kind === "entry") copiedEntries++;
        else copiedSessions++;
      }
      writes += chunk.length;
    }

    const done = copiedSessions >= sessions.length && copiedEntries >= entries.length;
    await markerRef.set({ ...marker, sharedSessions: copiedSessions, sharedEntries: copiedEntries, sharedTo: teamId, ...(done ? { sharedAtMs: nowMs } : {}) }, { merge: true });
    return { status: 200, body: { ok: true, done, copiedSessions, copiedEntries, writes, remaining: Math.max(0, total - copiedSessions - copiedEntries), total } };
  });
}
