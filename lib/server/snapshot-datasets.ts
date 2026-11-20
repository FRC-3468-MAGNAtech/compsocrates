import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { csUserToMember } from "@/data/cs/users";
import type { CsUserDoc } from "@/data/cs/types";
import { ftcUserToMember, type FtcUserDoc } from "@/data/ftc/users";
import { DEFAULT_PROGRAM, type ProgramId } from "@/config/programs/types";
import { programPath } from "@/lib/firebase/paths";
import { readMembership } from "@/lib/memberships/model";
import { membershipToMember } from "@/lib/memberships/roster-member";
import { readServerRoster } from "@/lib/server/team-roster";
import type { TeamMember } from "@/lib/team-members";
import type { SnapshotDataset } from "@/lib/snapshot/model";

/**
 * What each snapshot dataset reads and how, per program (read reduction 2a). The ONE place the server maps a program id to its collections, queries and mappers (the
 * same pattern as `lib/server/live-program.ts`); the route, the cache and the browser hooks are shared and never name a program.
 *
 *  - ROSTER (a team's part): the member rows, already mapped to `TeamMember` here so the response carries only what the browser's own reader shows (no raw user
 *    documents: nothing the person's screen does not already use). With the memberships switch ON the active memberships are merged in, through the existing
 *    server roster seam, in the same order the browser merged them.
 *  - LIBRARY (shared parts): the published library matches as raw `{ id, data }` documents, converted by the browser with the same converter it always used. A program
 *    whose library also holds a team's own hand-made matches gets a second, team-keyed part.
 */
type Where = [field: string, value: string | boolean];

type ProgramSnapshotSpec = {
  mapMember: (uid: string, data: Record<string, unknown>) => TeamMember | null;
  library: {
    /** Equality filters of the program-wide part (readable by any signed-in user). */
    shared: Where[];
    /** Equality filters of the team's own documents (`teamField == the caller's team`), or null when the program has none. */
    own: { filters: Where[]; teamField: string } | null;
  };
};

const rootSpec: ProgramSnapshotSpec = {
  mapMember: (uid, data) => csUserToMember(uid, data as CsUserDoc),
  library: { shared: [["published", true]], own: null },
};

const namespacedSpec: ProgramSnapshotSpec = {
  mapMember: (uid, data) => ftcUserToMember(uid, data as FtcUserDoc),
  library: { shared: [["published", true], ["origin", "api"]], own: { filters: [["published", true]], teamField: "teamId" } },
};

export const snapshotSpec = (program: ProgramId): ProgramSnapshotSpec => (program === DEFAULT_PROGRAM ? rootSpec : namespacedSpec);

export type DatasetPart = { name: string; scope: "team" | "program"; build: () => Promise<unknown[]> };

/** The roster of a team: users first, then memberships of people whose user document points elsewhere (the browser's `mergeMembers` order). */
function rosterPart(db: Firestore, program: ProgramId, teamId: string): DatasetPart {
  const spec = snapshotSpec(program);
  return {
    name: "roster",
    scope: "team",
    build: async () => {
      const rows = await readServerRoster(db, program, teamId);
      const out: TeamMember[] = [];
      for (const row of rows) {
        if (row.source === "user") {
          const member = spec.mapMember(row.uid, row.data);
          if (member) out.push(member);
        } else {
          const membership = readMembership(row.data);
          if (membership) out.push(membershipToMember(membership));
        }
      }
      return out;
    },
  };
}

async function libraryDocs(db: Firestore, program: ProgramId, filters: Where[], teamFilter?: Where): Promise<unknown[]> {
  let q: FirebaseFirestore.Query = db.collection(programPath(program, "libraryMatches"));
  for (const [field, value] of [...filters, ...(teamFilter ? [teamFilter] : [])]) q = q.where(field, "==", value);
  const snap = await q.get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

function libraryParts(db: Firestore, program: ProgramId, teamId: string): DatasetPart[] {
  const spec = snapshotSpec(program).library;
  const parts: DatasetPart[] = [{ name: "library", scope: "program", build: () => libraryDocs(db, program, spec.shared) }];
  if (spec.own) parts.push({ name: "library-own", scope: "team", build: () => libraryDocs(db, program, spec.own!.filters, [spec.own!.teamField, teamId]) });
  return parts;
}

/** The parts of a dataset for an authorized team, in the order their rows are concatenated. Only the implemented datasets have parts. */
export function datasetParts(db: Firestore, dataset: SnapshotDataset, program: ProgramId, teamId: string): DatasetPart[] | null {
  if (dataset === "roster") return [rosterPart(db, program, teamId)];
  if (dataset === "library") return libraryParts(db, program, teamId);
  return null;
}
