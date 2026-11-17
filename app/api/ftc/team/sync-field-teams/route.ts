import { handleFtcFieldTeams } from "@/lib/ftc/server-field-teams";
import { readJsonBody, withCaller } from "@/lib/server/route-helpers";

/**
 * Team Settings, server side, for an FTC account: look up a team's name by number (FTC Events API) or repair the account's team list. Admin or owner of the
 * named team only; see lib/ftc/server-field-teams.ts. Body: `{ program: "ftc", action: "lookup" | "sync", teamId, number? }`.
 */
export const maxDuration = 30;

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  return withCaller(request, (db, caller) => handleFtcFieldTeams(db, caller, { program: body.program, action: body.action, teamId: body.teamId, number: body.number }));
}
