/**
 * The FTC match library under `programs/ftc/`: `libraryEvents` and `libraryMatches`. Same conventions as `read.ts` / `write.ts`: every path is built by
 * `lib/firebase/paths.ts` with an explicit program, a failed read is reported and handed to `onError` (never an empty list), and a failed write is
 * reported and rethrown. Pure rules (ids, validation, the import plan, converters) are in `lib/library/ftc-library.ts`.
 *
 * Queries are equality-only (no orderBy, no new index) and never collection-group. A read is TWO queries, because the collection holds the shared
 * API-imported docs (`origin == 'api'`, public competition data) and a team's own hand-made docs (`teamId == <mine>`), and the rules can prove a list query
 * only from its constraints: `origin == 'api'` for the first, `teamId == <mine>` for the second (see the `programs/ftc` block of firestore.rules).
 */
import { getDoc, getDocs, onSnapshot, query, where, writeBatch, type Query, type Unsubscribe, type WriteBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { programCollection, programDoc } from "@/lib/firebase/paths";
import { buildAuditEntry, newAuditLogRef } from "@/lib/audit-log";
import { reportFirestoreError, type FirestoreFailure } from "@/lib/firestore-errors";
import { clearReadFailure, recordReadFailure } from "@/lib/read-failures";
import { createMergedFeed, ftcDocToLibraryEvent, ftcDocsToLibraryMatches, ftcMatchId, generateFtcManualEventCode, planScheduleImport } from "@/lib/ftc/library";
import { LIBRARY_BATCH_SIZE, buildManualMatchDoc, chunk, type CreateEventResult, type ImportSummary, type LibraryActor, type LibraryEventRef, type LibraryWrite, type ScheduleMatchInput, type UpsertResult } from "@/lib/library/schedule";
import { validateEventForm, type EventFormInput } from "@/lib/library/event-form";
import { validateEventCode } from "@/lib/library/ids";
import type { EventMatch } from "@/lib/events/types";
import type { LibraryEvent } from "@/lib/library/store";
import type { LibraryMatch } from "@/lib/match-library";

const PROGRAM = "ftc" as const;
const MATCHES = "libraryMatches";
const EVENTS = "libraryEvents";

type Failure = (failure: FirestoreFailure) => void;
type Actor = LibraryActor;

const matchesRef = () => programCollection(db, PROGRAM, MATCHES);
const eventsRef = () => programCollection(db, PROGRAM, EVENTS);

/** The two queries every library read is made of: the shared API docs, and this team's own hand-made docs. */
function twoQueries(base: ReturnType<typeof matchesRef>, teamId: string, filters: [string, string | boolean][]): { q: Query; path: string }[] {
  const eq = filters.map(([field, value]) => where(field, "==", value));
  const label = (extra: string) => `${base.path} where ${[...filters.map(([f, v]) => `${f} == ${String(v)}`), extra].join(", ")}`;
  return [
    { q: query(base, ...eq, where("origin", "==", "api")), path: label("origin == api") },
    { q: query(base, ...eq, where("teamId", "==", teamId)), path: label(`teamId == ${teamId}`) },
  ];
}

function watchMerged<T>(context: string, queries: { q: Query; path: string }[], convert: (rows: { id: string; data: Record<string, unknown> }[]) => T, onData: (value: T) => void, onError: Failure): Unsubscribe {
  const fail = (path: string) => (err: unknown) => {
    const failure = reportFirestoreError(context, err, path);
    recordReadFailure(failure);
    onError(failure);
  };
  const feed = createMergedFeed(
    queries.length,
    (rows) => {
      for (const { path } of queries) clearReadFailure(context, path);
      onData(convert(rows));
    },
    (err) => fail(queries[0].path)(err)
  );
  const stops = queries.map(({ q, path }, i) =>
    onSnapshot(
      q,
      (snap) => feed.update(i, snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))),
      (err) => {
        reportFirestoreError(context, err, path);
        feed.fail(err);
      }
    )
  );
  return () => stops.forEach((stop) => stop());
}

// --- reads -----------------------------------------------------------------------------------------------

/** The events a team can see: the shared API ones and its own hand-made ones, optionally of one season. */
export function subscribeLibraryEvents(teamId: string, seasonId: string | null, onData: (events: LibraryEvent[]) => void, onError: Failure): Unsubscribe {
  const filters: [string, string][] = seasonId ? [["seasonId", seasonId]] : [];
  return watchMerged("Couldn't load the library events", twoQueries(eventsRef(), teamId, filters), (rows) => rows.map((r) => ftcDocToLibraryEvent(r.id, r.data)), onData, onError);
}

export type LibraryMatchFilter = { eventCode?: string | null; seasonId?: string | null; includeUnpublished: boolean };

/**
 * Library matches of one event, one season, or all (a scout asks for published only: the rules need `published == true` in the query; an admin may
 * include drafts). `unreadable` counts stored docs that could not be identified.
 */
