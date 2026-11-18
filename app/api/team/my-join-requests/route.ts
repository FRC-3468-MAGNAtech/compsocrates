import { myJoinRequests } from "@/lib/server/join-request-flows";
import { membershipRoute } from "@/lib/server/membership-route";

/** The signed-in person's pending join requests and the last denied or canceled one, for either program. Body: `{ program }` (REQUIRED). Not behind the memberships switch. */
export const maxDuration = 30;

export async function POST(request: Request) {
  return membershipRoute(request, (db, actor, body) => myJoinRequests(db, actor, { program: body.program }));
}
