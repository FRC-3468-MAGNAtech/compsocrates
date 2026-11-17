import { afterEach, describe, expect, it, vi } from "vitest";

// The browser SDK upload and fetch are mocked; no network, no Blob store.
const mocks = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@vercel/blob/client", () => ({ upload: mocks.upload }));

import { BlobUploadError, deleteImageBlob, uploadImageBlob } from "./client";

const input = { blob: new Blob(["x"], { type: "image/jpeg" }), path: "forms/t1/a.jpg", clientPayload: "{}", getToken: async () => "firebase-token" };
const MISMATCH = "Vercel Blob: Cannot use public access on a private store. The store is configured for private access.";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mocks.upload.mockReset();
});

describe("uploadImageBlob", () => {
  it("always asks for access public", async () => {
    mocks.upload.mockResolvedValue({ url: "https://s.public.blob.vercel-storage.com/a.jpg", pathname: "a.jpg", contentType: "image/jpeg" });
    await uploadImageBlob(input);
    expect(mocks.upload.mock.calls[0][2].access).toBe("public");
  });
  it("maps an access-mode mismatch to store-access-mismatch with the friendly line (plus the developer detail outside production), not retryable", async () => {
    mocks.upload.mockRejectedValue(new Error(MISMATCH));
    vi.stubEnv("NODE_ENV", "development");
    const err = await uploadImageBlob(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BlobUploadError);
    expect((err as BlobUploadError).code).toBe("store-access-mismatch");
    expect((err as BlobUploadError).retryable).toBe(false);
    expect((err as BlobUploadError).message).toContain("Photo uploads aren't available right now");
    expect((err as BlobUploadError).message).toContain("Blob store access mode does not match");
    vi.stubEnv("NODE_ENV", "production");
    const prod = await uploadImageBlob(input).catch((e: unknown) => e);
    expect((prod as BlobUploadError).message).toBe("Photo uploads aren't available right now. Please tell a team admin.");
  });
  it("any other failure keeps its own message and stays retryable", async () => {
    mocks.upload.mockRejectedValue(new Error("Vercel Blob: Unknown error, please visit https://vercel.com/help."));
    const err = (await uploadImageBlob(input).catch((e: unknown) => e)) as BlobUploadError;
    expect(err.code).toBeUndefined();
    expect(err.retryable).toBe(true);
    expect(err.message).toContain("Unknown error");
  });
});

describe("deleteImageBlob", () => {
  it("carries the route's store-access-mismatch code and message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({ ok: false, code: "store-access-mismatch", error: "Photo uploads aren't available right now. Please tell a team admin." }) }));
    const err = (await deleteImageBlob("https://s.public.blob.vercel-storage.com/a.jpg", async () => "t").catch((e: unknown) => e)) as BlobUploadError;
    expect(err.code).toBe("store-access-mismatch");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("Photo uploads aren't available right now");
  });
  it("a plain server error stays retryable with the server's text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ ok: false, code: "error", error: "Something went wrong." }) }));
    const err = (await deleteImageBlob("https://s.public.blob.vercel-storage.com/a.jpg", async () => "t").catch((e: unknown) => e)) as BlobUploadError;
    expect(err.code).toBeUndefined();
    expect(err.retryable).toBe(true);
  });
});
