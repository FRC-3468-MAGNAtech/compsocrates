import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { isPlatformOwnerToken } from "@/lib/server/owner-admin";
import { APPLICATION_LIMITS, sanitizeLine, sanitizeText } from "@/lib/applications";
import { programPath } from "@/lib/firebase/paths";
import { PROGRAMS } from "@/config/programs";
import { platformAuditDoc } from "@/lib/server/audit";
import { appBaseUrl, sendEmail } from "@/lib/server/email";
import { emailTemplates } from "@/lib/server/email-templates";
import { parseProgram } from "@/lib/server/memberships";
import { RouteError, approveApplication, decideApplication } from "@/lib/server/application-decisions";

/**
 * P20 (both programs since memberships build 3): the platform owner's review actions on team applications. Every action requires a platform owner (verified email in
 * RELEASE_OWNER_EMAILS plus the claim) and a REQUIRED `program` in the body (400 otherwise), and is logged in `platformAuditLog`. Nothing here is automatic: approval only
 * happens when the platform owner presses it. The rules of each action are in lib/server/application-decisions.ts (one implementation for every program).
 */
export async function POST(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!isPlatformOwnerToken(decoded)) return NextResponse.json({ ok: false, error: "Only the platform owner can do this." }, { status: 403 });

  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseProgram(body?.program);
  if (!parsed.ok) return NextResponse.json({ ok: false, code: parsed.code, error: parsed.error }, { status: parsed.status });
  const program = parsed.program;
  const action = typeof body?.action === "string" ? body.action : "";
  const actor = { uid: decoded.uid, name: sanitizeLine(decoded.name ?? decoded.email ?? "Platform owner", 80) };
  const applications = () => db.collection(programPath(program, "teamApplications"));

  try {
    switch (action) {
      case "approve": {
        const applicationId = String(body?.applicationId ?? "");
        // The applicant must still exist and still have a verified email; checked outside the transaction (an Auth call).
        const appSnap = await applications().doc(applicationId).get();
        if (!appSnap.exists) throw new RouteError(404, "not-found", "That application doesn't exist.");
        const applicantUid = String(appSnap.data()?.applicantUid ?? "");
        const applicant = await adminAuth.getUser(applicantUid).catch(() => null);
        if (!applicant) throw new RouteError(409, "applicant-gone", "The applicant's sign-in account no longer exists.");
        if (!applicant.emailVerified) throw new RouteError(409, "email-unverified", "The applicant's email isn't verified.");
        const result = await approveApplication(db, program, applicationId, actor);
        await sendEmail(emailTemplates.applicationApproved({ to: result.email, name: result.name, teamNumber: result.teamNumber, appUrl: `${appBaseUrl()}/${program}/dashboard` })).catch(() => {});
        return NextResponse.json({ ok: true, teamId: result.teamId, programLabel: PROGRAMS[program].brand.label });
      }
      case "reject": {
        const reason = sanitizeText(body?.reason, APPLICATION_LIMITS.reason);
        if (reason.length < 3) throw new RouteError(400, "reason-required", "Give the applicant a reason (a sentence is fine).");
        const decided = await decideApplication(db, program, String(body?.applicationId ?? ""), actor, "rejected", reason);
        await sendEmail(emailTemplates.applicationRejected({ to: decided.email, name: decided.name, teamNumber: decided.teamNumber, reason, statusUrl: `${appBaseUrl()}/apply` })).catch(() => {});
        return NextResponse.json({ ok: true });
      }
      case "block": {
        const blockEmail = body?.blockEmail === true;
        const blockTeam = body?.blockTeam === true;
        if (!blockEmail && !blockTeam) throw new RouteError(400, "nothing-to-block", "Choose the email, the team number, or both to block.");
        const reason = sanitizeText(body?.reason, APPLICATION_LIMITS.reason);
        await decideApplication(db, program, String(body?.applicationId ?? ""), actor, "blocked", reason, { blockEmail, blockTeam });
        return NextResponse.json({ ok: true });
      }
      case "unblock": {
        const blockId = String(body?.blockId ?? "");
        if (!/^(email_[0-9a-f]{32}|team_\d{1,5})$/.test(blockId)) throw new RouteError(400, "bad-block", "That isn't a block.");
        const batch = db.batch();
        batch.delete(db.collection(programPath(program, "applicationBlocks")).doc(blockId));
        batch.set(db.collection(programPath(program, "platformAuditLog")).doc(), platformAuditDoc("unblock", actor, { blockId, program }));
        await batch.commit();
        return NextResponse.json({ ok: true });
      }
      case "note": {
        const applicationId = String(body?.applicationId ?? "");
        if (!(await applications().doc(applicationId).get()).exists) throw new RouteError(404, "not-found", "That application doesn't exist.");
        await db.collection(programPath(program, "applicationPrivate")).doc(applicationId).set({ notes: sanitizeText(body?.notes, APPLICATION_LIMITS.notes), notesUpdatedAt: FieldValue.serverTimestamp(), notesUpdatedBy: actor.uid }, { merge: true });
        return NextResponse.json({ ok: true });
      }
      default:
        throw new RouteError(400, "unknown-action", "Unknown action.");
    }
  } catch (err) {
    if (err instanceof RouteError) return NextResponse.json({ ok: false, code: err.code, error: err.message }, { status: err.status });
    console.error("applications route failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
