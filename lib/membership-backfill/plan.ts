import { MAX_ACTIVE_MEMBERSHIPS } from "@/config/platform";
import { buildMembershipFromUser, membershipProblem, pointerOf, type MembershipDoc, type ProgramId } from "@/lib/memberships/model";

// The backfill's plan, pure: which memberships to create from user documents, and what to report instead. Nothing here reads or writes Firestore.

export type UserRow = { uid: string; data: Record<string, unknown> };
export type ExistingMembership = { program: ProgramId; teamId: string; uid: string; status: string };

export type PlanInput = {
  /** User documents per program (only those with a pointer are of interest; others are ignored). */
  users: Partial<Record<ProgramId, UserRow[]>>;
  /** EVERY existing membership of the programs involved, for the "has none" test and the per-account limit. */
  existing: ExistingMembership[];
  /** The team ids (per program) that exist as team documents; a pointer to anything else is reported, not backfilled. */
  teamsFound: Partial<Record<ProgramId, ReadonlySet<string>>>;
  /** Apply to these teams only (empty: all). */
  onlyTeams: readonly string[];
  nowMs: number;
};

export type PlannedCreate = { program: ProgramId; id: string; doc: MembershipDoc };

export type Plan = {
  toCreate: PlannedCreate[];
  perTeam: { program: ProgramId; teamId: string; toCreate: number }[];
  /** Pointers at a team document that does not exist: reported, not fixed, not backfilled. */
  missingTeams: { program: ProgramId; teamId: string; uids: string[] }[];
  /** Users that would pass the limit of active memberships per account (across programs): not backfilled. */
  wouldExceed: { program: ProgramId; teamId: string; uid: string }[];
  /** Users whose teamId or uid cannot make a key ("_" or "/"): not backfilled. */
  invalidIds: { program: ProgramId; teamId: string; uid: string }[];
  alreadyHave: number;
  outsideTeamFilter: number;
};

/** Which memberships to create, in a deterministic order (program, then team, then uid). Never plans a membership that exists (any status). */
export function planBackfill(input: PlanInput): Plan {
  const have = new Set(input.existing.map((m) => `${m.program}|${m.teamId}|${m.uid}`));
  const activeByUid = new Map<string, number>();
  for (const m of input.existing) if (m.status === "active") activeByUid.set(m.uid, (activeByUid.get(m.uid) ?? 0) + 1);

  const plan: Plan = { toCreate: [], perTeam: [], missingTeams: [], wouldExceed: [], invalidIds: [], alreadyHave: 0, outsideTeamFilter: 0 };
  const perTeam = new Map<string, number>();
  const missing = new Map<string, string[]>();
  const only = new Set(input.onlyTeams);

  for (const program of Object.keys(input.users).sort() as ProgramId[]) {
    const rows = [...(input.users[program] ?? [])].sort((a, b) => (pointerOf(a.data) + a.uid < pointerOf(b.data) + b.uid ? -1 : 1));
    for (const row of rows) {
      const teamId = pointerOf(row.data);
      if (teamId === "") continue;
      if (only.size && !only.has(teamId)) {
        plan.outsideTeamFilter++;
        continue;
      }
      const built = buildMembershipFromUser(program, row.uid, row.data, input.nowMs);
      if (!built.ok) {
        plan.invalidIds.push({ program, teamId, uid: row.uid });
        continue;
      }
      if (have.has(`${program}|${teamId}|${row.uid}`)) {
        plan.alreadyHave++;
        continue;
      }
      if (!input.teamsFound[program]?.has(teamId)) {
        const key = `${program}|${teamId}`;
        missing.set(key, [...(missing.get(key) ?? []), row.uid]);
        continue;
      }
      if ((activeByUid.get(row.uid) ?? 0) >= MAX_ACTIVE_MEMBERSHIPS) {
        plan.wouldExceed.push({ program, teamId, uid: row.uid });
        continue;
      }
      const problem = membershipProblem(built.doc);
      if (problem) {
        plan.invalidIds.push({ program, teamId, uid: row.uid });
        continue;
      }
      activeByUid.set(row.uid, (activeByUid.get(row.uid) ?? 0) + 1);
      plan.toCreate.push({ program, id: built.id, doc: built.doc });
      perTeam.set(`${program}|${teamId}`, (perTeam.get(`${program}|${teamId}`) ?? 0) + 1);
    }
  }
  plan.perTeam = [...perTeam].map(([k, n]) => ({ program: k.split("|")[0] as ProgramId, teamId: k.split("|").slice(1).join("|"), toCreate: n }));
  plan.missingTeams = [...missing].map(([k, uids]) => ({ program: k.split("|")[0] as ProgramId, teamId: k.split("|").slice(1).join("|"), uids }));
  return plan;
}