export function subscribeLibraryMatches(teamId: string, filter: LibraryMatchFilter, onData: (matches: LibraryMatch[], unreadable: number) => void, onError: Failure): Unsubscribe {
  const filters: [string, string | boolean][] = [];
  if (filter.eventCode) filters.push(["eventCode", filter.eventCode]);
  if (filter.seasonId) filters.push(["seasonId", filter.seasonId]);
  if (!filter.includeUnpublished) filters.push(["published", true]);
  return watchMerged("Couldn't load the library matches", twoQueries(matchesRef(), teamId, filters), ftcDocsToLibraryMatches, ({ matches, unreadable }) => onData(matches, unreadable), onError);
}

async function readEventMatches(event: Pick<LibraryEvent, "eventCode" | "origin">, teamId: string): Promise<Map<string, Record<string, unknown>>> {
  const base = [where("eventCode", "==", event.eventCode)];
  const q = event.origin === "api" ? query(matchesRef(), ...base, where("origin", "==", "api")) : query(matchesRef(), ...base, where("teamId", "==", teamId));
  try {
    const snap = await getDocs(q);
    return new Map(snap.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));
  } catch (err) {
    reportFirestoreError("Couldn't read the event's matches", err, `${matchesRef().path} where eventCode == ${event.eventCode}`);
    throw err;
  }
}

// --- writing in batches ------------------------------------------------------------------------------------

const audit = (batch: WriteBatch, actor: Actor, target: Record<string, unknown>, before: unknown = null, after: unknown = null) =>
  batch.set(newAuditLogRef(PROGRAM), buildAuditEntry(actor.teamId, actor.uid, actor.name, "edit-match-library", target, before, after));

type Op = { kind: "set"; id: string; data: Record<string, unknown>; merge: boolean } | { kind: "update"; id: string; data: Record<string, unknown> } | { kind: "delete"; id: string };

/** Commits operations on `libraryMatches` in batches of LIBRARY_BATCH_SIZE; the audit entry rides in the first one. Re-running the same ops is harmless. */
async function commitMatchOps(actor: Actor, ops: Op[], auditTarget: Record<string, unknown>, auditAfter: unknown = null, extra?: (batch: WriteBatch) => void): Promise<number> {
  const groups = ops.length === 0 ? [[]] : chunk(ops, LIBRARY_BATCH_SIZE);
  for (let i = 0; i < groups.length; i++) {
    const batch = writeBatch(db);
    if (i === 0) {
      extra?.(batch);
      audit(batch, actor, auditTarget, null, auditAfter);
    }
    for (const op of groups[i]) {
      const ref = programDoc(db, PROGRAM, MATCHES, op.id);
      if (op.kind === "set") batch.set(ref, op.data, { merge: op.merge });
      else if (op.kind === "update") batch.update(ref, op.data);
      else batch.delete(ref);
    }
    try {
      await batch.commit();
    } catch (err) {
      reportFirestoreError("Couldn't save the library matches", err, matchesRef().path);
      throw err;
    }
  }
  return groups.length;
}

// --- events -------------------------------------------------------------------------------------------------------

/** Creates a hand-made event owned by the actor's team. Needs no API key. */
export async function createManualEvent(actor: Actor, input: EventFormInput, seasonId: string, existingEvents: readonly LibraryEvent[]): Promise<CreateEventResult> {
  const checked = validateEventForm(input);
  if (!checked.ok) return { ok: false, error: "Fix the highlighted fields.", fieldErrors: checked.errors };
  const taken = new Set(existingEvents.map((e) => e.eventCode));
  const custom = input.code.trim() !== "";
  let code: string;
  if (custom) {
    const result = validateEventCode(input.code, taken);
    if (!result.ok) return { ok: false, error: result.error, fieldErrors: { code: result.error } };
    code = result.code;
  } else {
    code = generateFtcManualEventCode(input.name, taken);
  }
  const now = new Date().toISOString();
  const event: LibraryEvent = { eventCode: code, eventName: input.name.trim(), seasonId, origin: "manual", date: input.date.trim() || null, sourceUrl: input.sourceUrl.trim() || null, defaultVideoUrl: null, createdBy: actor.uid, createdAt: now, updatedAt: now, teamId: actor.teamId };
  const batch = writeBatch(db);
  batch.set(programDoc(db, PROGRAM, EVENTS, code), event);
  audit(batch, actor, { op: "create-event", eventCode: code }, null, { eventName: event.eventName, seasonId });
  try {
    await batch.commit();
  } catch (err) {
    reportFirestoreError("Couldn't create the library event", err, `${eventsRef().path}/${code}`);
    return { ok: false, error: "Couldn't save the event. Check your connection, and that the code isn't already used by another team." };
  }
  return { ok: true, event };
}

