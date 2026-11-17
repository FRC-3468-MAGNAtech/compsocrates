import { getAdminFirestoreRest } from "@/lib/firebase/admin";
import { requestToJoinFtcTeam } from "@/lib/ftc/server-join-requests";
import { readJsonBody, withCaller } from "@/lib/server/route-helpers";

/**
 * Files a PENDING request to join the FTC team with the typed code (its document id or its `joinCode`). A team admin approves or denies it from Team
 * Management; only approval creates the person's profile. Body: `{ joinCode, name? }`. See lib/ftc/server-join-requests.ts for why this is not a client write.
 */
/** The route answers within this, so a slow database shows as a message on the page and not an endless "Sending…". */
export const maxDuration = 30;

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  // The REST client, not the shared gRPC one: on this host the gRPC connection stalled on its first call (see getAdminFirestoreRest).
  return withCaller(request, (db, caller) => requestToJoinFtcTeam(getAdminFirestoreRest() ?? db, caller, { joinCode: body.joinCode, name: body.name }));
}
