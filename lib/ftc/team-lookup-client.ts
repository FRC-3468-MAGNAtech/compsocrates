import { authedApi } from "@/lib/api-client";

/**
 * Team Settings: the team's name by number, from the FTC Events API through the server route (the keys are read there and never reach the browser).
 * Resolves `{ found: false }` for an unknown number; rejects with the route's own message (it names a missing or rejected key by variable) so the editor can show it
 * and let the person type the name instead.
 */
export async function lookupTeamName(teamId: string, number: number): Promise<{ found: boolean; name?: string }> {
  const out = await authedApi<{ found: boolean; name?: string }>("/api/ftc/team/sync-field-teams", { body: { program: "ftc", action: "lookup", teamId, number }, timeoutMs: 15000 });
  return { found: out.found === true, ...(typeof out.name === "string" ? { name: out.name } : {}) };
}
