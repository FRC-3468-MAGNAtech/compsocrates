import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminMessaging } from "@/lib/firebase/admin";
import { appBaseUrl, platformOwnerEmails, sendEmail } from "@/lib/server/email";
import { emailTemplates } from "@/lib/server/email-templates";
import { CS_OWNER_UIDS } from "@/config/cs";

/**
 * Push tokens of every platform owner: users carrying the `isPlatformOwner` mirror (email owners, written by sync-roles) plus the
 * users whose uid is in `CS_OWNER_UIDS` (CS's owner layer has no mirror field, so they are read by id).
 */
async function platformOwnerPushTokens(db: Firestore): Promise<string[]> {
  const [mirrored, byUid] = await Promise.all([
    db.collection("users").where("isPlatformOwner", "==", true).get(),
    Promise.all(CS_OWNER_UIDS.map((uid) => db.collection("users").doc(uid).get())),
  ]);
  const docs = [...mirrored.docs, ...byUid.filter((d) => d.exists)];
  return [...new Set(docs.flatMap((d) => (Array.isArray(d.data()?.fcmTokens) ? (d.data()?.fcmTokens as string[]) : [])))];
}

/**
 * P20: tells the platform owner(s) a new application arrived. Two best-effort channels (the in-app badge on the
 * Admin Panel needs no sending: it counts pending applications live): a web push to every device any
 * platform owner enabled push on (`users.fcmTokens`, the same tokens live-score notifications use), and an email to
 * the OWNER_EMAILS addresses (when email is configured). Neither can fail the application.
 */
export async function notifyPlatformOwnersOfApplication(
  db: Firestore,
  app: { applicationId: string; applicantName: string; applicantEmail: string; teamNumber: number; teamName: string; role: string }
): Promise<void> {
  const title = `New team application: FTC ${app.teamNumber}`;
  const body = `${app.applicantName} applied to create a team account.`;

  try {
    const messaging = getAdminMessaging();
    if (messaging) {
      const tokens = await platformOwnerPushTokens(db);
      if (tokens.length > 0) {
        await messaging.sendEachForMulticast({ tokens, notification: { title, body }, data: { applicationId: app.applicationId, url: "/admin" } });
      }
    }
  } catch (err) {
    console.error("application push failed:", err instanceof Error ? err.message : err);
  }

  const to = platformOwnerEmails();
  if (to.length > 0) {
    await sendEmail(emailTemplates.newApplicationForOwner({ to, ...app, queueUrl: `${appBaseUrl()}/admin` }));
  }
}

/**
 * P23: tells the platform owner(s) a form template is waiting for review (a new publish request, or a new version of a public template). Same two
 * best-effort channels as applications (push to their devices, email to OWNER_EMAILS); the Template Review tab needs no sending, it reads the queue live.
 */
export async function notifyPlatformOwnersOfTemplate(db: Firestore, t: { templateId: string; templateName: string; authorName: string; update: boolean }): Promise<void> {
  const title = t.update ? `Template update: ${t.templateName}` : `Template to review: ${t.templateName}`;
  try {
    const messaging = getAdminMessaging();
    if (messaging) {
      const tokens = await platformOwnerPushTokens(db);
      if (tokens.length > 0) await messaging.sendEachForMulticast({ tokens, notification: { title, body: `${t.authorName} sent a template for review.` }, data: { templateId: t.templateId, url: "/admin" } });
    }
  } catch (err) {
    console.error("template push failed:", err instanceof Error ? err.message : err);
  }
  const to = platformOwnerEmails();
  if (to.length > 0) await sendEmail(emailTemplates.templatePublishRequested({ to, templateName: t.templateName, authorName: t.authorName, update: t.update, queueUrl: `${appBaseUrl()}/admin` }));
}
