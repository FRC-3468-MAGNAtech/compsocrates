import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { programPath } from "@/lib/firebase/paths";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import type { Caller, RouteResult } from "@/lib/server/join-requests";

/**
 * Asking to join an FTC team, over the Admin SDK. The browser cannot do this itself: the rules only let a person reach a team by its document id, and a
 * team's join code is not always its document id (a team brought over from the old site keeps the code it had), so a client write to `teams/{code}`
 * is refused for those teams, with no way to tell "no such team" from "wrong key". This route finds the team by id OR by its `joinCode` field and files
 * the same pending request the client used to write (`teams/{teamId}/joinRequests/{uid}`: `uid`, `name`, `status`, `createdAt`), so approval is unchanged.
 */

const HOUR_MS = 60 * 60 * 1000;
const fail = (status: number, code: string, error: string): RouteResult => ({ status, body: { ok: false, code, error } });

/** A typed code, trimmed and uppercased; null when it cannot be a team code (it becomes part of a document path, so no slashes or spaces). */
export function normalizeFtcJoinCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z0-9]{3,24}$/.test(code) ? code : null;
}

/** The id of the team a code belongs to: the team whose document id is the code, else the one whose `joinCode` field is. Null when none. */
export async function findFtcTeamIdByCode(db: Firestore, code: string): Promise<string | null> {
  const teams = programPath("ftc", "teams");
  const byId = await db.collection(teams).doc(code).get();
  if (byId.exists) return byId.id;
  const byCode = await db.collection(teams).where("joinCode", "==", code).limit(1).get();
  return byCode.empty ? null : byCode.docs[0].id;
}

export async function requestToJoinFtcTeam(db: Firestore, caller: Caller, input: { joinCode: unknown; name?: unknown }, nowMs: number = Date.now()): Promise<RouteResult> {
  const code = normalizeFtcJoinCode(input.joinCode);
  if (!code) return fail(400, "bad-code", "Enter the join code your team admin gave you.");

  // Join codes are guessable; every try counts, hit or miss.
  const limit = await consumeRateLimit(db, `ftcjoin_${caller.uid}`, 30, HOUR_MS, nowMs);
  if (!limit.allowed) return fail(429, "rate-limited", "Too many attempts. Try again in a while.");

  const teamId = await findFtcTeamIdByCode(db, code);
  if (!teamId) return fail(404, "team-not-found", "That join code doesn't match any team.");

  if ((await db.collection(programPath("ftc", "users")).doc(caller.uid).get()).exists) {
    return fail(409, "already-member", "This account already has a team here.");
  }

  const name = (typeof input.name === "string" ? input.name.trim() : "") || (caller.name ?? "").trim() || (caller.email ?? "").split("@")[0] || "";
  if (!name || name.length > 80) return fail(400, "bad-name", "Enter your name (80 characters at most).");

  const ref = db.collection(programPath("ftc", "teams")).doc(teamId).collection("joinRequests").doc(caller.uid);
  const existing = await ref.get();
  if (existing.exists && existing.data()?.status === "pending") return { status: 200, body: { ok: true, alreadyPending: true, teamId } };

  // A new request replaces a decided one (an old denial), so the person can ask again.
  await ref.set({ uid: caller.uid, name, status: "pending", createdAt: FieldValue.serverTimestamp() });
  return { status: 200, body: { ok: true, alreadyPending: false, teamId } };
}
