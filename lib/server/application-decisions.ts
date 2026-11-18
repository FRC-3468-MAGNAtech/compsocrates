import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { PROGRAMS } from "@/config/programs";
import type { ProgramId } from "@/config/programs/types";
import { programPath } from "@/lib/firebase/paths";
import { effectiveStatus } from "@/lib/applications";
import { DEFAULT_ROLE_ID, type RoleId } from "@/lib/roles";
import { MembershipError } from "@/lib/memberships/model";
import { readCreationState, writeCreatorMembership } from "@/lib/server/membership-flows";
import { getMembershipsEnabled } from "@/lib/server/team-settings";
import { claimFreeTeamCode } from "@/lib/server/team-create";
import { TEAM_PLANNERS } from "@/lib/server/application-teams";
import { platformAuditDoc, teamAuditDoc } from "@/lib/server/audit";

/**
 * The platform owner's decisions on a team application, ONE implementation for every program: the program supplies the collections (`programPath`), the team
 * number field (`ProgramConfig.membership.flows.newTeam`) and the document shapes (`application-teams.ts`).
 *
 *  - approve: ONE transaction creates the team (join code, number, name, the applicant as owner), makes the applicant its owner and admin, marks the application
 *    approved and writes the audit entries. Refuses an expired or decided application, a number some team in THIS program already has, and (while memberships are
 *    OFF) an applicant who already has a team here. The POINTER (`users/{uid}.teamId`) is set only when the account has no active team in the program; with
 *    memberships ON an account that already has a team gets the new team as a VERIFIED owner membership only (the five-team limit applies), the pointer untouched.
 *  - reject (with a reason the applicant sees), block (email and/or team number, per program), unblock, notes.
 */

export class RouteError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type Actor = { uid: string; name: string };

export function toMs(value: unknown): number | null {
  return value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: unknown }).toMillis === "function" ? (value as { toMillis: () => number }).toMillis() : null;
}

const col = (db: Firestore, program: ProgramId, name: string) => db.collection(programPath(program, name));
const hasTeam = (user: Record<string, unknown> | null): boolean => typeof user?.teamId === "string" && user.teamId.trim() !== "";

/** The team-number value as the program's team documents store it (a string or a number). */
export function storedTeamNumber(program: ProgramId, n: number): string | number {
  return PROGRAMS[program].membership.flows.newTeam.numberKind === "string" ? String(n) : n;
}

/** Is there already a team in `program` with this number? (a limit-1 query on the program's own number field) */
export async function teamNumberTaken(db: Firestore, program: ProgramId, n: number): Promise<boolean> {
  const field = PROGRAMS[program].membership.flows.newTeam.numberField;
  const snap = await col(db, program, "teams").where(field, "==", storedTeamNumber(program, n)).limit(1).get();
  return !snap.empty;
}

