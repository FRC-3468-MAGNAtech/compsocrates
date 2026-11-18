import { selfDeleteRoute } from "@/lib/server/account-deletion/wire";

/**
 * The signed-in person deletes their own account (memberships build 4). Body: `{ confirm: "DELETE" }`; the sign-in must be recent (the client re-authenticates first).
 * 404 `deletion_disabled` while `appSettings/global.accountDeletionEnabled` is not true. The answer says only that the deletion started.
 */
export const maxDuration = 30;

export async function POST(request: Request) {
  return selfDeleteRoute(request);
}
