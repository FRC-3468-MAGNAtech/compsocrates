// Pure helpers for scripts/migrate-ce-to-ftc.ts: which collections move, where they land, and how account ids are
// rewritten. No Firebase, no Node APIs, so the rules for the move are unit-tested and the script only does I/O.

/** Collections copied from the old app's root to `programs/ftc/<name>` (their subcollections go with them). */
export const MIGRATED_COLLECTIONS = [
  "users",
  "teams",
  "profiles",
  "forms",
  "formEntries",
  "scoutEntries",
  "practiceSessions",
  "libraryMatches",
  "libraryEvents",
  "eventAttendance",
  "auditLog",
  "formTemplates",
  "pickLists",
  "scoutTargets",
  "assignments",
  "liveMatches",
  "lobbies",
  "notifications",
  "teamApplications",
  "applicationPrivate",
  "applicationBlocks",
] as const;

/**
 * Deliberately not copied: `appSettings`, `platformAuditLog` and `rateLimits` are platform state that already exists in the
 * destination project, and `changelog` / `credits` are site content the destination has its own copy of.
 */
export const NOT_MIGRATED_COLLECTIONS = ["appSettings", "platformAuditLog", "rateLimits", "changelog", "credits"] as const;

export const DESTINATION_PREFIX = "programs/ftc/";

/** CE uid -> destination uid, for accounts whose email already exists in the destination project. */
export type UidMap = ReadonlyMap<string, string>;

/** "users/abc" -> "programs/ftc/users/abc", with account ids inside the path rewritten. Null when the root collection is not migrated. */
export function destinationPath(sourcePath: string, uidMap: UidMap): string | null {
  const parts = sourcePath.split("/").filter(Boolean);
  if (parts.length === 0 || !(MIGRATED_COLLECTIONS as readonly string[]).includes(parts[0])) return null;
  return DESTINATION_PREFIX + parts.map((p) => uidMap.get(p) ?? p).join("/");
}

/**
 * Copy of `value` with every string that is exactly a mapped account id replaced (object values, array items, nested).
 * Account ids are long random strings, so exact-match replacement cannot touch ordinary text. Non-plain objects
 * (Timestamps, GeoPoints, DocumentReferences) are returned as they are.
 */
export function remapIds<T>(value: T, uidMap: UidMap): T {
  if (uidMap.size === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return uidMap.get(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

/** The document written to the destination: remapped ids plus a provenance marker. */
export function destinationData(data: Record<string, unknown>, uidMap: UidMap): Record<string, unknown> {
  return { ...remapIds(data, uidMap), migratedFrom: "ce" };
}
