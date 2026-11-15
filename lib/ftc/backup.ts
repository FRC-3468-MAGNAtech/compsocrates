// Pure rules of the FTC backup file (Admin Panel > Backups). No React, no Firebase: what is exported, and what is never put in the file.
//
// The file is one team's data: every team-scoped collection is read with `teamId ==` (or `ownerTeamId ==` for templates), the shared library with the same two
// equality queries the Match Library uses (`origin == "api"`, `teamId == mine`), and the team's own document. The default program's backup is export only (no restore), and so is
// this one: restoring would be a bulk write of every collection under `programs/ftc/`, which the FTC rules (rightly) do not allow in one piece.

/** A collection read with `teamId == <team>`. */
export const FTC_BACKUP_TEAM_COLLECTIONS = ["scoutEntries", "formEntries", "practiceSessions", "assignments", "eventAttendance", "auditLog", "forms"] as const;
/** A collection read with `ownerTeamId == <team>`: the team's own form templates (never another team's, never a public one). */
export const FTC_BACKUP_TEMPLATE_COLLECTION = "formTemplates";
/** The shared library: the imported docs (`origin == "api"`) and the team's hand-made ones (`teamId ==`). */
export const FTC_BACKUP_LIBRARY_COLLECTIONS = ["libraryEvents", "libraryMatches"] as const;

/** Keys that are credentials or private contact details wherever they appear in a stored document. Never written to a backup file. */
const PRIVATE_KEYS = new Set(["joincode", "pendingtransfer", "password", "passwordhash", "apikey", "api_key", "privatekey", "private_key", "token", "accesstoken", "refreshtoken", "idtoken", "secret", "clientsecret", "email", "fcmtokens", "fcmtoken"]);

const isPrivateKey = (key: string): boolean => PRIVATE_KEYS.has(key.toLowerCase());

/** The value without any private key at any depth (arrays and nested maps included). A non-plain value (a number, a string, null) is returned as it is. */
export function sanitizeForBackup(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForBackup);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (!isPrivateKey(key)) out[key] = sanitizeForBackup(inner);
    }
    return out;
  }
  return value;
}

/** A roster row as the file holds it: who the person is on the team, never their email, avatar or credentials. */
export function memberForBackup(member: { uid: string; name: string; primaryRole?: string; secondaryRoles?: readonly string[]; isAdmin?: boolean; isOwner?: boolean; assignedTeamIds?: readonly string[] }): Record<string, unknown> {
  return {
    id: member.uid,
    name: member.name,
    primaryRole: member.primaryRole ?? null,
    secondaryRoles: [...(member.secondaryRoles ?? [])],
    isAdmin: member.isAdmin === true,
    isOwner: member.isOwner === true,
    ...(member.assignedTeamIds ? { assignedTeamIds: [...member.assignedTeamIds] } : {}),
  };
}

/** A stored doc as one backup row: its id, then its fields without any private key. */
export function backupRow(id: string, data: unknown): Record<string, unknown> {
  const clean = sanitizeForBackup(data);
  return { id, ...(clean && typeof clean === "object" && !Array.isArray(clean) ? (clean as Record<string, unknown>) : {}) };
}

/** Rows of the same id once (a library doc can match both library queries when a team's hand-made doc is also marked shared). */
export function dedupeRows(rows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const id = String(row.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export type BackupCounts = { collection: string; count: number }[];

export function countCollections(collections: Readonly<Record<string, readonly unknown[]>>): BackupCounts {
  return Object.entries(collections).map(([collection, rows]) => ({ collection, count: rows.length }));
}
