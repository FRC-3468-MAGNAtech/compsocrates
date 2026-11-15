import { requestToJoinFtcTeam } from "@/lib/ftc/server-join-requests";
import { readJsonBody, withCaller } from "@/lib/server/route-helpers";

/**
 * Files a PENDING request to join the FTC team with the typed code (its document id or its `joinCode`). A team admin approves or denies it from Team
 * Management; only approval creates the person's profile. Body: `{ joinCode, name? }`. See lib/ftc/server-join-requests.ts for why this is not a client write.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  return withCaller(request, (db, caller) => requestToJoinFtcTeam(db, caller, { joinCode: body.joinCode, name: body.name }));
}
