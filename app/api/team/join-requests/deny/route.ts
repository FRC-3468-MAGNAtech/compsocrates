import { processJoinRequest } from "@/lib/server/join-requests";
import { readJsonBody, withCaller } from "@/lib/server/route-helpers";

/** CS join-request `deny` (docs/ROUTES.md D1/D6). Body: `{ requestId }`. Authorised by `decideJoinRequest` (data/cs/join-requests.ts). */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  return withCaller(request, (db, caller) => processJoinRequest(db, caller, "deny", body.requestId));
}
