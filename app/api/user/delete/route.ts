import { deleteAccountData } from "@/lib/server/join-requests";
import { readJsonBody, withCaller } from "@/lib/server/route-helpers";

/**
 * CS `/api/user/delete`: removes the caller's join requests and `users/{uid}` doc (clients can't delete a user doc, the CS rules
 * say `allow delete: if false`). Unlike CS, the caller is verified with firebase-admin and may only delete themselves; the
 * client deletes the sign-in account afterwards. Body (optional): `{ uid }`, which must equal the caller's uid.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  return withCaller(request, async (db, caller) => {
    if (typeof body.uid === "string" && body.uid.trim() !== "" && body.uid.trim() !== caller.uid) {
      return { status: 403, body: { ok: false, code: "not-self", error: "You can only delete your own account data." } };
    }
    return deleteAccountData(db, caller);
  });
}
