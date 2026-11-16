import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { AVATAR_MAX_BYTES } from "@/lib/server/avatar-image";
import { avatarStoreHost, vercelAvatarStore } from "@/lib/server/avatar-blobs";
import { removeOwnAvatar, uploadAvatar } from "@/lib/server/avatar-service";
import { blobToken } from "@/lib/server/env";
import { serverSignInProblem, verifyBearerToken } from "@/lib/server/require-user";

// sharp needs Node (never Edge). The body is a few hundred KB (the browser downscales first); Vercel's own request limit is about 4.5 MB.
export const runtime = "nodejs";
export const maxDuration = 30;

const fail = (status: number, code: string, error: string) => NextResponse.json({ ok: false, code, error }, { status });

/** Reads the body up to `max` bytes; null when it is larger (it never buffers more than max + one chunk). */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

async function gate(request: Request) {
  const token = blobToken();
  if (!token) return { ok: false as const, response: fail(503, "not-configured", "Picture uploads aren't set up on this server: set BLOB_READ_WRITE_TOKEN.") };
  const decoded = await verifyBearerToken(request);
  if (!decoded) {
    const problem = serverSignInProblem();
    return { ok: false as const, response: problem ? fail(503, "server_not_configured", problem) : fail(401, "not-signed-in", "Not signed in.") };
  }
  const db = getAdminFirestore();
  if (!db) return { ok: false as const, response: fail(503, "server_not_configured", "Server isn't configured.") };
  return { ok: true as const, uid: decoded.uid, db, store: vercelAvatarStore(token) };
}

/** Upload your profile picture: the raw image bytes as the body. Re-encoded to a 512 px square WebP with no metadata; see lib/server/avatar-service.ts. */
export async function POST(request: Request) {
  const g = await gate(request);
  if (!g.ok) return g.response;
  if (Number(request.headers.get("content-length") ?? 0) > AVATAR_MAX_BYTES) return fail(413, "too-big", "That picture is too large. Try a smaller one.");
  const body = await readCapped(request, AVATAR_MAX_BYTES);
  if (!body) return fail(413, "too-big", "That picture is too large. Try a smaller one.");
  try {
    const result = await uploadAvatar({ db: g.db, store: g.store, storeHost: avatarStoreHost() }, { uid: g.uid }, body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("avatar upload failed:", err instanceof Error ? err.message : err);
    return fail(500, "server_error", "Something went wrong.");
  }
}

/** Remove your own uploaded picture (idempotent): deletes the file and clears the fields. */
export async function DELETE(request: Request) {
  const g = await gate(request);
  if (!g.ok) return g.response;
  try {
    const result = await removeOwnAvatar({ db: g.db, store: g.store }, { uid: g.uid });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("avatar removal failed:", err instanceof Error ? err.message : err);
    return fail(500, "server_error", "Something went wrong.");
  }
}