export async function approveApplication(
  db: Firestore,
  program: ProgramId,
  applicationId: string,
  actor: Actor,
  nowMs: number = Date.now(),
  random: () => number = Math.random
): Promise<{ teamId: string; email: string; name: string; teamNumber: number }> {
  // Memberships (build 2): with the kill switch ON the applicant also gets a VERIFIED owner membership in the same transaction. OFF: nothing extra happens.
  const membershipsOn = await getMembershipsEnabled(db, nowMs).catch(() => false);
  const numberField = PROGRAMS[program].membership.flows.newTeam.numberField;
  return db.runTransaction(async (txn) => {
    const appRef = col(db, program, "teamApplications").doc(applicationId);
    const appSnap = await txn.get(appRef);
    if (!appSnap.exists) throw new RouteError(404, "not-found", "That application doesn't exist.");
    const app = appSnap.data()!;
    const status = effectiveStatus({ status: app.status, expiresAtMs: toMs(app.expiresAt) }, nowMs);
    if (status === "expired") throw new RouteError(409, "expired", "This application has expired. Ask the applicant to apply again.");
    if (status !== "pending") throw new RouteError(409, "already-decided", `This application is already ${status}.`);

    const userRef = col(db, program, "users").doc(app.applicantUid);
    const [userSnap, numberSnap, code] = await Promise.all([
      txn.get(userRef),
      txn.get(col(db, program, "teams").where(numberField, "==", storedTeamNumber(program, app.teamNumber)).limit(1)),
      claimFreeTeamCode(db, txn, random, program),
    ]);
    const applicant = userSnap.exists ? ((userSnap.data() ?? {}) as Record<string, unknown>) : null;
    const pointerFree = !hasTeam(applicant);
    if (!pointerFree && !membershipsOn) throw new RouteError(409, "already-member", "The applicant has already joined a team account.");
    if (!numberSnap.empty) throw new RouteError(409, "account-exists", `An account for team ${app.teamNumber} already exists.`);
    if (!code) throw new RouteError(503, "code-collision", "Couldn't pick a free join code. Try again.");
    const created = membershipsOn ? await readCreationState(db, txn, program, code, app.applicantUid) : null;

    const role: RoleId = (app.role as RoleId) ?? DEFAULT_ROLE_ID;
    const plan = TEAM_PLANNERS[program]({ code, uid: app.applicantUid, email: String(app.applicantEmail ?? ""), name: String(app.applicantName ?? ""), teamNumber: app.teamNumber, teamName: String(app.teamName ?? ""), role, applicationId, nowMs });
    const teamRef = col(db, program, "teams").doc(code);

    txn.set(teamRef, plan.teamDoc);
    // The pointer moves only for an account with no active team in this program; an existing user document keeps all its other fields (merge).
    if (pointerFree) {
      if (applicant) txn.set(userRef, plan.userPatch, { merge: true });
      else txn.set(userRef, plan.userNew);
    }
    if (created) {
      try {
        writeCreatorMembership(txn, program, created, { uid: app.applicantUid, teamId: code, name: String(app.applicantName ?? ""), teamLabel: plan.teamLabel, role: plan.role, fieldTeamIds: plan.fieldTeamIds, nowMs });
      } catch (err) {
        if (err instanceof MembershipError) throw new RouteError(err.status, err.code, err.message);
        throw err;
      }
    }
    txn.update(appRef, { status: "approved", decidedAt: FieldValue.serverTimestamp(), decidedBy: actor.uid, teamId: teamRef.id });
    // The new account's own log gets a minimal entry (no applicant details); the platform log gets the full one.
    txn.set(col(db, program, "auditLog").doc(), teamAuditDoc(teamRef.id, actor.uid, actor.name, "approve-team-application", { applicationId }, null, { verifiedOwnerId: app.applicantUid, teamNumber: app.teamNumber }));
    txn.set(col(db, program, "platformAuditLog").doc(), platformAuditDoc("approve-application", actor, { applicationId, teamId: teamRef.id, teamNumber: app.teamNumber, applicantUid: app.applicantUid, program }));
    return { teamId: teamRef.id, email: app.applicantEmail as string, name: app.applicantName as string, teamNumber: app.teamNumber as number };
  });
}

export async function decideApplication(
  db: Firestore,
  program: ProgramId,
  applicationId: string,
  actor: Actor,
  outcome: "rejected" | "blocked",
  reason: string,
  blocks: { blockEmail?: boolean; blockTeam?: boolean } = {},
  nowMs: number = Date.now()
): Promise<{ email: string; name: string; teamNumber: number }> {
  return db.runTransaction(async (txn) => {
    const appRef = col(db, program, "teamApplications").doc(applicationId);
    const snap = await txn.get(appRef);
    if (!snap.exists) throw new RouteError(404, "not-found", "That application doesn't exist.");
    const app = snap.data()!;
    const status = effectiveStatus({ status: app.status, expiresAtMs: toMs(app.expiresAt) }, nowMs);
    if (status === "expired") throw new RouteError(409, "expired", "This application has expired.");
    if (status !== "pending") throw new RouteError(409, "already-decided", `This application is already ${status}.`);

    txn.update(appRef, { status: outcome, rejectionReason: reason || null, decidedAt: FieldValue.serverTimestamp(), decidedBy: actor.uid });
    if (outcome === "blocked") {
      const common = { reason: reason || null, applicationId, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid };
      const blocksCol = col(db, program, "applicationBlocks");
      if (blocks.blockEmail) txn.set(blocksCol.doc(`email_${app.emailKey}`), { type: "email", value: app.applicantEmail, ...common });
      if (blocks.blockTeam) txn.set(blocksCol.doc(`team_${app.teamNumber}`), { type: "team", value: String(app.teamNumber), ...common });
    }
    txn.set(
      col(db, program, "platformAuditLog").doc(),
      platformAuditDoc(outcome === "blocked" ? "block-application" : "reject-application", actor, {
        applicationId,
        teamNumber: app.teamNumber,
        reason: reason || null,
        program,
        // (Firestore refuses `undefined` values, so the key is only present for a block.)
        ...(outcome === "blocked" ? { blocked: { email: blocks.blockEmail === true, team: blocks.blockTeam === true } } : {}),
      })
    );
    return { email: app.applicantEmail as string, name: app.applicantName as string, teamNumber: app.teamNumber as number };
  });
}
