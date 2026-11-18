import { DEFAULT_RUN_READS, DELETE_CONFIRMATION_WORD } from "@/lib/deletion/constants";
import { isRecentSignIn } from "@/lib/team-owner";
import type { AccountDeletionSettings } from "@/lib/server/team-settings";
import { fail, listJobs, openJobUids, runDeletion, startDeletion, uidForOpaque, type Result } from "./job";
import type { Data, Deps, RunBudget } from "./ports";

/**
 * The three routes' logic, written against the job's doors so the guards can be tested without a server (`wire.ts` is the Admin SDK half):
 *   - `POST /api/account/delete`      the person themself (recent re-authentication, the typed word, never a platform owner)
 *   - `POST /api/platform/account-deletions`  the platform owner: list, start for a uid, resume (by opaque id)
 *   - `GET /api/cron/account-deletions`       resumes every open job within one shared budget
 * While the kill switch is OFF every one of them answers 404 `deletion_disabled` and nothing else happens.
 */
export const DISABLED: Result = fail(404, "deletion_disabled", "Account deletion is not turned on.");

export type Caller = { uid: string; name: string; authTimeSeconds: number | undefined; isPlatformOwner: boolean };
export type HandlerEnv = {
  deps: Deps;
  settings: AccountDeletionSettings;
  nowMs: number;
  /** Counts an attempt; false when the caller is over the limit. */
  rateLimit: (key: string, limit: number) => Promise<boolean>;
};

const budgetOf = (settings: AccountDeletionSettings): RunBudget => ({ writes: settings.runWrites, reads: DEFAULT_RUN_READS });
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const TOO_MANY: Result = fail(429, "rate_limited", "Too many attempts. Try again in a while.");

export async function handleSelfDelete(env: HandlerEnv, caller: Caller | null, body: Data): Promise<Result> {
  if (!env.settings.enabled) return DISABLED;
  if (!caller) return fail(401, "not_signed_in", "Not signed in.");
  const named = str(body.uid);
  if (named !== "" && named !== caller.uid) return fail(403, "not_self", "You can only delete your own account.");
  if (caller.isPlatformOwner) return fail(403, "platform_owner", "A platform owner's account cannot be deleted here.");
  if (str(body.confirm) !== DELETE_CONFIRMATION_WORD) return fail(400, "not_confirmed", `Type ${DELETE_CONFIRMATION_WORD} to confirm.`);
  if (!isRecentSignIn(caller.authTimeSeconds, env.nowMs)) return fail(401, "reauth_required", "Confirm it's you: sign in again, then retry.");
  if (!(await env.rateLimit(`account-delete_${caller.uid}`, 10))) return TOO_MANY;
  const r = await startDeletion(env.deps, { uid: caller.uid, requestedBy: "self", actor: { uid: "system", name: "Account deletion" }, budget: budgetOf(env.settings) });
  // The person is told only that the deletion started (never counters, step names or team ids).
  return r.status === 200 ? { status: 200, body: { ok: true, status: "started" } } : r;
}

export async function handleOwnerAction(env: HandlerEnv, caller: Caller | null, body: Data): Promise<Result> {
  if (!env.settings.enabled) return DISABLED;
  if (!caller) return fail(401, "not_signed_in", "Not signed in.");
  if (!caller.isPlatformOwner) return fail(403, "not_platform_owner", "Only a platform owner can do this.");
  if (!(await env.rateLimit(`account-deletions-admin_${caller.uid}`, 120))) return TOO_MANY;
  const action = str(body.action);
  if (action === "list") return { status: 200, body: { ok: true, jobs: await listJobs(env.deps) } };
  if (action === "start") {
    const uid = str(body.uid);
    if (uid === "" || uid.includes("/")) return fail(400, "bad_request", "Enter the account's uid.");
    return startDeletion(env.deps, { uid, requestedBy: "owner", actor: { uid: caller.uid, name: caller.name }, budget: budgetOf(env.settings) });
  }
  if (action === "resume") {
    const uid = await uidForOpaque(env.deps, str(body.opaqueId));
    if (!uid) return fail(404, "no_such_deletion", "There is no deletion with that id.");
    return runDeletion(env.deps, uid, budgetOf(env.settings), { resumeStalled: true, actor: { uid: caller.uid, name: caller.name } });
  }
  return fail(400, "bad_request", "Unknown action.");
}

/** The cron sweep: every open (not stalled) job, oldest first, until the shared budget is spent. */
export async function handleCron(env: HandlerEnv): Promise<Result> {
  if (!env.settings.enabled) return DISABLED;
  let budget = budgetOf(env.settings);
  const results: { done: boolean; status: unknown; step: unknown }[] = [];
  for (const uid of await openJobUids(env.deps)) {
    if (budget.writes <= 0 || budget.reads <= 0) break;
    const r = await runDeletion(env.deps, uid, budget);
    if (r.status === 200) {
      const used = r.body as { reads?: number; writes?: number; done?: boolean; status?: unknown; step?: unknown };
      budget = { writes: budget.writes - (used.writes ?? 0), reads: budget.reads - (used.reads ?? 0) };
      results.push({ done: used.done === true, status: used.status, step: used.step });
    }
  }
  return { status: 200, body: { ok: true, jobs: results.length, finished: results.filter((r) => r.done).length } };
}
