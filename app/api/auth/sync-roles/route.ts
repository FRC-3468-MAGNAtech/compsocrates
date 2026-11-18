import { NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase/admin";
import { meterDb } from "@/lib/server/read-meter";
import { verifyBearerToken } from "@/lib/server/require-user";
import { isOwnerEmail } from "@/lib/server/owner-admin";
import { syncRolesForCaller } from "@/lib/server/sync-roles";
import { ensureMembershipsOnSignIn } from "@/lib/server/memberships";

/**
 * Called by the client right after every sign-in (see lib/auth.tsx): the CS-shaped role/owner sync. All logic lives in
 * lib/server/sync-roles.ts (platform owner = a uid in RELEASE_OWNER_UIDS or a verified RELEASE_OWNER_EMAILS email; the `verifiedOwnerId` bootstrap; an approved-but-unsynced join request applied). Requires a *verified* email
 * for anything email-based, otherwise someone could register with the owner's address before the real owner signs up.
 */
export async function POST(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const db = meterDb(getAdminFirestore(), "api/auth/sync-roles");
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });

  try {
    const result = await syncRolesForCaller(db, {
      uid: decoded.uid,
      email: decoded.email ?? null,
      emailVerified: decoded.email_verified === true,
      name: decoded.name ?? null,
      isOwnerEmail: isOwnerEmail(decoded.email),
      claims: decoded as unknown as { platformOwner?: unknown; admin?: unknown; owner?: unknown },
      setClaims: (claims) => adminAuth.setCustomUserClaims(decoded.uid, claims),
    });
    // Memberships (additive): with the kill switch ON, make sure each program's active team has a membership. It never throws and never changes the answer
    // above; OFF costs only the cached switch read (lib/server/memberships.ts).
    await ensureMembershipsOnSignIn(db, decoded.uid).catch((err: unknown) => console.error("ensureMembershipsOnSignIn failed:", err instanceof Error ? err.message : err));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("sync-roles failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
