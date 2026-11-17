import { createTeamForCaller } from "@/lib/server/team-create";
import { readJsonBody, withCaller } from "@/lib/server/route-helpers";

/**
 * Creates a new CS-shaped team (`teams/{CODE}`: teamName, teamNumber as a string, verifiedOwnerId, selectedEvents), makes the
 * caller its team admin and owner, and disables further public creation, all inside one Firestore transaction, so two
 * simultaneous attempts can't both succeed. See lib/server/team-create.ts. Body: `{ teamNumber, teamName?, role?, name? }`.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  return withCaller(request, (db, caller) => createTeamForCaller(db, caller, { teamNumber: body.teamNumber, teamName: body.teamName, role: body.role, name: body.name }));
}
