import { handleTeamSwitch } from "@/lib/server/team-switch";
import { readJsonBody, withCaller } from "@/lib/server/route-helpers";

/**
 * Make one of the account's teams the active team of a program. Body: `{ program, teamId }` (program REQUIRED). Needs an ACTIVE membership in that team;
 * 404 `memberships_disabled` while the kill switch (`appSettings/global.membershipsEnabled`) is off. See lib/server/team-switch.ts.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  return withCaller(request, (db, caller) => handleTeamSwitch(db, caller, { program: body.program, teamId: body.teamId }));
}
