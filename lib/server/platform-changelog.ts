import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { platformAuditDoc } from "@/lib/server/audit";
import { fail, type RouteResult, type Viewer } from "@/lib/server/platform-route";
import { describeErrors, entryFromDoc, parseEntryInput, sortEntries, type EntryInput, type PlatformEntry, type PlatformStatus } from "@/lib/platform-changelog/model";

// The platform changelog's server logic (Session 7): `platformChangelog/{entryId}`, Admin SDK only. Times are epoch milliseconds (plain values,
// like the old app's), `rev` counts saves so two edits cannot overwrite each other. Every write records one `platformAuditLog` entry in the
// same transaction. Nothing here touches an existing collection.

export const PLATFORM_CHANGELOG = "platformChangelog";
const ID = /^[A-Za-z0-9_-]{1,120}$/;

/** The JSON a client receives for an entry (`PlatformEntry` is already plain data). */
export const entryJson = (e: PlatformEntry): PlatformEntry => e;

/**
 * The feed: published entries for everyone, plus drafts only when the caller is the platform owner AND asked for them. Entries are sorted
 * (current newest first, legacy below). Never filtered by team or program: the page filters by the tags, so "Show all programs" needs no refetch.
 */
export async function listFeed(db: Firestore, viewer: Viewer, wantDrafts: boolean): Promise<RouteResult> {
  const snap = await db.collection(PLATFORM_CHANGELOG).get();
  const includeDrafts = viewer.isOwner && wantDrafts;
  const entries = sortEntries(snap.docs.map((d) => entryFromDoc(d.id, d.data() as Record<string, unknown>)).filter((e) => includeDrafts || e.status === "published"));
  return { status: 200, body: { ok: true, entries: entries.map(entryJson), isOwner: viewer.isOwner }, headers: { "Cache-Control": "private, no-store" } };
}

const auditDetails = (id: string, e: Pick<PlatformEntry, "title" | "version">, extra: Record<string, unknown> = {}) => ({ entryId: id, title: e.title, version: e.version, ...extra });

type Write = { kind: "create"; input: unknown; status: PlatformStatus } | { kind: "update"; id: unknown; input: unknown; expectedRev: unknown; status?: PlatformStatus } | { kind: "status"; id: unknown; expectedRev: unknown; status: PlatformStatus } | { kind: "delete"; id: unknown; expectedRev: unknown };

/** Applies one owner write. Validation first (400), then one transaction (404, 409 with the current entry, or the write and its audit entry). */
export async function applyWrite(db: Firestore, owner: Viewer, write: Write, nowMs: number = Date.now()): Promise<RouteResult> {
  const actor = { uid: owner.uid, name: owner.name };

  if (write.kind === "create") {
    const parsed = parseEntryInput(write.input);
    if (!parsed.ok) return fail(400, "invalid_input", describeErrors(parsed.errors), { errors: parsed.errors });
    const ref = db.collection(PLATFORM_CHANGELOG).doc();
    const doc = docFor(parsed.value, write.status, { createdBy: owner.uid, createdAt: nowMs, publishedAt: write.status === "published" ? nowMs : null, rev: 1, nowMs, legacy: false });
    await db.runTransaction(async (tx) => {
      tx.set(ref, doc);
      tx.set(db.collection("platformAuditLog").doc(), platformAuditDoc(write.status === "published" ? "publish-platform-changelog-entry" : "create-platform-changelog-entry", actor, auditDetails(ref.id, parsed.value, { status: write.status, items: parsed.value.items.length })));
    });
    return { status: 200, body: { ok: true, entry: entryJson(entryFromDoc(ref.id, doc)) } };
  }

  if (typeof write.id !== "string" || !ID.test(write.id)) return fail(400, "invalid_input", "Missing or invalid entry id.");
  if (typeof write.expectedRev !== "number" || !Number.isInteger(write.expectedRev) || write.expectedRev < 0) return fail(400, "invalid_input", "Missing the revision the edit started from.");
  const expectedRev = write.expectedRev;
  const id = write.id;
  const parsedInput = write.kind === "update" ? parseEntryInput(write.input) : null;
  if (parsedInput && !parsedInput.ok) return fail(400, "invalid_input", describeErrors(parsedInput.errors), { errors: parsedInput.errors });
  const ref = db.collection(PLATFORM_CHANGELOG).doc(id);

  return db.runTransaction(async (tx): Promise<RouteResult> => {
    const snap = await tx.get(ref);
    if (!snap.exists) return fail(404, "not_found", "That entry no longer exists.");
    const current = entryFromDoc(id, snap.data() as Record<string, unknown>);
    // A stale editor never overwrites: it is told, and given what is stored now.
    if (current.rev !== expectedRev) return fail(409, "conflict", "Someone else changed this entry first. Reload it and try again.", { current: entryJson(current) });

    if (write.kind === "delete") {
      tx.delete(ref);
      tx.set(db.collection("platformAuditLog").doc(), platformAuditDoc("delete-platform-changelog-entry", actor, auditDetails(id, current, { status: current.status })));
      return { status: 200, body: { ok: true, deleted: id } };
    }

    const input: EntryInput = parsedInput && parsedInput.ok ? parsedInput.value : { title: current.title, version: current.version, date: current.date, programs: current.programs, items: current.items };
    const status: PlatformStatus = write.status ?? current.status;
    // publishedAt is set when an entry first goes live and kept through later edits (a typo fix never lights the dot again); unpublishing clears it.
    const publishedAt = status === "published" ? (current.status === "published" && current.publishedAtMs !== null ? current.publishedAtMs : nowMs) : null;
    const doc = docFor(input, status, { createdBy: current.createdBy, createdAt: current.createdAtMs ?? nowMs, publishedAt, rev: current.rev + 1, nowMs, legacy: current.legacy });
    tx.set(ref, doc);
    const action = status !== current.status ? (status === "published" ? "publish-platform-changelog-entry" : "unpublish-platform-changelog-entry") : "edit-platform-changelog-entry";
    tx.set(db.collection("platformAuditLog").doc(), platformAuditDoc(action, actor, auditDetails(id, input, { status, items: input.items.length, rev: doc.rev })));
    return { status: 200, body: { ok: true, entry: entryJson(entryFromDoc(id, doc)) } };
  });
}

type DocExtras = { createdBy: string; createdAt: number; publishedAt: number | null; rev: number; nowMs: number; legacy: boolean };

/** The stored shape (documented in docs/SESSION7_RESULTS.md). `legacy` is only ever carried over from an imported entry, never set by a client. */
function docFor(input: EntryInput, status: PlatformStatus, x: DocExtras) {
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
  };
}
