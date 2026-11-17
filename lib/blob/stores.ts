import { blobToken, publicBlobToken } from "@/lib/server/env";

// The ONE place that says which Vercel Blob store a purpose uses, with which token and `access` value. The SDK only reads BLOB_READ_WRITE_TOKEN by itself
// (the legacy PRIVATE store); the public store was connected with the prefix BLOB_PUBLIC, so its token is always passed explicitly. Never log or return a token.

export type BlobPurpose = "avatars" | "formPhotos";

export const PUBLIC_BLOB_ENV = "BLOB_PUBLIC_READ_WRITE_TOKEN";
export const LEGACY_BLOB_ENV = "BLOB_READ_WRITE_TOKEN";

export type BlobStoreConfig = {
  /** The read-write token, or null when the variable is unset. */
  token: string | null;
  /** The `access` value every put() / upload() for this purpose must pass. It must match how the store was created. */
  access: "public";
  /** The variable that holds the token (for "not set" messages). */
  envName: string;
};

/** Profile pictures and form photos both live in the PUBLIC store. */
export function blobStore(_purpose: BlobPurpose): BlobStoreConfig {
  void _purpose;
  return { token: publicBlobToken(), access: "public", envName: PUBLIC_BLOB_ENV };
}

/** The store id is the fourth part of `vercel_blob_rw_<id>_<secret>`; lower-cased because URL hosts are. */
export function storeIdFromToken(token: string | null | undefined): string | null {
  const parts = (token ?? "").split("_");
  const id = parts.length >= 4 && parts[0] === "vercel" && parts[1] === "blob" ? parts[3] : "";
  return /^[A-Za-z0-9]{6,64}$/.test(id) ? id.toLowerCase() : null;
}

/** `<id>.public.blob.vercel-storage.com` or `<id>.private.blob.vercel-storage.com`; null for any other host. */
export function parseBlobHost(host: string): { id: string; kind: "public" | "private" } | null {
  const m = /^([a-z0-9]{6,64})\.(public|private)\.blob\.vercel-storage\.com$/.exec(host.toLowerCase());
  return m ? { id: m[1], kind: m[2] as "public" | "private" } : null;
}

export type DeleteTokenChoice =
  | { ok: true; token: string; store: "public" | "legacy" }
  | { ok: false; status: 400 | 503; code: "unknown-store" | "not-configured"; message: string };

/**
 * The token to delete (or list) a blob with, chosen by the blob URL's HOST, never by guess: a `.public.` host needs the public token and a `.private.` host the
 * legacy one, and the host's store id must be the id inside that token. A URL on any other host or store is refused, so one store's token is never sent to act on
 * a blob in another. A matching store whose variable is unset is a 503 naming the variable.
 */
export function tokenForBlobUrl(url: string): DeleteTokenChoice {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { ok: false, status: 400, code: "unknown-store", message: "That isn't one of our photo links." };
  }
  const parsed = parseBlobHost(host);
  if (!parsed) return { ok: false, status: 400, code: "unknown-store", message: "That isn't one of our photo links." };
  const store = parsed.kind === "public" ? ("public" as const) : ("legacy" as const);
  const envName = store === "public" ? PUBLIC_BLOB_ENV : LEGACY_BLOB_ENV;
  const token = store === "public" ? publicBlobToken() : blobToken();
  if (!token) return { ok: false, status: 503, code: "not-configured", message: `Photo storage isn't set up on this server: set ${envName}.` };
  if (storeIdFromToken(token) !== parsed.id) return { ok: false, status: 400, code: "unknown-store", message: "That isn't one of our photo links." };
  return { ok: true, token, store };
}
