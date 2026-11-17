import { listAdminsToVerify, verifyAdmins } from "@/lib/server/verify-admins";
import { flowFail } from "@/lib/server/membership-flows";
import { membershipRoute } from "@/lib/server/membership-route";

/**
 * Platform owner only. `{ action: "list", program, teamId }` is READ ONLY (the team's active admins and owners, each with an evidence note); `{ action: "verify",
 * program, teamId, uids, confirmName }` verifies exactly the uids sent, after the team name is typed.
 */
export const maxDuration = 30;

export async function POST(request: Request) {
  return membershipRoute(request, async (db, actor, body) => {
    const input = { program: body.program, teamId: body.teamId, uids: body.uids, confirmName: body.confirmName };
    if (body.action === "list") return listAdminsToVerify(db, actor, input);
    if (body.action === "verify") return verifyAdmins(db, actor, input);
    return flowFail(400, "invalid_action", "Unknown action.");
  });
}
