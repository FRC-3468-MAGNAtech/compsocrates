"use client";

import { authedApi } from "@/lib/api-client";
import { PROGRAMS } from "@/config/programs";
import type { ProgramId } from "@/config/programs/types";
import { membershipApi } from "@/lib/memberships/client";
import { friendlyMembershipError } from "@/lib/memberships/strings";

/**
 * The browser side of the ONE Join / Apply screen (`components/team-setup/team-setup-screen.tsx`), the same calls for every program. The program only supplies
 * data: the route a join request takes while the memberships switch is OFF comes from `ProgramConfig.membership.flows.legacyJoinPath`.
 */

export type PendingJoinRequest = { id: string; teamId: string; teamLabel: string; role: string; status: "pending" | "denied" | "canceled"; createdAtMs: number };

/** The person's pending requests and the last denied or canceled one, ONE read (no listener): call it once per visit and again after sending or canceling. */
export async function fetchMyJoinRequests(program: ProgramId): Promise<PendingJoinRequest[]> {
  const res = await authedApi<{ requests?: PendingJoinRequest[] }>("/api/team/my-join-requests", { method: "POST", body: { program }, timeoutMs: 25_000 });
  return Array.isArray(res.requests) ? res.requests : [];
}

/** Cancels the person's own pending request to `teamId`. */
export async function cancelJoinRequest(program: ProgramId, teamId: string): Promise<void> {
  await authedApi("/api/team/cancel-request", { method: "POST", body: { program, teamId }, timeoutMs: 25_000 });
}

/**
 * Files a join request. Memberships ON: the program-aware route (a team that lets joiners choose a role was asked about first by the card). OFF: the program's own
 * older route. Resolves with the team id the request went to; throws an Error with the words to show.
 */
export async function sendJoinRequest(program: ProgramId, memberships: boolean, input: { code: string; name: string; role?: string }): Promise<{ teamId: string }> {
  try {
    if (memberships) {
      const sent = await membershipApi.requestJoin(program, { code: input.code, name: input.name, ...(input.role ? { requestedRole: input.role } : {}) });
      return { teamId: sent.teamId };
    }
    const sent = await authedApi<{ teamId?: string }>(PROGRAMS[program].membership.flows.legacyJoinPath, { method: "POST", body: { joinCode: input.code, name: input.name }, timeoutMs: 25_000 });
    return { teamId: typeof sent.teamId === "string" ? sent.teamId : input.code };
  } catch (err) {
    throw new Error(friendlyMembershipError(err, "Could not send your request. Check your connection and try again."));
  }
}
