import { editMemberAccess } from "@/lib/server/membership-flows";
import { membershipRoute } from "@/lib/server/membership-route";

/** A team admin edits a member's roles or admin status. Body: `{ program, teamId, uid, changes: { primaryRole?, secondaryRoles?, isAdmin? } }` (program REQUIRED). */
export const maxDuration = 30;

export async function POST(request: Request) {
  return membershipRoute(request, (db, actor, body) => editMemberAccess(db, actor, { program: body.program, teamId: body.teamId, uid: body.uid, changes: body.changes }));
}
