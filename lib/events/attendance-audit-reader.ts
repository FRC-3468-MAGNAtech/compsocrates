import { isPracticeSessionRow } from "@/data/cs/scouting";
import type { EventKeyShape } from "@/lib/events/event-key";
import type { AuditAttendanceRow, AuditEntryRow, AuditInput, AuditMember } from "@/lib/events/attendance-audit";

// The audit's reads, behind an interface that can only read. A store has two methods, `getDoc` and `getDocs`; there is no way to write through
// it. The script gives it Admin SDK `.get()` calls, the tests give it a fake. `prefix` is `ProgramConfig.firestorePrefix` ("" for the root
// program, whose attendance lives on the team document; a namespaced program has one attendance document per team and event).

export type ReadOnlyStore = {
  getDoc(path: string): Promise<Record<string, unknown> | null>;
  getDocs(collectionPath: string, where: ReadonlyArray<readonly [field: string, value: string]>): Promise<Array<{ id: string; data: Record<string, unknown> }>>;
};

/** The script's own check before it reads anything: a store is exactly the two read methods, so a write method cannot have been added to it. */
export function assertReadOnlyStore(store: object): asserts store is ReadOnlyStore {
  const keys = Object.keys(store).sort().join(",");
  if (keys !== "getDoc,getDocs") throw new Error(`The audit store must have only getDoc and getDocs (got: ${keys || "nothing"}).`);
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export type LoadAuditArgs = { prefix: string; uid: string; teamId: string; shape: EventKeyShape; season: number };

export async function loadAuditInput(store: ReadOnlyStore, a: LoadAuditArgs): Promise<AuditInput> {
  const root = a.prefix === "";
  const usersPath = `${a.prefix}users`;
  const nameField = root ? "displayName" : "name";

  const [person, memberDocs] = await Promise.all([store.getDoc(`${usersPath}/${a.uid}`), store.getDocs(usersPath, [["teamId", a.teamId]])]);
  const members: AuditMember[] = memberDocs.map((d) => ({ uid: d.id, name: str(d.data[nameField]) })).filter((m) => m.name !== "");

  let attendance: AuditAttendanceRow[];
  let entries: AuditEntryRow[];
  if (root) {
    const team = await store.getDoc(`teams/${a.teamId}`);
    const map = team && isRecord(team.eventAttendees) ? team.eventAttendees : {};
    attendance = Object.entries(map).map(([rawKey, v]) => ({ rawKey, listed: Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [] }));
    const rows = await store.getDocs("scouting", [["scoutId", a.uid]]);
    entries = rows.map((d) => ({
      id: d.id,
      rawEventKey: str(d.data.eventKey),
      source: isPracticeSessionRow(d.data) ? "practice" : "event",
      excluded: d.data.excludeFromStats === true,
      teamId: str(d.data.teamId) || null,
    }));
  } else {
    const docs = await store.getDocs(`${a.prefix}eventAttendance`, [["teamId", a.teamId]]);
    attendance = docs.map((d) => ({ rawKey: str(d.data.eventCode), listed: Array.isArray(d.data.uids) ? d.data.uids.filter((x): x is string => typeof x === "string") : [] }));
    const rows = await store.getDocs(`${a.prefix}scoutEntries`, [["uid", a.uid]]);
    entries = rows.map((d) => {
      const s = str(d.data.source);
      return { id: d.id, rawEventKey: str(d.data.eventCode), source: s === "live" || s === "practice" ? s : s === "event" || s === "" ? "event" : "other", excluded: d.data.excluded === true, teamId: str(d.data.teamId) || null };
    });
  }
  return { uid: a.uid, personName: person ? str(person[nameField]) || null : null, teamId: a.teamId, shape: a.shape, season: a.season, attendance, members, entries };
}
