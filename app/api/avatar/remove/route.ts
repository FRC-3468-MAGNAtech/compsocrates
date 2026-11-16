import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { vercelAvatarStore } from "@/lib/server/avatar-blobs";
import { removeMemberAvatar } from "@/lib/server/avatar-service";
import { blobToken } from "@/lib/server/env";
import { isPlatformOwnerToken } from "@/lib/server/owner-admin";
import { serverSignInProblem, verifyBearerToken } from "@/lib/server/require-user";

export const runtime = "nodejs";

const fail = (status: number, code: string, error: string) => NextResponse.json({ ok: false, code, error }, { status });

/**
 * A team admin (of the member's own team) or the platform owner removes a member's uploaded picture. Body: `{ program, uid }`. Idempotent; writes the team audit
 * entry under the program's path and notifies nobody.
 */
export async function POST(request: Request) {
  const token = blobToken();
  if (!token) return fail(503, "not-configured", "Picture uploads aren't set up on this server: set BLOB_READ_WRITE_TOKEN.");
  const decoded = await verifyBearerToken(request);
  if (!decoded) {
    const problem = serverSignInProblem();
    return problem ? fail(503, "server_not_configured", problem) : fail(401, "not-signed-in", "Not signed in.");
  }
  const db = getAdminFirestore();
  if (!db) return fail(503, "server_not_configured", "Server isn't configured.");
  const raw = await request.text().catch(() => "");
  if (raw.length > 4 * 1024) return fail(413, "too-large", "That's too large.");
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    return fail(400, "bad-request", "That request couldn't be read.");
  }
  try {
    const result = await removeMemberAvatar(
      { db, store: vercelAvatarStore(token) },
      { uid: decoded.uid, name: typeof decoded.name === "string" ? decoded.name : null, isPlatformOwner: isPlatformOwnerToken(decoded) },
      body
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("member avatar removal failed:", err instanceof Error ? err.message : err);
    return fail(500, "server_error", "Something went wrong.");
  }
}
