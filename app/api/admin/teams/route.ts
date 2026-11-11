import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { isPlatformOwnerToken } from "@/lib/server/owner-admin";
import { readTeamIdentity } from "@/lib/team-number";
import { normalizeTeamCode, ownerUidOfTeam } from "@/data/cs/join-requests";
import type { CsRecord } from "@/data/cs/types";

/**
 * P20: the list behind Admin Panel > Recovery (platform owner only): every team account's number and name, who owns it, and
 * its **admins** (the only people ownership can be moved to), so a platform owner can force-transfer an account whose
 * owner is gone. Deliberately minimal: no scouting data, no non-admin members, no join codes.
 */
export async function GET(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!isPlatformOwnerToken(decoded)) return NextResponse.json({ ok: false, error: "Only the platform owner can see this." }, { status: 403 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });

  // CS admins: `isTeamAdmin`, and the legacy `role == "coach"` the production rules also treat as admin (D6).
  const [teamsSnap, adminsSnap, coachesSnap] = await Promise.all([
    db.collection("teams").get(),
    db.collection("users").where("isTeamAdmin", "==", true).get(),
    db.collection("users").where("role", "==", "coach").get(),
  ]);
  const adminsByTeam = new Map<string, { uid: string; name: string; email: string }[]>();
  const seen = new Set<string>();
  for (const d of [...adminsSnap.docs, ...coachesSnap.docs]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    const data = d.data();
    const teamId = normalizeTeamCode(data.teamId);
    if (!teamId) continue;
    const list = adminsByTeam.get(teamId) ?? [];
    list.push({ uid: d.id, name: String(data.displayName ?? data.name ?? ""), email: String(data.email ?? "") });
    adminsByTeam.set(teamId, list);
  }

  const teams = teamsSnap.docs.map((d) => {
    const data = d.data();
    const admins = adminsByTeam.get(d.id) ?? [];
    const ownerUid = ownerUidOfTeam(data as CsRecord) || null;
    return {
      teamId: d.id,
      accountName: typeof data.accountName === "string" ? data.accountName : null,
      teamNumber: readTeamIdentity(data).number,
      teamName: readTeamIdentity(data).name,
      ownerUid,
      ownerName: admins.find((a) => a.uid === ownerUid)?.name ?? null,
      admins,
    };
  });
  teams.sort((a, b) => (a.teamNumber ?? 0) - (b.teamNumber ?? 0));
  return NextResponse.json({ ok: true, teams });
}
