/**
 * Adapter between FTC `programs/ftc/eventAttendance/{teamId}_{eventCode}` documents (who attends which event, one doc per team and event) and the app's
 * `EventAttendance` (lib/event-attendance.ts). No React, no Firebase. A tolerant read: a doc without a list of uids attends with nobody.
 */
import type { EventAttendance } from "@/lib/event-attendance";
import { isRecord, str, stringList } from "@/data/ftc/util";
import type { FtcRawRow } from "@/data/ftc/scouting";

/** The id of an attendance doc: `{teamId}_{eventCode}`. */
export const ftcAttendanceDocId = (teamId: string, eventCode: string): string => `${teamId}_${eventCode}`;

export function ftcDocToAttendance(id: string, doc: Record<string, unknown>): EventAttendance {
  return { id, teamId: str(doc.teamId), eventCode: str(doc.eventCode), uids: stringList(doc.uids), updatedAt: doc.updatedAt ?? null };
}

/** Every row as a record. A row whose body is not a map is skipped. */
export function ftcDocsToAttendance(rows: readonly FtcRawRow[]): EventAttendance[] {
  return rows.flatMap((row) => (isRecord(row.data) ? [ftcDocToAttendance(row.id, row.data)] : []));
}

/** What is stored for an event's attendance: the team, the event, the attendees' uids (no duplicates, in the order given) and a server time. */
export function ftcAttendanceDoc(teamId: string, eventCode: string, uids: readonly string[], now: () => unknown): Record<string, unknown> {
  return { teamId, eventCode, uids: [...new Set(uids)], updatedAt: now() };
}
