import { NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { isOwnerEmail, isPreconfiguredAdminEmail } from "@/lib/server/owner-admin";
import { syncRolesForCaller } from "@/lib/server/sync-roles";

/**
 * Called by the client right after every sign-in (see lib/auth.tsx): the CS-shaped role/owner sync. All logic lives in
 * lib/server/sync-roles.ts (platform owner = a uid in CS_OWNER_UIDS or a verified OWNER_EMAILS email; `isTeamAdmin` for
 * ADMIN_EMAILS; the `verifiedOwnerId` bootstrap; an approved-but-unsynced join request applied). Requires a *verified* email
 * for anything email-based, otherwise someone could register with the owner's address before the real owner signs up.
 */
export async function POST(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });

  try {
    const result = await syncRolesForCaller(db, {
      uid: decoded.uid,
      email: decoded.email ?? null,
      emailVerified: decoded.email_verified === true,
      name: decoded.name ?? null,
      isOwnerEmail: isOwnerEmail(decoded.email),
      isAdminEmail: isPreconfiguredAdminEmail(decoded.email),
      claims: decoded as unknown as { platformOwner?: unknown; admin?: unknown; owner?: unknown },
      setClaims: (claims) => adminAuth.setCustomUserClaims(decoded.uid, claims),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("sync-roles failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
