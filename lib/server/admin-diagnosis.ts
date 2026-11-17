import "server-only";
import { getApps } from "firebase-admin/app";
import { firebaseAdminEnv } from "@/lib/server/env";

/** The project a service-account email belongs to (`name@PROJECT.iam.gserviceaccount.com`), or null for any other shape. Pure. */
export function serviceAccountProject(email: string): string | null {
  const match = /^[^@]+@([a-z0-9-]+)\.iam\.gserviceaccount\.com$/i.exec(email.trim());
  return match ? match[1] : null;
}

/**
 * A short, secret-free sentence on whether the Admin credentials work, for an error shown to the person who has to fix the deployment: the project the
 * server uses, the project the service account belongs to (they must match), and whether Google hands out an access token for the key. Never throws,
 * never includes the key, the email or a token. Takes at most `limitMs`.
 */
export async function describeAdminProblem(limitMs: number = 8000): Promise<string> {
  const { projectId, clientEmail } = firebaseAdminEnv();
  const accountProject = serviceAccountProject(clientEmail);
  const parts: string[] = [];
  if (!accountProject) parts.push("The service account email does not look like a Firebase service account.");
  else if (projectId && accountProject !== projectId) parts.push(`The server uses project "${projectId}" but its service account belongs to "${accountProject}": they must be the same project.`);
  else parts.push("The server's project and its service account's project match.");

  const credential = getApps()[0]?.options.credential;
  if (!credential) {
    parts.push("The Admin app has not started.");
    return parts.join(" ");
  }
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([credential.getAccessToken(), new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("no answer from Google")), limitMs)))]);
    parts.push(`Google accepted the key (${Date.now() - started} ms), so the problem is reaching Firestore itself.`);
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 160);
    parts.push(`Google did not give the key an access token: ${message}.`);
  } finally {
    clearTimeout(timer);
  }
  return parts.join(" ");
}
