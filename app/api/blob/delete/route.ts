import { NextResponse } from "next/server";
import { tokenForBlobUrl } from "@/lib/blob/stores";
import { classifyBlobError, STORE_ACCESS_MISMATCH, storeAccessMismatchText } from "@/lib/blob/errors";
import { del } from "@vercel/blob";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { authorizeBlobDelete, blobUserFromAppDoc, blobUserFromCsDoc } from "@/lib/server/blob-auth";
import { PROGRAMS } from "@/config/programs";
import { DEFAULT_PROGRAM, isProgramId } from "@/config/programs/types";
import type { CsUserDoc } from "@/data/cs/types";

const MAX_BODY_BYTES = 4 * 1024;

const json = (body: Record<string, unknown>, status: number) => NextResponse.json({ ok: false, ...body }, { status });

/**
 * Deletes one form photo. Body: { url, program? }. Only the uploader or an admin/owner of the same team may (see authorizeBlobDelete).
 * Blob URLs are public, so the URL alone proves nothing: the check is on the Firebase token and the path's team and uid tag.
 */
export async function POST(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) return json({ code: "not-signed-in", error: "Not signed in." }, 401);
  const db = getAdminFirestore();
  if (!db) return json({ code: "not-configured", error: "Server isn't configured." }, 503);

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ code: "too-large", error: "That's too large." }, 413);
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return json({ code: "too-large", error: "That's too large." }, 413);
  let url: unknown;
  let programId: unknown;
  try {
    const body = JSON.parse(raw) as { url?: unknown; program?: unknown } | null;
    url = body?.url;
    programId = body?.program;
  } catch {
    url = undefined;
  }
  // the namespace the caller's profile is read from: the program the delete names (the default program when it names none)
  const program = isProgramId(programId) ? programId : DEFAULT_PROGRAM;
  const prefix = PROGRAMS[program].firestorePrefix;
  if (typeof url !== "string" || !url) return json({ code: "bad-request", error: "That request couldn't be read." }, 400);

  // The token is chosen by the URL's host (public store, or the legacy private one for older files); any other host is refused, and a store whose variable is
  // unset is a 503 naming it. One store's token is never used on another store's file.
  const choice = tokenForBlobUrl(url);
  if (!choice.ok) return json({ code: choice.code, error: choice.message }, choice.status);

  const decision = await authorizeBlobDelete({
    uid: decoded.uid,
    url,
    deps: {
      getUser: async (id) => {
        const snap = await db.doc(`${prefix}users/${id}`).get();
        if (!snap.exists) return null;
        const data = (snap.data() ?? {}) as Record<string, unknown>;
        return prefix === "" ? blobUserFromCsDoc(id, data as CsUserDoc) : blobUserFromAppDoc(data);
      },
    },
  });
  if (!decision.ok) return json({ code: decision.code, error: decision.message }, decision.status);

  try {
    // Delete by the pathname we validated, not the caller's URL string.
    await del(decision.pathname, { token: choice.token });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("blob delete failed:", err instanceof Error ? err.message : err);
    if (classifyBlobError(err) === STORE_ACCESS_MISMATCH) return json({ code: STORE_ACCESS_MISMATCH, error: storeAccessMismatchText() }, 502);
    return json({ code: "error", error: "Something went wrong." }, 500);
  }
}
