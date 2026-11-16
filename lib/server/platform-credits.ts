import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { platformAuditDoc } from "@/lib/server/audit";
import { fail, type RouteResult, type Viewer } from "@/lib/server/platform-route";
import { sanitizeSections, type CreditSection } from "@/lib/credits/ops";
import { DEFAULT_CREDITS } from "@/lib/credits/seed";
import { parseCreditsInput } from "@/lib/credits/validate";

// The one set of Credits (Session 7): `platformCredits/main`, Admin SDK only. `version` counts saves (starting at 1; no document means version 0
// and the built-in default). Reading and the owner's save both go through server routes; the rules catch-all keeps the document closed to clients.

export const PLATFORM_CREDITS_PATH = "platformCredits/main";

export type StoredCredits = { sections: CreditSection[]; version: number; updatedAtMs: number | null };

/** The stored credits, or null when none were saved yet (the page then shows the built-in default). */
export async function readCredits(db: Firestore): Promise<StoredCredits | null> {
  const snap = await db.doc(PLATFORM_CREDITS_PATH).get();
  if (!snap.exists) return null;
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  return {
    sections: sanitizeSections(data.sections),
    version: typeof data.version === "number" && Number.isInteger(data.version) ? data.version : 1,
    updatedAtMs: typeof data.updatedAt === "number" ? data.updatedAt : null,
  };
}

/** The public read: cached at the edge for a short time. Signed-out visitors included; it holds nothing private. */
export async function publicCredits(db: Firestore): Promise<RouteResult> {
  const credits = await readCredits(db);
  return { status: 200, body: { ok: true, credits }, headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" } };
}

/** The owner's own read for the editor: never cached, so the version it edits from is the stored one. */
export async function ownerCredits(db: Firestore): Promise<RouteResult> {
  const credits = await readCredits(db);
  return { status: 200, body: { ok: true, credits, defaults: DEFAULT_CREDITS }, headers: { "Cache-Control": "private, no-store" } };
}

type Save = { sections: unknown; expectedVersion: unknown; reset?: boolean };

/**
 * Saves the whole document. `expectedVersion` is the version the editor loaded (0 = nothing saved yet): a different stored version is a 409 with
 * what is stored now, so two owners can never silently overwrite each other. `reset` stores the built-in default (as the next version, so a stale
 * editor still conflicts) instead of the submitted sections.
 */
export async function saveCredits(db: Firestore, owner: Viewer, save: Save, nowMs: number = Date.now()): Promise<RouteResult> {
  if (typeof save.expectedVersion !== "number" || !Number.isInteger(save.expectedVersion) || save.expectedVersion < 0) return fail(400, "invalid_input", "Missing the version the edit started from.");
  const expected = save.expectedVersion;
  let sections: CreditSection[];
  if (save.reset) sections = DEFAULT_CREDITS;
  else {
    const parsed = parseCreditsInput(save.sections);
    if (!parsed.ok) return fail(400, "invalid_input", parsed.error);
    sections = parsed.sections;
  }
  const ref = db.doc(PLATFORM_CREDITS_PATH);
  return db.runTransaction(async (tx): Promise<RouteResult> => {
    const snap = await tx.get(ref);
    const stored = snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
    const version = stored ? (typeof stored.version === "number" ? stored.version : 1) : 0;
    if (version !== expected) return fail(409, "conflict", "Someone else changed the credits first. Reload them and try again.", { current: await currentOf(stored) });
    const next = version + 1;
    tx.set(ref, { sections, version: next, updatedAt: nowMs, updatedBy: owner.uid });
    tx.set(db.collection("platformAuditLog").doc(), platformAuditDoc("save-platform-credits", owner, { version: next, sections: sections.length, entries: sections.reduce((n, s) => n + s.entries.length, 0), reset: save.reset === true }));
    return { status: 200, body: { ok: true, credits: { sections, version: next, updatedAtMs: nowMs } satisfies StoredCredits } };
  });
}

async function currentOf(stored: Record<string, unknown> | null): Promise<StoredCredits | null> {
  if (!stored) return null;
  return { sections: sanitizeSections(stored.sections), version: typeof stored.version === "number" ? stored.version : 1, updatedAtMs: typeof stored.updatedAt === "number" ? stored.updatedAt : null };
}
