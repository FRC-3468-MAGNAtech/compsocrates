import "server-only";

/**
 * The one place server code reads environment variables. Everything that needs a key calls a getter here, so a missing
 * or malformed value is handled the same way everywhere, and `missingEnv()` can tell an admin exactly what is not set
 * (names only, never values).
 *
 * Variable names follow the CompSocrates app's `.env.example` wherever the meaning is the same:
 *   NEXT_PUBLIC_FIREBASE_*, NEXT_PUBLIC_TBA_API_KEY, FIRST_API_USERNAME, FIRST_API_TOKEN, RELEASE_OWNER_UIDS, RELEASE_OWNER_EMAILS
 * On top of those, the Firebase Admin credentials are required (server routes verify sign-ins and write on a user's
 * behalf with them), and a few optional services each switch a feature on. The shared-login variables the old app used
 * (MIGRATION_EMAIL / MIGRATION_PASSWORD) and TBA_KEY_ENCRYPTION_SECRET are intentionally not read.
 *
 * NEXT_PUBLIC_TBA_API_KEY keeps its name from the old app, but it is only ever read here, on the server: no client code
 * references it, so it is never inlined into a browser bundle.
 */

export type EnvGroup = "cs" | "required" | "optional" | "ftc";

export type EnvVarInfo = {
  name: string;
  group: EnvGroup;
  /** What it is for. */
  purpose: string;
  /** What stops working while it is unset. */
  whenMissing: string;
};