/** Deletes a hand-made event and every match under it (batched). Imported events cannot be deleted (the rules refuse it); unpublish them instead. */
export async function deleteManualEvent(actor: Actor, event: LibraryEvent): Promise<number> {
  if (event.origin !== "manual") throw new Error("Only hand-made events can be deleted. Unpublish an imported event instead.");
  const existing = await readEventMatches(event, actor.teamId);
  const ids = [...existing.keys()];
  const eventRef = programDoc(db, PROGRAM, EVENTS, event.eventCode);
  const groups = chunk(ids, LIBRARY_BATCH_SIZE);
  for (let i = 0; i < groups.length; i++) {
    await commitMatchOps(actor, groups[i].map((id) => ({ kind: "delete" as const, id })), i === 0 ? { op: "delete-matches", eventCode: event.eventCode, count: ids.length, matchIds: ids.slice(0, 50) } : { op: "delete-matches", eventCode: event.eventCode, continued: true });
  }
  const batch = writeBatch(db);
  batch.delete(eventRef);
  audit(batch, actor, { op: "delete-event", eventCode: event.eventCode }, { eventName: event.eventName }, null);
  try {
    await batch.commit();
  } catch (err) {
    reportFirestoreError("Couldn't delete the library event", err, eventRef.path);
    throw err;
  }
  return ids.length;
}

// --- matches --------------------------------------------------------------------------------------------------------

/** Creates or replaces hand-made matches of one event of the actor's team. A match listed twice keeps the last one. */
export async function upsertManualMatches(actor: Actor, event: LibraryEvent, matches: readonly ScheduleMatchInput[]): Promise<UpsertResult> {
  const existing = await readEventMatches(event, actor.teamId);
  const byId = new Map<string, ScheduleMatchInput>();
  for (const m of matches) byId.set(ftcMatchId(event.eventCode, m.matchType, m.matchNumber), m);
  const now = new Date().toISOString();
  const ref: LibraryEventRef = { eventCode: event.eventCode, eventName: event.eventName, seasonId: event.seasonId };
  const ops: Op[] = [];
  let created = 0;
  let updated = 0;
  for (const [id, match] of byId) {
    const current = existing.get(id) ?? null;
    ops.push({ kind: "set", id, merge: false, data: buildManualMatchDoc(match, ref, current, actor.teamId, actor.uid, now) });
    if (current) updated++;
    else created++;
  }
  await commitMatchOps(actor, ops, { op: "upsert-matches", eventCode: event.eventCode }, { created, updated });
  return { created, updated, ids: [...byId.keys()] };
}

/** Publishes or unpublishes matches (each match only carries `published`). */
export function setMatchesPublished(actor: Actor, ids: readonly string[], published: boolean): Promise<number> {
  const now = new Date().toISOString();
  return commitMatchOps(actor, ids.map((id) => ({ kind: "update" as const, id, data: { published, updatedAt: now } })), { op: published ? "publish-matches" : "unpublish-matches", count: ids.length, matchIds: ids.slice(0, 50) }, { published });
}

/** Deletes hand-made matches (the rules refuse to delete an imported one). */
export function deleteManualMatches(actor: Actor, ids: readonly string[]): Promise<number> {
  return commitMatchOps(actor, ids.map((id) => ({ kind: "delete" as const, id })), { op: "delete-matches", count: ids.length, matchIds: ids.slice(0, 50) });
}

// --- the schedule import ------------------------------------------------------------------------------------------------

/**
 * Writes an imported schedule (already fetched server-side) under stable ids, so importing twice updates in place. Creates the event doc (origin api) the
 * first time. A code that belongs to a hand-made event is refused. Batched by 400; safe to re-run after a partial failure.
 */
export async function importSchedule(actor: Actor, args: { event: LibraryEventRef; matches: readonly EventMatch[] }): Promise<ImportSummary> {
  const { event } = args;
  const eventRef = programDoc(db, PROGRAM, EVENTS, event.eventCode);
  let eventExists = false;
  try {
    const snap = await getDoc(eventRef);
    eventExists = snap.exists();
    if (snap.exists() && snap.data().origin === "manual") throw new Error(`${event.eventCode} is a hand-made event: it can't be imported over.`);
  } catch (err) {
    if ((err as { code?: string })?.code === "permission-denied") throw new Error(`${event.eventCode} is already used by another team's hand-made event.`);
    throw err;
  }
  const existing = await readEventMatches({ eventCode: event.eventCode, origin: "api" }, actor.teamId);
  const now = new Date().toISOString();
  const plan = planScheduleImport({ event, matches: args.matches, existing, uid: actor.uid, now });
  const ops: Op[] = plan.writes.map((w: LibraryWrite) => ({ kind: "set", id: w.id, data: w.data, merge: w.merge }));
  const batches = await commitMatchOps(actor, ops, { op: "import-event", eventCode: event.eventCode, seasonId: event.seasonId }, { created: plan.created, updated: plan.updated, skippedManual: plan.skippedManual.length, skippedNoTeams: plan.skippedNoTeams }, (batch) => {
    if (eventExists) batch.update(eventRef, { eventName: event.eventName, updatedAt: now });
    else batch.set(eventRef, { eventCode: event.eventCode, eventName: event.eventName, seasonId: event.seasonId, origin: "api", date: null, sourceUrl: null, defaultVideoUrl: null, createdBy: actor.uid, createdAt: now, updatedAt: now });
  });
  return { eventCode: event.eventCode, eventName: event.eventName, created: plan.created, updated: plan.updated, skippedManual: plan.skippedManual, skippedNoTeams: plan.skippedNoTeams, batches };
}
