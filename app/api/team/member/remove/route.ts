import { removeMember } from "@/lib/server/membership-flows";
import { membershipRoute } from "@/lib/server/membership-route";

/** A team admin removes a member (a platform owner may force it). Body: `{ program, teamId, uid, force? }` (program REQUIRED). */
export const maxDuration = 30;

export async function POST(request: Request) {
  return membershipRoute(request, (db, actor, body) => removeMember(db, actor, { program: body.program, teamId: body.teamId, uid: body.uid, force: body.force }));
}
