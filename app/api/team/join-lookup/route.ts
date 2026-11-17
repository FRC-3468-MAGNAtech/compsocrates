import { joinLookup } from "@/lib/server/membership-flows";
import { membershipRoute } from "@/lib/server/membership-route";

/** What the Join screen needs before it sends a request: only `{ exists, allowsRoleChoice, alreadyMember, atLimit }`. Body: `{ program, code }` (program REQUIRED). 404 `memberships_disabled` while the kill switch is off. */
export const maxDuration = 30;

export async function POST(request: Request) {
  return membershipRoute(request, (db, actor, body) => joinLookup(db, actor, { program: body.program, code: body.code }));
}
