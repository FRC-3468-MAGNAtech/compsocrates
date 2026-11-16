// Browser side of photo uploads: talks to /api/blob/upload (token) + Vercel Blob (bytes), and /api/blob/delete.
import { upload } from "@vercel/blob/client";
import { DEFAULT_PROGRAM, type ProgramId } from "@/config/programs/types";
import { isStoreAccessMismatch, STORE_ACCESS_MISMATCH, storeAccessMismatchText } from "@/lib/blob/errors";

export type UploadResult = { url: string; pathname: string; size: number; contentType: string };

/** `getToken` returns a fresh Firebase ID token (e.g. `() => user.getIdToken()`), sent as `Authorization: Bearer`. */
export type GetToken = () => Promise<string>;

export class BlobUploadError extends Error {
  /** false for failures a retry can't fix (not signed in, forbidden, bad request); the queue still retries, but the UI can say why. */
  readonly retryable: boolean;
  /** `store-access-mismatch` when the Blob store's access mode is not the one the app uses; otherwise undefined. */
  readonly code?: string;
  constructor(message: string, retryable: boolean, code?: string) {
    super(message);
    this.name = "BlobUploadError";
    this.retryable = retryable;
    this.code = code;
  }
}

/**
 * Uploads one already-compressed photo straight to Vercel Blob (bytes don't pass through our server).
 * `clientPayload` is the JSON string `{ formId, kind, teamId, eventCode, teamNumber }`.
 */
export async function uploadImageBlob(input: { blob: Blob; path: string; clientPayload: string; getToken: GetToken }): Promise<UploadResult> {
  const { blob, path, clientPayload, getToken } = input;
  try {
    const token = await getToken();
    const result = await upload(path, blob, {
      // The store is public: anyone with the (unguessable) URL can view the photo.
      access: "public",
      handleUploadUrl: "/api/blob/upload",
      clientPayload,
      headers: { Authorization: `Bearer ${token}` },
      contentType: blob.type || "image/jpeg",
    });
    return { url: result.url, pathname: result.pathname, size: blob.size, contentType: result.contentType || blob.type };
  } catch (err) {
    // An access-mode mismatch (the store is not public) gets a friendly line (plus the developer detail outside production), never the SDK's raw text.
    if (isStoreAccessMismatch(err)) throw new BlobUploadError(storeAccessMismatchText(), false, STORE_ACCESS_MISMATCH);
    throw new BlobUploadError(err instanceof Error ? err.message : "Upload failed.", true);
  }
}

/** Deletes a photo by its blob URL. Server allows the uploader or an admin only. Throws BlobUploadError with the server's message. */
export async function deleteImageBlob(url: string, getToken: GetToken, program?: ProgramId): Promise<void> {
  const res = await fetch("/api/blob/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await getToken()}` },
    body: JSON.stringify({ url, ...(program && program !== DEFAULT_PROGRAM ? { program } : {}) }),
  });
  if (res.ok) return;
  const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  // The route's 502 `store-access-mismatch` text is already the friendly line (and the developer detail outside production).
  throw new BlobUploadError(data?.error ?? "Couldn't delete that photo.", res.status >= 500 && data?.code !== STORE_ACCESS_MISMATCH, data?.code === STORE_ACCESS_MISMATCH ? STORE_ACCESS_MISMATCH : undefined);
}
