import "server-only";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { generateTeamCode } from "@/data/cs/join-requests";
import { PROGRAMS } from "@/config/programs";
import { DEFAULT_PROGRAM, type ProgramId } from "@/config/programs/types";
import { programPath } from "@/lib/firebase/paths";

/** How many fresh codes one attempt looks at (all read inside the transaction, so a code can't be taken between check and write). */
const CODE_CANDIDATES = 6;

/**
 * A free uppercase team code for `program` (its length comes from `ProgramConfig.membership.flows.newTeam.joinCodeLength`), or null if every candidate is taken.
 * Reads candidate team docs INSIDE the transaction (so the code can't be claimed between check and write); call it before the transaction's first write.
 *
 * Team creation itself is no longer a route: a new team comes only from an approved application (`lib/server/application-decisions.ts`), and `POST /api/team/create`
 * answers 410 for every program (memberships build 3).
 */
export async function claimFreeTeamCode(db: Firestore, txn: Transaction, random: () => number = Math.random, program: ProgramId = DEFAULT_PROGRAM): Promise<string | null> {
  const length = PROGRAMS[program].membership.flows.newTeam.joinCodeLength;
  const candidates = [...new Set(Array.from({ length: CODE_CANDIDATES }, () => generateTeamCode(random, length)))];
  const snaps = await Promise.all(candidates.map((c) => txn.get(db.collection(programPath(program, "teams")).doc(c))));
  const free = snaps.findIndex((s) => !s.exists);
  return free < 0 ? null : candidates[free];
}
