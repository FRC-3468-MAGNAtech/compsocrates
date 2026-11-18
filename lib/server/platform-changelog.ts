import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { platformAuditDoc } from "@/lib/server/audit";
import { fail, type RouteResult, type Viewer } from "@/lib/server/platform-route";
import { describeErrors, entryFromDoc, parseEntryInput, sortEntries, type EntryInput, type PlatformEntry, type PlatformStatus } from "@/lib/platform-changelog/model";
import { checkTimes, parseTimePatch, type EntryTimes } from "@/lib/platform-changelog/times";

// The platform changelog's server logic (Session 7): `platformChangelog/{entryId}`, Admin SDK only. Times are epoch milliseconds (plain values,
// like the old app's), `rev` counts saves so two edits cannot overwrite each other. Every write records one `platformAuditLog` entry in the
// same transaction. Nothing here touches an existing collection.

export const PLATFORM_CHANGELOG = "platformChangelog";
const ID = /^[A-Za-z0-9_-]{1,120}$/;

/** The JSON a client receives for an entry (`PlatformEntry` is already plain data). */
export const entryJson = (e: PlatformEntry): PlatformEntry => e;

const FEED_TTL_MS = 60_000;
let feedCache: { at: number; entries: PlatformEntry[] } | null = null;

/** Forget the cached published feed (an owner write happened, or a test). */
export function invalidateFeedCache(): void {
  feedCache = null;
}

/**
 * The feed: published entries for everyone, plus drafts only when the caller is the platform owner AND asked for them. Entries are sorted
 * (current newest first, legacy below). Never filtered by team or program: the page filters by the tags, so "Show all programs" needs no refetch.
 */
export async function listFeed(db: Firestore, viewer: Viewer, wantDrafts: boolean, nowMs: number = Date.now()): Promise<RouteResult> {
  const includeDrafts = viewer.isOwner && wantDrafts;
  // The published feed is served from a 60 s per-instance copy (it is read by every shell load); the owner's draft view is always fresh, and every owner write below drops the copy.
  let entries: PlatformEntry[];
  if (!includeDrafts && feedCache && nowMs - feedCache.at < FEED_TTL_MS) {
    entries = feedCache.entries;
  } else {
    const snap = await db.collection(PLATFORM_CHANGELOG).get();
    entries = sortEntries(snap.docs.map((d) => entryFromDoc(d.id, d.data() as Record<string, unknown>)).filter((e) => includeDrafts || e.status === "published"));
    if (!includeDrafts) feedCache = { at: nowMs, entries };
  }
  return { status: 200, body: { ok: true, entries: entries.map(entryJson), isOwner: viewer.isOwner }, headers: { "Cache-Control": "private, no-store" } };
}

const auditDetails = (id: string, e: Pick<PlatformEntry, "title" | "version">, extra: Record<string, unknown> = {}) => ({ entryId: id, title: e.title, version: e.version, ...extra });

/** The owner's extra choices on an update (Session 9). All optional; an old client that sends none behaves as before, except that edits are recorded. */
export type UpdateOptions = {
  /** Time overrides: `{ postedAt?, editedAt? }`, a key absent = unchanged, null = clear (validated by `parseTimePatch`). */
  times?: unknown;
  /** false = "Don't record this edit": `editedAt` and `editedBy` are left as they are. Default: record. */
  recordEdit?: unknown;
  /** true = the owner unlocked a legacy entry's date and may change it. */
  dateUnlocked?: unknown;
};

type Write = ({ kind: "create"; input: unknown; status: PlatformStatus }) | ({ kind: "update"; id: unknown; input: unknown; expectedRev: unknown; status?: PlatformStatus } & UpdateOptions) | { kind: "status"; id: unknown; expectedRev: unknown; status: PlatformStatus } | { kind: "delete"; id: unknown; expectedRev: unknown };

const timesOf = (e: Pick<PlatformEntry, "postedAtMs" | "editedAtMs">): EntryTimes => ({ postedAt: e.postedAtMs ?? null, editedAt: e.editedAtMs ?? null });

