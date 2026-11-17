import { requestJoin } from "@/lib/server/membership-flows";
import { membershipRoute } from "@/lib/server/membership-route";

/** Files a pending request to join a team by code, for an account that may already be on another team. Body: `{ program, code, name?, requestedRole? }` (program REQUIRED). */
export const maxDuration = 30;

export async function POST(request: Request) {
  return membershipRoute(request, (db, actor, body) => requestJoin(db, actor, { program: body.program, code: body.code, name: body.name, requestedRole: body.requestedRole }));
}
