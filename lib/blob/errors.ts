// Shared by the avatar routes, the form-photo routes and the browser: how a Vercel Blob failure is classified. No env, no server-only imports.
//
// What @vercel/blob produces (read in node_modules/@vercel/blob/dist/chunk-XKVPKJPO.js, getBlobError): it has NO error class for an access-mode mismatch. Every
// failure is a `BlobError` whose message starts with "Vercel Blob: "; only a `bad_request` answer keeps the service's own text, every other code becomes a fixed
// message ("Access denied, please provide a valid token for this resource.", "This store does not exist.", "Unknown error, please visit https://vercel.com/help.").
// So a mismatch is recognised from the service text it passes through: a message that talks about public/private access AND a store. The exact wording of the
// live service could not be checked here (no real Blob calls); this pattern covers "Cannot use public access on a private store..." and its mirror. Anything else
// stays a plain store failure, and the server log keeps the full message so the pattern can be tightened.

export const STORE_ACCESS_MISMATCH = "store-access-mismatch";
export const STORE_FAILED = "store-failed";
/** The user-facing line (never names a store or a variable). */
export const STORE_ACCESS_MISMATCH_FRIENDLY = "Photo uploads aren't available right now. Please tell a team admin.";
/** The developer-facing detail, shown in development only. */
export const STORE_ACCESS_MISMATCH_DETAIL = "Blob store access mode does not match";

const MISMATCH_PATTERNS: RegExp[] = [
  /\b(public|private)\b[^.]{0,40}\baccess\b[^.]{0,60}\b(public|private)\b[^.]{0,20}\bstore\b/i,
  /\bstore\b[^.]{0,60}\b(configured|created|set up)\b[^.]{0,40}\b(public|private)\b[^.]{0,20}\baccess\b/i,
  /\b(public|private)\b[^.]{0,20}\bstore\b[^.]{0,80}\b(public|private)\b[^.]{0,20}\baccess\b/i,
];

export function isStoreAccessMismatch(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (!message) return false;
  return MISMATCH_PATTERNS.some((p) => p.test(message));
}

export const isDevelopment = (): boolean => process.env.NODE_ENV !== "production";

/** The text for a mismatch: the friendly line, plus the developer detail outside production. */
export function storeAccessMismatchText(dev: boolean = isDevelopment()): string {
  return dev ? `${STORE_ACCESS_MISMATCH_FRIENDLY} (${STORE_ACCESS_MISMATCH_DETAIL})` : STORE_ACCESS_MISMATCH_FRIENDLY;
}

/** `store-access-mismatch` or the given fallback code (`store-failed`) for any other failure. */
export const classifyBlobError = (err: unknown, fallback: string = STORE_FAILED): string => (isStoreAccessMismatch(err) ? STORE_ACCESS_MISMATCH : fallback);
