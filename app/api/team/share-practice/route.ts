import { sharePractice } from "@/lib/server/practice-sharing";
import { membershipRoute } from "@/lib/server/membership-route";

/**
 * The person opts in to copy their private practice into the team they are on (completed sessions and their entries, batches of 400, at most 3,000 writes a call:
 * call again while `done` is false). Body: `{ program }` (REQUIRED). Never automatic; 404 \`memberships_disabled\` while the switch is OFF.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  return membershipRoute(request, (db, actor, body) => sharePractice(db, actor, { program: body.program }), 55_000);
}
