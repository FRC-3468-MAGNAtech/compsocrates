// Reads for the FTC backup file (Admin Panel > Backups), all under `programs/ftc/`, all equality queries on the team (no orderBy, no collection group, no new index).
// Read only: nothing here writes. The pure rules (what is never exported) are in lib/ftc/backup.ts.

import { collection, doc, getDoc, getDocs, query, where, type DocumentData, type Query } from "@/lib/firebase/metered";
import { db } from "@/lib/firebase/client";
import { programCollection, programDoc, programPath } from "@/lib/firebase/paths";
import { describeFirestoreError, failureExplanation } from "@/lib/firestore-errors";
import { ftcUserToMember, type FtcUserDoc } from "@/data/ftc/users";
import { isRecord } from "@/data/ftc/util";
import { withRosterExtras } from "@/lib/team-roster";
import {
  FTC_BACKUP_LIBRARY_COLLECTIONS,
  FTC_BACKUP_TEAM_COLLECTIONS,
  FTC_BACKUP_TEMPLATE_COLLECTION,
  backupRow,
  dedupeRows,
  memberForBackup,
} from "@/lib/ftc/backup";

const PROGRAM = "ftc" as const;

const why = (err: unknown): string => failureExplanation(describeFirestoreError("backup", err));

/** Reads one query; a failure names the collection and says what probably happened, so the export stops with a reason instead of a partial file. */
async function readRows(name: string, q: Query<DocumentData>): Promise<Record<string, unknown>[]> {
  try {
    const snap = await getDocs(q);
    return snap.docs.map((d) => backupRow(d.id, d.data()));
  } catch (err) {
    throw new Error(`Couldn't read ${name}: ${why(err)}`);
  }
}

/** Every collection of the team's backup, keyed by the name the file uses. */
export async function readFtcBackup(teamId: string): Promise<Record<string, Record<string, unknown>[]>> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const name of FTC_BACKUP_TEAM_COLLECTIONS) out[name] = await readRows(name, query(programCollection(db, PROGRAM, name), where("teamId", "==", teamId)));

  // Each form's published versions (write-once docs under the form doc): the version an old entry was scouted with.
  const versions: Record<string, unknown>[] = [];
  for (const form of out.forms) {
    const rows = await readRows(`the versions of form ${String(form.id)}`, query(collection(db, programPath(PROGRAM, "forms"), String(form.id), "versions")));
    for (const row of rows) versions.push({ ...row, formDocId: form.id });
  }
  out.formVersions = versions;

  out[FTC_BACKUP_TEMPLATE_COLLECTION] = await readRows(FTC_BACKUP_TEMPLATE_COLLECTION, query(programCollection(db, PROGRAM, FTC_BACKUP_TEMPLATE_COLLECTION), where("ownerTeamId", "==", teamId)));

  for (const name of FTC_BACKUP_LIBRARY_COLLECTIONS) {
    const shared = await readRows(name, query(programCollection(db, PROGRAM, name), where("origin", "==", "api")));
    const own = await readRows(name, query(programCollection(db, PROGRAM, name), where("teamId", "==", teamId)));
    out[name] = dedupeRows([...shared, ...own]);
  }

  // The roster: who is on the team and their roles, never emails or credentials.
  try {
    const snap = await getDocs(query(programCollection(db, PROGRAM, "users"), where("teamId", "==", teamId)));
    const fromUsers = snap.docs.flatMap((d) => (isRecord(d.data()) ? [ftcUserToMember(d.id, d.data() as FtcUserDoc)] : []));
    // The roster seam: members whose active team is another one are part of this team's roster too (nothing extra is read while the memberships switch is OFF).
    out.members = (await withRosterExtras(PROGRAM, teamId, fromUsers)).map(memberForBackup);
  } catch (err) {
    throw new Error(`Couldn't read the team members: ${why(err)}`);
  }

  // The team's own document and its sidebar layout (settings), without the join code or anything private.
  try {
    const team = await getDoc(programDoc(db, PROGRAM, "teams", teamId));
    out.teams = team.exists() ? [backupRow(team.id, team.data())] : [];
    const sidebar = await getDoc(doc(db, programPath(PROGRAM, "teams"), teamId, "settings", "sidebar"));
    out.settings = sidebar.exists() ? [backupRow("sidebar", sidebar.data())] : [];
  } catch (err) {
    throw new Error(`Couldn't read the team settings: ${why(err)}`);
  }
  return out;
}
