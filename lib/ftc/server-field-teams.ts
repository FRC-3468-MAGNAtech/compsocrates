import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { isProgramId } from "@/config/programs/types";
import { programPath } from "@/lib/firebase/paths";
import { MAX_ACCOUNT_TEAMS, sanitizeTeamName } from "@/lib/account-teams";
import { getTeamByNumber } from "@/lib/ftc/provider";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { readServerRoster } from "@/lib/server/team-roster";
import { ftcApiMissingNames } from "@/lib/server/env";
import { parseTeamNumber } from "@/lib/team-number";
import { readFieldTeams } from "@/data/ftc/teams";
import type { Caller, RouteResult } from "@/lib/server/join-requests";

/**
 * `POST /api/ftc/team/sync-field-teams`: the server side of Team Settings for an FTC account, over the Admin SDK and the `programs/ftc/` paths only.
 *
 * Body: `{ program: "ftc", action: "lookup" | "sync", teamId, number? }`. The program is REQUIRED in the body (and the route's own path is the FTC one); any other KNOWN program is refused
 * (nothing here has a meaning for it) and so is anything else. The caller is identified by their verified ID token (the route's `withCaller`); this module then reads
 * THEIR FTC user document and requires that they are an admin or owner of the team named in the request, so a client-sent role is never trusted and only the
 * caller's own team can be touched.
 *  - `lookup` (with `number`): asks the FTC Events API for the team's name so the editor can fill it in. The keys never leave the server.
 *  - `sync` : the idempotent repair CE ran on sign-in, now admin-only: gives the team doc `fieldTeams` / `fieldTeamIdList` / `fieldTeamNumbers` from its legacy
 *    `number` / `name` when they are missing or stale, and gives every member with no `fieldTeamIds` all of the teams. It never overwrites an existing assignment.
 */

const HOUR_MS = 60 * 60 * 1000;
const RATE_LIMIT_PER_HOUR = 60;
const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): RouteResult => ({ status, body: { ok: false, code, error, ...extra } });

export type FieldTeamsInput = { program?: unknown; action?: unknown; teamId?: unknown; number?: unknown };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sameList = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((v, i) => v === b[i]);

async function lookup(numberInput: unknown): Promise<RouteResult> {
  const number = typeof numberInput === "string" || typeof numberInput === "number" ? parseTeamNumber(numberInput) : null;
  if (number === null) return fail(400, "invalid_number", "Enter a team number with 1 to 5 digits.");
  const missing = ftcApiMissingNames();
  if (missing.length > 0) return fail(503, "missing_credentials", `FTC API credentials are not configured: set ${missing.join(" and ")}.`, { missing });
  const result = await getTeamByNumber(number);
  if (!result.ok) {
    const { code } = result.error;
    if (code === "missing_credentials") return fail(503, code, result.error.message, { missing: ftcApiMissingNames() });
    if (code === "unauthorized") return fail(502, code, "The FIRST API rejected the configured credentials: check FTC_API_USERNAME and FTC_API_KEY.", { missing: [] });
    if (code === "rate_limited") return fail(429, code, result.error.message);
    return fail(502, code, result.error.message);
  }
  if (!result.data) return { status: 200, body: { ok: true, found: false, number } };
  return { status: 200, body: { ok: true, found: true, number, name: sanitizeTeamName(result.data.nameShort || result.data.nameFull) } };
}

async function sync(db: Firestore, teamId: string): Promise<RouteResult> {
  const teamRef = db.collection(programPath("ftc", "teams")).doc(teamId);
  const migrated = await db.runTransaction(async (txn) => {
    const snap = await txn.get(teamRef);
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    const teams = readFieldTeams(data);
    if (teams.length > MAX_ACCOUNT_TEAMS) return { tooMany: true as const };
    if (teams.length === 0) return { wrote: false, teams };
    const ids = teams.map((t) => t.id);
    const numbers = teams.map((t) => t.number);
    const stored = Array.isArray(data.fieldTeams) ? data.fieldTeams : [];
    const complete = stored.length === teams.length && sameList(Array.isArray(data.fieldTeamIdList) ? data.fieldTeamIdList : [], ids) && sameList(Array.isArray(data.fieldTeamNumbers) ? data.fieldTeamNumbers : [], numbers);
    if (complete) return { wrote: false, teams };
    txn.update(teamRef, { fieldTeams: teams.map((t) => ({ id: t.id, number: t.number, name: t.name })), fieldTeamIdList: ids, fieldTeamNumbers: numbers });
    return { wrote: true, teams };
  });
  if (migrated === null) return fail(404, "team_not_found", "That team does not exist.");
  if ("tooMany" in migrated) return fail(422, "too_many_teams", `An account can have at most ${MAX_ACCOUNT_TEAMS} teams.`);
  if (migrated.teams.length === 0) return { status: 200, body: { ok: true, teamMigrated: false, membersMigrated: 0 } };

  const all = migrated.teams.map((t) => t.id);
  // The roster seam: the team's user documents (the query this always ran), plus its active memberships while the kill switch is ON, so a member whose active team
  // is another one gets their assignment too (it lives on their membership).
  const members = await readServerRoster(db, "ftc", teamId);
  const needing = members.filter((r) => !Array.isArray(r.data.fieldTeamIds));
  for (let i = 0; i < needing.length; i += 400) {
    const batch = db.batch();
    for (const r of needing.slice(i, i + 400)) batch.update(r.ref, { fieldTeamIds: [...all] });
    await batch.commit();
  }
  return { status: 200, body: { ok: true, teamMigrated: migrated.wrote, membersMigrated: needing.length } };
}

export async function handleFtcFieldTeams(db: Firestore, caller: Caller, input: FieldTeamsInput): Promise<RouteResult> {
  if (typeof input.program !== "string") return fail(400, "invalid_program", "Say which program this is for.");
  if (isProgramId(input.program) && input.program !== "ftc") return fail(400, "program_not_supported", "Team Settings sync has no meaning for that program.");
  if (input.program !== "ftc") return fail(400, "invalid_program", "Unknown program.");
  if (input.action !== "lookup" && input.action !== "sync") return fail(400, "invalid_action", "Unknown action.");
  const teamId = typeof input.teamId === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(input.teamId) ? input.teamId : null;
  if (!teamId) return fail(400, "invalid_team", "That is not a valid team.");

  // Who is asking, from THEIR document (never from the request): an admin or owner of the team they name.
  const userSnap = await db.collection(programPath("ftc", "users")).doc(caller.uid).get();
  const user = userSnap.exists ? userSnap.data() : null;
  if (!isRecord(user) || user.teamId !== teamId || (user.isAdmin !== true && user.isOwner !== true)) return fail(403, "forbidden", "Only a team admin can do that.");

  const limit = await consumeRateLimit(db, `ftc-field-teams_${caller.uid}`, RATE_LIMIT_PER_HOUR, HOUR_MS);
  if (!limit.allowed) return fail(429, "rate_limited", "Too many requests. Try again later.");

  return input.action === "lookup" ? lookup(input.number) : sync(db, teamId);
}
