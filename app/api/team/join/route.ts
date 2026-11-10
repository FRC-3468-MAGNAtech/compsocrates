import { requestToJoinTeam } from "@/lib/server/join-requests";
import { readJsonBody, withCaller } from "@/lib/server/route-helpers";

/**
 * CS's join flow (docs/ROUTES.md D1/D6): files a PENDING `teamJoinRequests` row for the team whose uppercase code was typed
 * (the code is the `teams/{CODE}` doc id), after making sure the caller has a CS-shaped user doc (`teamId: ""`). A team admin
 * (or the platform owner) approves it from Team Management (`/api/team/join-requests/approve`), and only then does the
 * user's `teamId` get set. It replaces CE's instant join-code join. Body: `{ joinCode, role?, name? }`.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  return withCaller(request, (db, caller) => requestToJoinTeam(db, caller, { teamCode: body.joinCode, role: body.role, name: body.name }));
}
