import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { programPath } from "@/lib/firebase/paths";
import { MembershipError, isQuotaError, parseProgram, switchActiveTeam } from "@/lib/server/memberships";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { teamAuditDoc } from "@/lib/server/audit";
import { getMembershipsEnabled } from "@/lib/server/team-settings";
import type { Caller, RouteResult } from "@/lib/server/join-requests";

/**
 * `POST /api/team/switch`, the logic: body `{ program, teamId }` (`program` REQUIRED, never a cookie or a default). The caller is the verified ID token's uid
 * (`withCaller`); a client-sent identity or role is never read. Order: kill switch (404 `memberships_disabled` while `appSettings/global.membershipsEnabled` is
 * not true) -> program (400) -> team id (400) -> rate limit (429) -> `switchActiveTeam` -> audit entry. Typed refusals keep their status; a Firestore quota error
 * (gRPC 8) is a 503 `quota_exceeded`; anything else is thrown to `withCaller` (a generic 500, message logged, never sent).
 */
const HOUR_MS = 60 * 60 * 1000;
const SWITCHES_PER_HOUR = 60;
const fail = (status: number, code: string, error: string): RouteResult => ({ status, body: { ok: false, code, error } });

export type TeamSwitchInput = { program?: unknown; teamId?: unknown };

export async function handleTeamSwitch(db: Firestore, caller: Caller, input: TeamSwitchInput, nowMs: number = Date.now()): Promise<RouteResult> {
  try {
    if (!(await getMembershipsEnabled(db, nowMs))) return fail(404, "memberships_disabled", "Not found.");
    const parsed = parseProgram(input.program);
    if (!parsed.ok) return fail(parsed.status, parsed.code, parsed.error);
    const { program } = parsed;
    if (typeof input.teamId !== "string" || input.teamId.trim() === "") return fail(400, "invalid_team", "Missing team.");

    const limit = await consumeRateLimit(db, `team-switch_${caller.uid}`, SWITCHES_PER_HOUR, HOUR_MS, nowMs);
    if (!limit.allowed) return fail(429, "rate_limited", "Too many team switches. Try again later.");

    const state = await switchActiveTeam(db, program, caller.uid, input.teamId, nowMs);
    if (state.changed) {
      try {
        // The switch is done; a failed audit write must not turn it into an error.
        await db
          .collection(programPath(program, "auditLog"))
          .doc()
          .set(teamAuditDoc(state.teamId, caller.uid, caller.name ?? "", "switch-team", { uid: caller.uid, program }, { teamId: state.previousTeamId }, { teamId: state.teamId }));
      } catch (err) {
        console.error("team switch audit entry failed:", err instanceof Error ? err.message : err);
      }
    }
    return { status: 200, body: { ok: true, program: state.program, activeTeamId: state.teamId, previousTeamId: state.previousTeamId } };
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.status, err.code, err.message);
    if (isQuotaError(err)) return fail(503, "quota_exceeded", "The database is over its daily usage limit right now. Try again later.");
    throw err;
  }
}
