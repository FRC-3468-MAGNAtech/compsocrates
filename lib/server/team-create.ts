import "server-only";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { CsUserDoc } from "@/data/cs/types";
import { buildBaseUserDoc, buildCreatorUserPatch, buildNewTeamDoc, generateTeamCode, normalizeTeamCode } from "@/data/cs/join-requests";
import { str } from "@/data/cs/util";
import { migratedFieldTeamId, parseFieldTeamNumber } from "@/lib/field-teams";
import { APP_SETTINGS_PATH, getTeamCreationEnabledInTransaction } from "@/lib/server/team-settings";
import type { Caller, RouteResult } from "@/lib/server/join-requests";

const fail = (status: number, code: string, error: string): RouteResult => ({ status, body: { ok: false, code, error } });

/** How many fresh codes one attempt looks at (all read inside the transaction, so a code can't be taken between check and write). */
const CODE_CANDIDATES = 6;

/**
 * A free uppercase team code, or null if every candidate is taken. Reads candidate team docs INSIDE the transaction (so the code
 * can't be claimed between check and write); call it before the transaction's first write.
 */
export async function claimFreeTeamCode(db: Firestore, txn: Transaction, random: () => number = Math.random): Promise<string | null> {
  const candidates = [...new Set(Array.from({ length: CODE_CANDIDATES }, () => generateTeamCode(random)))];
  const snaps = await Promise.all(candidates.map((c) => txn.get(db.collection("teams").doc(c))));
  const free = snaps.findIndex((s) => !s.exists);
  return free < 0 ? null : candidates[free];
}

/**
 * Creates a team as CS stores it, makes the caller its owner and admin, and switches public creation off, in ONE transaction
 * (two simultaneous creators cannot both win). Writes:
 *   teams/{CODE}: teamName, teamNumber (string), verifiedOwnerId, selectedEvents [], createdAt (ms), + CE fieldTeams* extras
 *   users/{uid} (merge): teamId, role/roles/secondaryRoles, isTeamAdmin true, isOwner true (CE mirror), fieldTeamIds
 * `{CODE}` is a random uppercase code, checked for collisions against existing team docs inside the transaction.
 */
export async function createTeamForCaller(
  db: Firestore,
  caller: Caller,
  input: { teamNumber: unknown; teamName?: unknown; role?: unknown; name?: unknown },
  nowMs: number = Date.now(),
  random: () => number = Math.random
): Promise<RouteResult> {
  const teamNumber = parseFieldTeamNumber(typeof input.teamNumber === "number" || typeof input.teamNumber === "string" ? input.teamNumber : null);
  if (teamNumber === null) return fail(400, "bad-number", "Enter a valid team number.");
  const teamName = str(input.teamName).trim().slice(0, 80);
  const displayName = str(input.name).trim() || str(caller.name).trim() || str(caller.email).split("@")[0] || "";

  return db.runTransaction(async (txn): Promise<RouteResult> => {
    const userRef = db.collection("users").doc(caller.uid);
    // Reads must happen before any writes in a Firestore transaction.
    const [userSnap, creationEnabled, code] = await Promise.all([txn.get(userRef), getTeamCreationEnabledInTransaction(db, txn), claimFreeTeamCode(db, txn, random)]);

    const user = userSnap.exists ? ((userSnap.data() ?? {}) as CsUserDoc) : null;
    if (user && normalizeTeamCode(user.teamId)) return fail(409, "already-member", "You're already on a team.");
    if (!creationEnabled) return fail(403, "creation-disabled", "Team creation is currently disabled.");

    if (!code) return fail(503, "code-collision", "Couldn't pick a free join code. Try again.");

    const fieldTeam = { id: migratedFieldTeamId(teamNumber), number: teamNumber, name: teamName };
    txn.set(db.collection("teams").doc(code), buildNewTeamDoc({ teamNumber, teamName, ownerUid: caller.uid, fieldTeam }, nowMs));
    const patch = buildCreatorUserPatch({ teamId: code, role: input.role ?? user?.role, fieldTeamIds: [fieldTeam.id] });
    if (user) {
      txn.set(userRef, patch, { merge: true });
    } else {
      txn.set(userRef, { ...buildBaseUserDoc({ uid: caller.uid, email: caller.email ?? "", displayName, role: input.role }, nowMs), ...patch });
    }
    txn.set(db.doc(APP_SETTINGS_PATH), { teamCreationEnabled: false }, { merge: true });
    return { status: 200, body: { ok: true, joinCode: code, teamId: code } };
  });
}