/** Applies one owner write. Validation first (400), then one transaction (404, 409 with the current entry, or the write and its audit entry). */
export async function applyWrite(db: Firestore, owner: Viewer, write: Write, nowMs: number = Date.now()): Promise<RouteResult> {
  try {
    return await applyWriteInner(db, owner, write, nowMs);
  } finally {
    invalidateFeedCache(); // the next reader sees the change at once on this instance (other instances within 60 s)
  }
}

async function applyWriteInner(db: Firestore, owner: Viewer, write: Write, nowMs: number): Promise<RouteResult> {
  const actor = { uid: owner.uid, name: owner.name };

  if (write.kind === "create") {
    const parsed = parseEntryInput(write.input);
    if (!parsed.ok) return fail(400, "invalid_input", describeErrors(parsed.errors), { errors: parsed.errors });
    const ref = db.collection(PLATFORM_CHANGELOG).doc();
    const published = write.status === "published";
    // A new entry is current (never legacy), so its first publish is its posting: the server's clock, once.
    const doc = docFor(parsed.value, write.status, { createdBy: owner.uid, createdAt: nowMs, publishedAt: published ? nowMs : null, rev: 1, nowMs, legacy: false, postedAt: published ? nowMs : undefined });
    await db.runTransaction(async (tx) => {
      tx.set(ref, doc);
      tx.set(db.collection("platformAuditLog").doc(), platformAuditDoc(published ? "publish-platform-changelog-entry" : "create-platform-changelog-entry", actor, auditDetails(ref.id, parsed.value, { status: write.status, items: parsed.value.items.length, ...(published ? { times: { before: { postedAt: null, editedAt: null }, after: { postedAt: nowMs, editedAt: null } } } : {}) })));
    });
    return { status: 200, body: { ok: true, entry: entryJson(entryFromDoc(ref.id, doc)) } };
  }

  if (typeof write.id !== "string" || !ID.test(write.id)) return fail(400, "invalid_input", "Missing or invalid entry id.");
  if (typeof write.expectedRev !== "number" || !Number.isInteger(write.expectedRev) || write.expectedRev < 0) return fail(400, "invalid_input", "Missing the revision the edit started from.");
  const expectedRev = write.expectedRev;
  const id = write.id;
  const parsedInput = write.kind === "update" ? parseEntryInput(write.input) : null;
  if (parsedInput && !parsedInput.ok) return fail(400, "invalid_input", describeErrors(parsedInput.errors), { errors: parsedInput.errors });
  const timePatch = write.kind === "update" ? parseTimePatch(write.times) : null;
  if (timePatch && !timePatch.ok) return fail(400, "invalid_input", timePatch.error);
  const patch = timePatch && timePatch.ok ? timePatch.value : {};
  const ref = db.collection(PLATFORM_CHANGELOG).doc(id);

  return db.runTransaction(async (tx): Promise<RouteResult> => {
    const snap = await tx.get(ref);
    if (!snap.exists) return fail(404, "not_found", "That entry no longer exists.");
    const stored = snap.data() as Record<string, unknown>;
    const current = entryFromDoc(id, stored);
    // A stale editor never overwrites: it is told, and given what is stored now.
    if (current.rev !== expectedRev) return fail(409, "conflict", "Someone else changed this entry first. Reload it and try again.", { current: entryJson(current) });

    if (write.kind === "delete") {
      tx.delete(ref);
      tx.set(db.collection("platformAuditLog").doc(), platformAuditDoc("delete-platform-changelog-entry", actor, auditDetails(id, current, { status: current.status })));
      return { status: 200, body: { ok: true, deleted: id } };
    }

    const input: EntryInput = parsedInput && parsedInput.ok ? parsedInput.value : { title: current.title, version: current.version, date: current.date, programs: current.programs, items: current.items };
    // A legacy entry keeps its original date: only an owner who unlocked the field may change it. No save ever changes it otherwise.
    if (current.legacy && input.date !== current.date && !(write.kind === "update" && write.dateUnlocked === true)) {
      return fail(400, "date_locked", "This entry keeps its original date. Unlock the Date field to change it.");
    }
    const status: PlatformStatus = write.status ?? current.status;
    // publishedAt is set when an entry first goes live and kept through later edits (a typo fix never lights the dot again); unpublishing clears it.
    const publishedAt = status === "published" ? (current.status === "published" && current.publishedAtMs !== null ? current.publishedAtMs : nowMs) : null;

    // Posted (display only): the stored value, else (a current entry that is published and has never had the field) the moment it went live, once.
    // A key stored as null means the owner cleared it on purpose, so it is never refilled. A legacy entry is never given one automatically.
    const before = timesOf(current);
    let postedAt: number | null | undefined = stored.postedAt === undefined ? undefined : before.postedAt;
    if (patch.postedAt !== undefined) postedAt = patch.postedAt;
    else if (postedAt === undefined && status === "published" && !current.legacy) postedAt = publishedAt;
    // Edited: stamped by the server on a content save of an entry that is already public, unless "Don't record this edit"; an owner override wins.
    let editedAt = before.editedAt;
    let editedBy: string | undefined = current.editedBy || undefined;
    if (patch.editedAt !== undefined) {
      editedAt = patch.editedAt;
      editedBy = patch.editedAt === null ? undefined : owner.uid;
    } else if (write.kind === "update" && write.recordEdit !== false && current.status === "published" && status === "published") {
      editedAt = Math.max(nowMs, postedAt ?? 0);
      editedBy = owner.uid;
    }
    if (Object.keys(patch).length > 0) {
      const problem = checkTimes({ postedAt: postedAt ?? null, editedAt }, nowMs);
      if (problem) return fail(400, "invalid_input", problem);
    }

    const doc = docFor(input, status, { createdBy: current.createdBy, createdAt: current.createdAtMs ?? nowMs, publishedAt, rev: current.rev + 1, nowMs, legacy: current.legacy, postedAt, editedAt, editedBy });
    tx.set(ref, doc);
    const after: EntryTimes = { postedAt: postedAt ?? null, editedAt };
    const timesChanged = before.postedAt !== after.postedAt || before.editedAt !== after.editedAt;
    const action = status !== current.status ? (status === "published" ? "publish-platform-changelog-entry" : "unpublish-platform-changelog-entry") : "edit-platform-changelog-entry";
    tx.set(
      db.collection("platformAuditLog").doc(),
      platformAuditDoc(action, actor, auditDetails(id, input, { status, items: input.items.length, rev: doc.rev, ...(timesChanged ? { times: { before, after } } : {}), ...(input.date !== current.date ? { date: { before: current.date, after: input.date } } : {}) }))
    );
    return { status: 200, body: { ok: true, entry: entryJson(entryFromDoc(id, doc)) } };
  });
}

export type DocExtras = { createdBy: string; createdAt: number; publishedAt: number | null; rev: number; nowMs: number; legacy: boolean; postedAt?: number | null; editedAt?: number | null; editedBy?: string };

/**
 * The stored shape (documented in docs/SESSION7_RESULTS.md and docs/SESSION9_RESULTS.md). `legacy` is only ever carried over from an imported entry, never
 * set by a client. The Session 9 fields are written only when they have a value (`postedAt: null` is kept: it records that the owner cleared it), so a
 * document that never had them is written exactly as before.
 */
export function docFor(input: EntryInput, status: PlatformStatus, x: DocExtras) {
  return {
    title: input.title,
    version: input.version,
    date: input.date,
    status,
    programs: input.programs,
    items: input.items,
    legacy: x.legacy,
    createdBy: x.createdBy,
    createdAt: x.createdAt,
    updatedAt: x.nowMs,
    publishedAt: x.publishedAt,
    rev: x.rev,
    ...(x.postedAt !== undefined ? { postedAt: x.postedAt } : {}),
    ...(typeof x.editedAt === "number" ? { editedAt: x.editedAt } : {}),
    ...(x.editedBy ? { editedBy: x.editedBy } : {}),
  };
}
