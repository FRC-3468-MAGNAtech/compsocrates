import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { isAdminFromCsUser } from "@/data/cs/users";
import { missingEnv } from "@/lib/server/env";
import { isPlatformOwnerToken } from "@/lib/server/owner-admin";
import { serverSignInProblem, verifyBearerToken } from "@/lib/server/require-user";

/**
 * Admin Panel > Setup Check: which environment variables are not set, and what stops working without them. Admin only
 * (a team admin or a platform owner). Names and descriptions only: a value is never read into the response.
 *
 * If the Admin SDK itself is unconfigured nobody can be verified, so this answers 503 with the message naming
 * FIREBASE_ADMIN_*, which the panel shows as its error.
 */
export async function GET(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) {
    const problem = serverSignInProblem();
    return problem ? NextResponse.json({ ok: false, error: problem }, { status: 503 }) : NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  let allowed = isPlatformOwnerToken(decoded);
  if (!allowed) {
    const db = getAdminFirestore();
    if (!db) return NextResponse.json({ ok: false, error: serverSignInProblem() ?? "Server isn't configured." }, { status: 503 });
    const snap = await db.collection("users").doc(decoded.uid).get();
    allowed = snap.exists && isAdminFromCsUser(snap.data() ?? {});
  }
  if (!allowed) return NextResponse.json({ ok: false, error: "Only admins can see this." }, { status: 403 });

  const pick = (v: { name: string; group: string; purpose: string; whenMissing: string }) => ({ name: v.name, group: v.group, purpose: v.purpose, whenMissing: v.whenMissing });
  return NextResponse.json({
    ok: true,
    missing: missingEnv().map(pick),
    optionalOff: missingEnv(["optional"]).map(pick),
  });
}
