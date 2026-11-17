import "server-only";
import { EVENT_CONFIG } from "@/config/event";
import { firstApiCredentials, firstApiMissingNames, tbaApiKey } from "@/lib/server/env";
import type { ActionError } from "@/lib/events/types";

/**
 * Shared HTTP helper for the three FRC data APIs: one error type with `ActionErrorCode`s, and a short in-memory cache that
 * dedupes concurrent and repeat requests (server-local, reset on cold start; the client has its own longer cache in
 * use-event-query.ts).
 *
 * Keys come only from lib/server/env.ts, and only on the server: `NEXT_PUBLIC_TBA_API_KEY` (the CompSocrates name; it is
 * never referenced from client code, so it is not inlined into a browser bundle) and `FIRST_API_USERNAME` +
 * `FIRST_API_TOKEN`. Statbotics needs none. There are no per-team keys.
 *
 * Failure is loud and never cached: a missing key throws `missing_credentials`, a key the API rejects throws
 * `unauthorized`, and both messages name the variable to fix. Only a successful response is kept in the cache.
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

export type FrcFetchOptions = {
  query?: Record<string, string | number | undefined>;
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

/** What to tell the user when this source's key is unset or refused. */
function keyHint(source: FrcSource): string {
  if (source === "tba") return "NEXT_PUBLIC_TBA_API_KEY";
  if (source === "first") return "FIRST_API_USERNAME and FIRST_API_TOKEN";
  return "";
}

function authHeaders(source: FrcSource): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (source === "tba") {
    const key = tbaApiKey();
    if (!key) throw new FrcApiError("missing_credentials", "TBA key is not configured: set NEXT_PUBLIC_TBA_API_KEY.");
    headers["X-TBA-Auth-Key"] = key;
  } else if (source === "first") {
    const credentials = firstApiCredentials();
    if (!credentials) {
      throw new FrcApiError("missing_credentials", `FIRST API credentials are not configured: set ${firstApiMissingNames().join(" and ") || keyHint("first")}.`);
    }
    headers.Authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.token}`).toString("base64")}`;
  }
  return headers;
}

async function fetchJson<T>(source: FrcSource, url: string): Promise<T> {
  const label = SOURCE_LABEL[source];
  const headers = authHeaders(source);

  let response: Response;
  try {
    response = await fetch(url, { headers, cache: "no-store" });
  } catch {
    throw new FrcApiError("network_error", `Could not reach ${label}.`);
  }

  if (response.status === 401 || response.status === 403) {
    const hint = keyHint(source);
    throw new FrcApiError("unauthorized", hint ? `${label} rejected the configured key: check ${hint}.` : `${label} refused the request (${response.status}).`);
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

  // Credentials are checked inside fetchJson, so a missing key rejects the promise; every rejection is dropped from the
  // cache below, so an error is never served twice.
  const promise = fetchJson<T>(source, url);
  dedupeCache.set(url, { expires: now + FRC_CACHE_TTL_MS, promise });
  promise.catch(() => {
    if (dedupeCache.get(url)?.promise === promise) dedupeCache.delete(url);
  });
  return promise;
}
