import { leaveTeam } from "@/lib/server/membership-flows";
import { membershipRoute } from "@/lib/server/membership-route";

/** The caller leaves one of their teams. Body: `{ program, teamId }` (program REQUIRED). */
export const maxDuration = 30;

export async function POST(request: Request) {
  return membershipRoute(request, (db, actor, body) => leaveTeam(db, actor, { program: body.program, teamId: body.teamId }));
}
