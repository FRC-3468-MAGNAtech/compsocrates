import "server-only";
import { appUrl, emailFrom, releaseOwnerEmails, resendApiKey, vercelHost } from "@/lib/server/env";

// P20: outbound email, just enough for application and ownership-transfer notices. A thin sender over Resend's HTTP
// API (no SDK or new dependency): set RESEND_API_KEY and EMAIL_FROM ("<Sender name> <notify@yourdomain.org>", a sender
// on a domain you verified in Resend). With either unset, sendEmail() does nothing and says so. Nothing in the app
// depends on an email arriving: every notice is also shown in the app, and a failure never fails the request.

export type EmailMessage = { to: string | string[]; subject: string; text: string; html?: string };
export type EmailResult = { sent: true } | { sent: false; reason: "not-configured" | "no-recipient" | "error" };

export function isEmailConfigured(): boolean {
  return Boolean(resendApiKey() && emailFrom());
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export async function sendEmail(message: EmailMessage, fetchImpl: typeof fetch = fetch): Promise<EmailResult> {
  const key = resendApiKey();
  const from = emailFrom();
  if (!key || !from) return { sent: false, reason: "not-configured" };
  const to = (Array.isArray(message.to) ? message.to : [message.to]).filter((a) => EMAIL_RE.test(a)).slice(0, 20);
  if (to.length === 0) return { sent: false, reason: "no-recipient" };
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: message.subject.slice(0, 200), text: message.text, ...(message.html ? { html: message.html } : {}) }),
    });
    if (!res.ok) {
      console.error(`Email send failed: Resend answered ${res.status}`);
      return { sent: false, reason: "error" };
    }
    return { sent: true };
  } catch (err) {
    console.error("Email send failed:", err instanceof Error ? err.message : err);
    return { sent: false, reason: "error" };
  }
}

/** The app's public base URL for links in emails: APP_URL, else Vercel's production URL, else the preview URL, else localhost. */
export function appBaseUrl(): string {
  const explicit = appUrl();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = vercelHost();
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}

/** Platform owners' addresses (RELEASE_OWNER_EMAILS, lowercased), for "a new application arrived". */
export function platformOwnerEmails(): string[] {
  return releaseOwnerEmails();
}
