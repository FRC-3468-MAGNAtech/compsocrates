import "server-only";
import { EVENT_CONFIG } from "@/config/event";
import type { ActionError } from "@/lib/events/types";

/**
 * Shared HTTP helper for the three FRC data APIs. Mirrors lib/ftc/http.ts: same error codes
 * (`ActionErrorCode`), same short in-memory cache that dedupes concurrent and repeat requests
 * (server-local, reset on cold start; the client has its own longer cache in use-event-query.ts).
 *
 * Keys are server-only env vars. There is exactly one server key per API:
 *   TBA_API_KEY, FIRST_API_USERNAME + FIRST_API_TOKEN. Statbotics needs none.
 * CS's per-team encrypted TBA keys are not used. A caller may later pass `apiKey` (a team's own
 * TBA key, decrypted on the server) to `frcFetch`; the cache is keyed by URL only, which is safe
 * because the same URL returns the same data whichever key asks.
 */

export type FrcSource = "tba" | "first" | "statbotics";

export class FrcApiError extends Error {
  code: ActionError["code"];
  constructor(code: ActionError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const SOURCE_LABEL: Record<FrcSource, string> = {
  tba: "The Blue Alliance",
  first: "FIRST FRC API",
  statbotics: "Statbotics",
};

/** Short on purpose: a live event changes every few minutes, and the scores poller wants fresh data. */
export const FRC_CACHE_TTL_MS = 60 * 1000;

const dedupeCache = new Map<string, { expires: number; promise: Promise<unknown> }>();

/** Test hook: forget every cached response. */
export function clearFrcCache(): void {
  dedupeCache.clear();
}

export function getTbaKey(): string | null {
  const key = (process.env.TBA_API_KEY ?? "").trim();
  return key || null;
}

export function getFirstCredentials(): { username: string; token: string } | null {
  const username = (process.env.FIRST_API_USERNAME ?? "").trim();
  const token = (process.env.FIRST_API_TOKEN ?? "").trim();
  if (!username || !token) return null;
  return { username, token };
}

export type FrcFetchOptions = {
  query?: Record<string, string | number | undefined>;
  /** Overrides the server TBA key for this call (a future per-team key). Ignored for the other sources. */
  apiKey?: string;
};

function baseUrlFor(source: FrcSource): string {
  return EVENT_CONFIG.apis[source].baseUrl;
}

export function buildFrcUrl(source: FrcSource, path: string, query?: FrcFetchOptions["query"]): string {
  const url = new URL(`${baseUrlFor(source)}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function authHeaders(source: FrcSource, apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (source === "tba") {
    const key = apiKey?.trim() || getTbaKey();
    if (!key) throw new FrcApiError("missing_credentials", "TBA_API_KEY is not configured.");
    headers["X-TBA-Auth-Key"] = key;
  } else if (source === "first") {
    const credentials = getFirstCredentials();
    if (!credentials) {
      throw new FrcApiError("missing_credentials", "FIRST_API_USERNAME / FIRST_API_TOKEN are not configured.");
    }
    headers.Authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.token}`).toString("base64")}`;
  }
  return headers;
}

async function fetchJson<T>(source: FrcSource, url: string, apiKey?: string): Promise<T> {
  const label = SOURCE_LABEL[source];
  const headers = authHeaders(source, apiKey);

  let response: Response;
  try {
    response = await fetch(url, { headers, cache: "no-store" });
  } catch {
    throw new FrcApiError("network_error", `Could not reach ${label}.`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new FrcApiError("unauthorized", `${label} rejected the configured credentials.`);
  }
  if (response.status === 404) throw new FrcApiError("not_found", "The requested resource was not found.");
  if (response.status === 429) throw new FrcApiError("rate_limited", `${label} rate limit was hit. Try again shortly.`);
  if (!response.ok) throw new FrcApiError("upstream_error", `${label} returned ${response.status}.`);

  try {
    return (await response.json()) as T;
  } catch {
    throw new FrcApiError("upstream_error", `${label} returned an unreadable response.`);
  }
}

/** GET + JSON with the shared cache and error mapping. Throws `FrcApiError`. */
export function frcFetch<T>(source: FrcSource, path: string, options: FrcFetchOptions = {}): Promise<T> {
  const url = buildFrcUrl(source, path, options.query);
  const now = Date.now();
  const cached = dedupeCache.get(url);
  if (cached && cached.expires > now) return cached.promise as Promise<T>;

  // Credentials are checked inside fetchJson, so a missing key rejects the promise and is never cached.
  const promise = fetchJson<T>(source, url, options.apiKey);
  dedupeCache.set(url, { expires: now + FRC_CACHE_TTL_MS, promise });
  promise.catch(() => dedupeCache.delete(url));
  return promise;
}
