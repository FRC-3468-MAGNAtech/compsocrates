import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { isPlatformOwnerToken } from "@/lib/server/owner-admin";
import { APP_SETTINGS_PATH, invalidateAppSettingsCache } from "@/lib/server/team-settings";

/**
 * Platform-owner-only switch backing Admin Panel's "Admins can see every profile on their team" toggle. Writes the additive field
 * `adminsSeeAllProfiles` on appSettings/global (missing means ON). Same gate as /api/admin/team-creation: the verified token's
 * `platformOwner` claim plus the live owner list; no client can write appSettings directly (denied in firestore.rules).
 */
export async function POST(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!isPlatformOwnerToken(decoded)) {
    return NextResponse.json({ ok: false, error: "Only the platform owner can change this." }, { status: 403 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const enabled = body?.enabled;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "Missing 'enabled' boolean." }, { status: 400 });
  }

  await db.doc(APP_SETTINGS_PATH).set({ adminsSeeAllProfiles: enabled }, { merge: true });
  invalidateAppSettingsCache(); // the shared settings snapshot shows the change at once on this instance (others within 30 s)
  return NextResponse.json({ ok: true, adminsSeeAllProfiles: enabled });
}
