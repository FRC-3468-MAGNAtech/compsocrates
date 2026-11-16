import "server-only";
import { del, list, put } from "@vercel/blob";
import { AVATAR_PATH_PREFIX } from "@/lib/avatar/model";
import { blobStore, storeIdFromToken } from "@/lib/blob/stores";

// Session 8: the avatar routes' only contact with Vercel Blob, behind a small interface so tests can use a fake store.

export type AvatarBlobStore = {
  /** Stores bytes at EXACTLY this path (the random part is already in it) and returns the public URL. */
  put(path: string, data: Buffer, contentType: string): Promise<{ url: string }>;
  /** Deletes blobs by URL; a blob that is already gone is not an error. */
  remove(urls: string[]): Promise<void>;
  /** Every blob URL under a path prefix (all pages). */
  listUrls(prefix: string): Promise<string[]>;
};

export const vercelAvatarStore = (token: string): AvatarBlobStore => ({
  async put(path, data, contentType) {
    // `access` comes from the helper: it must match how the public store was created (a mismatch is a Blob error, never silent).
    const blob = await put(path, data, { access: blobStore("avatars").access, contentType, addRandomSuffix: false, allowOverwrite: false, token });
    return { url: blob.url };
  },
  async remove(urls) {
    // This token only ever acts on ITS OWN store: a URL on another host is skipped, never sent to the service with this token.
    const id = storeIdFromToken(token);
    const own = urls.filter((u) => {
      try {
        return id !== null && new URL(u).hostname.toLowerCase().startsWith(`${id}.`);
      } catch {
        return false;
      }
    });
    if (own.length > 0) await del(own, { token });
  },
  async listUrls(prefix) {
    const urls: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000, token });
      urls.push(...page.blobs.map((b) => b.url));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return urls;
  },
});

/** The store host the app's own Blob URLs have: `<storeId>.public.blob.vercel-storage.com`, the store id being a part of the read-write token. Null when it cannot be told. */
export function storeHostFromToken(token: string | null | undefined): string | null {
  const id = storeIdFromToken(token);
  return id ? `${id}.public.blob.vercel-storage.com` : null;
}

/** The host the browser may trust for avatar URLs (also served by /api/public/config): the PUBLIC store's. */
export const avatarStoreHost = (): string | null => storeHostFromToken(blobStore("avatars").token);

/**
 * Deletes EVERY blob under `avatars/<uid>/` (it lists the prefix, so stray files that no document points at go too), not only the stored path.
 * This is the hook for the later account-deletion job (see docs/SESSION8_RESULTS.md). Resolves with how many blobs were removed; a missing token throws.
 */
export async function deleteAvatarBlobs(uid: string, store?: AvatarBlobStore): Promise<number> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error("bad uid");
  const s = store ?? vercelAvatarStore(requireToken());
  const urls = await s.listUrls(`${AVATAR_PATH_PREFIX}${uid}/`);
  await s.remove(urls);
  return urls.length;
}

export function requireToken(): string {
  const { token, envName } = blobStore("avatars");
  if (!token) throw new Error(`not-configured: set ${envName}`);
  return token;
}
