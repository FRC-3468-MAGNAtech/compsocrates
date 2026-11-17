import type { Firestore } from "firebase-admin/firestore";
import { PROGRAMS } from "@/config/programs";
import type { ProgramId } from "@/config/programs/types";
import { programPath } from "@/lib/firebase/paths";
import type { BackfillDb } from "./runner";
import type { ExistingMembership, UserRow } from "./plan";

// The real BackfillDb over the Admin SDK. It exposes only: one settings read, count()s, reads of users (a SELECTED set of fields), memberships and team
// documents, and `create` of membership documents. There is no update, set or delete here, and the only write target is a program's membership collection.

const ALREADY_EXISTS = 6;

/** The user-document fields a membership is built from (nothing else is read, so no email and no token leaves Firestore). */
export function userFieldsToRead(program: ProgramId): string[] {
  const m = PROGRAMS[program].membership;
  const f = m.userFields;
  return [...new Set(["teamId", ...m.nameFields, f.role, f.roles, f.secondaryRoles, f.isAdmin, f.isOwner, f.fieldTeamIds].filter((x): x is string => typeof x === "string"))];
}

export function makeBackfillDb(db: Firestore): BackfillDb {
  const users = (p: ProgramId) => db.collection(programPath(p, "users"));
  const memberships = (p: ProgramId) => db.collection(programPath(p, "memberships"));
  const usersQuery = (p: ProgramId, team: string | null) => (team ? users(p).where("teamId", "==", team) : users(p).where("teamId", "!=", ""));

  return {
    async membershipsEnabled() {
      const snap = await db.doc("appSettings/global").get();
      return snap.data()?.membershipsEnabled === true;
    },
    async countUsers(program, team) {
      return (await usersQuery(program, team).count().get()).data().count;
    },
    async countMemberships(program) {
      return (await memberships(program).count().get()).data().count;
    },
    async readUsers(program, team, limit): Promise<UserRow[]> {
      const snap = await usersQuery(program, team)
        .select(...userFieldsToRead(program))
        .limit(limit)
        .get();
      return snap.docs.map((d) => ({ uid: d.id, data: d.data() as Record<string, unknown> }));
    },
    async readMemberships(program, limit): Promise<ExistingMembership[]> {
      const snap = await memberships(program).select("uid", "teamId", "status").limit(limit).get();
      return snap.docs.map((d) => ({ program, uid: String(d.get("uid") ?? ""), teamId: String(d.get("teamId") ?? ""), status: String(d.get("status") ?? "") }));
    },
    async teamsExist(program, teamIds) {
      const col = db.collection(programPath(program, "teams"));
      const found = new Set<string>();
      for (let i = 0; i < teamIds.length; i += 300) {
        const refs = teamIds.slice(i, i + 300).map((id) => col.doc(id));
        const snaps = await db.getAll(...refs);
        for (const s of snaps) if (s.exists) found.add(s.id);
      }
      return found;
    },
    async createBatch(program, items) {
      const col = memberships(program);
      let created = 0;
      let existed = 0;
      const batch = db.batch();
      for (const it of items) batch.create(col.doc(it.id), { ...it.doc });
      try {
        await batch.commit();
        return { created: items.length, existed: 0 };
      } catch (err) {
        if ((err as { code?: unknown } | null)?.code !== ALREADY_EXISTS) throw err;
      }
      // One of them already exists (the batch is all-or-nothing, so nothing was written): create them one by one and leave the existing ones as they are.
      for (const it of items) {
        try {
          await col.doc(it.id).create({ ...it.doc });
          created++;
        } catch (err) {
          if ((err as { code?: unknown } | null)?.code !== ALREADY_EXISTS) throw err;
          existed++;
        }
      }
      return { created, existed };
    },
  };
}
