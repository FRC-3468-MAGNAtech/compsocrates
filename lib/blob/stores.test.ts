import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the two environment getters are mocked; no real Blob store is contacted.
const mocks = vi.hoisted(() => ({ pub: vi.fn(), legacy: vi.fn() }));
vi.mock("@/lib/server/env", () => ({ publicBlobToken: mocks.pub, blobToken: mocks.legacy }));

import { blobStore, parseBlobHost, storeIdFromToken, tokenForBlobUrl } from "./stores";

const PUB = "vercel_blob_rw_pubstore1_secretaaaa";
const LEG = "vercel_blob_rw_legstore1_secretbbbb";
const pubUrl = (path = "avatars/u1/a.webp") => `https://pubstore1.public.blob.vercel-storage.com/${path}`;
const legUrl = (path = "forms/old.jpg") => `https://legstore1.private.blob.vercel-storage.com/${path}`;

beforeEach(() => {
  mocks.pub.mockReset().mockReturnValue(PUB);
  mocks.legacy.mockReset().mockReturnValue(LEG);
});

describe("blobStore", () => {
  it("avatars and form photos both use the PUBLIC store's token with access public (never the legacy token)", () => {
    for (const purpose of ["avatars", "formPhotos"] as const) {
      const s = blobStore(purpose);
      expect(s.token).toBe(PUB);
      expect(s.access).toBe("public");
      expect(s.envName).toBe("BLOB_PUBLIC_READ_WRITE_TOKEN");
    }
  });
  it("a missing public token is null even when the legacy token is set, and names the public variable", () => {
    mocks.pub.mockReturnValue(null);
    const s = blobStore("avatars");
    expect(s.token).toBeNull();
    expect(s.envName).toBe("BLOB_PUBLIC_READ_WRITE_TOKEN");
  });
});

describe("store ids and hosts", () => {
  it("reads the store id from a read-write token, lower-cased; null for anything else", () => {
    expect(storeIdFromToken("vercel_blob_rw_AbCdEf123_secret")).toBe("abcdef123");
    for (const bad of ["", null, undefined, "nonsense", "vercel_blob_rw_x_secret", "other_blob_rw_abcdef123_s"]) expect(storeIdFromToken(bad as string)).toBeNull();
  });
  it("parses public and private store hosts only", () => {
    expect(parseBlobHost("pubstore1.public.blob.vercel-storage.com")).toEqual({ id: "pubstore1", kind: "public" });
    expect(parseBlobHost("LegStore1.private.blob.vercel-storage.com")).toEqual({ id: "legstore1", kind: "private" });
    for (const bad of ["example.com", "pubstore1.blob.vercel-storage.com", "evil.com.public.blob.vercel-storage.com.evil.test", "a.public.blob.vercel-storage.com"]) expect(parseBlobHost(bad)).toBeNull();
  });
});

describe("tokenForBlobUrl: the token follows the URL's host", () => {
  it("a file in the public store is handled with the public token", () => {
    expect(tokenForBlobUrl(pubUrl())).toEqual({ ok: true, token: PUB, store: "public" });
  });
  it("a file in the legacy store is handled with the legacy token", () => {
    expect(tokenForBlobUrl(legUrl())).toEqual({ ok: true, token: LEG, store: "legacy" });
  });
  it("an unknown host, another store's id, or a malformed URL is refused (400), never given a token", () => {
    for (const url of ["https://example.com/a.jpg", "https://otherstore9.public.blob.vercel-storage.com/a.jpg", "https://otherstore9.private.blob.vercel-storage.com/a.jpg", "not a url", ""]) {
      const r = tokenForBlobUrl(url);
      expect(r.ok, url).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(400);
        expect(r.code).toBe("unknown-store");
      }
    }
  });
  it("a public-host URL is never given the legacy token, and a private-host URL is never given the public token", () => {
    // The ids are swapped: the public host carries the legacy store's id, and vice versa.
    expect(tokenForBlobUrl("https://legstore1.public.blob.vercel-storage.com/a.jpg").ok).toBe(false);
    expect(tokenForBlobUrl("https://pubstore1.private.blob.vercel-storage.com/a.jpg").ok).toBe(false);
  });
  it("a matching store whose variable is unset is a 503 naming that variable", () => {
    mocks.pub.mockReturnValue(null);
    const a = tokenForBlobUrl(pubUrl());
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(a.status).toBe(503);
      expect(a.code).toBe("not-configured");
      expect(a.message).toContain("BLOB_PUBLIC_READ_WRITE_TOKEN");
    }
    mocks.legacy.mockReturnValue(null);
    const b = tokenForBlobUrl(legUrl());
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.status).toBe(503);
      expect(b.message).toContain("BLOB_READ_WRITE_TOKEN");
      expect(b.message).not.toContain("BLOB_PUBLIC");
    }
  });
});