export const ENV_VARS: readonly EnvVarInfo[] = [
  { name: "NEXT_PUBLIC_FIREBASE_API_KEY", group: "cs", purpose: "Firebase web app config", whenMissing: "Sign-in and all data (the app cannot reach Firebase)." },
  { name: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", group: "cs", purpose: "Firebase web app config", whenMissing: "Sign-in." },
  { name: "NEXT_PUBLIC_FIREBASE_PROJECT_ID", group: "cs", purpose: "Firebase web app config", whenMissing: "All data." },
  { name: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", group: "cs", purpose: "Firebase web app config", whenMissing: "File storage references." },
  { name: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", group: "cs", purpose: "Firebase web app config", whenMissing: "Push notifications." },
  { name: "NEXT_PUBLIC_FIREBASE_APP_ID", group: "cs", purpose: "Firebase web app config", whenMissing: "Sign-in." },
  { name: "NEXT_PUBLIC_TBA_API_KEY", group: "cs", purpose: "The Blue Alliance API key (read on the server only)", whenMissing: "Event names, schedules, teams, rankings and playoff brackets." },
  { name: "FIRST_API_USERNAME", group: "cs", purpose: "FIRST FRC Events API username", whenMissing: "Practice schedules and the FIRST fallback for teams and rankings." },
  { name: "FIRST_API_TOKEN", group: "cs", purpose: "FIRST FRC Events API token", whenMissing: "Practice schedules and the FIRST fallback for teams and rankings." },
  { name: "RELEASE_OWNER_UIDS", group: "cs", purpose: "Comma-separated uids of the platform owner(s)", whenMissing: "Nobody is treated as platform owner." },
  { name: "RELEASE_OWNER_EMAILS", group: "cs", purpose: "Comma-separated emails of the platform owner(s)", whenMissing: "Owner-by-email recognition." },
  { name: "FTC_API_USERNAME", group: "ftc", purpose: "FIRST FTC Events API username (FTC program only)", whenMissing: "FTC event data (events, teams, schedules, rankings): the FTC pages show a notice naming the variable. FRC is unaffected." },
  { name: "FTC_API_KEY", group: "ftc", purpose: "FIRST FTC Events API key (FTC program only)", whenMissing: "Same as FTC_API_USERNAME." },
  { name: "FTC_API_BASE_URL", group: "ftc", purpose: "Override for the FTC Events API base URL (FTC program only)", whenMissing: "Nothing: it defaults to the public FIRST FTC API v2.0." },
  { name: "FIREBASE_ADMIN_CLIENT_EMAIL", group: "required", purpose: "Firebase Admin service account", whenMissing: "Server sign-in checks: event data, team join approvals, role sync, account deletion." },
  { name: "FIREBASE_ADMIN_PRIVATE_KEY", group: "required", purpose: "Firebase Admin service account (paste with \\n sequences)", whenMissing: "Server sign-in checks: event data, team join approvals, role sync, account deletion." },
  { name: "FIREBASE_ADMIN_PROJECT_ID", group: "optional", purpose: "Override for the Admin SDK's project id", whenMissing: "Nothing: it defaults to NEXT_PUBLIC_FIREBASE_PROJECT_ID, which is the same project in every normal setup." },
  { name: "APP_URL", group: "optional", purpose: "Public URL used in links inside emails", whenMissing: "Falls back to the host's own URL variables." },
  { name: "CRON_SECRET", group: "optional", purpose: "Protects the scheduled live-score poller", whenMissing: "The poller route refuses to run." },
  { name: "RESEND_API_KEY", group: "optional", purpose: "Sends email through Resend", whenMissing: "No notification emails (the app still works)." },
  { name: "EMAIL_FROM", group: "optional", purpose: "Sender for outgoing email", whenMissing: "No notification emails." },
  { name: "NEXT_PUBLIC_TURNSTILE_SITE_KEY", group: "optional", purpose: "Cloudflare Turnstile site key", whenMissing: "The bot check on the team application form is skipped." },
  { name: "TURNSTILE_SECRET_KEY", group: "optional", purpose: "Cloudflare Turnstile secret", whenMissing: "The bot check on the team application form is skipped." },
  { name: "BLOB_READ_WRITE_TOKEN", group: "optional", purpose: "Vercel Blob storage for photos", whenMissing: "Photo uploads." },
  { name: "NEXT_PUBLIC_FIREBASE_VAPID_KEY", group: "optional", purpose: "Web push key", whenMissing: "Push notifications." },
  { name: "APPLICATION_SECRET", group: "optional", purpose: "Signs team-application tokens", whenMissing: "Falls back to a key derived from the Admin credentials." },
  { name: "NEXT_PUBLIC_RELEASE_OWNER_UIDS", group: "optional", purpose: "Optional browser copy of RELEASE_OWNER_UIDS", whenMissing: "Nothing: the server reads RELEASE_OWNER_UIDS; this only lets the UI know who the owner is." },
] as const;

const read = (name: string): string => (process.env[name] ?? "").trim();

/** A comma, semicolon or whitespace separated list, without empties or duplicates. */
export function parseList(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
}

/** The Blue Alliance key, or null when unset. */
export function tbaApiKey(): string | null {
  return read("NEXT_PUBLIC_TBA_API_KEY") || null;
}

/** FIRST FRC API credentials, or null unless both parts are set. */
export function firstApiCredentials(): { username: string; token: string } | null {
  const username = read("FIRST_API_USERNAME");
  const token = read("FIRST_API_TOKEN");
  return username && token ? { username, token } : null;
}

/** The FIRST credential variables that are unset, by name (empty when both are set). */
export function firstApiMissingNames(): string[] {
  return ["FIRST_API_USERNAME", "FIRST_API_TOKEN"].filter((name) => !read(name));
}

/** FTC Events API credentials, or null unless both parts are set. */
export function ftcApiCredentials(): { username: string; apiKey: string } | null {
  const username = read("FTC_API_USERNAME");
  const apiKey = read("FTC_API_KEY");
  return username && apiKey ? { username, apiKey } : null;
}

/** FTC Events API base URL (override with FTC_API_BASE_URL). */
export function ftcApiBaseUrl(): string {
  return read("FTC_API_BASE_URL") || "https://ftc-api.firstinspires.org/v2.0";
}

/** The FTC credential variables that are unset, by name. */
export function ftcApiMissingNames(): string[] {
  return ["FTC_API_USERNAME", "FTC_API_KEY"].filter((name) => !read(name));
}

/**
 * The project the Admin SDK talks to: `FIREBASE_ADMIN_PROJECT_ID` when set (an override), otherwise the same
 * `NEXT_PUBLIC_FIREBASE_PROJECT_ID` the browser uses. They are the same project in every normal setup, so one is enough.
 */
function firebaseAdminProjectId(): string {
  return read("FIREBASE_ADMIN_PROJECT_ID") || read("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
}

/** Both project ids when they are set and differ (a misconfiguration: sign-ins would be checked against the wrong project), else null. */
export function firebaseProjectIdMismatch(): { admin: string; web: string } | null {
  const admin = read("FIREBASE_ADMIN_PROJECT_ID");
  const web = read("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  return admin && web && admin !== web ? { admin, web } : null;
}

/** The variables the Admin SDK still needs that are unset, by name (empty when it can start). The project id is reported as the web one it falls back to. */
export function firebaseAdminMissingNames(): string[] {
  const missing = ["FIREBASE_ADMIN_CLIENT_EMAIL", "FIREBASE_ADMIN_PRIVATE_KEY"].filter((name) => !read(name));
  if (!firebaseAdminProjectId()) missing.unshift("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  return missing;
}

/** Raw Firebase Admin values; `lib/firebase/admin.ts` validates and cleans the private key. */
export function firebaseAdminEnv(): { projectId: string; clientEmail: string; privateKey: string } {
  return {
    projectId: firebaseAdminProjectId(),
    clientEmail: read("FIREBASE_ADMIN_CLIENT_EMAIL"),
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "",
  };
}

/** Platform owner uids (case sensitive, compared exactly). */
export function releaseOwnerUids(): string[] {
  return parseList(read("RELEASE_OWNER_UIDS") || read("NEXT_PUBLIC_RELEASE_OWNER_UIDS"));
}

/** Platform owner emails, lowercased. */
export function releaseOwnerEmails(): string[] {
  return parseList(read("RELEASE_OWNER_EMAILS").toLowerCase());
}

export const appUrl = (): string | null => read("APP_URL") || null;
export const cronSecret = (): string | null => read("CRON_SECRET") || null;
export const resendApiKey = (): string | null => read("RESEND_API_KEY") || null;
export const emailFrom = (): string | null => read("EMAIL_FROM") || null;
export const turnstileSecret = (): string | null => read("TURNSTILE_SECRET_KEY") || null;
export const blobToken = (): string | null => read("BLOB_READ_WRITE_TOKEN") || null;
export const applicationSecret = (): string | null => read("APPLICATION_SECRET") || null;
export const turnstileSiteKey = (): string | null => read("NEXT_PUBLIC_TURNSTILE_SITE_KEY") || null;
/** Vercel's production URL (no scheme), else the deployment's own URL; null off Vercel. */
export const vercelHost = (): string | null => read("VERCEL_PROJECT_PRODUCTION_URL") || read("VERCEL_URL") || null;
/** The Admin private key exactly as set (not trimmed: it is hashed to derive the server secret when APPLICATION_SECRET is unset). */
export const firebaseAdminPrivateKeyRaw = (): string | null => process.env.FIREBASE_ADMIN_PRIVATE_KEY || null;

export type MissingEnvVar = EnvVarInfo;

/**
 * The variables that are not set, with what that breaks. Names and descriptions only, never values. `group` filters:
 * the default is the ones the app cannot run well without ("cs" and "required").
 */
export function missingEnv(groups: readonly EnvGroup[] = ["cs", "required"]): MissingEnvVar[] {
  // RELEASE_OWNER_EMAILS and RELEASE_OWNER_UIDS are alternatives for recognising an owner: one of the two is enough.
  const ownerSet = read("RELEASE_OWNER_UIDS") || read("NEXT_PUBLIC_RELEASE_OWNER_UIDS") || read("RELEASE_OWNER_EMAILS");
  return ENV_VARS.filter((v) => groups.includes(v.group))
    .filter((v) => {
      if (v.name === "RELEASE_OWNER_UIDS" || v.name === "RELEASE_OWNER_EMAILS") return !ownerSet;
      return !read(v.name);
    })
    .map((v) => ({ ...v }));
}
