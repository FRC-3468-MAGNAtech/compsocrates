import { teamLabelFor } from "@/lib/server/join-requests";
import { withCaller } from "@/lib/server/route-helpers";

/**
 * CS `/api/team-label`, over the Admin SDK: `GET ?teamCode=ABC123` -> `{ exists, verified, label }` ("Team 3468", the team's
 * name, or "Team ABC123"). Needs no client Firestore rule (a pending requester cannot read `teams/*`), but it does need a
 * signed-in caller and is rate limited per user, so it cannot be used to enumerate join codes anonymously.
 */
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("teamCode");
  return withCaller(request, (db, caller) => teamLabelFor(db, caller, code));
}
