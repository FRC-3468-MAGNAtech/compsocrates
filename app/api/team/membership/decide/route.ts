import { decideJoin } from "@/lib/server/membership-flows";
import { membershipRoute } from "@/lib/server/membership-route";

/** An admin approves or denies a join request, for either program. Body: `{ program, teamId, requestId, action: "approve" | "deny", role? }` (program REQUIRED; `requestId` is the applicant's uid in a program that files requests per team). */
export const maxDuration = 30;

export async function POST(request: Request) {
  return membershipRoute(request, (db, actor, body) => decideJoin(db, actor, { program: body.program, teamId: body.teamId, requestId: body.requestId, action: body.action, role: body.role }));
}
