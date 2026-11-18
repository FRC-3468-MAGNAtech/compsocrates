import { ownerRoute } from "@/lib/server/account-deletion/wire";

/**
 * Platform owner only. `{ action: "list" }` (opaque ids and statuses, no personal data), `{ action: "start", uid }`, `{ action: "resume", opaqueId }` (also restarts a
 * stalled job). 404 `deletion_disabled` while the switch is OFF.
 */
export const maxDuration = 30;

export async function POST(request: Request) {
  return ownerRoute(request);
}
