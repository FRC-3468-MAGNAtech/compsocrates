import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import type { ProgramId } from "@/config/programs/types";
import { buildBaseUserDoc, buildCreatorUserPatch, buildNewTeamDoc } from "@/data/cs/join-requests";
import { ftcNewTeamDocs } from "@/data/ftc/enrollment";
import { teamLabelOfDoc } from "@/lib/memberships/flows";
import type { RoleId } from "@/lib/roles";

/**
 * What an approved application turns into, per program: the new team document, the owner's user document (a whole one for an account that has none in the
 * program, or a patch for an account that has one without an active team), and the membership facts. The DOCUMENT SHAPES are each program's own data layer
 * (`data/cs`, `data/ftc`), so they sit here behind one table keyed by program id; the approval flow that calls them (`application-decisions.ts`) is one
 * implementation and never asks which program it serves.
 */
export type TeamPlanInput = { code: string; uid: string; email: string; name: string; teamNumber: number; teamName: string; role: RoleId; applicationId: string; nowMs: number };

export type TeamPlan = {
  teamDoc: Record<string, unknown>;
  userNew: Record<string, unknown>;
  userPatch: Record<string, unknown>;
  /** The role stored on the owner's membership. */
  role: string;
  teamLabel: string;
  /** The owner's field teams for the membership (a program that has none: null). */
  fieldTeamIds: string[] | null;
};

const USER_PATCH_KEYS = ["teamId", "primaryRole", "secondaryRoles", "isAdmin", "isOwner", "fieldTeamIds"] as const;

function rootPlan(i: TeamPlanInput): TeamPlan {
  const teamDoc = { ...buildNewTeamDoc({ teamNumber: i.teamNumber, teamName: i.teamName, ownerUid: i.uid }, i.nowMs), applicationId: i.applicationId };
  const patch = buildCreatorUserPatch({ teamId: i.code, role: i.role });
  return {
    teamDoc,
    userNew: { ...buildBaseUserDoc({ uid: i.uid, email: i.email, displayName: i.name, role: i.role }, i.nowMs), ...patch },
    userPatch: patch,
    role: String(patch.role ?? i.role),
    teamLabel: teamLabelOfDoc({ teamNumber: String(i.teamNumber), teamName: i.teamName }),
    fieldTeamIds: null,
  };
}

function namespacedPlan(i: TeamPlanInput): TeamPlan {
  const docs = ftcNewTeamDocs(i.code, { uid: i.uid, email: i.email, name: i.name, teamNumber: i.teamNumber, teamName: i.teamName || `Team ${i.teamNumber}`, location: "", role: i.role }, FieldValue.serverTimestamp());
  const userPatch: Record<string, unknown> = {};
  for (const key of USER_PATCH_KEYS) userPatch[key] = docs.user[key];
  return {
    teamDoc: { ...docs.team, applicationId: i.applicationId },
    userNew: docs.user,
    userPatch,
    role: i.role,
    teamLabel: teamLabelOfDoc(docs.team),
    fieldTeamIds: Array.isArray(docs.user.fieldTeamIds) ? (docs.user.fieldTeamIds as string[]) : null,
  };
}

export const TEAM_PLANNERS: Record<ProgramId, (input: TeamPlanInput) => TeamPlan> = { frc: rootPlan, ftc: namespacedPlan };
