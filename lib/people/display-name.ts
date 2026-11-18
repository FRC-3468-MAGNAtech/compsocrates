import { DELETED_ACCOUNT_NAME, isDeletedAccountId } from "@/lib/deletion/constants";

/** The text shown where a person is looked up by uid and the roster no longer has them (they left, or they never were on this device's roster). */
export const FORMER_MEMBER_NAME = "Former member";

/**
 * ONE way to turn a uid into a name for display. A person on the roster shows their name; a deleted account shows "Deleted Account"; any other uid the
 * roster cannot resolve shows `fallback`. It NEVER returns the uid or an opaque id, because both identify a row to anyone who sees them.
 */
export function personName(uid: string | null | undefined, members: readonly { uid: string; name: string }[], fallback: string = FORMER_MEMBER_NAME): string {
  if (!uid) return fallback;
  const found = members.find((m) => m.uid === uid);
  if (found && found.name.trim() !== "") return isDeletedAccountId(uid) ? DELETED_ACCOUNT_NAME : found.name;
  return isDeletedAccountId(uid) ? DELETED_ACCOUNT_NAME : fallback;
}
